'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {createHash} = require('node:crypto');
const Database = require('better-sqlite3');
const {agentAuthorityFixture} = require('./helpers/agent-authority-fixture.cjs');
const {input} = require('./helpers/pilot-fixture.cjs');
const {createPilotEvents} = require('../integrations/mcp/events.cjs');

async function fixture(t, {advanceBeforeAuth = 0, transport} = {}) {
  const cleanup = []; let events;
  t.after(async () => {try {events?.close();} finally {for (const fn of cleanup) await fn();}});
  const r = await agentAuthorityFixture({after: fn => cleanup.push(fn)});
  const bearer = r.token(); r.advance(advanceBeforeAuth);
  const node = r.human('alice', 'a', h => h.createNode({name: 'event-browser', capabilities: ['browser.public_read'], scopes: ['public']}));
  const task = r.human('alice', 'a', h => h.enqueueTask({targetNodeId: node.id, scopeId: 'public', taskType: 'browser.public_read', input, deadlineAt: r.now() + 120000}));
  const grant = r.authority.grant(r.actor('alice', 'a'), {subject: '11111111-1111-4111-8111-111111111111', clientId: 'native-client',
    workspaceId: r.workspaces.a.id, nodeId: node.id, scopes: ['events.subscribe'], expiresAt: r.now() + 3600000});
  const proof = await r.authority.authenticate(bearer, {grantId: grant.id, scope: 'events.subscribe'});
  const principal = r.gateway.authenticateAgent(proof, {scope: 'events.subscribe'});
  assert.equal(typeof r.gateway.agentSubscriptionBinding, 'function');
  const binding = r.gateway.agentSubscriptionBinding(principal);
  const base = {nodeId: node.id, workspaceId: r.workspaces.a.id};
  const agent = {...base, agentGrant: binding};
  const dbPath = path.join(r.dir, 'agent-events.sqlite'), calls = [];
  const config = {dbPath, encryptionKey: Buffer.alloc(32, 9), multiUser: true, now: r.now,
    authorize: (p, taskId) => r.access.authorizeStoredNode(p, taskId),
    authorizeCleanup: p => r.access.authorizeStoredNode(p, undefined, {cleanup: true}),
    authorizeAgentGrant: (value, p) => {
      try {const current = r.authority.assertSubscription(value); return current.nodeId === p.nodeId && current.workspaceId === p.workspaceId;} catch {return false;}
    },
    transport: async (url, options, attribution) => {
      const body = JSON.parse(options.body); calls.push({body, attribution});
      if (transport) return transport(body);
      return new Response(JSON.stringify(body.type === 'verification' ? {challenge: body.challenge} : {}), {status: 200});
    }};
  const params = {name: 'pilot.task_ready', arguments: {taskId: task.taskId}, delivery: {mode: 'webhook',
    url: 'https://callback.example/events', secret: 'whsec_' + Buffer.alloc(32, 3).toString('base64')}, ttlMs: 300000};
  const event = {eventId: 'event-one', taskId: task.taskId, taskType: 'browser.public_read', deadlineAt: r.now() + 120000};
  events = createPilotEvents(config);
  return {...r, grant, principal, binding, agent, base, task, node, config, params, event, calls, dbPath,
    get events() {return events;},
    reopen(options = {}) {events.close(); events = createPilotEvents({...config, ...options}); return events;},
    revoke() {r.authority.revoke(r.actor('alice', 'a'), {workspaceId: r.workspaces.a.id, grantId: grant.id});}};
}

test('gateway produces a bounded persisted subscription binding, never a bearer token', async t => {
  const f = await fixture(t);
  assert.ok(Object.isFrozen(f.binding));
  assert.equal(f.binding.grantId, f.grant.id);
  assert.equal(f.binding.scope, 'events.subscribe');
  assert.equal(f.authority.assertSubscription(f.binding).nodeId, f.node.id);
  assert.equal(JSON.stringify(f.binding).includes('eyJ'), false);
  for (const change of [{nodeId: f.nodes.b.id}, {workspaceId: f.workspaces.b.id}, {scope: 'task.result'}, {extra: true}]) {
    assert.throws(() => f.authority.assertSubscription({...f.binding, ...change}));
  }
  const pairing = f.gateway.pair(f.node.pairingCode);
  assert.throws(() => f.gateway.agentSubscriptionBinding(f.gateway.authenticate(pairing.token)), {code: 'unauthorized'});
});

test('encrypted Agent subscriptions survive an events-store restart and deliver under the same grant', async t => {
  const f = await fixture(t);
  await f.events.subscribe(f.agent, f.params);
  assert.equal(f.events.publish(f.base, f.event).queued, 1);
  f.reopen();
  assert.equal((await f.events.deliverDue()).delivered, 1);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].attribution.agentGrant.grantId, f.grant.id);
  assert.equal(fs.readFileSync(f.dbPath).includes(Buffer.from(f.params.delivery.secret)), false);
});

