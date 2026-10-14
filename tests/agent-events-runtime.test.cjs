'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {createHmac} = require('node:crypto');
const {agentAuthorityFixture} = require('./helpers/agent-authority-fixture.cjs');
const {input} = require('./helpers/pilot-fixture.cjs');
const {createPublicEventsRuntime} = require('../integrations/mcp/runtime.cjs');
const {createPilotMcp} = require('../integrations/mcp/pilot-server.cjs');

function deferred() { let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve}; }

async function fixture(t, {advanceBeforeAuth = 0, grantScopes = ['events.subscribe']} = {}) {
  const cleanup = []; let runtime, ready = false;
  t.after(async () => {try {await runtime?.close();} finally {for (const fn of cleanup) await fn();}});
  const r = await agentAuthorityFixture({after: fn => cleanup.push(fn)});
  const bearer = r.token(); r.advance(advanceBeforeAuth);
  const node = r.human('alice', 'a', h => h.createNode({name: 'runtime-browser', capabilities: ['browser.public_read'], scopes: ['public']}));
  const task = r.human('alice', 'a', h => h.enqueueTask({targetNodeId: node.id, scopeId: 'public', taskType: 'browser.public_read', input, deadlineAt: r.now() + 120000}));
  const grant = r.authority.grant(r.actor('alice', 'a'), {subject: '11111111-1111-4111-8111-111111111111', clientId: 'native-client',
    workspaceId: r.workspaces.a.id, nodeId: node.id, scopes: grantScopes, expiresAt: r.now() + 3600000});
  const proof = await r.authority.authenticate(bearer, {grantId: grant.id, scope: 'events.subscribe'});
  const binding = r.gateway.agentSubscriptionBinding(r.gateway.authenticateAgent(proof, {scope: 'events.subscribe'}));
  const base = {nodeId: node.id, workspaceId: r.workspaces.a.id}, agent = {...base, agentGrant: binding};
  const secret = 'whsec_' + Buffer.alloc(32, 31).toString('base64');
  const params = {name: 'pilot.task_ready', arguments: {taskId: task.taskId}, ttlMs: 60000,
    delivery: {mode: 'webhook', url: 'https://callback.example/ready', secret}};
  const calls = [], addresses = [{address: '8.8.8.8', family: 4}];
  let lookup = async () => addresses;
  const config = {gateway: {store: r.gateway, workspaceAccess: r.access}, dataRoot: r.dir,
    agentAuthority: r.authority, now: r.now, ready: () => ready,
    options: {enabled: true, encryptionKeyEnv: 'AGENT_EVENTS_TEST_KEY', allowedHosts: ['callback.example'],
      workspaceCallbackHosts: {[r.workspaces.a.id]: ['callback.example']}, deliveryIntervalMs: 1000},
    env: {AGENT_EVENTS_TEST_KEY: Buffer.alloc(32, 32).toString('hex')},
    webhook: {lookup: (...args) => lookup(...args), post: async (_url, options) => {
      const headers = options.headers;
      const expected = 'v1,' + createHmac('sha256', Buffer.from(secret.slice(6), 'base64'))
        .update(headers['webhook-id'] + '.' + headers['webhook-timestamp'] + '.' + options.body).digest('base64');
      assert.equal(headers['webhook-signature'], expected);
      const body = JSON.parse(options.body); calls.push(body);
      return body.type === 'verification' ? Response.json({challenge: body.challenge}) : new Response(null, {status: 204});
    }}};
  return {...r, node, task, grant, binding, base, agent, params, config, calls,
    start(extra = {}) {runtime = createPublicEventsRuntime({...config, ...extra}); return runtime;},
    get runtime() {return runtime;},
    setReady(value) {ready = value;},
    holdDns() {const entered = deferred(), release = deferred(); lookup = async () => {entered.resolve(); await release.promise; return addresses;}; return {entered: entered.promise, release: release.resolve};},
    revoke() {r.authority.revoke(r.actor('alice', 'a'), {workspaceId: base.workspaceId, grantId: grant.id});},
    queue() {return runtime.events.publish(base, {eventId: 'runtime-ready', taskId: task.taskId, taskType: 'browser.public_read', deadlineAt: r.now() + 120000});}};
}

