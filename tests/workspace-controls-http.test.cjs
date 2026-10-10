'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const express = require('express');
const {workspaceFixture} = require('./helpers/workspace-fixture.cjs');
const {hashPassword} = require('../identity/passwords.cjs');
const {createSessionService} = require('../identity/sessions.cjs');
const {createWorkspaceStateRegistry} = require('../collaboration/state.cjs');
const {createWorkspaceTransport} = require('../collaboration/transport.cjs');
const {createCapacityCoordinator} = require('../collaboration/capacity.cjs');
const {createWorkspaceTaskControl} = require('../collaboration/task-control.cjs');
const {createGatewayStore} = require('../gateway/store.cjs');
const {createWorkspaceGatewayAccess} = require('../gateway/workspace-access.cjs');
const {createWorkspaceControlsRouter} = require('../collaboration/controls-http.cjs');
const {runWithWorkspace} = require('../collaboration/context.cjs');
const {createPilotArtifacts} = require('../gateway/pilot-artifacts.cjs');
const {screenshot} = require('./helpers/workspace-gateway-fixture.cjs');
const origin = 'https://lack.fixture.invalid';
async function setup(t) {
  const password = 'synthetic-controls-password';
  const f = workspaceFixture(t, {passwordHash: await hashPassword(password)});
  const sessions = f.own(createSessionService({store: f.store, now: f.now}));
  const registry = f.own(createWorkspaceStateRegistry({identity: f.store}));
  const transport = f.own(createWorkspaceTransport({identity: f.store, sessions, state: registry, webOrigin: origin}));
  const capacity = f.own(createCapacityCoordinator({now: f.now}));
  const tasks = f.own(createWorkspaceTaskControl({identity: f.store, capacity, now: f.now}));
  const store = f.own(createGatewayStore({dbPath: path.join(f.dir, 'gateway.db'), multiUser: true, capacity, now: f.now}));
  const access = createWorkspaceGatewayAccess({store, identity: f.store});
  const artifacts = createPilotArtifacts({store, root: path.join(f.dir, 'artifacts'), now: f.now});
  const accounts = {};
  for (const login of ['alice', 'bob', 'carol']) accounts[login] = await sessions.login({login, password, source: 'controls-' + login});
  const app = express(); app.use(transport.httpContext); app.use(createWorkspaceControlsRouter({taskControl: tasks, getGateway: () => ({workspaceAccess: access, artifacts}), now: f.now}));
  const server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => {server.closeAllConnections(); server.close(resolve);}));
  async function request(user, workspace, route, {method = 'GET', body, csrf = true, headers: extra = {}} = {}) {
    const headers = {Origin: origin, 'X-Workspace-Id': f.workspaces[workspace].id, ...extra};
    if (user) {headers.Cookie = '__Host-chunlack_session=' + accounts[user].token; if (csrf) headers['X-CSRF-Token'] = accounts[user].csrfToken;}
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch('http://127.0.0.1:' + server.address().port + route, {method, headers, body: body === undefined ? undefined : JSON.stringify(body)});
    return {status: response.status, headers: response.headers, body: /^image\//.test(response.headers.get('content-type') || '') ? Buffer.from(await response.arrayBuffer()) : await response.json()};
  }
  return {...f, sessions, tasks, store, access, artifacts, request};
}

