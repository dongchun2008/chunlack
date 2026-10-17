'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const {randomBytes, createHash, createHmac} = require('node:crypto');
const {agentAuthorityFixture} = require('./helpers/agent-authority-fixture.cjs');
const {createSessionService} = require('../identity/sessions.cjs');
const {createIdentityRouter} = require('../identity/http.cjs');
const origin = 'https://lack.admin.invalid';
const subject = '11111111-1111-4111-8111-111111111111';
const hash = value => createHash('sha256').update(value).digest('hex');

async function fixture(t, {enabled = true} = {}) {
  const cleanup = []; let sessions, server;
  t.after(async () => {
    if (server) {server.closeAllConnections(); await new Promise(resolve => server.close(resolve));}
    sessions?.close();
    for (const fn of cleanup) await fn();
  });
  const f = await agentAuthorityFixture({after: fn => cleanup.push(fn)});
  sessions = createSessionService({store: f.store, now: f.now});
  const app = express();
  app.use(createIdentityRouter({store: f.store, sessions, webOrigin: origin, ...(enabled ? {agentAuthority: f.authority} : {})}));
  server = await new Promise(resolve => {const value = app.listen(0, '127.0.0.1', () => resolve(value));});
  const base = `http://127.0.0.1:${server.address().port}`;
  function auth(name) {
    const token = randomBytes(32).toString('base64url');
    const csrf = createHmac('sha256', token).update('chunlack-csrf-v1').digest('base64url');
    f.store.createSessionRecord({userId: f.users[name].id, tokenHash: hash(token), csrfHash: hash(csrf),
      expectedPasswordHash: f.store.findUserForLogin(name).passwordHash, expiresAt: f.now() + 600000});
    return {cookie: '__Host-chunlack_session=' + token, csrf};
  }
  const path = workspace => `/api/workspaces/${f.workspaces[workspace].id}/agent-grants`;
  async function request(route, {method = 'GET', user, body, csrf = true, headers = {}} = {}) {
    const response = await fetch(base + route, {method, headers: {
      Origin: origin, ...(body === undefined ? {} : {'Content-Type': 'application/json'}),
      ...(user ? {Cookie: user.cookie, ...(csrf ? {'X-CSRF-Token': user.csrf} : {})} : {}), ...headers},
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000)});
    const text = await response.text(); let json; try {json = JSON.parse(text);} catch {}
    return {status: response.status, json, text};
  }
  const input = {subject, clientId: 'native-client', nodeId: f.nodes.a.id, scopes: ['task.read'], expiresAt: f.now() + 60000};
  const count = () => f.db.prepare('SELECT COUNT(*) AS n FROM agent_authority_grants').get().n;
  return {...f, auth, path, request, input, count};
}

test('owner can list, create and revoke grants through the real session router with an audit trail', async t => {
  const f = await fixture(t), user = f.auth('alice'), route = f.path('a');
  const empty = await f.request(route, {user});
  assert.equal(empty.status, 200); assert.deepEqual(empty.json.grants, []);
  assert.deepEqual(empty.json.clientIds, ['native-client']);
  const created = await f.request(route, {user, method: 'POST', body: f.input});
  assert.equal(created.status, 201, created.text); const id = created.json.grant.id;
  assert.equal(created.json.grant.workspaceId, f.workspaces.a.id);
  const listed = await f.request(route, {user});
  assert.equal(listed.status, 200); assert.deepEqual(listed.json.grants.map(grant => grant.id), [id]);
  assert.equal((await f.authority.discover(f.token())).connections[0].grantId, id);
  assert.ok(!listed.text.includes(user.cookie)); assert.ok(!listed.text.includes(user.csrf));
  assert.ok(!listed.text.includes('membership_epoch')); assert.ok(!listed.text.includes('password'));
  const revoked = await f.request(route + '/' + id, {user, method: 'DELETE', body: {}});
  assert.equal(revoked.status, 200, revoked.text); assert.equal(f.count(), 0);
  assert.deepEqual((await f.authority.discover(f.token())).connections, []);
  assert.deepEqual(f.db.prepare("SELECT action FROM audit WHERE action LIKE 'agent.grant.%' ORDER BY rowid").all().map(row => row.action),
    ['agent.grant.create', 'agent.grant.revoke']);
});

test('a valid Agent token never substitutes for a human session or grants itself authority', async t => {
  const f = await fixture(t), headers = {Authorization: 'Bearer ' + f.token()};
  for (const options of [{}, {headers}]) {
    assert.equal((await f.request(f.path('a'), options)).status, 401);
    assert.equal((await f.request(f.path('a'), {...options, method: 'POST', body: f.input})).status, 401);
  }
  assert.equal(f.count(), 0);
});

