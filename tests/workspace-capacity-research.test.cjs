'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {workspaceFixture} = require('./helpers/workspace-fixture.cjs');
const {runWithWorkspace} = require('../collaboration/context.cjs');
const {createCapacityCoordinator} = require('../collaboration/capacity.cjs');
const {createGatewayStore} = require('../gateway/store.cjs');
const {createWorkspaceGatewayAccess} = require('../gateway/workspace-access.cjs');
const {createResearchBridge} = require('../gateway/research-bridge.cjs');
const turn = () => new Promise(resolve => setImmediate(resolve));
function setup(t) {
  const f = workspaceFixture(t), capacity = f.own(createCapacityCoordinator({now: f.now}));
  const store = f.own(createGatewayStore({dbPath: path.join(f.dir, 'gateway.db'), multiUser: true, capacity, now: f.now}));
  const access = createWorkspaceGatewayAccess({store, identity: f.store});
  const actor = f.actor('alice', 'a');
  const node = runWithWorkspace(actor, () => access.forHuman(actor).createNode({name: 'Research fixture', capabilities: ['research.retrieve'], scopes: ['public']}));
  const credentials = store.pair(node.pairingCode), authenticated = store.authenticate(credentials.token);
  const nodeHandle = access.forNode(authenticated);
  const bridge = f.own(createResearchBridge({store, workspaceAccess: access, now: f.now, capacity}));
  const input = {query: 'Public source fixture', maxSources: 1};
  const stage = () => bridge.dispatchResearchStage({sessionId: 'session-fixture', traceId: 'trace-fixture', stage: 'retrieve', role: {kind: 'external', nodeId: node.id}, input, privacy: 'public', deadlineAt: f.now() + 60000});
  return {...f, capacity, store, access, actor, node, nodeHandle, bridge, stage};
}
test('external delegation spends the root step budget without holding a slot while waiting for its persisted task', async t => {
  const f = setup(t);
  await runWithWorkspace(f.actor, () => f.capacity.withTaskScope({workspaceId: f.actor.workspaceId, taskId: 'root-research', createdBy: f.actor.userId, maxSteps: 1, deadlineAt: f.now() + 60000}, async () => {
    const first = f.stage(); const cancelled = assert.rejects(first, /external_task_cancelled/);
    await turn();
    assert.equal(f.capacity.status(f.actor.workspaceId).active, 0);
    const tasks = f.access.forHuman(f.actor).listTasks(); assert.equal(tasks.length, 1);
    await assert.rejects(f.stage(), error => error.code === 'task_step_budget');
    f.access.forHuman(f.actor).cancelTask(tasks[0].taskId || tasks[0].id); await cancelled;
  }));
});
test('root cancellation requests remote cancellation but preserves occupancy until exact node acknowledgement', async t => {
  const f = setup(t);
  const root = runWithWorkspace(f.actor, () => f.capacity.withTaskScope({workspaceId: f.actor.workspaceId, taskId: 'root-cancel', createdBy: f.actor.userId, deadlineAt: f.now() + 60000}, f.stage));
  const rejected = assert.rejects(root, error => error.code === 'task_cancelled' || /external_task_cancel_requested/.test(error.message));
  await turn(); const lease = f.nodeHandle.claimTask(); assert.ok(lease);
  f.capacity.cancel('root-cancel'); await turn();
  assert.equal(f.capacity.status(f.actor.workspaceId).active, 1);
  runWithWorkspace(f.actor, () => assert.equal(f.access.forHuman(f.actor).getTask(lease.taskId).status, 'cancel_requested'));
  await rejected;
  f.nodeHandle.appendEvent({protocolVersion: 1, taskId: lease.taskId, leaseId: lease.leaseId, attempt: lease.attempt, eventId: 'cancel-fixture', type: 'cancelled', message: 'Cancellation acknowledged'});
  assert.equal(f.capacity.status(f.actor.workspaceId).active, 0);
});
test('closing bridge while enqueue waits behind model capacity prevents a later orphan task', async t => {
  const f = setup(t); let release;
  const busy = f.capacity.submit({workspaceId: f.actor.workspaceId, taskId: 'busy-model', kind: 'model.generate', deadlineAt: f.now() + 10000, run: () => new Promise(resolve => {release = resolve;})});
  await turn();
  const waiting = runWithWorkspace(f.actor, f.stage);
  const rejected = assert.rejects(waiting, /gateway_closed/);
  await turn(); f.bridge.close(); release('done'); await busy; await rejected;
  runWithWorkspace(f.actor, () => assert.equal(f.access.forHuman(f.actor).listTasks().length, 0));
});