test('runtime wires live Agent authority through verification, publication, and signed callback delivery', async t => {
  const f = await fixture(t), runtime = f.start();
  assert.equal(runtime.events.agentAuthority, true);
  await runtime.events.subscribe(f.agent, f.params); await runtime.flush();
  assert.equal(f.calls.length, 1);
  f.setReady(true); await runtime.flush(); await runtime.flush();
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].data.workspaceId, f.base.workspaceId);
  assert.equal(f.calls[1].data.taskId, f.task.taskId);
  assert.equal(f.human('alice', 'a', h => h.getTask(f.task.taskId)).status, 'queued');
});

test('runtime refuses malformed authority before creating its event database', async t => {
  const f = await fixture(t);
  assert.throws(() => f.start({agentAuthority: {assertSubscription: true}}), /invalid_events_agent_authority/);
  assert.equal(fs.existsSync(path.join(f.dir, 'db', 'mcp-events.db')), false);
});

test('revocation before runtime pumping prevents already-queued Agent delivery', async t => {
  const f = await fixture(t), runtime = f.start();
  await runtime.events.subscribe(f.agent, f.params); await runtime.flush();
  assert.equal(f.queue().queued, 1); f.revoke();
  f.setReady(true); await runtime.flush();
  assert.equal(f.calls.length, 1);
});

test('revocation during verification DNS resolution prevents the verification POST and subscription persistence', async t => {
  const f = await fixture(t), runtime = f.start(), gate = f.holdDns();
  const pending = runtime.events.subscribe(f.agent, f.params);
  const rejected = assert.rejects(pending, /challenge_failed/);
  try {await gate.entered; f.revoke();} finally {gate.release();}
  await rejected;
  assert.equal(f.calls.length, 0);
  assert.deepEqual(runtime.events.pendingTargets(), []);
});

for (const mutation of ['revoke', 'membership epoch', 'JWT expiry']) {
  test(`runtime rechecks ${mutation} after delivery DNS and before POST`, async t => {
    const f = await fixture(t, {advanceBeforeAuth: mutation === 'JWT expiry' ? 590000 : 0}), runtime = f.start();
    await runtime.events.subscribe(f.agent, f.params); await runtime.flush();
    const gate = f.holdDns(); f.setReady(true);
    const pumping = runtime.flush();
    try {
      await gate.entered;
      if (mutation === 'revoke') f.revoke();
      else if (mutation === 'JWT expiry') f.advance(10000);
      else {
        const update = f.db.prepare('UPDATE memberships SET role=? WHERE workspace_id=? AND user_id=?');
        update.run('member', f.base.workspaceId, f.users.alice.id);
        update.run('owner', f.base.workspaceId, f.users.alice.id);
      }
    } finally {gate.release();}
    await pumping; await runtime.flush();
    assert.equal(f.calls.length, 1, 'only the pre-revocation verification callback was sent');
    assert.throws(() => f.authority.assertSubscription(f.binding));
  });
}

test('runtime restart revalidates persisted Agent grants and refuses a missing authorizer', async t => {
  const f = await fixture(t), first = f.start();
  await first.events.subscribe(f.agent, f.params); await first.flush();
  assert.equal(f.queue().queued, 1); await first.close();
  assert.throws(() => f.start({agentAuthority: undefined}), /event_agent_authority_required/);
  f.revoke(); const second = f.start(); f.setReady(true); await second.flush();
  assert.equal(f.calls.length, 1);
});

test('runtime never accepts an Agent binding for another node or workspace', async t => {
  const f = await fixture(t), runtime = f.start(), foreign = f.enqueue('b');
  await assert.rejects(runtime.events.subscribe({nodeId: f.nodes.b.id, workspaceId: f.workspaces.b.id, agentGrant: f.binding},
    {...f.params, arguments: {taskId: foreign.taskId}}), /event_access_denied/);
  assert.equal(f.calls.length, 0);
  assert.deepEqual(runtime.events.pendingTargets(), []);
});