async function finishPilot(f, user = 'alice', workspace = 'a') {
  const created = await f.request(user, workspace, '/api/nodes', {method: 'POST', body: {name: 'Evidence fixture', capabilities: ['browser.public_read'], scopes: ['public']}});
  const queued = await f.request(user, workspace, '/api/tasks', {method: 'POST', body: {targetNodeId: created.body.node.id}});
  const credentials = f.store.pair(created.body.pairingCode), worker = f.access.forNode(f.store.authenticate(credentials.token));
  const lease = worker.claimTask(); assert.equal(lease.taskId, queued.body.task.taskId);
  const artifact = worker.run(() => f.artifacts.put(created.body.node.id, lease, {eventId: 'evidence-image', contentType: 'image/png', bytes: screenshot()}));
  worker.submitResult({protocolVersion: 1, taskId: lease.taskId, leaseId: lease.leaseId, attempt: lease.attempt, eventId: 'evidence-result', status: 'succeeded', output: {
    url: lease.input.url, challenge: lease.input.challenge, title: '<img src=x> Synthetic Example', artifactId: artifact.artifactId,
    executedAt: new Date(f.now()).toISOString(), activityEvidence: 'Synthetic fixture only; not vendor-owned execution.'}});
  return {taskId: lease.taskId, nodeId: created.body.node.id, artifact, challenge: lease.input.challenge, token: credentials.token};
}
test('human controls require a real session and exact workspace membership; posted role and workspace never grant node access', async t => {
  const f = await setup(t);
  assert.equal((await f.request(null, 'a', '/api/nodes')).status, 401);
  assert.equal((await f.request('alice', 'b', '/api/nodes')).status, 404);
  assert.equal((await f.request('carol', 'b', '/api/nodes', {method: 'POST', body: {name: 'Spoof', capabilities: ['browser.public_read'], scopes: ['public'], role: 'owner'}})).status, 403);
  const before = runWithWorkspace(f.actor('alice', 'a'), () => f.access.forHuman(f.actor('alice', 'a')).listNodes().length);
  const response = await f.request('alice', 'a', '/api/nodes', {method: 'POST', body: {name: 'Wrong binding', capabilities: ['browser.public_read'], scopes: ['public'], workspaceId: f.workspaces.b.id}});
  assert.equal(response.status, 400);
  runWithWorkspace(f.actor('alice', 'a'), () => assert.equal(f.access.forHuman(f.actor('alice', 'a')).listNodes().length, before));
});
test('owner creates scoped node, listing excludes pairing/token secrets, member reads but cannot pause/revoke, and foreign node stays unknown', async t => {
  const f = await setup(t);
  const created = await f.request('alice', 'a', '/api/nodes', {method: 'POST', body: {name: 'Public browser', capabilities: ['browser.public_read'], scopes: ['public']}});
  assert.equal(created.status, 201); assert.equal(created.body.node.workspaceId, f.workspaces.a.id); assert.ok(created.body.pairingCode);
  const nodeId = created.body.node.id, paired = f.store.pair(created.body.pairingCode);
  const list = await f.request('bob', 'a', '/api/nodes'); assert.equal(list.status, 200); assert.equal(list.body.nodes.length, 1);
  const text = JSON.stringify(list.body); assert.ok(!text.includes(paired.token)); assert.ok(!text.includes('token_hash')); assert.ok(!text.includes(created.body.pairingCode));
  assert.equal((await f.request('bob', 'a', '/api/nodes/' + nodeId + '/pause', {method: 'POST', body: {paused: true}})).status, 403);
  assert.equal((await f.request('alice', 'a', '/api/nodes/' + nodeId + '/pause', {method: 'POST', body: {paused: true}})).status, 200);
  assert.equal((await f.request('bob', 'b', '/api/nodes/' + nodeId, {method: 'DELETE', body: {}})).status, 404);
  assert.equal((await f.request('alice', 'a', '/api/nodes/' + nodeId, {method: 'DELETE', body: {}})).status, 200);
  assert.throws(() => f.store.authenticate(paired.token), error => error.code === 'unauthorized');
});
test('task list is workspace scoped and excludes prompts/results; member may cancel own root but not another user root', async t => {
  const f = await setup(t); let release;
  const root = runWithWorkspace(f.actor('bob', 'a'), () => f.tasks.run('member-root', () => new Promise(resolve => {release = resolve;})));
  const rejected = assert.rejects(root, error => error.code === 'task_cancelled');
  const own = await f.request('bob', 'a', '/api/tasks'); assert.equal(own.status, 200); assert.equal(own.body.localTasks[0].createdBy, f.users.bob.id);
  assert.deepEqual((await f.request('bob', 'b', '/api/tasks')).body.localTasks, []);
  assert.equal((await f.request('carol', 'b', '/api/tasks/member-root/cancel', {method: 'POST', body: {kind: 'local'}})).status, 403);
  assert.equal((await f.request('bob', 'b', '/api/tasks/member-root/cancel', {method: 'POST', body: {kind: 'local'}})).status, 404);
  assert.equal((await f.request('bob', 'a', '/api/tasks/member-root/cancel', {method: 'POST', body: {kind: 'local'}})).status, 200);
  release('synthetic-private-result'); await rejected;
  const list = await f.request('alice', 'a', '/api/tasks'); assert.equal(list.body.localTasks[0].state, 'cancelled');
  assert.ok(!JSON.stringify(list.body).includes('synthetic-private-result'));
});
test('controls mutations reject missing CSRF, wrong Origin and non-JSON input without a side effect', async t => {
  const f = await setup(t), body = {name: 'CSRF fixture', capabilities: ['browser.public_read'], scopes: ['public']};
  assert.equal((await f.request('alice', 'a', '/api/nodes', {method: 'POST', body, csrf: false})).status, 403);
  assert.equal((await f.request('alice', 'a', '/api/nodes', {method: 'POST', body, headers: {Origin: 'https://evil.invalid'}})).status, 403);
  assert.equal((await f.request('alice', 'a', '/api/nodes', {method: 'POST'})).status, 415);
  assert.equal((await f.request('alice', 'a', '/api/nodes')).body.nodes.length, 0);
});
test('external cancellation keeps its real lease occupied until matching node acknowledgement; HTTP metadata does not reveal its input', async t => {
  const f = await setup(t), actor = f.actor('alice', 'a');
  const node = runWithWorkspace(actor, () => f.access.forHuman(actor).createNode({name: 'External fixture', capabilities: ['browser.public_read'], scopes: ['public']}));
  const credentials = f.store.pair(node.pairingCode), worker = f.access.forNode(f.store.authenticate(credentials.token));
  const task = runWithWorkspace(actor, () => f.access.forHuman(actor).enqueueTask({targetNodeId: node.id, scopeId: 'public', taskType: 'browser.public_read', input: {url: 'https://example.com/', challenge: Buffer.alloc(32, 7).toString('base64url')}, deadlineAt: f.now() + 60000}));
  const lease = worker.claimTask(); assert.ok(lease);
  const list = await f.request('alice', 'a', '/api/tasks'); assert.equal(list.body.externalTasks[0].taskId, task.taskId);
  assert.ok(!JSON.stringify(list.body).includes('challenge')); assert.ok(!JSON.stringify(list.body).includes('input_json'));
  assert.equal((await f.request('alice', 'a', '/api/tasks/' + task.taskId + '/cancel', {method: 'POST', body: {kind: 'external'}})).status, 200);
  assert.equal(f.store.capacity.status(actor.workspaceId).active, 1);
  worker.appendEvent({protocolVersion: 1, taskId: lease.taskId, leaseId: lease.leaseId, attempt: lease.attempt, eventId: 'http-cancelled', type: 'cancelled'});
  assert.equal(f.store.capacity.status(actor.workspaceId).active, 0);
});

