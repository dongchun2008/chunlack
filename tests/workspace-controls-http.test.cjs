'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
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
  const accounts = {};
  for (const login of ['alice', 'bob', 'carol']) accounts[login] = await sessions.login({login, password, source: 'controls-' + login});
  const app = express(); app.use(transport.httpContext); app.use(createWorkspaceControlsRouter({taskControl: tasks, getGateway: () => ({workspaceAccess: access}), now: f.now}));
  const server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => {server.closeAllConnections(); server.close(resolve);}));
  async function request(user, workspace, route, {method = 'GET', body, csrf = true, headers: extra = {}} = {}) {
    const headers = {Origin: origin, 'X-Workspace-Id': f.workspaces[workspace].id, ...extra};
    if (user) {headers.Cookie = '__Host-chunlack_session=' + accounts[user].token; if (csrf) headers['X-CSRF-Token'] = accounts[user].csrfToken;}
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch('http://127.0.0.1:' + server.address().port + route, {method, headers, body: body === undefined ? undefined : JSON.stringify(body)});
    return {status: response.status, body: await response.json()};
  }
  return {...f, sessions, tasks, store, access, request};
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
