'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {workspaceFixture, throwsCode} = require('./helpers/workspace-fixture.cjs');
const {runWithWorkspace} = require('../collaboration/context.cjs');
const {createCapacityCoordinator} = require('../collaboration/capacity.cjs');
const {createWorkspaceTaskControl} = require('../collaboration/task-control.cjs');
const turn = () => new Promise(resolve => setImmediate(resolve));
function setup(t) {
  const f = workspaceFixture(t), capacity = f.own(createCapacityCoordinator({now: f.now}));
  const transitions = [];
  const tasks = f.own(createWorkspaceTaskControl({identity: f.store, capacity, now: f.now, onState: event => transitions.push(event)}));
  return {...f, capacity, tasks, transitions};
}
test('root task owner and workspace are server-bound; member cannot cancel another member task or cross-workspace task', async t => {
  const f = setup(t); let finish;
  const work = runWithWorkspace(f.actor('alice', 'a'), () => f.tasks.run('root-a', () => new Promise(resolve => {finish = resolve;})));
  await turn();
  runWithWorkspace(f.actor('bob', 'a'), () => throwsCode(() => f.tasks.cancelTask('root-a'), 'forbidden'));
  runWithWorkspace(f.actor('bob', 'b'), () => {
    assert.deepEqual(f.tasks.listTasks(), []);
    throwsCode(() => f.tasks.cancelTask('root-a'), 'task_not_found');
  });
  finish('safe-output'); assert.equal(await work, 'safe-output');
  runWithWorkspace(f.actor('alice', 'a'), () => {
    const record = f.tasks.getTask('root-a');
    assert.equal(record.createdBy, f.users.alice.id); assert.equal(record.workspaceId, f.workspaces.a.id);
    assert.equal(record.state, 'completed'); assert.equal(Object.isFrozen(record), true);
  });
});
test('member may cancel own root and owner may cancel member root; cancellation aborts model and waits for actual settlement', async t => {
  const f = setup(t); let settle, entered = false, nextEntered = false, signal;
  const work = runWithWorkspace(f.actor('bob', 'a'), () => f.tasks.run('bob-root', () => f.capacity.submit({
    workspaceId: f.workspaces.a.id, taskId: 'model-bob', kind: 'model.generate', deadlineAt: f.now() + 20000,
    run: context => {entered = true; signal = context.signal; return new Promise(resolve => {settle = resolve;});}
  })));
  const rejected = assert.rejects(work, error => error.code === 'task_cancelled');
  await turn(); assert.equal(entered, true);
  runWithWorkspace(f.actor('bob', 'a'), () => assert.equal(f.tasks.cancelTask('bob-root').state, 'cancel_requested'));
  assert.equal(signal.aborted, true);
  const next = runWithWorkspace(f.actor('alice', 'a'), () => f.tasks.run('alice-next', () => f.capacity.submit({
    workspaceId: f.workspaces.a.id, taskId: 'model-next', kind: 'model.generate', deadlineAt: f.now() + 20000,
    run: () => {nextEntered = true; return 42;}
  })));
  await turn(); assert.equal(nextEntered, false);
  settle('must-not-return'); await rejected; assert.equal(await next, 42);
  runWithWorkspace(f.actor('alice', 'a'), () => assert.equal(f.tasks.getTask('bob-root').state, 'cancelled'));
  let finish;
  const memberWork = runWithWorkspace(f.actor('bob', 'a'), () => f.tasks.run('owner-cancels', () => new Promise(resolve => {finish = resolve;})));
  const denied = assert.rejects(memberWork, error => error.code === 'task_cancelled');
  await turn(); runWithWorkspace(f.actor('alice', 'a'), () => f.tasks.cancelTask('owner-cancels'));
  finish('discard'); await denied;
});
test('fresh membership and viewer role prevent task submission or cancellation; server metadata contains no prompt or output', async t => {
  const f = setup(t), alice = f.actor('alice', 'a'), bob = f.actor('bob', 'a');
  await runWithWorkspace(alice, () => f.tasks.run('private-task', () => 'synthetic-private-output'));
  f.store.setMembership(alice, {workspaceId: f.workspaces.a.id, userId: bob.userId, role: 'viewer'});
  await runWithWorkspace(bob, async () => {
    await assert.rejects(() => f.tasks.run('viewer-task', () => 1), error => error.code === 'forbidden');
    throwsCode(() => f.tasks.cancelTask('private-task'), 'forbidden');
  });
  const serialized = JSON.stringify(f.transitions);
  assert.ok(!serialized.includes('synthetic-private-output'));
  assert.ok(f.transitions.some(event => event.taskId === 'private-task' && event.state === 'completed'));
});
test('delegation inherits root ownership, depth and shared step budget without taking an execution slot for orchestration', async t => {
  const f = setup(t), actor = f.actor('alice', 'a');
  await runWithWorkspace(actor, () => f.tasks.run('root-budget', async () => {
    assert.equal(f.capacity.status(f.workspaces.a.id).active, 0);
    await f.tasks.run('child', async () => {
      const current = f.capacity.currentTask(); assert.equal(current.rootTaskId, 'root-budget'); assert.equal(current.createdBy, actor.userId);
      await f.capacity.submit({workspaceId: actor.workspaceId, taskId: 'request-one', kind: 'model.generate', deadlineAt: f.now() + 10000, run: () => 1});
      await assert.rejects(() => f.capacity.submit({workspaceId: actor.workspaceId, taskId: 'request-two', kind: 'model.generate', deadlineAt: f.now() + 10000, run: () => 2}), error => error.code === 'task_step_budget');
      await assert.rejects(() => f.tasks.run('grandchild', () => 3, {delegate: true}), error => error.code === 'delegation_depth');
      await runWithWorkspace(f.actor('bob', 'a'), async () => {
        await assert.rejects(() => f.tasks.run('wrong-owner', () => 4, {delegate: true}), error => error.code === 'task_owner_mismatch');
      });
    }, {delegate: true});
  }, {limits: {maxSteps: 1, maxDepth: 1, timeoutMs: 10000}}));
});
test('closed controller refuses new tasks and does not grant access from a fabricated actor outside workspace context', async t => {
  const f = setup(t);
  throwsCode(() => f.tasks.listTasks(), 'workspace_context_required');
  f.tasks.close();
  await runWithWorkspace(f.actor('alice', 'a'), async () => assert.rejects(() => f.tasks.run('after-close', () => 1), error => error.code === 'task_control_closed'));
});
test('even delegates with no model call have a bounded count and server-owned audit metadata', async t => {
  const f = setup(t), actor = f.actor('alice', 'a'); let thirdEntered = false;
  await runWithWorkspace(actor, () => f.tasks.run('bounded-delegates', async () => {
    await f.tasks.run('delegate-one', () => 1, {delegate: true});
    await f.tasks.run('delegate-two', () => 2, {delegate: true});
    await assert.rejects(() => f.tasks.run('delegate-three', () => {thirdEntered = true;}, {delegate: true}), error => error.code === 'task_delegation_budget');
  }, {limits: {maxSteps: 2, maxDepth: 3, timeoutMs: 10000}}));
  assert.equal(thirdEntered, false);
  runWithWorkspace(actor, () => {
    const task = f.tasks.getTask('bounded-delegates'); assert.equal(task.delegations, 2); assert.equal(task.maxDepthSeen, 1);
  });
  assert.ok(f.transitions.some(event => event.taskId === 'bounded-delegates' && event.delegations === 2));
});
