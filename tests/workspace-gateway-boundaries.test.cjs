'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {gatewayFixture} = require('./helpers/workspace-gateway-fixture.cjs');
const {throwsCode, workspaceFixture} = require('./helpers/workspace-fixture.cjs');
const {createPilotEvents} = require('../integrations/mcp/events.cjs');

test('pausing prevents new claims but does not abandon a running lease; owner revocation stops every node action', t => {
  const f = gatewayFixture(t); f.enqueue('a'); const n = f.node('a'), lease = n.claimTask();
  f.human('alice', 'a', h => h.setNodePaused(f.nodes.a.id, true));
  assert.equal(n.claimTask(), null);
  assert.ok(n.renewLease(lease.taskId, lease.leaseId, lease.attempt));
  f.human('alice', 'a', h => h.setNodePaused(f.nodes.a.id, false));
  f.store.setMembership(f.actor('alice', 'a'), {workspaceId: f.workspaces.a.id, userId: f.users.bob.id, role: 'owner'});
  f.store.disableUser(f.users.alice.id);
  assert.throws(() => n.heartbeat());
  assert.throws(() => n.getTask(lease.taskId));
});

test('human facade exposes checked operations, not an arbitrary store callback bypass', t => {
  const f = gatewayFixture(t);
  f.human('carol', 'b', h => assert.equal(h.run, undefined));
});

test('public callback transport uses trusted per-workspace host grants before DNS or HTTP', async () => {
  let dns = 0, sent = 0;
  const send = require('../integrations/mcp/webhook-transport.cjs').createWebhookTransport({multiUser: true,
    allowedHosts: ['callback.example', 'other.example'], workspaceCallbackHosts: {alpha: ['callback.example'], beta: ['other.example']},
    lookup: async () => {dns++; return [{address: '93.184.216.34', family: 4}];},
    post: async () => {sent++; return new Response('', {status: 200});}});
  await assert.rejects(() => send('https://callback.example/events', {}, {workspaceId: 'beta', nodeId: 'node-b', taskId: 'task-b'}));
  await assert.rejects(() => send('https://callback.example/events', {}));
  assert.equal(dns, 0); assert.equal(sent, 0);
  assert.equal((await send('https://callback.example/events', {}, {workspaceId: 'alpha', nodeId: 'node-a', taskId: 'task-a'})).status, 200);
  assert.equal(dns, 1); assert.equal(sent, 1);
});

test('event database rejects unassigned records without deleting or adopting them', t => {
  const f = workspaceFixture(t), file = path.join(f.dir, 'events.sqlite');
  const Database = require('better-sqlite3'), db = new Database(file);
  db.exec('CREATE TABLE subscriptions(id TEXT PRIMARY KEY,node_id TEXT,task_id TEXT,sealed TEXT,expires_at INTEGER,verified_at INTEGER,active INTEGER);');
  db.prepare('INSERT INTO subscriptions VALUES(?,?,?,?,?,?,?)').run('unassigned', 'node', 'task', 'not-a-real-secret', 1, 1, 1); db.close();
  assert.throws(() => createPilotEvents({dbPath: file, multiUser: true, encryptionKey: Buffer.alloc(32, 1), authorize: () => true, transport: async () => new Response('')}), e => e.reason === 'event_migration_required');
  const check = new Database(file, {readonly: true}); try {assert.equal(check.prepare('SELECT COUNT(*) AS n FROM subscriptions').get().n, 1);} finally {check.close();}
});

test('persisted event deliveries retain workspace binding across restart and cannot be readopted with legacy mode', async t => {
  const f = gatewayFixture(t), file = path.join(f.dir, 'events.sqlite'), task = f.enqueue('a'), principal = {nodeId: f.nodes.a.id, workspaceId: f.workspaces.a.id};
  let sent = 0;
  const options = {dbPath: file, multiUser: true, encryptionKey: Buffer.alloc(32, 1), now: f.now,
    authorize: (p, id) => f.access.authorizeStoredNode(p, id),
    transport: async (_url, options, binding) => {assert.equal(binding.workspaceId, f.workspaces.a.id); const body = JSON.parse(options.body); if (body.type === 'verification') return new Response(JSON.stringify({challenge: body.challenge})); sent++; assert.equal(body.data.workspaceId, binding.workspaceId); return new Response('', {status: 200});}};
  const events = createPilotEvents(options);
  await events.subscribe(principal, {name: 'pilot.task_ready', arguments: {taskId: task.taskId}, delivery: {mode: 'webhook', url: 'https://callback.example/events', secret: 'whsec_' + Buffer.alloc(32, 2).toString('base64')}});
  assert.equal(events.publish(principal, {eventId: 'ready', taskId: task.taskId, taskType: 'browser.public_read', deadlineAt: f.now() + 10000}).queued, 1);
  events.close();
  assert.throws(() => createPilotEvents({...options, multiUser: false}), e => e.reason === 'event_schema_mode_mismatch');
  const resumed = createPilotEvents(options); f.own(resumed);
  assert.equal((await resumed.deliverDue()).delivered, 1);
  assert.equal((await resumed.deliverDue()).delivered, 0); assert.equal(sent, 1);
});
