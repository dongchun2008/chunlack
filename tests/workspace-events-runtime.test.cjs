'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {randomBytes, createHmac} = require('node:crypto');
const {setTimeout: delay} = require('node:timers/promises');
const {gatewayFixture} = require('./helpers/workspace-gateway-fixture.cjs');

function fixture(t) {
  const cleanup = [], f = gatewayFixture({after: fn => cleanup.push(fn)}), secret = 'whsec_' + randomBytes(32).toString('base64');
  let runtime;
  t.after(async () => {try {await runtime?.close();} finally {for (const fn of cleanup) await fn();}});
  const task = f.enqueue('a'), principal = {nodeId: f.nodes.a.id, workspaceId: f.workspaces.a.id};
  const config = {enabled: true, encryptionKeyEnv: 'EVENTS_FIXTURE_KEY', allowedHosts: ['callback.example'],
    workspaceCallbackHosts: {[f.workspaces.a.id]: ['callback.example']}, deliveryIntervalMs: 1000};
  const env = {EVENTS_FIXTURE_KEY: randomBytes(32).toString('hex')};
  const params = {name: 'pilot.task_ready', arguments: {taskId: task.taskId}, delivery: {mode: 'webhook', url: 'https://callback.example/ready', secret}};
  let verified = 0, delivered = 0;
  const webhook = {lookup: async () => [{address: '8.8.8.8', family: 4}],
    post: async (_url, options) => {
      const headers = options.headers, expected = 'v1,' + createHmac('sha256', Buffer.from(secret.slice(6), 'base64'))
        .update(headers['webhook-id'] + '.' + headers['webhook-timestamp'] + '.' + options.body).digest('base64');
      assert.equal(headers['webhook-signature'], expected);
      const value = JSON.parse(options.body);
      if (value.type === 'verification') {verified++; return new Response(JSON.stringify({challenge: value.challenge}));}
      assert.equal(value.data.workspaceId, f.workspaces.a.id); assert.equal(value.data.taskId, task.taskId); delivered++;
      return new Response(null, {status: 204});
    }};
  return {...f, task, principal, config, env, params, webhook, counts: () => ({verified, delivered}),
    start(extra = {}) {runtime = require('../integrations/mcp/runtime.cjs').createPublicEventsRuntime({gateway: {store: f.gatewayStore, workspaceAccess: f.access},
      dataRoot: f.dir, options: config, env, webhook, now: f.now, ...extra}); return runtime;}};
}
test('event runtime verifies the approved callback, publishes an existing queued task and deduplicates repeat subscriptions', async t => {
  const f = fixture(t), runtime = f.start();
  await runtime.events.subscribe(f.principal, f.params); await runtime.flush();
  assert.deepEqual(f.counts(), {verified: 1, delivered: 1});
  await runtime.events.subscribe(f.principal, f.params); await runtime.flush();
  assert.deepEqual(f.counts(), {verified: 1, delivered: 1});
  assert.equal(f.human('alice', 'a', h => h.getTask(f.task.taskId)).status, 'queued', 'HTTP event receipt never executes or claims the task');
  await runtime.close(); await assert.rejects(runtime.flush(), /events_runtime_closed/);
});
test('event runtime rejects absent keys and callback grants before creating a persistent event database', async t => {
  const f = fixture(t), dbPath = path.join(f.dir, 'db', 'mcp-events.db');
  assert.throws(() => f.start({env: {}}), /events_encryption_key_required/);
  assert.throws(() => f.start({options: {...f.config, workspaceCallbackHosts: {[f.workspaces.a.id]: ['unapproved.example']}}}), /invalid_workspace_callback_grants/);
  assert.equal(require('node:fs').existsSync(dbPath), false);
});
test('callback grants deny another workspace without network traffic or subscription state', async t => {
  const f = fixture(t), runtime = f.start(), foreign = f.enqueue('b');
  await assert.rejects(runtime.events.subscribe({nodeId: f.nodes.b.id, workspaceId: f.workspaces.b.id}, {...f.params, arguments: {taskId: foreign.taskId}}), /challenge_failed/);
  assert.deepEqual(f.counts(), {verified: 0, delivered: 0});
  assert.deepEqual(runtime.events.pendingTargets(), []);
});
test('event runtime shutdown aborts a pending delivery, joins its pump and detaches the store listener', async t => {
  const f = fixture(t); let signal;
  const runtime = f.start({webhook: {...f.webhook, post: async (_url, options) => {
    const value = JSON.parse(options.body);
    if (value.type === 'verification') return new Response(JSON.stringify({challenge: value.challenge}));
    signal = options.signal; return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), {once: true}));
  }}});
  await runtime.events.subscribe(f.principal, f.params);
  const pumping = runtime.flush();
  for (let i = 0; i < 50 && !signal; i++) await delay(5);
  assert.ok(signal); await runtime.close(); await pumping;
  assert.equal(signal.aborted, true);
  assert.equal(f.gatewayStore.changes.listeners('change').some(listener => listener === runtime.onChange), false);
});

test('event runtime reopens encrypted subscriptions and delivered receipts without repeating a callback',async t=>{
  const f=fixture(t),first=f.start(); await first.events.subscribe(f.principal,f.params); await first.flush(); await first.close();
  const second=f.start(); await second.flush();
  assert.deepEqual(f.counts(),{verified:1,delivered:1});
  assert.deepEqual(second.events.pendingTargets(),[{...f.principal,taskId:f.task.taskId}]);
});
