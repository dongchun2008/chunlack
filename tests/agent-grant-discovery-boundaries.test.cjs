'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {once} = require('node:events');
const {agentAuthorityFixture} = require('./helpers/agent-authority-fixture.cjs');
const {createAgentAuthority} = require('../identity/agent-authority.cjs');
const {createPilotMcp} = require('../integrations/mcp/pilot-server.cjs');
const issuer = 'https://pocket.example.test', resource = 'https://agents.example.test/mcp';
const subject = '11111111-1111-4111-8111-111111111111';
const rpc = (name, args = {}) => ({jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name, arguments: args}});

test('paused connections retain read but remove claim; revoked nodes disappear', async t => {
  const f = await agentAuthorityFixture(t), {grant} = await f.agent();
  f.human('alice', 'a', h => h.setNodePaused(f.nodes.a.id, true));
  const list = await f.authority.discover(f.token());
  assert.equal(list.connections[0].grantId, grant.id);
  assert.ok(list.connections[0].scopes.includes('task.read'));
  assert.ok(!list.connections[0].scopes.includes('task.claim'));
  f.human('alice', 'a', h => h.revokeNode(f.nodes.a.id));
  assert.deepEqual((await f.authority.discover(f.token())).connections, []);
});

test('grant expiry and issuer identity unlink are rechecked by discovery', async t => {
  const f = await agentAuthorityFixture(t); await f.agent();
  f.advance(3600001);
  assert.deepEqual((await f.authority.discover(f.token())).connections, []);
  f.db.prepare('UPDATE agent_authority_grants SET expires_at=?').run(f.now() + 100000);
  assert.equal((await f.authority.discover(f.token())).connections.length, 1);
  f.db.prepare('UPDATE external_identities SET revoked_at=? WHERE issuer=? AND subject=?').run(f.now(), issuer, subject);
  assert.deepEqual((await f.authority.discover(f.token())).connections, []);
});

test('discovery requires read scope and is closed after shutdown', async t => {
  const f = await agentAuthorityFixture(t); await f.agent();
  await assert.rejects(f.authority.discover(f.token(['task.result'])), {code: 'insufficient_scope'});
  f.authority.close();
  await assert.rejects(f.authority.discover(f.token()), {code: 'service_closed'});
});

test('bounded discovery consumes one verifier proof across grants and filters subject/client', async t => {
  const f = await agentAuthorityFixture(t); await f.agent();
  const second = f.human('alice', 'a', h => h.createNode({name: 'second', capabilities: ['research.retrieve'], scopes: ['public']}));
  f.authority.grant(f.actor('alice', 'a'), {subject, clientId: 'native-client', workspaceId: f.workspaces.a.id,
    nodeId: second.id, scopes: ['task.read'], expiresAt: f.now() + 100000});
  let verified = 0, consumed = 0;
  let facts = {issuer, resource, subject, clientId: 'native-client', scopes: ['task.read'], expiresAt: f.now() / 1000 + 600};
  const proof = Object.freeze({});
  const authority = f.own(createAgentAuthority({db: f.db, identity: f.store, workspaceAccess: f.access, now: f.now,
    config: {enabled: true, issuer, resource, clientIds: ['native-client', 'second-client'], browserClientId: 'human-client'},
    verifier: {async verify() {verified++; return proof;}, consume(value) {assert.equal(value, proof); consumed++; return facts;}}}));
  assert.equal((await authority.discover('synthetic-counting-input')).connections.length, 2);
  assert.equal(verified, 1); assert.equal(consumed, 1);
  facts = {...facts, clientId: 'second-client'};
  assert.deepEqual((await authority.discover('synthetic-counting-input')).connections, []);
  facts = {...facts, clientId: 'native-client', subject: '22222222-2222-4222-8222-222222222222'};
  assert.deepEqual((await authority.discover('synthetic-counting-input')).connections, []);
});

test('discovery output labels are bounded and cannot leak arbitrary node fields', async t => {
  const f = await agentAuthorityFixture(t); await f.agent();
  f.db.prepare('UPDATE workspaces SET name=? WHERE id=?').run('W'.repeat(500) + '\n', f.workspaces.a.id);
  const {connections} = await f.authority.discover(f.token());
  assert.equal(connections[0].workspaceName.length, 160);
  assert.equal(connections[0].pairingCode, undefined);
  assert.equal(connections[0].token, undefined);
  assert.equal(connections[0].subject, undefined);
});

test('explicit HTTP discovery, initialize and grant-bound events use the canonical endpoint', async t => {
  const cleanup = []; let mcp;
  t.after(async () => {await mcp?.close(); for (const fn of cleanup) await fn();});
  const f = await agentAuthorityFixture({after: fn => cleanup.push(fn)}), {grant} = await f.agent();
  let subscribed;
  mcp = createPilotMcp({store: f.gateway, workspaceAccess: f.access,
    agentOAuth: {enabled: true, issuer, resource},
    resolvePrincipal: value => f.gateway.authenticate(value),
    resolveAgentConnections: value => f.authority.discover(value),
    resolveAgentPrincipal: async (value, options) => f.gateway.authenticateAgent(await f.authority.authenticate(value, options), options),
    events: {multiUser: true, agentAuthority: true,
      list: p => ({nodeId: p.nodeId}),
      subscribe: (p, args) => {subscribed = {p, args}; return {id: 'synthetic-subscription'};}}});
  mcp.server.listen(0, '127.0.0.1'); await once(mcp.server, 'listening');
  const url = `http://127.0.0.1:${mcp.server.address().port}/mcp`;
  const request = async (body, suffix = '') => {
    const response = await fetch(url + suffix, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + f.token()},
      body: JSON.stringify(body), signal: AbortSignal.timeout(5000)});
    return {status: response.status, body: await response.json()};
  };
  const list = await request(rpc('chunlack_connections_list'));
  assert.equal(list.status, 200); assert.equal(list.body.result.structuredContent.connections[0].grantId, grant.id);
  const init = await request({jsonrpc: '2.0', id: 1, method: 'initialize', params: {protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {name: 'fixture', version: '1'}}});
  assert.equal(init.body.result.protocolVersion, '2025-11-25');
  assert.equal((await request(rpc('chunlack_connections_list'), '?grantId=' + grant.id)).status, 404);
  const event = await request({jsonrpc: '2.0', id: 1, method: 'events/subscribe', params: {grantId: grant.id, name: 'synthetic'}});
  assert.equal(event.body.result.id, 'synthetic-subscription');
  assert.deepEqual(subscribed.args, {name: 'synthetic'});
  assert.equal(subscribed.p.agentGrant.grantId, grant.id);
  f.authority.revoke(f.actor('alice', 'a'), {workspaceId: f.workspaces.a.id, grantId: grant.id});
  assert.equal((await request(rpc('chunlack_connections_list'))).status, 403);
  assert.equal((await request({jsonrpc: '2.0', id: 1, method: 'events/list', params: {grantId: grant.id}})).status, 401);
});
