'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {agentAuthorityFixture} = require('./helpers/agent-authority-fixture.cjs');
const {throwsCode} = require('./helpers/workspace-fixture.cjs');

function pairedNode(r) {
  const credentials = r.gateway.pair(r.nodes.a.pairingCode);
  return r.access.forNode(r.gateway.authenticate(credentials.token));
}
function envelope(lease, eventId) {
  return {protocolVersion: 1, taskId: lease.taskId, leaseId: lease.leaseId, attempt: lease.attempt, eventId};
}

test('result-only authority renews and completes a real lease without gaining read or claim access', async t => {
  const r = await agentAuthorityFixture(t), a = await r.agent(['task.result']), task = r.enqueue();
  const lease = pairedNode(r).claimTask();
  assert.equal(lease.taskId, task.taskId);
  throwsCode(() => a.node.getTask(task.taskId), 'insufficient_scope');
  throwsCode(() => a.node.claimTask(), 'insufficient_scope');
  throwsCode(() => a.node.nodeEvents(0), 'insufficient_scope');
  assert.ok(a.node.renewLease(lease.taskId, lease.leaseId, lease.attempt));
  a.node.appendEvent({...envelope(lease, 'result-only-progress'), type: 'progress'});
  const result = {...envelope(lease, 'result-only-completed'), status: 'succeeded', output: {summary: 'synthetic-result'}};
  const receipt = a.node.submitResult(result);
  assert.deepEqual(a.node.submitResult(result), receipt);
  const saved = r.human('alice', 'a', h => h.getTask(task.taskId));
  assert.equal(saved.status, 'succeeded');
  assert.equal(saved.result.output.summary, 'synthetic-result');
});

test('events-read authority polls real events but cannot subscribe, inspect tasks or mutate leases', async t => {
  const r = await agentAuthorityFixture(t), a = await r.agent(['events.read']), task = r.enqueue();
  const paired = pairedNode(r), lease = paired.claimTask();
  paired.appendEvent({...envelope(lease, 'events-only-progress'), type: 'progress'});
  const polled = a.node.nodeEvents(0);
  assert.ok(polled.events.some(event => event.task_id === task.taskId && event.type === 'progress'));
  assert.ok(Number.isSafeInteger(polled.cursor) && polled.cursor > 0);
  assert.ok(polled.events.every(event => Number.isSafeInteger(event.seq) && event.seq > 0 && event.seq <= polled.cursor));
  assert.deepEqual(a.node.nodeEvents(polled.cursor).events, []);
  throwsCode(() => r.gateway.assertAuthenticatedNode(a.principal, {scope: 'events.subscribe'}), 'insufficient_scope');
  throwsCode(() => a.node.getTask(task.taskId), 'insufficient_scope');
  throwsCode(() => a.node.renewLease(lease.taskId, lease.leaseId, lease.attempt), 'insufficient_scope');
  throwsCode(() => a.node.submitResult({}), 'insufficient_scope');
});

test('subscription-only authority satisfies its check but cannot poll events or inspect tasks', async t => {
  const r = await agentAuthorityFixture(t), a = await r.agent(['events.subscribe']), task = r.enqueue();
  assert.equal(r.gateway.assertAuthenticatedNode(a.principal, {scope: 'events.subscribe'}).id, r.nodes.a.id);
  throwsCode(() => a.node.nodeEvents(0), 'insufficient_scope');
  throwsCode(() => a.node.getTask(task.taskId), 'insufficient_scope');
  throwsCode(() => a.node.claimTask(), 'insufficient_scope');
});

test('pausing a node still permits result-only authority to complete its existing lease', async t => {
  const r = await agentAuthorityFixture(t), a = await r.agent(['task.result']), task = r.enqueue();
  const lease = pairedNode(r).claimTask();
  r.human('alice', 'a', h => h.setNodePaused(r.nodes.a.id, true));
  assert.ok(a.node.renewLease(lease.taskId, lease.leaseId, lease.attempt));
  a.node.appendEvent({...envelope(lease, 'paused-progress'), type: 'progress'});
  a.node.submitResult({...envelope(lease, 'paused-completed'), status: 'succeeded', output: {summary: 'completed-while-paused'}});
  const saved = r.human('alice', 'a', h => h.getTask(task.taskId));
  assert.equal(saved.status, 'succeeded');
  assert.equal(saved.result.output.summary, 'completed-while-paused');
  assert.equal(r.human('alice', 'a', h => h.getNode(r.nodes.a.id)).paused, true);
});

for (const invalidation of ['grant revocation', 'membership change', 'grant expiry', 'token expiry']) {
  test(`retained write and event access rejects ${invalidation} before side effects`, async t => {
    const r = await agentAuthorityFixture(t), a = await r.agent(), task = r.enqueue();
    const lease = a.node.claimTask();
    a.node.appendEvent({...envelope(lease, 'before-invalidation'), type: 'progress'});
    const savedBefore = r.human('alice', 'a', h => h.getTask(task.taskId));
    if (invalidation === 'grant revocation') {
      r.authority.revoke(r.actor('alice', 'a'), {workspaceId: r.workspaces.a.id, grantId: a.grant.id});
    } else if (invalidation === 'membership change') {
      const update = r.db.prepare('UPDATE memberships SET role=? WHERE workspace_id=? AND user_id=?');
      update.run('member', r.workspaces.a.id, r.users.alice.id);
      update.run('owner', r.workspaces.a.id, r.users.alice.id);
    } else if (invalidation === 'grant expiry') {
      // Fixture-only shortening isolates grant expiration while the JWT and lease remain valid.
      r.db.prepare('UPDATE agent_authority_grants SET expires_at=? WHERE id=?').run(r.now() + 1000, a.grant.id);
      r.advance(1000);
    } else r.advance(600000);
    for (const operation of [
      () => a.node.renewLease(lease.taskId, lease.leaseId, lease.attempt),
      () => a.node.appendEvent({...envelope(lease, 'denied-progress'), type: 'progress'}),
      () => a.node.submitResult({...envelope(lease, 'denied-result'), status: 'succeeded', output: {}}),
      () => a.node.nodeEvents(0),
      () => r.gateway.assertAuthenticatedNode(a.principal, {scope: 'events.subscribe'})
    ]) throwsCode(operation, 'unauthorized');
    const savedAfter = r.human('alice', 'a', h => h.getTask(task.taskId));
    assert.deepEqual(savedAfter.result, savedBefore.result);
    assert.equal(savedAfter.status, savedBefore.status);
  });
}
