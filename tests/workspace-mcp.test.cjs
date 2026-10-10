'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {gatewayFixture, screenshot} = require('./helpers/workspace-gateway-fixture.cjs');
const {AgentClient} = require('../sdk/agent-client.cjs');

test('MCP resolves authentic node bindings, denies guessed task/upload IDs and retains the rightful upload', async t => {
  const f = gatewayFixture(t), a = f.enqueue('a'), b = f.enqueue('b');
  const uploads = require('../integrations/mcp/artifact-upload.cjs').createArtifactUpload({store: f.gatewayStore, artifacts: f.artifacts, now: f.now});
  const mcp = require('../integrations/mcp/pilot-server.cjs').createPilotMcp({store: f.gatewayStore, artifacts: f.artifacts, uploads, workspaceAccess: f.access, resolvePrincipal: token => f.gatewayStore.authenticate(token)}); t.after(() => mcp.close());
  const rpc = async (workspace, name, args) => mcp.handleRpc({jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name, arguments: args}}, f.credentials[workspace].token);
  assert.ok((await rpc('a', 'pilot.read_task', {taskId: b.taskId})).error);
  const read = (await rpc('a', 'pilot.read_task', {taskId: a.taskId})).result;
  assert.equal(read.structuredContent.workspaceId, f.workspaces.a.id);
  assert.equal(JSON.parse(read.content[0].text).workspaceId, f.workspaces.a.id);
  const claimed = (await rpc('a', 'pilot.claim_task', {taskId: a.taskId})).result.structuredContent;
  const lease = {taskId: claimed.taskId, leaseId: claimed.leaseId, attempt: claimed.attempt};
  const begin = (await rpc('a', 'pilot.artifact_begin', {...lease, eventId: 'screenshot', contentType: 'image/png'})).result.structuredContent;
  const bytes = screenshot().toString('base64');
  assert.ok((await rpc('b', 'pilot.artifact_chunk', {uploadId: begin.uploadId, index: 0, data: bytes})).error);
  assert.equal((await rpc('a', 'pilot.artifact_chunk', {uploadId: begin.uploadId, index: 0, data: bytes})).result.structuredContent.nextIndex, 1);
  assert.equal((await rpc('a', 'pilot.artifact_finish', {uploadId: begin.uploadId})).result.structuredContent.workspaceId, f.workspaces.a.id);
  const forged = require('../integrations/mcp/pilot-server.cjs').createPilotMcp({store: f.gatewayStore, artifacts: f.artifacts, workspaceAccess: f.access, resolvePrincipal: () => ({nodeId: f.nodes.a.id, workspaceId: f.workspaces.b.id})}); t.after(() => forged.close());
  assert.equal((await forged.handleRpc({jsonrpc: '2.0', id: 1, method: 'tools/list'}, 'fake')).error.code, -32001);
});

test('SDK refuses another workspace before local execution and does not trust a changed response identity', async t => {
  const f = gatewayFixture(t); f.enqueue('a'); const lease = f.node('a').claimTask();
  let executed = 0;
  const client = new AgentClient({baseUrl: 'http://127.0.0.1:1', token: f.credentials.b.token, workspaceId: f.workspaces.b.id, nodeId: f.nodes.b.id});
  await assert.rejects(() => client.execute(lease, () => {executed++; return {}; }), e => e.status === 403);
  assert.equal(executed, 0);
  const changed = new AgentClient({baseUrl: 'https://gateway.example', token: 'synthetic-only-token', workspaceId: f.workspaces.a.id, fetch: async () => new Response(JSON.stringify({workspaceId: f.workspaces.b.id, nodeId: f.nodes.b.id}), {status: 200})});
  await assert.rejects(() => changed.manifest(), e => e.status === 403);
});

test('event subscriptions and deliveries carry the bound workspace, stop after revoke and reject forged binding', async t => {
  const f = gatewayFixture(t), task = f.enqueue('a'); let notifications = 0;
  const events = require('../integrations/mcp/events.cjs').createPilotEvents({dbPath: ':memory:', encryptionKey: Buffer.alloc(32, 1), multiUser: true,
    authorize: (p, taskId) => f.access.authorizeStoredNode(p, taskId), authorizeCleanup: p => f.access.authorizeStoredNode(p, undefined, {cleanup: true}), now: f.now,
    transport: async (url, options, binding) => {assert.equal(binding.workspaceId, f.workspaces.a.id); const data = JSON.parse(options.body); if (data.type === 'verification') return new Response(JSON.stringify({challenge: data.challenge})); notifications++; return new Response('', {status: 200});}}); t.after(() => events.close());
  const principal = {nodeId: f.nodes.a.id, workspaceId: f.workspaces.a.id};
  const params = {name: 'pilot.task_ready', arguments: {taskId: task.taskId}, delivery: {mode: 'webhook', url: 'https://callback.example/events', secret: 'whsec_' + Buffer.alloc(32, 2).toString('base64')}};
  await events.subscribe(principal, params);
  assert.throws(() => events.publish({...principal, workspaceId: f.workspaces.b.id}, {eventId: 'event', taskId: task.taskId, taskType: 'browser.public_read', deadlineAt: f.now() + 1000}));
  events.publish(principal, {eventId: 'event', taskId: task.taskId, taskType: 'browser.public_read', deadlineAt: f.now() + 1000});
  f.human('alice', 'a', h => h.revokeNode(f.nodes.a.id));
  assert.equal((await events.deliverDue()).delivered, 0);
  assert.equal(notifications, 0);
});
