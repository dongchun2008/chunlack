'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {once} = require('node:events');
const {agentAuthorityFixture} = require('./helpers/agent-authority-fixture.cjs');
const {input, png, output, result} = require('./helpers/pilot-fixture.cjs');
const {createPilotMcp} = require('../integrations/mcp/pilot-server.cjs');
const {createPilotArtifacts} = require('../gateway/pilot-artifacts.cjs');
const {createArtifactUpload} = require('../integrations/mcp/artifact-upload.cjs');
const {createPilotEvents} = require('../integrations/mcp/events.cjs');

const rpc = (name, args = {}) => ({jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name, arguments: args}});

test('legacy signed-JWT binding accepts metadata but cannot upgrade a read-only grant', async t => {
  const f = await fixture(t, {scopes: ['task.read']});
  const read = rpc('pilot.read_task', {taskId: f.task.taskId});
  read.params._meta = {progressToken: 7, scope: 'task.claim', workspaceId: f.workspaces.b.id};
  const allowed = await f.request(read);
  assert.equal(allowed.body.result?.structuredContent.taskId, f.task.taskId);
  assert.equal(allowed.body.result?.structuredContent.workspaceId, f.workspaces.a.id);
  assert.equal(f.legacyResolutions(), 0);
  const claim = rpc('pilot.claim_task', {taskId: f.task.taskId});
  claim.params._meta = read.params._meta;
  assert.equal((await f.request(claim)).status, 403);
  assert.equal(f.human('alice', 'a', h => h.getTask(f.task.taskId)).status, 'queued');
});
async function fixture(t, {scopes = ['task.read', 'task.claim', 'task.result', 'events.read', 'events.subscribe'], enabled = true,
  withEvents = false, beforeResolve} = {}) {
  const cleanups = []; let mcp, events;
  t.after(async () => {
    try {await mcp?.close();} finally {
      try {events?.close();} finally {for (const cleanup of cleanups) await cleanup();}
    }
  });
  const r = await agentAuthorityFixture({after: fn => cleanups.push(fn)});
  const browser = r.human('alice', 'a', h => h.createNode({name: 'synthetic-browser', capabilities: ['browser.public_read'], scopes: ['public']}));
  const paired = r.gateway.pair(browser.pairingCode);
  const task = r.human('alice', 'a', h => h.enqueueTask({targetNodeId: browser.id, scopeId: 'public',
    taskType: 'browser.public_read', input, deadlineAt: r.now() + 120000}));
  const grant = r.authority.grant(r.actor('alice', 'a'), {subject: '11111111-1111-4111-8111-111111111111',
    clientId: 'native-client', workspaceId: r.workspaces.a.id, nodeId: browser.id, scopes, expiresAt: r.now() + 3600000});
  const artifacts = createPilotArtifacts({store: r.gateway, root: path.join(r.dir, 'artifacts'), now: r.now});
  const uploads = createArtifactUpload({store: r.gateway, artifacts, now: r.now});
  let legacyResolutions = 0, callbacks = 0;
  if (withEvents) events = createPilotEvents({dbPath: ':memory:', encryptionKey: Buffer.alloc(32, 7), multiUser: true, now: r.now,
    authorize: (p, taskId) => r.access.authorizeStoredNode(p, taskId),
    authorizeCleanup: p => r.access.authorizeStoredNode(p, undefined, {cleanup: true}),
    transport: async () => {callbacks++; throw new Error('unexpected synthetic callback');}});
  mcp = createPilotMcp({store: r.gateway, workspaceAccess: r.access, artifacts, uploads, events,
    resolvePrincipal: token => {legacyResolutions++; return r.gateway.authenticate(token);},
    ...(enabled ? {resolveAgentPrincipal: async (token, {scope}) => {
      if (beforeResolve) await beforeResolve();
      const proof = await r.authority.authenticate(token, {grantId: grant.id, scope});
      return r.gateway.authenticateAgent(proof, {scope});
    }} : {})});
  mcp.server.listen(0, '127.0.0.1'); await once(mcp.server, 'listening');
  const url = `http://127.0.0.1:${mcp.server.address().port}/mcp`, jwt = r.token(scopes);
  async function request(body, token = jwt) {
    const response = await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + token},
      body: JSON.stringify(body), signal: AbortSignal.timeout(5000)});
    return {status: response.status, body: await response.json()};
  }
  return {...r, browser, paired, task, grant, artifacts, uploads, mcp, jwt, request,
    legacyResolutions: () => legacyResolutions, callbacks: () => callbacks};
}

test('opt-in HTTP accepts a real signed JWT and reads only its granted node task', async t => {
  const f = await fixture(t);
  assert.ok(f.jwt.length > 256);
  const reply = await f.request(rpc('pilot.read_task', {taskId: f.task.taskId}));
  assert.equal(reply.status, 200);
  assert.equal(reply.body.result.structuredContent.taskId, f.task.taskId);
  assert.equal(reply.body.result.structuredContent.workspaceId, f.workspaces.a.id);
  assert.equal(reply.body.result.structuredContent.input.challenge, input.challenge);
  assert.equal(f.legacyResolutions(), 0);
  const other = f.enqueue('b');
  const denied = await f.request(rpc('pilot.read_task', {taskId: other.taskId}));
  assert.equal(denied.body.error.data.reason, 'unknown_task');
});

test('read-only JWT cannot claim or begin an artifact and does not change the queued task', async t => {
  const f = await fixture(t, {scopes: ['task.read']});
  for (const body of [rpc('pilot.claim_task', {taskId: f.task.taskId}), rpc('pilot.artifact_begin', {
    taskId: f.task.taskId, leaseId: 'synthetic', attempt: 1, eventId: 'screen', contentType: 'image/png'})]) {
    const denied = await f.request(body);
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error.data.reason, 'insufficient_scope');
  }
  assert.equal(f.human('alice', 'a', h => h.getTask(f.task.taskId)).status, 'queued');
});

