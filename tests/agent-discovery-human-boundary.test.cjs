'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {publicAgentFixture} = require('./helpers/public-agent-fixture.cjs');

test('normal Agent runtime keeps the foreign workspace independently owned and ungranted', {timeout: 60000}, async t => {
  const f = await publicAgentFixture(t, {foreignWorkspace: true});
  assert.deepEqual(Object.keys(f.grants).sort(), ['a', 'b']);
  assert.notEqual(f.user.id, f.otherUser.id);
  assert.throws(() => f.runtime.identity.requireMembership(f.user.id, f.workspaces.c.id));
  assert.throws(() => f.runtime.identity.requireMembership(f.otherUser.id, f.workspaces.a.id));
  const read = async (workspace, cookie) => {
    const response = await fetch(`http://127.0.0.1:${f.ports[0]}/api/workspaces/${workspace}/agent-grants`, {
      headers: {Cookie: cookie}, signal: AbortSignal.timeout(8000)});
    return {status: response.status, body: await response.json()};
  };
  const own = await read(f.workspaces.c.id, f.foreignCookie);
  assert.equal(own.status, 200); assert.deepEqual(own.body.grants, []);
  const denied = await read(f.workspaces.c.id, f.humanCookie);
  const missing = await read('99999999-9999-4999-8999-999999999999', f.humanCookie);
  assert.equal(denied.status, 404); assert.deepEqual(denied.body, missing.body);
  const connections = await f.rpc('tools/call', {name: 'chunlack_connections_list', arguments: {}});
  assert.equal(connections.status, 200);
  assert.deepEqual(connections.body.result.structuredContent.connections.map(item => item.grantId).sort(),
    [f.grants.a.id, f.grants.b.id].sort());
  assert.equal(JSON.stringify(connections.body).includes(f.nodes.c.id), false);
});

test('discovery-only runtime makes no JWKS request while preserving scoped human HTTP and internal node reads', {timeout: 60000}, async t => {
  let jwksRequests = 0;
  // Observe the real runtime's calls before the fixture's external JWKS stub
  // handles them, including startup. Keep all other fixture behavior intact.
  const observed = {after: (...args) => t.after(...args), mock: {
    method(object, name, implementation, ...options) {
      if (object === globalThis && name === 'fetch') {
        return t.mock.method(object, name, function (url, ...args) {
          if (String(url) === 'https://pocket.e2e.invalid/jwks') jwksRequests++;
          return implementation.call(this, url, ...args);
        }, ...options);
      }
      return t.mock.method(object, name, implementation, ...options);
    }
  }};
  const f = await publicAgentFixture(observed, {discoveryOnly: true, foreignWorkspace: true});
  assert.equal(jwksRequests, 0, 'startup must not fetch keys');
  const humanBase = `http://127.0.0.1:${f.ports[0]}`;
  const read = async (route, workspace, authenticated = true) => {
    const response = await fetch(humanBase + route, {signal: AbortSignal.timeout(8000), headers: {
      Origin: 'https://lack.e2e.invalid', 'X-Workspace-Id': workspace,
      ...(authenticated ? {Cookie: authenticated === 'foreign' ? f.foreignCookie : f.humanCookie} : {})
    }});
    return {status: response.status, body: await response.json()};
  };
  for (const workspace of ['a', 'b']) {
    const nodes = await read('/api/nodes', f.workspaces[workspace].id);
    assert.equal(nodes.status, 200);
    assert.deepEqual(nodes.body.nodes.map(node => node.id), [f.nodes[workspace].id]);
    assert.equal(nodes.body.nodes[0].workspaceId, f.workspaces[workspace].id);
    const tasks = await read('/api/tasks', f.workspaces[workspace].id);
    assert.equal(tasks.status, 200);
    assert.equal(JSON.stringify(tasks.body).includes(f.tasks[workspace === 'a' ? 'b' : 'a'].taskId), false);
  }
  assert.equal((await read('/api/nodes', f.workspaces.a.id, false)).status, 401);
  assert.equal((await read('/api/nodes', '99999999-9999-4999-8999-999999999999')).status, 404);
  const foreignNodes = await read('/api/nodes', f.workspaces.c.id, 'foreign');
  assert.equal(foreignNodes.status, 200);
  assert.deepEqual(foreignNodes.body.nodes.map(node => node.id), [f.nodes.c.id]);
  assert.notEqual(f.user.id, f.otherUser.id);
  for (const route of ['/api/nodes', '/api/tasks']) {
    const foreign = await read(route, f.workspaces.c.id);
    const missing = await read(route, '99999999-9999-4999-8999-999999999999');
    assert.equal(foreign.status, 404); assert.deepEqual(foreign.body, missing.body);
    assert.equal((await read(route, f.workspaces.a.id, 'foreign')).status, 404);
  }
  for (const [workspace, cookie] of [['a', true], ['c', 'foreign']]) {
    const evidence = await read(`/api/tasks/${f.tasks[workspace].taskId}/evidence`, f.workspaces[workspace].id, cookie);
    assert.equal(evidence.status, 200); assert.equal(evidence.body.task.taskId, f.tasks[workspace].taskId);
  }
  const knownForeign = await read(`/api/tasks/${f.tasks.c.taskId}/evidence`, f.workspaces.a.id);
  const unknownTask = await read('/api/tasks/99999999-9999-4999-8999-999999999999/evidence', f.workspaces.a.id);
  assert.equal(knownForeign.status, 404); assert.deepEqual(knownForeign.body, unknownTask.body);
  assert.equal((await read(`/api/tasks/${f.tasks.a.taskId}/evidence`, f.workspaces.c.id, 'foreign')).status, 404);
  const paired = f.runtime.gateway.store.pair(f.nodes.a.pairingCode);
  const manifest = await fetch(`http://127.0.0.1:${f.ports[1]}/v1/manifest`, {
    signal: AbortSignal.timeout(8000), headers: {Authorization: 'Bearer ' + paired.token}
  });
  assert.equal(manifest.status, 200);
  const node = await manifest.json(); assert.equal(node.workspaceId, f.workspaces.a.id);
  assert.equal(JSON.stringify(node).includes(paired.token), false);
  assert.equal((await f.rpc('tools/list', {}, paired.token)).status, 401);
  assert.equal((await f.rpc('tools/list', {}, f.token())).status, 401);
  assert.equal(jwksRequests, 0, 'neither denied MCP request may fetch keys');
});

