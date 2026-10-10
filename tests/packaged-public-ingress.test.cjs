'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const caddyBin = process.env.CADDY_TEST_BIN;

test('actual materialized LACK serves its referenced login/workspace scripts through verified HTTPS', {skip: !caddyBin, timeout: 30000}, async t => {
  const {createPackagedIngressFixture} = require('./helpers/packaged-ingress-fixture.cjs');
  const fixture = await createPackagedIngressFixture({caddyBin}); t.after(() => fixture.close());
  for (const page of ['/', '/login']) {
    const response = await fixture.request('web', page);
    assert.equal(response.status, 200, page);
    const scripts = [...response.text.matchAll(/<script\b[^>]*\bsrc=["'](\/[^"']+)["']/g)].map(match => match[1]);
    assert.ok(scripts.includes('/identity/workspace-ui.js'), page + ' must reference the real identity controller');
    for (const script of scripts) {
      const asset = await fixture.request('web', script);
      assert.equal(asset.status, 200, 'Referenced script unavailable: ' + script);
      assert.match(asset.headers['content-type'], /javascript/);
    }
  }
  assert.equal((await fixture.request('web', '/health')).status, 200);
  assert.equal((await fixture.request('agents', '/login')).status, 404);
  assert.equal((await fixture.request('web', '/identity/store.cjs')).status, 404);
  for (const path of ['/identity/unapproved.js', '/api/llm-providers/extra', '/ws/workspaces']) {
    assert.equal((await fixture.request('web', path)).status, 404, path);
  }
  for (const path of ['/identity/workspace-ui.js', '/api/llm-providers', '/ws/workspaces/' + fixture.workspaceId]) {
    assert.equal((await fixture.request('web', path, {method: 'POST', json: {}})).status, 404, path);
  }
});

test('actual packaged HTTPS API preserves sessions, Origin/CSRF and current workspace authorization across ingress', {skip: !caddyBin, timeout: 30000}, async t => {
  const {createPackagedIngressFixture} = require('./helpers/packaged-ingress-fixture.cjs');
  const fixture = await createPackagedIngressFixture({caddyBin}); t.after(() => fixture.close());
  const forbidden = await fixture.request('web', '/auth/login', {method: 'POST', headers: {Origin: 'https://rogue.fixture.invalid'}, json: fixture.credentials});
  assert.equal(forbidden.status, 403);
  const login = await fixture.login();
  assert.match(login.cookie, /^__Host-chunlack_session=/); assert.equal(typeof login.csrfToken, 'string');
  const members = await fixture.request('web', '/api/workspaces/' + fixture.workspaceId + '/members', {headers: {Cookie: login.cookie, 'X-Workspace-Id': fixture.workspaceId}});
  assert.equal(members.status, 200);
  assert.ok(JSON.parse(members.text).members.some(member => member.login === fixture.credentials.login));
  const cross = await fixture.request('web', '/api/workspaces/' + fixture.otherWorkspaceId + '/members', {headers: {Cookie: login.cookie, 'X-Workspace-Id': fixture.otherWorkspaceId}});
  assert.equal(cross.status, 404);
  assert.deepEqual(JSON.parse(cross.text), {error: 'not_found'});
  const providers = await fixture.request('web', '/api/llm-providers', {headers: {Cookie: login.cookie, 'X-Workspace-Id': fixture.workspaceId}});
  assert.equal(providers.status, 200);
  assert.doesNotThrow(() => JSON.parse(providers.text));
  const missingCsrf = await fixture.request('web', '/auth/logout', {method: 'POST', headers: {Cookie: login.cookie, Origin: fixture.webOrigin}, json: {}});
  assert.equal(missingCsrf.status, 403);
  const logout = await fixture.request('web', '/auth/logout', {method: 'POST', headers: {Cookie: login.cookie, Origin: fixture.webOrigin, 'X-CSRF-Token': login.csrfToken}, json: {}});
  assert.equal(logout.status, 200);
  const oldSession = await fixture.request('web', '/api/workspaces/' + fixture.workspaceId + '/members', {headers: {Cookie: login.cookie, 'X-Workspace-Id': fixture.workspaceId}});
  assert.equal(oldSession.status, 401);
});

test('actual packaged WSS uses the scoped path and shared identity, while agents REST/MCP never expose human or global administration routes', {skip: !caddyBin, timeout: 30000}, async t => {
  const {createPackagedIngressFixture} = require('./helpers/packaged-ingress-fixture.cjs');
  const fixture = await createPackagedIngressFixture({caddyBin}); t.after(() => fixture.close());
  const login = await fixture.login(), socket = await fixture.connect({cookie: login.cookie, workspaceId: fixture.workspaceId});
  socket.send(JSON.stringify({type: 'join', channelId: 'general'}));
  socket.send(JSON.stringify({type: 'message', channelId: 'general', content: 'ACTUAL_TLS_WORKSPACE_MESSAGE', username: 'FORGED_TLS_SENDER'}));
  const frame = await fixture.frame(socket, value => value.type === 'new_message');
  assert.ok(JSON.stringify(frame).includes('ACTUAL_TLS_WORKSPACE_MESSAGE'));
  assert.ok(!JSON.stringify(frame).includes('FORGED_TLS_SENDER'));
  await assert.rejects(fixture.connect({cookie: login.cookie, workspaceId: fixture.otherWorkspaceId}), /Unexpected server response: 404/);
  assert.equal((await fixture.request('agents', '/v1/agents/me')).status, 401);
  assert.equal((await fixture.request('agents', '/mcp', {method: 'POST', json: {jsonrpc: '2.0', id: 1, method: 'tools/list'}})).status, 401);
  for (const path of ['/v1/admin/nodes', '/v1/pair', '/auth/me', '/api/workspaces']) assert.equal((await fixture.request('agents', path)).status, 404, path);
  assert.equal((await fixture.request('web', '/v1/agents/me')).status, 404);
  assert.equal((await fixture.request('web', '/mcp', {method: 'POST', json: {}})).status, 404);
});