test('HTTP JWT pilot claim, renewal, progress, screenshot and result use scoped gateway authority', async t => {
  const f = await fixture(t);
  const call = async (name, args) => {
    const reply = await f.request(rpc(name, args));
    assert.equal(reply.status, 200); assert.equal(reply.body.error, undefined);
    return reply.body.result.structuredContent;
  };
  const claimed = await call('pilot.claim_task', {taskId: f.task.taskId});
  const lease = {taskId: claimed.taskId, leaseId: claimed.leaseId, attempt: claimed.attempt};
  await call('pilot.heartbeat', lease);
  await call('pilot.report_event', {envelope: {protocolVersion: 1, ...lease, eventId: 'http-progress', type: 'progress'}});
  const upload = await call('pilot.artifact_begin', {...lease, eventId: 'http-screen', contentType: 'image/png'});
  assert.equal((await call('pilot.artifact_chunk', {uploadId: upload.uploadId, index: 0, data: png().toString('base64')})).nextIndex, 1);
  const artifact = await call('pilot.artifact_finish', {uploadId: upload.uploadId});
  const envelope = result(claimed, output(artifact.artifactId));
  const receipt = await call('pilot.submit_result', {envelope});
  assert.deepEqual(await call('pilot.submit_result', {envelope}), receipt);
  const saved = f.human('alice', 'a', h => h.getTask(f.task.taskId));
  assert.equal(saved.status, 'succeeded');
  assert.equal(saved.result.output.artifactId, artifact.artifactId);
  assert.equal(f.human('alice', 'a', h => h.getPilotAcceptance(f.task.taskId)).state, 'evidence_checked');
});

test('grant revocation stops a previously valid JWT at the next HTTP request', async t => {
  const f = await fixture(t);
  assert.equal((await f.request(rpc('pilot.read_task', {taskId: f.task.taskId}))).status, 200);
  f.authority.revoke(f.actor('alice', 'a'), {workspaceId: f.workspaces.a.id, grantId: f.grant.id});
  assert.equal((await f.request(rpc('pilot.read_task', {taskId: f.task.taskId}))).status, 401);
  assert.equal(f.legacyResolutions(), 0);
});

test('without explicit Agent opt-in the original HTTP token limit and pairing route remain', async t => {
  const f = await fixture(t, {enabled: false});
  assert.equal((await f.request(rpc('pilot.read_task', {taskId: f.task.taskId}))).status, 401);
  const legacy = await f.request(rpc('pilot.read_task', {taskId: f.task.taskId}), f.paired.token);
  assert.equal(legacy.status, 200);
  assert.equal(legacy.body.result.structuredContent.taskId, f.task.taskId);
  assert.equal(f.legacyResolutions(), 1);
});

test('invalid and oversized JWTs never fall back to the legacy principal resolver', async t => {
  const f = await fixture(t);
  for (const token of ['abc.def.ghi', 'a'.repeat(8193) + '.b.c']) {
    assert.equal((await f.request(rpc('pilot.read_task', {taskId: f.task.taskId}), token)).status, 401);
  }
  assert.equal(f.legacyResolutions(), 0);
});

test('Agent discovery does not advertise durable events and subscriptions fail closed until grant-bound delivery exists', async t => {
  const f = await fixture(t, {withEvents: true});
  const discovery = await f.request({jsonrpc: '2.0', id: 1, method: 'server/discover', params: {}});
  assert.equal(discovery.status, 200);
  assert.equal(discovery.body.result.capabilities.events, undefined);
  const denied = await f.request({jsonrpc: '2.0', id: 1, method: 'events/subscribe', params: {
    name: 'pilot.task_ready', arguments: {taskId: f.task.taskId}, delivery: {mode: 'webhook',
      url: 'https://callback.example/events', secret: 'whsec_' + Buffer.alloc(32, 8).toString('base64')}}});
  assert.equal(denied.body.error.data.reason, 'agent_events_not_ready');
  assert.equal(f.callbacks(), 0);
  const legacy = await f.request({jsonrpc: '2.0', id: 1, method: 'server/discover', params: {}}, f.paired.token);
  assert.ok(legacy.body.result.capabilities.events);
});

test('closing MCP during asynchronous Agent authentication cannot claim a queued task afterwards', async t => {
  let entered, release;
  const started = new Promise(resolve => {entered = resolve;});
  const gate = new Promise(resolve => {release = resolve;});
  const f = await fixture(t, {beforeResolve: () => {entered(); return gate;}});
  const pending = f.mcp.handleRpc(rpc('pilot.claim_task', {taskId: f.task.taskId}), f.jwt);
  await started; await f.mcp.close(); release();
  const reply = await pending;
  assert.equal(reply.error.data.reason, 'mcp_closed');
  assert.equal(f.human('alice', 'a', h => h.getTask(f.task.taskId)).status, 'queued');
});

test('Agent resolver cannot substitute an authentic but unscoped pairing principal', async t => {
  const f = await fixture(t);
  const wrong = createPilotMcp({store: f.gateway, workspaceAccess: f.access,
    resolvePrincipal: token => f.gateway.authenticate(token),
    resolveAgentPrincipal: () => f.gateway.authenticate(f.paired.token)});
  try {
    const reply = await wrong.handleRpc(rpc('pilot.claim_task', {taskId: f.task.taskId}), f.jwt);
    assert.equal(reply.error.code, -32001);
    assert.equal(f.human('alice', 'a', h => h.getTask(f.task.taskId)).status, 'queued');
  } finally {await wrong.close();}
});
