'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {once} = require('node:events');
const {randomBytes} = require('node:crypto');
const {gatewayFixture, screenshot} = require('./helpers/workspace-gateway-fixture.cjs');
const {runWithWorkspace} = require('../collaboration/context.cjs');
const {AgentClient} = require('../sdk/agent-client.cjs');

async function setup(t) {
  const cleanup = [], f = gatewayFixture({after: fn => cleanup.push(fn)}), reservation = http.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const capacity = require('../collaboration/capacity.cjs').createCapacityCoordinator();
  let gateway;
  t.after(async () => {try {await gateway?.close();} finally {capacity.close(); for (const fn of cleanup) await fn();}});
  gateway = await require('../gateway/runtime.cjs').startAgentGateway({config: {multiUser: {enabled: true},
    publicRuntime: {agentsOrigin: 'https://agents.fixture.invalid'}, agentGateway: {enabled: true, port, adminTokenEnv: 'CONNECTOR_FIXTURE_TOKEN'}},
    dataRoot: f.dir, identity: f.store, capacity, env: {CONNECTOR_FIXTURE_TOKEN: 'synthetic-admin-fixture-'.repeat(3)}});
  const human = (workspace, fn) => {const actor = f.actor(workspace === 'a' ? 'alice' : 'bob', workspace); return runWithWorkspace(actor, () => fn(gateway.workspaceAccess.forHuman(actor)));};
  const baseUrl = `http://127.0.0.1:${port}`;
  const pending = human('a', h => h.createNode({name: 'Muse HTTP synthetic fixture', capabilities: ['browser.public_read'], scopes: ['public']}));
  const credentials = await (await fetch(`${baseUrl}/v1/workspaces/${f.workspaces.a.id}/pair`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({code: pending.pairingCode})})).json();
  const client = new AgentClient({baseUrl, ...credentials});
  const input = {url: 'https://example.com/', challenge: randomBytes(32).toString('base64url')};
  const queue = () => human('a', h => h.enqueueTask({targetNodeId: pending.id, scopeId: 'public', taskType: 'browser.public_read', input, deadlineAt: Date.now() + 120000}));
  return {...f, gateway, human, baseUrl, credentials, client, queue, input};
}
test('assembled public gateway exposes a node-authenticated deployment-bound connector contract', async t => {
  const f = await setup(t);
  const response = await fetch(f.baseUrl + '/v1/openapi.json', {headers: {Authorization: 'Bearer ' + f.credentials.token}});
  assert.equal(response.status, 200); const doc = await response.json();
  assert.deepEqual(doc.servers, [{url: 'https://agents.fixture.invalid'}]);
  assert.ok(doc.paths['/v1/tasks/{taskId}']); assert.ok(doc.paths['/v1/pilot/tasks/{taskId}/artifact']);
  assert.ok(!JSON.stringify(doc).includes(f.credentials.token));
  assert.equal((await fetch(f.baseUrl + '/v1/openapi.json')).status, 401);
});
test('SDK reads and claims exactly the requested approved browser task through the assembled runtime', async t => {
  const f = await setup(t), first = f.queue(), second = f.queue();
  const view = await f.client.readTask(second.taskId);
  assert.equal(view.workspaceId, f.workspaces.a.id); assert.equal(view.taskId, second.taskId); assert.equal(view.leaseId, undefined);
  const lease = await f.client.claimTask(second.taskId); assert.equal(lease.taskId, second.taskId);
  assert.equal(f.human('a', h => h.getTask(first.taskId)).status, 'queued');
  assert.equal(await f.client.claimTask(second.taskId), null, 'duplicate notification does not claim or execute twice');
});
test('SDK stores screenshot and returns evidence through the assembled gateway without confusing receipt with acceptance', async t => {
  const f = await setup(t), queued = f.queue(), lease = await f.client.claim();
  await f.client.event(lease, {type: 'started'});
  const artifact = await f.client.uploadArtifact(lease, {bytes: screenshot(), eventId: 'local-synthetic-screenshot'});
  assert.equal(artifact.workspaceId, f.workspaces.a.id);
  await f.client.result(lease, {status: 'succeeded', output: {...f.input, title: 'Example Domain', executedAt: new Date().toISOString(), artifactId: artifact.artifactId,
    activityEvidence: 'Local synthetic browser transport fixture; not a real Muse or dots activity record.'}});
  assert.equal(f.human('a', h => h.getTask(queued.taskId)).status, 'succeeded');
  assert.equal(f.human('a', h => h.getPilotAcceptance(queued.taskId)).state, 'evidence_checked');
});
test('a node creator losing authority while a JSON body is streaming cannot complete the mutation', async t => {
  const f = await setup(t), workspaceId = f.workspaces.a.id;
  f.store.setMembership(f.actor('alice', 'a'), {workspaceId, userId: f.users.bob.id, role: 'owner'});
  const arrived = once(f.gateway.server, 'request');
  let request;
  const response = new Promise((resolve, reject) => {
    request = http.request(f.baseUrl + '/v1/agents/me/heartbeat', {method: 'POST', headers: {Authorization: 'Bearer ' + f.credentials.token, 'Content-Type': 'application/json', 'Content-Length': '2'}}, res => {res.resume(); resolve(res.statusCode);});
    request.on('error', reject); request.write('{');
  });
  t.after(() => request.destroy()); await arrived;
  f.store.setMembership(f.actor('bob', 'a'), {workspaceId, userId: f.users.alice.id, role: 'viewer'});
  request.end('}'); assert.equal(await response, 403);
});
test('duplicate bearer headers are rejected rather than silently selecting an identity', async t => {
  const f = await setup(t);
  const status = await new Promise((resolve, reject) => {
    const request = http.request(f.baseUrl + '/v1/manifest', {headers: ['Host', new URL(f.baseUrl).host, 'Authorization', 'Bearer ' + f.credentials.token, 'Authorization', 'Bearer ' + f.credentials.token]}, res => {res.resume(); resolve(res.statusCode);});
    request.on('error', reject); request.end();
  });
  assert.equal(status, 401);
});
