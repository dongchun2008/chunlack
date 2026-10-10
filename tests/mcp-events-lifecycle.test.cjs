'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {randomBytes} = require('node:crypto');
const {setTimeout: delay} = require('node:timers/promises');
const {createPilotEvents} = require('../integrations/mcp/events.cjs');

function fixture(t) {
  const principal = {nodeId: 'fixture_node', workspaceId: 'fixture_workspace'};
  const params = {name: 'pilot.task_ready', arguments: {taskId: 'fixture_task'}, delivery: {mode: 'webhook', url: 'https://callback.example/ready', secret: 'whsec_' + randomBytes(32).toString('base64')}};
  let heldSignal, release;
  const events = createPilotEvents({dbPath: ':memory:', encryptionKey: randomBytes(32), multiUser: true, authorize: () => true,
    transport: (_url, options) => {
      const value = JSON.parse(options.body);
      if (value.type === 'verification') return Promise.resolve(new Response(JSON.stringify({challenge: value.challenge})));
      heldSignal = options.signal;
      return new Promise((resolve, reject) => {release = () => resolve(new Response(null, {status: 204})); options.signal.addEventListener('abort', () => reject(options.signal.reason), {once: true});});
    }});
  t.after(() => events.close());
  return {events, principal, params, signal: () => heldSignal, release: () => release?.()};
}
test('multi-workspace event schema matches the signed workspace attribution it emits', async t => {
  const f = fixture(t), definition = f.events.list(f.principal).events[0];
  assert.ok(definition.payloadSchema.properties.workspaceId);
  assert.ok(definition.payloadSchema.required.includes('workspaceId'));
});
test('closing event state aborts an active callback and returns without a closed-database write', async t => {
  const f = fixture(t); await f.events.subscribe(f.principal, f.params);
  f.events.publish(f.principal, {eventId: 'fixture_event', taskId: 'fixture_task', taskType: 'browser.public_read', deadlineAt: Date.now() + 10000});
  const delivering = f.events.deliverDue(); const observed = delivering.catch(() => {});
  try {
    await delay(10); assert.ok(f.signal());
    f.events.close(); assert.equal(f.signal().aborted, true);
    assert.deepEqual(await delivering, {delivered: 0});
  } finally {f.events.close(); f.release(); await observed;}
});
test('expired subscriptions are reclaimed so a bounded service does not become permanently full after five tasks', async t => {
  let time = Date.now();
  const events = createPilotEvents({dbPath: ':memory:', encryptionKey: randomBytes(32), multiUser: true, now: () => time, authorize: () => true,
    transport: async (_url, options) => new Response(JSON.stringify({challenge: JSON.parse(options.body).challenge}))});
  t.after(() => events.close());
  const principal = {nodeId: 'fixture_node', workspaceId: 'fixture_workspace'};
  const spec = index => ({name: 'pilot.task_ready', arguments: {taskId: 'task_' + index}, ttlMs: 1000,
    delivery: {mode: 'webhook', url: 'https://callback.example/ready', secret: 'whsec_' + randomBytes(32).toString('base64')}});
  for (let i = 0; i < 5; i++) await events.subscribe(principal, spec(i));
  time += 1001;
  assert.equal(typeof events.cleanup, 'function');
  assert.deepEqual(events.cleanup(), {removed: 5});
  assert.ok((await events.subscribe(principal, spec(6))).id);
  assert.deepEqual(events.pendingTargets(), [{nodeId: 'fixture_node', workspaceId: 'fixture_workspace', taskId: 'task_6'}]);
});
