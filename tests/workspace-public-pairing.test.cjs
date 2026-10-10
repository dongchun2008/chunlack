'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {once} = require('node:events');
const {gatewayFixture} = require('./helpers/workspace-gateway-fixture.cjs');
const {createAgentGateway} = require('../gateway/server.cjs');

async function fixture(t) {
  const f = gatewayFixture(t);
  const pending = f.human('alice', 'a', human => human.createNode({name: 'Public pairing fixture', capabilities: ['browser.public_read'], scopes: ['public']}));
  const gateway = createAgentGateway({store: f.gatewayStore, workspaceAccess: f.access, adminToken: 'synthetic-only-gateway-admin-'.repeat(2)});
  gateway.server.listen(0, '127.0.0.1'); await once(gateway.server, 'listening');
  t.after(() => gateway.close());
  const base = `http://127.0.0.1:${gateway.server.address().port}`;
  const pair = (workspaceId, body = {code: pending.pairingCode}, headers = {}) => fetch(`${base}/v1/workspaces/${workspaceId}/pair`,
    {method: 'POST', headers: {'Content-Type': 'application/json', ...headers}, body: JSON.stringify(body)});
  return {...f, pending, gateway, base, pair};
}
test('external node pairs through real workspace-scoped HTTP and receives only its stored identity', async t => {
  const f = await fixture(t), response = await f.pair(f.workspaces.a.id);
  assert.equal(response.status, 200);
  const credentials = await response.json();
  assert.equal(credentials.workspaceId, f.workspaces.a.id); assert.equal(credentials.nodeId, f.pending.id); assert.equal(typeof credentials.token, 'string');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const manifest = await fetch(f.base + '/v1/manifest', {headers: {Authorization: 'Bearer ' + credentials.token, 'X-Workspace-Id': f.workspaces.a.id}});
  assert.equal(manifest.status, 200); assert.equal((await manifest.json()).workspaceId, f.workspaces.a.id);
  assert.equal((await f.pair(f.workspaces.a.id)).status, 401, 'code is single use');
  assert.equal((await fetch(f.base + '/v1/pair', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({code: f.pending.pairingCode})})).status, 404, 'legacy global route stays unavailable');
});
test('wrong workspace, spoofed selectors and browser origins cannot consume a valid pairing code', async t => {
  const f = await fixture(t);
  assert.equal((await f.pair(f.workspaces.b.id)).status, 403);
  assert.equal((await f.pair(f.workspaces.a.id, {code: f.pending.pairingCode, workspaceId: f.workspaces.b.id})).status, 400);
  assert.equal((await f.pair(f.workspaces.a.id, undefined, {'X-Workspace-Id': f.workspaces.b.id})).status, 403);
  assert.equal((await f.pair(f.workspaces.a.id, undefined, {Origin: 'https://untrusted.example'})).status, 403);
  assert.equal((await f.pair(f.workspaces.a.id)).status, 200, 'invalid selectors never rotate credentials or consume the challenge');
});
test('pairing checks current creator authority before consuming the challenge', async t => {
  const f = await fixture(t);
  f.human('alice', 'a', human => human.revokeNode(f.pending.id));
  assert.equal((await f.pair(f.workspaces.a.id)).status, 401);
});
test('a creator who lost owner permission cannot pair and the unconsumed code works only after explicit restoration', async t => {
  const f = await fixture(t), workspaceId = f.workspaces.a.id;
  f.store.setMembership(f.actor('alice', 'a'), {workspaceId, userId: f.users.bob.id, role: 'owner'});
  f.store.setMembership(f.actor('bob', 'a'), {workspaceId, userId: f.users.alice.id, role: 'viewer'});
  assert.equal((await f.pair(workspaceId)).status, 403);
  f.store.setMembership(f.actor('bob', 'a'), {workspaceId, userId: f.users.alice.id, role: 'owner'});
  assert.equal((await f.pair(workspaceId)).status, 200);
});
test('SDK selects a scoped pairing route only with an explicit safe workspace', () => {
  const {pairingRoute} = require('../sdk/pairing.cjs');
  assert.equal(typeof pairingRoute, 'function');
  assert.equal(pairingRoute({workspaceId: 'workspace-a'}), '/v1/workspaces/workspace-a/pair');
  assert.equal(pairingRoute({}), '/v1/pair');
  assert.throws(() => pairingRoute({workspaceId: '../outside'}));
});
