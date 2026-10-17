'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {publicAgentFixture} = require('./helpers/public-agent-fixture.cjs');

test('packaged scoped tool calls select the exact grant across workspaces and never fall back after revocation', {timeout: 60000}, async t => {
  const f = await publicAgentFixture(t);
  const read = (grant, task) => f.rpc('tools/call', {name: 'pilot.read_task', arguments: {grantId: f.grants[grant].id, taskId: f.tasks[task].taskId}});
  for (const workspace of ['b', 'a', 'b']) {
    const reply = await read(workspace, workspace);
    assert.equal(reply.status, 200); assert.equal(reply.body.result.structuredContent.workspaceId, f.workspaces[workspace].id);
  }
  assert.ok((await read('a', 'b')).body.error);
  const missing = await f.rpc('tools/call', {name: 'pilot.read_task', arguments: {taskId: f.tasks.a.taskId}});
  assert.ok(missing.body.error);
  await f.revoke('a');
  assert.equal((await read('a', 'a')).status, 401);
  assert.equal((await read('b', 'b')).status, 200);
});

test('packaged OAuth event subscription keeps its grant and delivers signed data for the selected workspace only', {timeout: 60000}, async t => {
  const f = await publicAgentFixture(t);
  assert.equal(f.runtime.mcp.events.agentAuthority, true);
  const denied = await f.rpc('events/subscribe', f.params, f.token(['events.read']));
  assert.equal(denied.status, 403); assert.equal(f.callbacks.length, 0);
  const subscribed = await f.rpc('events/subscribe', f.params);
  assert.equal(subscribed.status, 200); assert.ok(subscribed.body.result.id);
  const event = await f.delivered();
  assert.equal(event.data.workspaceId, f.workspaces.b.id); assert.equal(event.data.taskId, f.tasks.b.taskId);
  assert.equal(f.callbacks.filter(value => value.type === 'verification').length, 1);
  assert.equal(f.human('b', h => h.getTask(f.tasks.b.taskId)).status, 'queued', 'notification delivery is not task execution');
  const {secret, ...delivery} = f.params.delivery;
  const stopped = await f.rpc('events/unsubscribe', {...f.params, delivery});
  assert.equal(stopped.status, 200); assert.equal(stopped.body.result.unsubscribed, true);
});

test('packaged subscription verification stops when a human revokes its grant during DNS', {timeout: 60000}, async t => {
  const f = await publicAgentFixture(t), gate = f.holdDns();
  const pending = f.rpc('events/subscribe', f.params);
  try {await gate.entered(); await f.revoke('b');} finally {gate.release();}
  const reply = await pending;
  assert.equal(reply.body.error.data.reason, 'challenge_failed');
  assert.deepEqual(f.runtime.mcp.events.pendingTargets(), []);
  await f.runtime.close(); assert.equal(f.callbacks.length, 0);
});

test('packaged event delivery revalidates a human revocation after DNS and before sending content', {timeout: 60000}, async t => {
  const f = await publicAgentFixture(t), gate = f.holdDns(1);
  const subscribed = await f.rpc('events/subscribe', f.params);
  assert.equal(subscribed.status, 200); assert.ok(subscribed.body.result.id);
  try {await gate.entered(); await f.revoke('b');} finally {gate.release();}
  const attempt = await f.deliveryAttempt();
  assert.deepEqual(attempt, {status: 'rejected', reason: 'callback_access_denied', aborted: false});
  assert.equal(f.callbacks.length, 1); assert.equal(f.callbacks[0].type, 'verification');
  assert.equal((await f.rpc('tools/list', {})).status, 200, 'runtime remains live after the revoked delivery settles');
  t.diagnostic('delivery settled with callback_access_denied before runtime shutdown; abort signal was not set');
  await f.runtime.close();
});
