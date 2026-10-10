'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Database = require('better-sqlite3');
const {once} = require('node:events');
const {gatewayFixture, screenshot} = require('./helpers/workspace-gateway-fixture.cjs');
const {throwsCode, workspaceFixture} = require('./helpers/workspace-fixture.cjs');
const {runWithWorkspace} = require('../collaboration/context.cjs');

test('human gateway handles refresh real roles and isolate nodes, tasks and guessed identifiers', t => {
  const f = gatewayFixture(t), a = f.enqueue('a'), b = f.enqueue('b');
  throwsCode(() => f.gatewayStore.getTask(a.taskId), 'workspace_context_required');
  f.human('alice', 'a', h => {
    assert.equal(h.listNodes().length, 1);
    assert.equal(h.listTasks()[0].workspaceId, f.workspaces.a.id);
    throwsCode(() => h.getTask(b.taskId), 'unknown_task');
    throwsCode(() => h.enqueueTask({targetNodeId: f.nodes.b.id, scopeId: 'public', taskType: 'browser.public_read', input: {url: 'https://example.com/', challenge: Buffer.alloc(32, 1).toString('base64url')}, deadlineAt: f.now() + 1000}), 'unknown_node');
  });
  f.human('carol', 'b', h => {
    assert.equal(h.getTask(b.taskId).workspaceId, f.workspaces.b.id);
    throwsCode(() => h.createNode({name: 'forged owner', capabilities: ['browser.public_read'], scopes: ['public']}), 'forbidden');
    throwsCode(() => h.cancelTask(b.taskId), 'forbidden');
  });
  runWithWorkspace(f.actor('carol', 'b'), () => throwsCode(() => f.access.forHuman({...f.actor('carol', 'b'), role: 'owner'}).createNode({name: 'forged', capabilities: ['browser.public_read'], scopes: ['public']}), 'forbidden'));
  const stale = f.actor('bob', 'a');
  f.store.removeMembership(f.actor('alice', 'a'), {workspaceId: f.workspaces.a.id, userId: f.users.bob.id});
  runWithWorkspace(stale, () => throwsCode(() => f.access.forHuman(stale).listTasks(), 'not_found'));
});

test('authenticated nodes cannot forge bindings or read other workspaces and preserve lease, screenshot and result attribution', t => {
  const f = gatewayFixture(t), a = f.enqueue('a'), b = f.enqueue('b');
  throwsCode(() => f.access.forNode({...f.principals.a, workspaceId: f.workspaces.b.id}), 'unauthorized');
  throwsCode(() => f.node('a').getTask(b.taskId), 'unknown_task');
  throwsCode(() => f.node('a').claimPilotTask(b.taskId), 'unknown_task');
  const lease = f.node('a').claimTask();
  assert.equal(lease.workspaceId, f.workspaces.a.id);
  assert.equal(f.node('b').claimTask(), null, 'The existing global single execution limit is preserved');
  const meta = f.node('a').run(() => f.artifacts.put(f.nodes.a.id, lease, {eventId: 'same-artifact-event', contentType: 'image/png', bytes: screenshot()}));
  assert.equal(meta.workspaceId, f.workspaces.a.id);
  throwsCode(() => f.node('b').run(() => f.artifacts.get(f.nodes.b.id, b.taskId, meta.artifactId)), 'artifact_unavailable');
  const event = {protocolVersion: 1, taskId: lease.taskId, leaseId: lease.leaseId, attempt: lease.attempt, eventId: 'same-event', type: 'progress', message: 'Actual fixture progress'};
  throwsCode(() => f.node('a').appendEvent({...event, workspaceId: f.workspaces.b.id}), 'workspace_mismatch');
  assert.equal(f.node('a').appendEvent(event).workspaceId, f.workspaces.a.id);
  assert.equal(f.node('a').appendEvent(event).accepted, true);
  const {type, message, ...resultLease} = event;
  f.node('a').submitResult({...resultLease, eventId: 'result-event', status: 'succeeded', output: {url: lease.input.url, challenge: lease.input.challenge, title: 'Example Domain', executedAt: new Date(f.now()).toISOString(), artifactId: meta.artifactId, activityEvidence: 'Local integration fixture; not real Muse or dots'}});
  const other = f.node('b').claimTask();
  assert.equal(other.workspaceId, f.workspaces.b.id);
  assert.equal(f.node('b').appendEvent({...event, taskId: other.taskId, leaseId: other.leaseId, attempt: other.attempt}).accepted, true, 'Same event ID is isolated by the authenticated node and workspace');
});

test('re-pair creates a new logical node, rejects captured credentials and retains cancel/result safety', t => {
  const f = gatewayFixture(t), task = f.enqueue('a'), lease = f.node('a').claimTask();
  f.human('alice', 'a', h => h.cancelTask(task.taskId));
  throwsCode(() => f.node('a').submitResult({protocolVersion: 1, taskId: task.taskId, leaseId: lease.leaseId, attempt: lease.attempt, eventId: 'late', status: 'failed', output: {error: 'late'}}), 'invalid_lease');
  const replacement = f.human('alice', 'a', h => h.rePair(f.nodes.a.id));
  assert.notEqual(replacement.nodeId, f.nodes.a.id);
  throwsCode(() => f.node('a').heartbeat(), 'unauthorized');
  throwsCode(() => f.gatewayStore.authenticate(f.credentials.a.token), 'unauthorized');
  const paired = f.gatewayStore.pair(replacement.pairingCode), n = f.access.forNode(f.gatewayStore.authenticate(paired.token));
  throwsCode(() => n.getTask(task.taskId), 'unknown_task');
  assert.equal(n.claimTask(), null);
});

test('public gateway HTTP binds the bearer workspace, denies admin ingress and observes revocation', async t => {
  const f = gatewayFixture(t); f.enqueue('a');
  const gateway = require('../gateway/server.cjs').createAgentGateway({store: f.gatewayStore, workspaceAccess: f.access, adminToken: 'a'.repeat(43), pollMs: 30});
  t.after(() => gateway.close()); gateway.server.listen(0, '127.0.0.1'); await once(gateway.server, 'listening');
  const base = `http://127.0.0.1:${gateway.server.address().port}`;
  const request = (route, workspaceId, token = f.credentials.a.token) => fetch(base + route, {headers: {Authorization: 'Bearer ' + token, ...(workspaceId ? {'X-Workspace-Id': workspaceId} : {})}});
  assert.equal((await request('/v1/manifest', f.workspaces.b.id)).status, 403);
  const manifest = await (await request('/v1/manifest', f.workspaces.a.id)).json(); assert.equal(manifest.workspaceId, f.workspaces.a.id);
  assert.equal((await request('/admin/v1/tasks', f.workspaces.a.id, 'a'.repeat(43))).status, 404);
  f.human('alice', 'a', h => h.revokeNode(f.nodes.a.id));
  assert.equal((await request('/v1/manifest', f.workspaces.a.id)).status, 401);
});

test('multi-user gateway refuses populated unassigned legacy data rather than assuming ownership', t => {
  const f = workspaceFixture(t), file = path.join(f.dir, 'legacy-gateway.sqlite');
  const create = require('../gateway/store.cjs').createGatewayStore;
  const legacy = create({dbPath: file}); legacy.createNode({name: 'Unassigned', capabilities: ['research.verify'], scopes: ['public']}); legacy.close();
  throwsCode(() => create({dbPath: file, multiUser: true}), 'gateway_migration_required');
  const db = new Database(file, {readonly: true}); try {assert.equal(db.prepare('SELECT COUNT(*) AS n FROM nodes').get().n, 1);} finally {db.close();}
});
