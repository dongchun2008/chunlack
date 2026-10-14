'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {agentAuthorityFixture} = require('./helpers/agent-authority-fixture.cjs');
const {createPilotMcp} = require('../integrations/mcp/pilot-server.cjs');
const subject = '11111111-1111-4111-8111-111111111111';
const rpc = (name, args = {}) => ({jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name, arguments: args}});
async function fixture(t) {
  const cleanups = []; let mcp;
  t.after(async () => {await mcp?.close(); for (const cleanup of cleanups) await cleanup();});
  const f = await agentAuthorityFixture({after: fn => cleanups.push(fn)});
  f.store.setMembership(f.actor('bob', 'b'), {workspaceId: f.workspaces.b.id, userId: f.users.alice.id, role: 'owner'});
  const nodes = {}, grants = {}, tasks = {}, paired = {};
  for (const workspace of ['a', 'b']) {
    nodes[workspace] = f.human('alice', workspace, h => h.createNode({name: 'browser-' + workspace,
      capabilities: ['browser.public_read'], scopes: ['public']}));
    paired[workspace] = f.gateway.pair(nodes[workspace].pairingCode);
    grants[workspace] = f.authority.grant(f.actor(workspace === 'a' ? 'alice' : 'bob', workspace), {
      subject, clientId: 'native-client', workspaceId: f.workspaces[workspace].id, nodeId: nodes[workspace].id,
      scopes: workspace === 'a' ? ['task.read'] : ['task.read', 'task.claim', 'events.read', 'events.subscribe'],
      expiresAt: f.now() + 3600000});
    tasks[workspace] = f.human('alice', workspace, h => h.enqueueTask({targetNodeId: nodes[workspace].id,
      scopeId: 'public', taskType: 'browser.public_read', input: {url: 'https://example.com/', challenge: 'A'.repeat(43)},
      deadlineAt: f.now() + 120000}));
  }
  let resolutions = 0, legacy = 0;
  mcp = createPilotMcp({store: f.gateway, workspaceAccess: f.access,
    resolvePrincipal: token => {legacy++; return f.gateway.authenticate(token);},
    resolveAgentConnections: token => f.authority.discover(token),
    resolveAgentPrincipal: async (token, options) => {
      resolutions++;
      return f.gateway.authenticateAgent(await f.authority.authenticate(token, options), {scope: options.scope});
    }});
  const call = body => mcp.handleRpc(body, f.token());
  return {...f, nodes, grants, tasks, paired, mcp, call, resolutions: () => resolutions, legacy: () => legacy};
}

test('discovery returns only current scoped connection metadata, never gateway authority', async t => {
  const f = await fixture(t);
  const value = await f.authority.discover(f.token());
  assert.equal(value.connections.length, 2);
  for (const item of value.connections) {
    assert.deepEqual(Object.keys(item).sort(), ['expiresAt', 'grantId', 'nodeId', 'nodeName', 'scopes', 'workspaceId', 'workspaceName']);
    assert.ok(Object.values(f.grants).some(grant => grant.id === item.grantId));
    assert.throws(() => f.gateway.authenticateAgent(item, {scope: 'task.read'}));
  }
  const readOnly = await f.authority.discover(f.token(['task.read']));
  assert.ok(readOnly.connections.every(item => item.scopes.join() === 'task.read'));
  await assert.rejects(f.authority.discover('bad.jwt.value'));
});

test('generic discovery does not manufacture a node principal or choose the first grant', async t => {
  const f = await fixture(t);
  const list = await f.call(rpc('chunlack_connections_list'));
  assert.equal(list.result.structuredContent.connections.length, 2);
  const tools = await f.call({jsonrpc: '2.0', id: 1, method: 'tools/list', params: {}});
  assert.ok(tools.result.tools.find(tool => tool.name === 'pilot.read_task').inputSchema.required.includes('grantId'));
  assert.ok(tools.result.tools.find(tool => tool.name === 'chunlack_connections_list'));
  const discovery = await f.call({jsonrpc: '2.0', id: 1, method: 'server/discover', params: {}});
  assert.ok(discovery.result.capabilities.tools);
  assert.equal(f.resolutions(), 0);
});