test('member creates a server-challenged public browser task without exposing its execution secrets', async t => {
  const f = await setup(t);
  const created = await f.request('alice', 'a', '/api/nodes', {method: 'POST', body: {name: 'Pilot node', capabilities: ['browser.public_read'], scopes: ['public']}});
  const response = await f.request('bob', 'a', '/api/tasks', {method: 'POST', body: {targetNodeId: created.body.node.id}});
  assert.equal(response.status, 201);
  assert.equal(response.body.task.workspaceId, f.workspaces.a.id);
  assert.equal(response.body.task.createdBy, f.users.bob.id);
  assert.equal(response.body.task.state, 'queued');
  const stored = runWithWorkspace(f.actor('bob', 'a'), () => f.access.forHuman(f.actor('bob', 'a')).getTask(response.body.task.taskId));
  assert.equal(stored.task_type, 'browser.public_read'); assert.equal(stored.scope_id, 'public');
  assert.equal(stored.input.url, 'https://example.com/');
  assert.match(stored.input.challenge, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(stored.deadline_at, f.now() + 300000);
  assert.ok(!JSON.stringify(response.body).includes(stored.input.challenge));
  assert.ok(!JSON.stringify(response.body).includes('leaseId'));
  const next = await f.request('bob', 'a', '/api/tasks', {method: 'POST', body: {targetNodeId: created.body.node.id}});
  assert.equal(next.status, 201);
  const other = runWithWorkspace(f.actor('bob', 'a'), () => f.access.forHuman(f.actor('bob', 'a')).getTask(next.body.task.taskId));
  assert.notEqual(other.input.challenge, stored.input.challenge);
});

test('external task creation rejects forged input, foreign nodes, viewer writes and missing CSRF before queue mutation', async t => {
  const f = await setup(t);
  const created = await f.request('bob', 'b', '/api/nodes', {method: 'POST', body: {name: 'B node', capabilities: ['browser.public_read'], scopes: ['public']}});
  const body = {targetNodeId: created.body.node.id};
  assert.equal((await f.request('carol', 'b', '/api/tasks', {method: 'POST', body})).status, 403);
  assert.equal((await f.request('bob', 'b', '/api/tasks', {method: 'POST', body, csrf: false})).status, 403);
  for (const extra of [{input: {url: 'http://127.0.0.1/'}}, {deadlineAt: f.now() + 900000}, {workspaceId: f.workspaces.a.id}, {taskType: 'research.retrieve'}, {scopeId: 'private'}]) {
    assert.equal((await f.request('bob', 'b', '/api/tasks', {method: 'POST', body: {...body, ...extra}})).status, 400);
  }
  const foreign = await f.request('alice', 'a', '/api/tasks', {method: 'POST', body});
  const missing = await f.request('alice', 'a', '/api/tasks', {method: 'POST', body: {targetNodeId: 'unknown-node'}});
  assert.equal(foreign.status, 404); assert.deepEqual(foreign.body, missing.body);
  assert.deepEqual((await f.request('bob', 'b', '/api/tasks')).body.externalTasks, []);
});

test('public task creation preserves the existing twenty-entry workspace queue cap and node capability checks', async t => {
  const f = await setup(t);
  const created = await f.request('alice', 'a', '/api/nodes', {method: 'POST', body: {name: 'Bounded node', capabilities: ['browser.public_read'], scopes: ['public']}});
  const research = await f.request('alice', 'a', '/api/nodes', {method: 'POST', body: {name: 'Not a browser', capabilities: ['research.verify'], scopes: ['public']}});
  const wrong = await f.request('alice', 'a', '/api/tasks', {method: 'POST', body: {targetNodeId: research.body.node.id}});
  assert.equal(wrong.status, 403); assert.equal(wrong.body.error, 'capability_denied');
  for (let i = 0; i < 20; i++) assert.equal((await f.request('alice', 'a', '/api/tasks', {method: 'POST', body: {targetNodeId: created.body.node.id}})).status, 201);
  const denied = await f.request('alice', 'a', '/api/tasks', {method: 'POST', body: {targetNodeId: created.body.node.id}});
  assert.equal(denied.status, 429); assert.equal(denied.body.error, 'workspace_queue_full');
  assert.equal((await f.request('alice', 'a', '/api/tasks')).body.externalTasks.length, 20);
});

test('public browser task creation refuses mixed capabilities or multiple scopes before creating an unfinishable pilot', async t => {
  const f = await setup(t);
  const specifications = [
    {name: 'Mixed browser', capabilities: ['browser.public_read', 'research.verify'], scopes: ['public']},
    {name: 'Multiple scopes', capabilities: ['browser.public_read'], scopes: ['public', 'private']},
    {name: 'Both mixed', capabilities: ['research.retrieve', 'browser.public_read'], scopes: ['private', 'public']}
  ];
  for (const specification of specifications) {
    const created = await f.request('alice', 'a', '/api/nodes', {method: 'POST', body: specification});
    assert.equal(created.status, 201);
    const denied = await f.request('bob', 'a', '/api/tasks', {method: 'POST', body: {targetNodeId: created.body.node.id}});
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error, 'facade_scope_denied');
    assert.deepEqual((await f.request('bob', 'a', '/api/tasks')).body.externalTasks, []);
  }
});

