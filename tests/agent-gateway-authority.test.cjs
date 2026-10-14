'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {agentAuthorityFixture} = require('./helpers/agent-authority-fixture.cjs');
const {throwsCode} = require('./helpers/workspace-fixture.cjs');

test('real signed identity and explicit grant produce a gateway-owned scoped principal', async t => {
  const r = await agentAuthorityFixture(t);
  assert.equal(typeof r.gateway.authenticateAgent, 'function');
  const a = await r.agent(), task = r.enqueue();
  assert.equal(r.gateway.assertAuthenticatedNode(a.principal, {scope: 'task.read'}).id, r.nodes.a.id);
  assert.equal(a.node.getTask(task.taskId).id, task.taskId);
  assert.ok(Object.isFrozen(a.principal));
  throwsCode(() => r.access.forNode({...a.principal}), 'unauthorized');
  throwsCode(() => r.gateway.authenticateAgent({...a.proof}, {scope: 'task.read'}), 'unauthorized');
  throwsCode(() => r.gateway.authenticate(r.token()), 'unauthorized');
});

test('read-only grants cannot claim, write results, poll events or invoke an unscoped callback', async t => {
  const r = await agentAuthorityFixture(t), a = await r.agent(['task.read']), task = r.enqueue();
  assert.equal(a.node.getTask(task.taskId).status, 'queued');
  for (const operation of [() => a.node.claimTask(), () => a.node.claimPilotTask(task.taskId),
    () => a.node.submitResult({}), () => a.node.appendEvent({}),
    () => a.node.renewLease(task.taskId, 'not-a-lease', 1), () => a.node.assertPilotLease({}),
    () => a.node.nodeEvents(0)]) throwsCode(operation, 'insufficient_scope');
  let ran = false;
  throwsCode(() => a.node.run(() => {ran = true;}), 'scoped_operation_required');
  assert.equal(ran, false);
  assert.equal(a.node.getTask(task.taskId).status, 'queued');
});

test('claim authority does not imply read, result, events or subscription authority', async t => {
  const r = await agentAuthorityFixture(t), a = await r.agent(['task.claim']), task = r.enqueue();
  throwsCode(() => a.node.getTask(task.taskId), 'insufficient_scope');
  assert.ok(a.node.claimTask());
  throwsCode(() => a.node.submitResult({}), 'insufficient_scope');
  throwsCode(() => a.node.nodeEvents(0), 'insufficient_scope');
  throwsCode(() => r.gateway.assertAuthenticatedNode(a.principal, {scope: 'events.subscribe'}), 'insufficient_scope');
});

test('scope enforcement still hides tasks from another workspace', async t => {
  const r = await agentAuthorityFixture(t), a = await r.agent(), other = r.enqueue('b');
  throwsCode(() => a.node.getTask(other.taskId), 'unknown_task');
  throwsCode(() => a.node.authorizePilotTask(other.taskId), 'unknown_task');
});

test('an existing gateway principal loses access immediately after explicit grant revocation', async t => {
  const r = await agentAuthorityFixture(t), a = await r.agent(), task = r.enqueue();
  assert.equal(a.node.getTask(task.taskId).id, task.taskId);
  r.authority.revoke(r.actor('alice', 'a'), {workspaceId: r.workspaces.a.id, grantId: a.grant.id});
  throwsCode(() => a.node.getTask(task.taskId), 'unauthorized');
  throwsCode(() => r.gateway.assertAuthenticatedNode(a.principal), 'unauthorized');
});

test('membership epoch changes invalidate already-created gateway access objects', async t => {
  const r = await agentAuthorityFixture(t), a = await r.agent(), task = r.enqueue();
  r.db.prepare('UPDATE memberships SET role=? WHERE user_id=? AND workspace_id=?')
    .run('member', r.users.alice.id, r.workspaces.a.id);
  r.db.prepare('UPDATE memberships SET role=? WHERE user_id=? AND workspace_id=?')
    .run('owner', r.users.alice.id, r.workspaces.a.id);
  throwsCode(() => a.node.getTask(task.taskId), 'unauthorized');
});

test('token expiration invalidates a retained gateway principal', async t => {
  const r = await agentAuthorityFixture(t), a = await r.agent(), task = r.enqueue();
  r.advance(600000);
  throwsCode(() => a.node.getTask(task.taskId), 'unauthorized');
});

test('pause blocks new claims without blocking reads, while re-pair invalidates old principals', async t => {
  const r = await agentAuthorityFixture(t), a = await r.agent(), task = r.enqueue();
  r.human('alice', 'a', h => h.setNodePaused(r.nodes.a.id, true));
  throwsCode(() => a.node.claimTask(), 'node_paused');
  assert.equal(a.node.getTask(task.taskId).id, task.taskId);
  r.human('alice', 'a', h => h.rePair(r.nodes.a.id));
  throwsCode(() => a.node.getTask(task.taskId), 'unauthorized');
});

test('existing pairing-token principals retain their trusted callback and task behavior', async t => {
  const r = await agentAuthorityFixture(t);
  const credentials = r.gateway.pair(r.nodes.a.pairingCode);
  const node = r.access.forNode(r.gateway.authenticate(credentials.token)), task = r.enqueue();
  assert.equal(node.getTask(task.taskId).id, task.taskId);
  assert.equal(node.run(current => current.id), r.nodes.a.id);
  assert.ok(node.claimTask());
});

test('closing authority prevents use of retained gateway principals without closing the gateway', async t => {
  const r = await agentAuthorityFixture(t), a = await r.agent(), task = r.enqueue();
  r.authority.close();
  throwsCode(() => a.node.getTask(task.taskId), 'service_closed');
  assert.equal(r.human('alice', 'a', h => h.getTask(task.taskId)).id, task.taskId);
});