test('discovery-only packaged runtime preserves real human OIDC HTTP login, callback and logout', {timeout: 60000}, async t => {
  const f = await publicAgentFixture(t, {discoveryOnly: true, humanOidcEnabled: true, foreignWorkspace: true});
  const base = `http://127.0.0.1:${f.ports[0]}`, origin = 'https://lack.e2e.invalid';
  const request = (route, options = {}) => fetch(base + route, {signal: AbortSignal.timeout(8000), redirect: 'manual', ...options});
  const login = await request('/auth/oidc/login');
  assert.equal(login.status, 200); assert.match(await login.text(), /login-script/);
  const begin = await request('/auth/oidc/begin', {method: 'POST', headers: {Origin: origin, 'Content-Type': 'application/json'}, body: '{}'});
  assert.equal(begin.status, 200);
  const browser = begin.headers.getSetCookie().find(cookie => cookie.startsWith('__Host-chunlack_oidc='));
  assert.ok(browser);
  const browserCookie = browser.split(';')[0], callback = f.authorizeHuman((await begin.json()).url);
  const wrongBrowser = await request(callback);
  assert.equal(wrongBrowser.status, 401); await wrongBrowser.arrayBuffer();
  assert.equal(f.oidcRequests().token, 0);
  const completed = await request(callback, {headers: {Cookie: browserCookie}});
  assert.equal(completed.status, 303); assert.equal(completed.headers.get('location'), '/');
  const session = completed.headers.getSetCookie().find(cookie => cookie.startsWith('__Host-chunlack_session='));
  assert.ok(session); for (const flag of ['Secure', 'HttpOnly', 'SameSite=Lax', 'Path=/']) assert.ok(session.includes(flag));
  await completed.arrayBuffer();
  const cookie = browserCookie + '; ' + session.split(';')[0];
  assert.notEqual(session.split(';')[0], f.humanCookie, 'the accepted session must come from the HTTP callback');
  const meResponse = await request('/auth/me', {headers: {Cookie: cookie}});
  assert.equal(meResponse.status, 200); const me = await meResponse.json();
  assert.equal(me.user.id, f.user.id); assert.equal(me.access_token, undefined); assert.equal(me.id_token, undefined);
  const workspacesResponse = await request('/api/workspaces', {headers: {Cookie: cookie}});
  assert.equal(workspacesResponse.status, 200);
  assert.deepEqual((await workspacesResponse.json()).workspaces.map(workspace => workspace.id).sort(), [f.workspaces.a.id, f.workspaces.b.id].sort());
  const availability = await request(`/api/workspaces/${f.workspaces.a.id}/agent-grants`, {headers: {Cookie: cookie}});
  assert.equal(availability.status, 200); assert.deepEqual(await availability.json(), {available: false});
  const beforeDenial = f.oidcRequests();
  assert.equal(beforeDenial.token, 1); assert.ok(beforeDenial.metadata > 0); assert.ok(beforeDenial.jwks > 0);
  assert.equal((await f.rpc('tools/list', {}, f.token())).status, 401);
  assert.deepEqual(f.oidcRequests(), beforeDenial, 'Agent denial must not initiate another key or token request');
  const deniedLogout = await request('/auth/logout', {method: 'POST', headers: {Origin: origin, Cookie: cookie, 'Content-Type': 'application/json'}, body: '{}'});
  assert.equal(deniedLogout.status, 403); await deniedLogout.arrayBuffer();
  const logout = await request('/auth/logout', {method: 'POST', headers: {Origin: origin, Cookie: cookie, 'X-CSRF-Token': me.csrfToken, 'Content-Type': 'application/json'}, body: '{}'});
  assert.equal(logout.status, 200); assert.deepEqual(await logout.json(), {ok: true});
  const revoked = await request('/auth/me', {headers: {Cookie: cookie}});
  assert.equal(revoked.status, 401); await revoked.arrayBuffer();
  const replay = await request(callback, {headers: {Cookie: browserCookie}});
  assert.equal(replay.status, 401); await replay.arrayBuffer();
  assert.equal(f.oidcRequests().token, 1, 'replay must not exchange the already consumed authorization code');
});