test('human evidence view returns bounded fields and verified PNG without node tokens, lease secrets or execution challenge', async t => {
  const f = await setup(t), pilot = await finishPilot(f);
  const response = await f.request('bob', 'a', '/api/tasks/' + pilot.taskId + '/evidence');
  assert.equal(response.status, 200); assert.equal(response.body.acceptance.state, 'evidence_checked');
  assert.equal(response.body.output.title, '<img src=x> Synthetic Example');
  assert.equal(response.body.artifact.sha256, pilot.artifact.sha256);
  for (const secret of [pilot.challenge, pilot.token, 'lease_id', 'leaseId', 'input_json']) assert.ok(!JSON.stringify(response.body).includes(secret));
  const image = await f.request('bob', 'a', '/api/tasks/' + pilot.taskId + '/artifact');
  assert.equal(image.status, 200); assert.equal(image.headers.get('content-type'), 'image/png');
  assert.equal(image.headers.get('cache-control'), 'no-store'); assert.equal(image.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(image.body, screenshot());
  await f.request('alice', 'a', '/api/nodes/' + pilot.nodeId, {method: 'DELETE', body: {}});
  assert.equal((await f.request('bob', 'a', '/api/tasks/' + pilot.taskId + '/artifact')).status, 200, 'Revoking node access must not erase human evidence');
  const denied = await f.request('alice', 'a', '/api/tasks/' + pilot.taskId + '/acceptance', {method: 'POST', body: {confirm: true}});
  assert.equal(denied.status, 409, 'Revoked node cannot receive a new human acceptance and must not invalidate the human session');
  assert.equal((await f.request('alice', 'a', '/api/tasks/' + pilot.taskId + '/evidence')).status, 200);
});

test('only the real workspace owner may explicitly accept evidence, with fresh CSRF; viewer may read but never approve', async t => {
  const f = await setup(t), pilot = await finishPilot(f), other = await finishPilot(f, 'bob', 'b');
  const route = '/api/tasks/' + pilot.taskId + '/acceptance';
  assert.equal((await f.request('bob', 'a', route, {method: 'POST', body: {confirm: true}})).status, 403);
  assert.equal((await f.request('carol', 'b', '/api/tasks/' + other.taskId + '/evidence')).status, 200);
  assert.equal((await f.request('carol', 'b', '/api/tasks/' + other.taskId + '/acceptance', {method: 'POST', body: {confirm: true}})).status, 403);
  assert.equal((await f.request('alice', 'a', route, {method: 'POST', body: {confirm: true}, csrf: false})).status, 403);
  assert.equal((await f.request('alice', 'a', route, {method: 'POST', body: {confirm: false}})).status, 400);
  assert.equal((await f.request('alice', 'a', route, {method: 'POST', body: {confirm: true, role: 'owner'}})).status, 400);
  const accepted = await f.request('alice', 'a', route, {method: 'POST', body: {confirm: true}});
  assert.equal(accepted.status, 200); assert.equal(accepted.body.acceptance.state, 'accepted');
  assert.equal(accepted.body.acceptance.acceptedAt, f.now());
  assert.deepEqual((await f.request('alice', 'a', route, {method: 'POST', body: {confirm: true}})).body, accepted.body);
});

test('foreign workspace and node bearer cannot read human evidence or screenshot, and corrupt image cannot be accepted', async t => {
  const f = await setup(t), pilot = await finishPilot(f);
  for (const suffix of ['evidence', 'artifact']) {
    const foreign = await f.request('bob', 'b', '/api/tasks/' + pilot.taskId + '/' + suffix);
    const missing = await f.request('bob', 'b', '/api/tasks/unknown-task/' + suffix);
    assert.equal(foreign.status, 404); assert.deepEqual(foreign.body, missing.body);
    assert.equal((await f.request(null, 'a', '/api/tasks/' + pilot.taskId + '/' + suffix, {headers: {Authorization: 'Bearer ' + pilot.token}})).status, 401);
  }
  const file = path.join(f.dir, 'artifacts', 'workspaces', f.workspaces.a.id, pilot.artifact.artifactId + '.png');
  const changed = screenshot(); changed[changed.length - 1] ^= 1; fs.writeFileSync(file, changed);
  assert.equal((await f.request('alice', 'a', '/api/tasks/' + pilot.taskId + '/artifact')).status, 409);
  assert.equal((await f.request('alice', 'a', '/api/tasks/' + pilot.taskId + '/acceptance', {method: 'POST', body: {confirm: true}})).status, 409);
  assert.equal((await f.request('alice', 'a', '/api/tasks/' + pilot.taskId + '/evidence')).body.acceptance.state, 'evidence_checked');
});
