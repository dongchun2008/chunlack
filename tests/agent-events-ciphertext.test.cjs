'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const root = process.cwd();
const Database = require(path.join(root, 'node_modules/better-sqlite3'));
const {agentAuthorityFixture} = require(path.join(root, 'tests/helpers/agent-authority-fixture.cjs'));
const {input} = require(path.join(root, 'tests/helpers/pilot-fixture.cjs'));
const {createPilotEvents} = require(path.join(root, 'integrations/mcp/events.cjs'));

function eventFixture(t, {bound = true} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-event-binding-'));
  let events;
  t.after(() => {
    try { events?.close(); } finally {
      const target = fs.realpathSync(dir), parent = fs.realpathSync(os.tmpdir());
      if (path.dirname(target) !== parent || !path.basename(target).startsWith('lack-event-binding-')) throw Error('Unsafe fixture cleanup');
      fs.rmSync(target, {recursive: true, force: true});
    }
  });
  const calls = [], time = Date.parse('2026-10-14T00:00:00Z');
  const config = {dbPath: path.join(dir, 'events.sqlite'), encryptionKey: Buffer.alloc(32, 23),
    multiUser: true, now: () => time, authorize: () => true,
    ...(bound ? {authorizeAgentGrant: () => false} : {}),
    transport: async (_url, options) => {
      const body = JSON.parse(options.body); calls.push(body);
      return Response.json(body.type === 'verification' ? {challenge: body.challenge} : {});
    }};
  const principal = {nodeId: 'node-a', workspaceId: 'workspace-a'};
  const params = {name: 'pilot.task_ready', arguments: {taskId: 'task-a'}, ttlMs: 60000,
    delivery: {mode: 'webhook', url: 'https://callback.example/events', secret: 'whsec_' + Buffer.alloc(32, 7).toString('base64')}};
  const event = {eventId: 'ready-one', taskId: 'task-a', taskType: 'browser.public_read', deadlineAt: time + 120000};
  events = createPilotEvents(config);
  function database(fn) { const db = new Database(config.dbPath); try { return fn(db); } finally { db.close(); } }
  function snapshot() { return database(db => ({schema: db.prepare('SELECT * FROM event_schema').all(),
    subscriptions: db.prepare('SELECT * FROM subscriptions ORDER BY id').all(),
    deliveries: db.prepare('SELECT * FROM deliveries ORDER BY id').all()})); }
  return {config, calls, principal, params, event, database, snapshot,
    get events() { return events; },
    reopen(options = {}) { events.close(); events = createPilotEvents({...config, ...options}); return events; }};
}