test('grant mutations require exact origin, JSON and valid CSRF before writing', async t => {
  const f = await fixture(t), user = f.auth('alice');
  for (const [extra, status] of [[{csrf: false}, 403], [{headers: {Origin: 'https://evil.invalid'}}, 403],
    [{headers: {'Content-Type': 'text/plain'}}, 415], [{headers: {'X-CSRF-Token': 'x'.repeat(43)}}, 403]]) {
    assert.equal((await f.request(f.path('a'), {method: 'POST', body: f.input, user, ...extra})).status, status);
  }
  assert.equal(f.count(), 0);
});

test('members and viewers cannot administer grants and foreign workspaces remain undisclosed', async t => {
  const f = await fixture(t);
  for (const [name, workspace] of [['bob', 'a'], ['carol', 'b']]) {
    const user = f.auth(name);
    assert.equal((await f.request(f.path(workspace), {user})).status, 403);
    assert.equal((await f.request(f.path(workspace), {user, method: 'POST', body: f.input})).status, 403);
    assert.equal((await f.request(f.path(workspace) + '/' + subject, {user, method: 'DELETE', body: {}})).status, 403);
  }
  const alice = f.auth('alice');
  const other = await f.request(f.path('b'), {user: alice, headers: {'X-Role': 'owner', 'X-User-ID': f.users.bob.id}});
  const missing = await f.request('/api/workspaces/does-not-exist/agent-grants', {user: alice});
  assert.equal(other.status, 404); assert.deepEqual(other.json, missing.json); assert.equal(f.count(), 0);
});

test('grant creation rejects injected identity fields, unknown subjects, foreign nodes and human client reuse', async t => {
  const f = await fixture(t), user = f.auth('alice');
  for (const [extra, status] of [[{workspaceId: f.workspaces.b.id}, 400], [{userId: f.users.bob.id}, 400], [{role: 'owner'}, 400],
    [{subject: '22222222-2222-4222-8222-222222222222'}, 403], [{nodeId: f.nodes.b.id}, 403],
    [{clientId: 'human-login-client'}, 400], [{scopes: ['admin']}, 400], [{expiresAt: f.now() + 30 * 86400000 + 1}, 400]]) {
    const response = await f.request(f.path('a'), {user, method: 'POST', body: {...f.input, ...extra}});
    assert.equal(response.status, status, response.text);
  }
  assert.equal(f.count(), 0);
});

test('duplicate creation and deletion payload injection do not widen grants; role changes take effect immediately', async t => {
  const f = await fixture(t), user = f.auth('alice'), route = f.path('a');
  const first = await f.request(route, {user, method: 'POST', body: f.input});
  assert.equal(first.status, 201, first.text);
  const second = await f.request(route, {user, method: 'POST', body: {...f.input, scopes: ['task.read', 'task.claim']}});
  assert.equal(second.status, 409); assert.equal(f.count(), 1);
  const id = first.json.grant.id;
  assert.equal((await f.request(route + '/' + id, {user, method: 'DELETE', body: {workspaceId: f.workspaces.b.id}})).status, 400);
  assert.equal(f.count(), 1);
  f.store.setMembership(f.actor('alice', 'a'), {workspaceId: f.workspaces.a.id, userId: f.users.bob.id, role: 'owner'});
  f.store.setMembership(f.actor('alice', 'a'), {workspaceId: f.workspaces.a.id, userId: f.users.alice.id, role: 'member'});
  assert.equal((await f.request(route, {user})).status, 403);
  assert.equal((await f.request(route + '/' + id, {user, method: 'DELETE', body: {}})).status, 403);
  assert.deepEqual((await f.authority.discover(f.token())).connections, []);
});

test('grant listing is scoped and disabled routing exposes only owner-readable availability', async t => {
  const f = await fixture(t), alice = f.auth('alice'), bob = f.auth('bob');
  assert.equal((await f.request(f.path('a'), {user: alice, method: 'POST', body: f.input})).status, 201);
  const other = await f.request(f.path('b'), {user: bob});
  assert.equal(other.status, 200); assert.deepEqual(other.json.grants, []);
  const disabled = await fixture(t, {enabled: false});
  const owner = disabled.auth('alice'), route = disabled.path('a');
  const unavailable = await disabled.request(route, {user: owner});
  assert.equal(unavailable.status, 200);
  assert.deepEqual(unavailable.json, {available: false});
  assert.equal((await disabled.request(route)).status, 401);
  assert.equal((await disabled.request(route, {user: disabled.auth('bob')})).status, 403);
  const foreign = await disabled.request(disabled.path('b'), {user: owner});
  const unknown = await disabled.request('/api/workspaces/does-not-exist/agent-grants', {user: owner});
  assert.equal(foreign.status, 404); assert.deepEqual(foreign.json, unknown.json);
  assert.equal((await disabled.request(route, {user: owner, method: 'POST', body: disabled.input})).status, 404);
  assert.equal((await disabled.request(route + '/' + subject, {user: owner, method: 'DELETE', body: {}})).status, 404);
  assert.equal(disabled.count(), 0);
});
