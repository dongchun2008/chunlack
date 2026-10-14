'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {workspaceFixture} = require('./helpers/workspace-fixture.cjs');
const {createCapacityCoordinator} = require('../collaboration/capacity.cjs');
const {createWorkspaceTaskControl} = require('../collaboration/task-control.cjs');
const {runWithWorkspace} = require('../collaboration/context.cjs');

for (const timeoutMs of [1000, 300000]) {
  test(`root deadline uses one creation timestamp with an advancing clock (${timeoutMs} ms)`, async t => {
    const f = workspaceFixture(t), capacity = f.own(createCapacityCoordinator());
    let clock = Date.now();
    const control = f.own(createWorkspaceTaskControl({identity: f.store, capacity, now: () => clock++}));
    await runWithWorkspace(f.actor('alice', 'a'), () => control.run('deadline-repro', async () => null, {limits: {timeoutMs}}));
    const record = runWithWorkspace(f.actor('alice', 'a'), () => control.getTask('deadline-repro'));
    assert.equal(record.deadlineAt - record.createdAt, timeoutMs);
    assert.equal(record.state, 'completed');
    assert.equal(record.createdBy, f.users.alice.id);
    assert.equal(record.workspaceId, f.workspaces.a.id);
  });
}