for (const mutation of ['grant revoke', 'membership epoch', 'identity unlink']) {
  test(`queued delivery stops after ${mutation}, including after restart`, async t => {
    const f = await fixture(t);
    await f.events.subscribe(f.agent, f.params); f.events.publish(f.base, f.event);
    if (mutation === 'grant revoke') f.revoke();
    else if (mutation === 'membership epoch') {
      const update = f.db.prepare('UPDATE memberships SET role=? WHERE workspace_id=? AND user_id=?');
      update.run('member', f.workspaces.a.id, f.users.alice.id); update.run('owner', f.workspaces.a.id, f.users.alice.id);
    } else f.store.unlinkExternalIdentity({issuer: f.binding.issuer, sub: f.binding.subject});
    f.reopen();
    assert.equal((await f.events.deliverDue()).delivered, 0);
    assert.equal(f.calls.length, 1);
    assert.throws(() => f.authority.assertSubscription(f.binding));
  });
}

test('subscription expiry is clipped to the original JWT while the grant and task remain live', async t => {
  const f = await fixture(t, {advanceBeforeAuth: 590000});
  const subscription = await f.events.subscribe(f.agent, f.params);
  assert.equal(Date.parse(subscription.refreshBefore), f.now() + 10000);
  f.events.publish(f.base, f.event); f.advance(10000);
  assert.ok(f.grant.expiresAt > f.now()); assert.ok(f.event.deadlineAt > f.now());
  assert.equal((await f.events.deliverDue()).delivered, 0);
  assert.equal(f.calls.length, 1);
  assert.throws(() => f.authority.assertSubscription(f.binding));
});

test('grant revocation during callback verification cannot persist a subscription', async t => {
  let entered, release;
  const start = new Promise(resolve => {entered = resolve;});
  const wait = new Promise(resolve => {release = resolve;});
  const f = await fixture(t, {transport: async body => {entered(); await wait; return new Response(JSON.stringify({challenge: body.challenge}));}});
  const subscription = f.events.subscribe(f.agent, f.params);
  const rejected = assert.rejects(subscription, error => error.reason === 'event_access_denied');
  await start; f.revoke(); release(); await rejected;
  assert.deepEqual(f.events.pendingTargets(), []);
});

test('grant revoked before the transport microtask dispatch never sends queued content', async t => {
  const f = await fixture(t);
  await f.events.subscribe(f.agent, f.params); f.events.publish(f.base, f.event);
  const delivery = f.events.deliverDue(); f.revoke();
  assert.equal((await delivery).delivered, 0);
  f.advance(1000); assert.equal((await f.events.deliverDue()).delivered, 0);
  assert.equal(f.calls.length, 1);
});

test('legacy and Agent subscriptions for the same target remain separate and cannot unsubscribe each other', async t => {
  const f = await fixture(t);
  const legacy = await f.events.subscribe(f.base, f.params), agent = await f.events.subscribe(f.agent, f.params);
  assert.notEqual(legacy.id, agent.id);
  const {secret, ...delivery} = f.params.delivery;
  f.events.unsubscribe(f.agent, {...f.params, delivery});
  assert.equal(f.events.publish(f.base, f.event).queued, 1);
  assert.equal((await f.events.deliverDue()).delivered, 1);
  assert.equal(f.calls.at(-1).attribution.agentGrant, undefined);
});

test('Agent event state cannot be reopened without a grant authorizer or as an old schema', async t => {
  const f = await fixture(t);
  await f.events.subscribe(f.agent, f.params); f.events.close();
  const db = new Database(f.dbPath, {readonly: true});
  try {assert.equal(db.prepare('SELECT version FROM event_schema').get().version, 2);} finally {db.close();}
  assert.throws(() => createPilotEvents({...f.config, authorizeAgentGrant: undefined}), error => error.reason === 'event_agent_authority_required');
  f.reopen(); assert.equal(f.events.agentAuthority, true);
});

test('future event schemas are rejected without changing database bytes', async t => {
  const f = await fixture(t); f.events.close();
  const db = new Database(f.dbPath);
  try {db.prepare('UPDATE event_schema SET version=99').run(); db.pragma('wal_checkpoint(TRUNCATE)');} finally {db.close();}
  const hash = () => createHash('sha256').update(fs.readFileSync(f.dbPath)).digest('hex'), before = hash();
  assert.throws(() => createPilotEvents(f.config), error => error.reason === 'event_schema_mode_mismatch');
  assert.equal(hash(), before);
});