test('copied legacy ciphertext must not bypass an Agent subscription revocation', async t => {
  const cleanup = [];
  let events;
  t.after(async () => { events?.close(); for (const fn of cleanup) await fn(); });
  const r = await agentAuthorityFixture({after: fn => cleanup.push(fn)});
  const workspace = r.workspaces.a.id;
  const node = r.human('alice', 'a', h => h.createNode({
    name: 'ciphertext-regression', capabilities: ['browser.public_read'], scopes: ['public']
  }));
  const task = r.human('alice', 'a', h => h.enqueueTask({
    targetNodeId: node.id, scopeId: 'public', taskType: 'browser.public_read', input, deadlineAt: r.now() + 120000
  }));
  const grant = r.authority.grant(r.actor('alice', 'a'), {
    workspaceId: workspace, nodeId: node.id, subject: '11111111-1111-4111-8111-111111111111',
    clientId: 'native-client', scopes: ['events.subscribe'], expiresAt: r.now() + 3600000
  });
  const proof = await r.authority.authenticate(r.token(), {grantId: grant.id, scope: 'events.subscribe'});
  const principal = r.gateway.authenticateAgent(proof, {scope: 'events.subscribe'});
  const binding = r.gateway.agentSubscriptionBinding(principal);
  const base = {nodeId: node.id, workspaceId: workspace};
  const calls = [];
  const config = {
    dbPath: path.join(r.dir, 'ciphertext-regression.sqlite'), encryptionKey: Buffer.alloc(32, 17),
    multiUser: true, now: r.now,
    authorize: (p, taskId) => r.access.authorizeStoredNode(p, taskId),
    authorizeCleanup: p => r.access.authorizeStoredNode(p, undefined, {cleanup: true}),
    authorizeAgentGrant: (value, p) => {
      try { const live = r.authority.assertSubscription(value); return live.nodeId === p.nodeId && live.workspaceId === p.workspaceId; }
      catch { return false; }
    },
    transport: async (_url, options) => {
      const body = JSON.parse(options.body); calls.push(body);
      return new Response(JSON.stringify(body.type === 'verification' ? {challenge: body.challenge} : {}), {status: 200});
    }
  };
  events = createPilotEvents(config);
  const params = {name: 'pilot.task_ready', arguments: {taskId: task.taskId}, ttlMs: 60000,
    delivery: {mode: 'webhook', url: 'https://callback.example/events', secret: 'whsec_' + Buffer.alloc(32, 3).toString('base64')}};
  const legacy = await events.subscribe(base, params);
  const agent = await events.subscribe({...base, agentGrant: binding}, params);
  assert.notEqual(legacy.id, agent.id);
  assert.equal(events.publish(base, {eventId: 'ciphertext-event', taskId: task.taskId,
    taskType: 'browser.public_read', deadlineAt: r.now() + 120000}).queued, 2);
  events.close();

  // Modify only this fixture's event database. The attack does not use its key.
  const db = new Database(config.dbPath);
  try {
    const sealed = db.prepare('SELECT sealed FROM subscriptions WHERE id=?').get(legacy.id).sealed;
    db.prepare('UPDATE subscriptions SET sealed=? WHERE id=?').run(sealed, agent.id);
    db.prepare('UPDATE subscriptions SET active=0 WHERE id=?').run(legacy.id);
  } finally { db.close(); }
  r.authority.revoke(r.actor('alice', 'a'), {workspaceId: workspace, grantId: grant.id});
  assert.throws(() => r.authority.assertSubscription(binding));
  calls.length = 0;
  assert.throws(() => createPilotEvents(config), {reason: 'event_state_key_mismatch'});
  assert.equal(calls.length, 0, 'tampered subscriptions must fail closed before any callback');
});

test('valid legacy subscriptions migrate atomically to bound encryption and retain pending delivery', async t => {
  const f = eventFixture(t, {bound: false});
  const subscription = await f.events.subscribe(f.principal, f.params);
  assert.equal(f.events.publish(f.principal, f.event).queued, 1);
  f.events.close();
  const before = f.snapshot();
  assert.equal(before.schema[0].version, 1);
  f.reopen({authorizeAgentGrant: () => false});
  const after = f.snapshot();
  assert.equal(after.schema[0].version, 2);
  assert.equal(after.subscriptions[0].id, subscription.id);
  assert.equal(after.subscriptions[0].expires_at, before.subscriptions[0].expires_at);
  assert.match(after.subscriptions[0].sealed, /^v2:/);
  assert.notEqual(after.subscriptions[0].sealed, before.subscriptions[0].sealed);
  assert.deepEqual(after.deliveries, before.deliveries);
  assert.equal((await f.events.deliverDue()).delivered, 1);
  f.reopen({authorizeAgentGrant: () => false});
  assert.equal((await f.events.deliverDue()).delivered, 0);
  assert.equal(f.calls.length, 2);
});

test('wrong encryption key cannot partially upgrade legacy records', async t => {
  const f = eventFixture(t, {bound: false});
  await f.events.subscribe(f.principal, f.params); f.events.close();
  const before = f.snapshot();
  assert.throws(() => createPilotEvents({...f.config, encryptionKey: Buffer.alloc(32, 24), authorizeAgentGrant: () => false}), {reason: 'event_state_key_mismatch'});
  assert.deepEqual(f.snapshot(), before);
  f.reopen();
  assert.equal(f.events.publish(f.principal, f.event).queued, 1);
});