async function httpMcp(t, f) {
  const runtime = f.runtime || f.start();
  const mcp = createPilotMcp({store: f.gateway, workspaceAccess: f.access, events: runtime.events,
    resolvePrincipal: token => f.gateway.authenticate(token),
    resolveAgentPrincipal: async (token, {scope}) => {
      const proof = await f.authority.authenticate(token, {grantId: f.grant.id, scope});
      return f.gateway.authenticateAgent(proof, {scope});
    }});
  t.after(() => mcp.close());
  await new Promise((resolve, reject) => {mcp.server.once('error', reject); mcp.server.listen(0, '127.0.0.1', resolve);});
  const url = `http://127.0.0.1:${mcp.server.address().port}/mcp`;
  let id = 0;
  return async function rpc(method, params, token = f.token()) {
    const response = await fetch(url, {method: 'POST', signal: AbortSignal.timeout(10000),
      headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + token},
      body: JSON.stringify({jsonrpc: '2.0', id: ++id, method, params})});
    return {status: response.status, body: await response.json()};
  };
}

test('HTTP Agent subscription retains its grant when the runtime later dispatches', async t => {
  const f = await fixture(t), rpc = await httpMcp(t, f);
  const subscribed = await rpc('events/subscribe', f.params);
  assert.equal(subscribed.status, 200); assert.ok(subscribed.body.result?.id);
  await f.runtime.flush(); assert.equal(f.calls.length, 1);
  f.revoke(); f.setReady(true); await f.runtime.flush();
  assert.equal(f.calls.length, 1, 'HTTP subscription must not become a legacy subscription that survives revocation');
  const retry = await rpc('events/subscribe', f.params);
  assert.equal(retry.status, 401);
});

test('HTTP events discovery and read-only listing do not require or grant subscription scope', async t => {
  const f = await fixture(t, {grantScopes: ['task.read', 'events.read', 'events.subscribe']}), rpc = await httpMcp(t, f);
  const discovery = await rpc('server/discover', {});
  assert.deepEqual(discovery.body.result.capabilities.events, {});
  const readToken = f.token(['events.read']);
  const listed = await rpc('events/list', {}, readToken);
  assert.equal(listed.status, 200);
  assert.equal(listed.body.result.events[0].name, 'pilot.task_ready');
  const denied = await rpc('events/subscribe', f.params, readToken);
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.data.reason, 'insufficient_scope');
  assert.equal(f.calls.length, 0);
});

test('HTTP Agent unsubscribe targets its grant-bound subscription rather than a legacy identity', async t => {
  const f = await fixture(t), rpc = await httpMcp(t, f);
  const reply = await rpc('events/subscribe', f.params);
  assert.ok(reply.body.result?.id); await f.runtime.flush();
  const direct = await f.runtime.events.subscribe(f.agent, f.params);
  assert.equal(reply.body.result.id, direct.id, 'HTTP and trusted internal calls must bind the same grant');
  const {secret, ...delivery} = f.params.delivery;
  const stopped = await rpc('events/unsubscribe', {...f.params, delivery});
  assert.equal(stopped.body.result.unsubscribed, true);
  f.setReady(true); await f.runtime.flush();
  assert.equal(f.calls.length, 1);
});

test('HTTP Agent event arguments cannot inject grant facts or access another workspace task', async t => {
  const f = await fixture(t), rpc = await httpMcp(t, f);
  const forged = await rpc('events/subscribe', {...f.params, agentGrant: f.binding});
  assert.equal(forged.body.error.data.reason, 'unsupported_field');
  const foreign = f.enqueue('b');
  const denied = await rpc('events/subscribe', {...f.params, arguments: {taskId: foreign.taskId}});
  assert.ok(denied.body.error); assert.equal(denied.body.result, undefined);
  assert.equal(f.calls.length, 0);
  assert.deepEqual(f.runtime.events.pendingTargets(), []);
});

test('HTTP verification cannot persist or send after revocation while DNS is pending', async t => {
  const f = await fixture(t), rpc = await httpMcp(t, f), gate = f.holdDns();
  const pending = rpc('events/subscribe', f.params);
  try {await gate.entered; f.revoke();} finally {gate.release();}
  const reply = await pending;
  assert.equal(reply.body.error.data.reason, 'challenge_failed');
  assert.equal(f.calls.length, 0);
  assert.deepEqual(f.runtime.events.pendingTargets(), []);
});