test('each call selects the exact grant across two workspaces without sticky state', async t => {
  const f = await fixture(t);
  for (const workspace of ['b', 'a', 'b']) {
    const reply = await f.call(rpc('pilot.read_task', {grantId: f.grants[workspace].id, taskId: f.tasks[workspace].taskId}));
    assert.equal(reply.result.structuredContent.workspaceId, f.workspaces[workspace].id);
  }
  assert.ok((await f.call(rpc('pilot.read_task', {grantId: f.grants.a.id, taskId: f.tasks.b.taskId}))).error);
  assert.equal(f.legacy(), 0);
});

test('missing, malformed and unknown selectors never fall back even with one remaining grant', async t => {
  const f = await fixture(t);
  f.authority.revoke(f.actor('bob', 'b'), {workspaceId: f.workspaces.b.id, grantId: f.grants.b.id});
  for (const grantId of [undefined, '', [], randomUUID()]) {
    const reply = await f.call(rpc('pilot.read_task', {taskId: f.tasks.a.taskId, ...(grantId === undefined ? {} : {grantId})}));
    assert.ok(reply.error);
  }
  assert.equal(f.legacy(), 0);
});

test('insufficient scope does not switch to a more privileged connection', async t => {
  const f = await fixture(t);
  const denied = await f.call(rpc('pilot.claim_task', {grantId: f.grants.a.id, taskId: f.tasks.a.taskId}));
  assert.equal(denied.error.code, -32003);
  assert.equal(f.human('alice', 'a', h => h.getTask(f.tasks.a.taskId)).status, 'queued');
  const allowed = await f.call(rpc('pilot.claim_task', {grantId: f.grants.b.id, taskId: f.tasks.b.taskId}));
  assert.equal(allowed.result.structuredContent.taskId, f.tasks.b.taskId);
});

test('revoked and epoch-invalid grants disappear and cannot execute after discovery', async t => {
  const f = await fixture(t);
  await f.authority.discover(f.token());
  f.authority.revoke(f.actor('alice', 'a'), {workspaceId: f.workspaces.a.id, grantId: f.grants.a.id});
  f.store.setMembership(f.actor('bob', 'b'), {workspaceId: f.workspaces.b.id, userId: f.users.alice.id, role: 'viewer'});
  assert.deepEqual((await f.authority.discover(f.token())).connections, []);
  for (const workspace of ['a', 'b']) assert.ok((await f.call(rpc('pilot.read_task', {
    grantId: f.grants[workspace].id, taskId: f.tasks[workspace].taskId}))).error);
});

test('legacy schemas and paired tokens neither discover nor accept grant selectors', async t => {
  const f = await fixture(t), token = f.paired.a.token;
  const list = await f.mcp.handleRpc({jsonrpc: '2.0', id: 1, method: 'tools/list', params: {}}, token);
  assert.equal(list.result.tools.find(tool => tool.name === 'chunlack_connections_list'), undefined);
  assert.equal(list.result.tools[0].inputSchema.properties.grantId, undefined);
  assert.ok((await f.mcp.handleRpc(rpc('chunlack_connections_list'), token)).error);
  assert.ok((await f.mcp.handleRpc(rpc('pilot.read_task', {grantId: f.grants.a.id, taskId: f.tasks.a.taskId}), token)).error);
  assert.equal((await f.mcp.handleRpc(rpc('pilot.read_task', {taskId: f.tasks.a.taskId}), token)).result.structuredContent.taskId, f.tasks.a.taskId);
});

test('caller identity fields and selectors on generic discovery are rejected', async t => {
  const f = await fixture(t);
  for (const extra of [{workspaceId: f.workspaces.b.id}, {nodeId: f.nodes.b.id}, {userId: f.users.bob.id}, {role: 'owner'}]) {
    assert.ok((await f.call(rpc('pilot.read_task', {grantId: f.grants.a.id, taskId: f.tasks.a.taskId, ...extra}))).error);
  }
  assert.ok((await f.call(rpc('chunlack_connections_list', {grantId: f.grants.a.id}))).error);
});