test('failed legacy re-encryption rolls back ciphertexts and schema metadata together', async t => {
  const f = eventFixture(t, {bound: false});
  await f.events.subscribe(f.principal, f.params);
  const second = await f.events.subscribe(f.principal, {...f.params, delivery: {...f.params.delivery, url: 'https://callback.example/second'}});
  f.events.close();
  assert.match(second.id, /^sub_[a-f0-9]{64}$/);
  f.database(db => db.exec(`CREATE TRIGGER reject_fixture_upgrade BEFORE UPDATE OF sealed ON subscriptions WHEN OLD.id='${second.id}' BEGIN SELECT RAISE(ABORT,'fixture_upgrade_failure'); END;`));
  const before = f.snapshot();
  assert.throws(() => createPilotEvents({...f.config, authorizeAgentGrant: () => false}), /fixture_upgrade_failure/);
  assert.deepEqual(f.snapshot(), before);
  f.database(db => db.exec('DROP TRIGGER reject_fixture_upgrade'));
  f.reopen({authorizeAgentGrant: () => false});
  assert.equal(f.snapshot().schema[0].version, 2);
});

test('legacy row identity mismatch is refused rather than blessed by migration', async t => {
  const f = eventFixture(t, {bound: false});
  await f.events.subscribe(f.principal, f.params); f.events.close();
  f.database(db => db.prepare('UPDATE subscriptions SET node_id=?').run('other-node'));
  const before = f.snapshot();
  assert.throws(() => createPilotEvents({...f.config, authorizeAgentGrant: () => false}), {reason: 'event_subscription_identity_mismatch'});
  assert.deepEqual(f.snapshot(), before);
});

for (const field of ['id', 'node_id', 'workspace_id', 'task_id']) {
  test(`bound ciphertext authenticates its owning ${field}`, async t => {
    const f = eventFixture(t);
    await f.events.subscribe(f.principal, f.params); f.events.close();
    f.database(db => {
      if (field === 'workspace_id') db.exec('DROP TRIGGER subscription_workspace_immutable');
      db.prepare(`UPDATE subscriptions SET ${field}=?`).run('substituted-value');
    });
    const before = f.snapshot();
    assert.throws(() => createPilotEvents(f.config), {reason: 'event_state_key_mismatch'});
    assert.deepEqual(f.snapshot(), before);
    assert.equal(f.calls.length, 1);
  });
}

test('live database ciphertext substitution is stopped before transport dispatch', async t => {
  const f = eventFixture(t);
  const first = await f.events.subscribe(f.principal, f.params);
  const second = await f.events.subscribe(f.principal, {...f.params, delivery: {...f.params.delivery, url: 'https://callback.example/second'}});
  assert.equal(f.events.publish(f.principal, f.event).queued, 2);
  f.database(db => {
    const sealed = db.prepare('SELECT sealed FROM subscriptions WHERE id=?').get(second.id).sealed;
    db.prepare('UPDATE subscriptions SET sealed=? WHERE id=?').run(sealed, first.id);
    db.prepare('UPDATE subscriptions SET active=0 WHERE id=?').run(second.id);
  });
  f.calls.length = 0;
  assert.equal((await f.events.deliverDue()).delivered, 0);
  assert.equal(f.calls.length, 0);
  assert.ok(f.snapshot().deliveries.every(row => row.state === 'stopped'));
});

test('schema downgrade cannot make bound ciphertext load through the legacy decoder', async t => {
  const f = eventFixture(t);
  await f.events.subscribe(f.principal, f.params); f.events.close();
  f.database(db => db.prepare('UPDATE event_schema SET version=1').run());
  assert.throws(() => createPilotEvents(f.config), {reason: 'event_state_key_mismatch'});
  assert.throws(() => createPilotEvents({...f.config, authorizeAgentGrant: undefined}), {reason: 'event_state_key_mismatch'});
});

for (const prefix of ['', 'v2:']) {
  test(`unbound ciphertext is rejected in an upgraded database with prefix ${JSON.stringify(prefix)}`, async t => {
    const f = eventFixture(t, {bound: false});
    await f.events.subscribe(f.principal, f.params); f.events.close();
    const unbound = f.snapshot().subscriptions[0].sealed;
    f.reopen({authorizeAgentGrant: () => false}); f.events.close();
    f.database(db => db.prepare('UPDATE subscriptions SET sealed=?').run(prefix + unbound));
    assert.throws(() => createPilotEvents({...f.config, authorizeAgentGrant: () => false}), {reason: 'event_state_key_mismatch'});
  });
}
