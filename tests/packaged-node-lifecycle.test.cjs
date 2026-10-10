'use strict';
// Actual generated service + verified Caddy HTTPS; all accounts and images are synthetic.
// No vendor-owned computer execution or real model inference is claimed here.
const test = require('node:test');
const assert = require('node:assert/strict');
const {once} = require('node:events');
const {AgentClient} = require('../sdk/agent-client.cjs');
const {screenshot} = require('./helpers/workspace-gateway-fixture.cjs');
const {createPackagedIngressFixture} = require('./helpers/packaged-ingress-fixture.cjs');
const caddyBin = process.env.CADDY_TEST_BIN;

test('three humans and five nodes complete scoped HTTPS task lifecycle, cancellation evidence and persisted lease recovery', {skip: !caddyBin, timeout: 60000}, async t => {
  const f = await createPackagedIngressFixture({caddyBin, threeHumans: true}); t.after(() => f.close());
  const owner = await f.login();
  function human(auth, workspaceId, route, {method = 'GET', json, csrf = true} = {}) {
    return f.request('web', route, {method, json, headers: {Cookie: auth.cookie, 'X-Workspace-Id': workspaceId, Origin: f.webOrigin, ...(csrf ? {'X-CSRF-Token': auth.csrfToken} : {})}});
  }
  async function node(auth, workspaceId, name) {
    const response = await human(auth, workspaceId, '/api/nodes', {method: 'POST', json: {name, capabilities: ['browser.public_read'], scopes: ['public']}});
    assert.equal(response.status, 201); return JSON.parse(response.text);
  }
  async function enqueue(auth, workspaceId, targetNodeId) {
    const response = await human(auth, workspaceId, '/api/tasks', {method: 'POST', json: {targetNodeId}});
    assert.equal(response.status, 201); const task = JSON.parse(response.text).task;
    assert.equal(task.workspaceId, workspaceId); assert.equal(task.state, 'queued');
    assert.ok(!response.text.includes('challenge')); return task;
  }
  const initial = await node(owner, f.workspaceId, 'Synthetic node 0');
  const first = await enqueue(owner, f.workspaceId, initial.node.id);
  const other = await f.login(f.accounts.other), viewer = await f.login(f.accounts.viewer);
  const sockets = await Promise.all([f.connect({cookie: owner.cookie, workspaceId: f.workspaceId}), f.connect({cookie: other.cookie, workspaceId: f.workspaceId}), f.connect({cookie: viewer.cookie, workspaceId: f.otherWorkspaceId})]);
  for (const socket of sockets) socket.send(JSON.stringify({type: 'join', channelId: 'general'}));
  const nodes = [initial];
  for (let i = 1; i < 4; i++) nodes.push(await node(owner, f.workspaceId, 'Synthetic node ' + i));
  nodes.push(await node(other, f.otherWorkspaceId, 'Synthetic node 4'));
  const denied = await human(owner, f.workspaceId, '/api/nodes', {method: 'POST', json: {name: 'Sixth', capabilities: ['browser.public_read'], scopes: ['public']}});
  assert.equal(denied.status, 429); assert.equal(JSON.parse(denied.text).error, 'node_capacity');
  assert.equal((await human(viewer, f.otherWorkspaceId, '/api/tasks', {method: 'POST', json: {targetNodeId: nodes[4].node.id}})).status, 403);
  assert.equal((await human(owner, f.workspaceId, '/api/tasks', {method: 'POST', csrf: false, json: {targetNodeId: nodes[0].node.id}})).status, 403);
  assert.equal((await human(owner, f.workspaceId, '/api/tasks', {method: 'POST', json: {targetNodeId: nodes[4].node.id}})).status, 404);
  const fetchNode = async (url, options) => {
    const target = new URL(url); assert.equal(target.origin, f.agentsOrigin);
    const response = await f.request('agents', target.pathname, {method: options.method, headers: options.headers,
      ...(options.body instanceof Uint8Array ? {bytes: options.body} : options.body === undefined ? {} : {json: JSON.parse(options.body)})});
    return new Response(response.status === 204 ? null : response.text, {status: response.status});
  };
  const clients = [];
  for (const item of nodes) {
    const response = await f.request('agents', '/v1/workspaces/' + item.node.workspaceId + '/pair', {method: 'POST', json: {code: item.pairingCode}});
    assert.equal(response.status, 200); const credentials = JSON.parse(response.text);
    clients.push(new AgentClient({baseUrl: f.agentsOrigin, token: credentials.token, nodeId: credentials.nodeId, workspaceId: credentials.workspaceId, fetch: fetchNode}));
    assert.equal((await clients.at(-1).manifest()).workspaceId, item.node.workspaceId);
  }
  const tasks = [first];
  for (let i = 1; i < 5; i++) tasks.push(await enqueue(i === 4 ? other : owner, nodes[i].node.workspaceId, nodes[i].node.id));
  const lease = await clients[0].claimTask(first.taskId); assert.equal(lease.targetNodeId, nodes[0].node.id);
  assert.equal(await clients[4].claimTask(tasks[4].taskId), null, 'One shared execution slot across both workspaces');
  await clients[0].event(lease, {type: 'started'}); assert.equal((await clients[0].heartbeat(lease)).status, 'running');
  assert.equal((await human(owner, f.workspaceId, '/api/tasks/' + first.taskId + '/cancel', {method: 'POST', json: {kind: 'external'}})).status, 200);
  assert.equal((await clients[0].heartbeat(lease)).status, 'cancel_requested');
  await assert.rejects(clients[0].result(lease, {status: 'failed', output: {error: 'late'}}), error => error.status === 409 && error.message === 'invalid_lease');
  assert.equal(await clients[4].claimTask(tasks[4].taskId), null, 'Cancellation alone does not release remote capacity');
  await clients[0].event(lease, {type: 'cancelled'});
  const bLease = await clients[4].claimTask(tasks[4].taskId); assert.equal(bLease.workspaceId, f.otherWorkspaceId);
  await clients[4].result(bLease, {status: 'failed', output: {error: 'synthetic_failure'}});
  assert.equal((await human(owner, f.workspaceId, '/api/nodes/' + nodes[1].node.id + '/pause', {method: 'POST', json: {paused: true}})).status, 200);
  assert.equal(await clients[1].claimTask(tasks[1].taskId), null);
  assert.equal((await human(owner, f.workspaceId, '/api/nodes/' + nodes[1].node.id + '/pause', {method: 'POST', json: {paused: false}})).status, 200);
  const resumed = await clients[1].claimTask(tasks[1].taskId); await clients[1].result(resumed, {status: 'failed', output: {error: 'synthetic_failure'}});
  const success = await clients[2].claimTask(tasks[2].taskId); await clients[2].event(success, {type: 'started'});
  const upload = await clients[2].uploadArtifact(success, {bytes: screenshot(), eventId: 'synthetic-image'});
  const duplicate = await clients[2].uploadArtifact(success, {bytes: screenshot(), eventId: 'synthetic-image'});
  assert.equal(duplicate.artifactId, upload.artifactId);
  const payload = {protocolVersion: 1, taskId: success.taskId, leaseId: success.leaseId, attempt: success.attempt, eventId: 'synthetic-result', status: 'succeeded', output: {
    url: success.input.url, challenge: success.input.challenge, title: 'Synthetic Example Domain', executedAt: new Date().toISOString(), artifactId: upload.artifactId,
    activityEvidence: 'Synthetic local HTTPS lifecycle fixture, not Muse/dots computer execution'}};
  const receipt = await clients[2].request('/v1/tasks/' + success.taskId + '/result', {method: 'POST', body: payload});
  assert.deepEqual(await clients[2].request('/v1/tasks/' + success.taskId + '/result', {method: 'POST', body: payload}), receipt);
  assert.equal(receipt.status, 'succeeded');
  const evidence = await human(other, f.workspaceId, '/api/tasks/' + success.taskId + '/evidence');
  assert.equal(evidence.status, 200); assert.equal(JSON.parse(evidence.text).acceptance.state, 'evidence_checked');
  assert.ok(!evidence.text.includes(success.input.challenge));
  const image = await human(owner, f.workspaceId, '/api/tasks/' + success.taskId + '/artifact');
  assert.equal(image.status, 200); assert.equal(image.headers['content-type'], 'image/png'); assert.deepEqual(image.bytes, screenshot());
  assert.equal((await human(other, f.workspaceId, '/api/tasks/' + success.taskId + '/acceptance', {method: 'POST', json: {confirm: true}})).status, 403);
  const accepted = await human(owner, f.workspaceId, '/api/tasks/' + success.taskId + '/acceptance', {method: 'POST', json: {confirm: true}});
  assert.equal(accepted.status, 200); assert.equal(JSON.parse(accepted.text).acceptance.state, 'accepted');
  assert.equal((await human(other, f.otherWorkspaceId, '/api/tasks/' + success.taskId + '/artifact')).status, 404);
  const active = await clients[3].claimTask(tasks[3].taskId);
  assert.equal((await human(owner, f.workspaceId, '/api/nodes/' + nodes[3].node.id, {method: 'DELETE', json: {}})).status, 200);
  await assert.rejects(clients[3].manifest(), error => error.status === 401);
  const waiting = await enqueue(other, f.otherWorkspaceId, nodes[4].node.id);
  assert.equal(await clients[4].claimTask(waiting.taskId), null, 'Revocation cannot invent remote cancellation acknowledgement');
  const closedSockets = sockets.map(socket => once(socket, 'close'));
  await f.restart(); await Promise.all(closedSockets);
  assert.ok(active.leaseUntil > Date.now());
  await assert.rejects(clients[3].manifest(), error => error.status === 401);
  assert.equal(await clients[4].claimTask(waiting.taskId), null, 'Restart must recover the unexpired remote lease before admission');
  const aList = await human(owner, f.workspaceId, '/api/tasks'), bList = await human(viewer, f.otherWorkspaceId, '/api/tasks');
  assert.equal(aList.status, 200); assert.equal(bList.status, 200);
  const aTasks = JSON.parse(aList.text).externalTasks, bTasks = JSON.parse(bList.text).externalTasks;
  assert.equal(aTasks.length, 4); assert.equal(bTasks.length, 2);
  assert.equal(aTasks.find(task => task.taskId === success.taskId).state, 'succeeded');
  assert.equal(aTasks.find(task => task.taskId === active.taskId).state, 'cancel_requested');
  assert.ok(!aList.text.includes(waiting.taskId)); assert.ok(!bList.text.includes(success.taskId));
  assert.ok(!aList.text.includes(success.input.challenge));
  assert.equal((await clients[2].readTask(success.taskId)).status, 'succeeded');
  const reconnect = await f.connect({cookie: owner.cookie, workspaceId: f.workspaceId});
  reconnect.send(JSON.stringify({type: 'join', channelId: 'general'}));
  await f.frame(reconnect, message => message.type === 'history');
  t.diagnostic('Actual packaged HTTPS lifecycle: 3 human sessions, 2 workspaces, 5 paired synthetic nodes; no real models/vendor execution or sustained capacity claim.');
});
