'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const {execFileSync} = require('node:child_process');
const {generateKeyPairSync, sign} = require('node:crypto');
const Database = require('better-sqlite3');
const {createIdentityStore} = require('../identity/store.cjs');
const {createCollaborationStore} = require('../collaboration/store.cjs');
const {runWithWorkspace} = require('../collaboration/context.cjs');
const {startPublicRuntime} = require('../gateway/public-runtime.cjs');
const issuer = 'https://pocket.runtime.invalid', resource = 'https://agents.runtime.invalid/mcp';
const subject = '11111111-1111-4111-8111-111111111111';
let keys;
function jwt() {
  keys ||= generateKeyPairSync('rsa', {modulusLength: 2048});
  const at = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({alg: 'RS256', typ: 'at+jwt', kid: 'runtime'})).toString('base64url');
  const payload = Buffer.from(JSON.stringify({iss: issuer, sub: subject, aud: resource, iat: at, exp: at + 600,
    jti: 'runtime-fixture', client_id: 'native-fixture', scope: 'openid task.read task.claim events.subscribe'})).toString('base64url');
  const input = header + '.' + payload;
  return input + '.' + sign('RSA-SHA256', Buffer.from(input), keys.privateKey).toString('base64url');
}
function jwks() {
  jwt();
  return Response.json({keys: [{...keys.publicKey.export({format: 'jwk'}), alg: 'RS256', kid: 'runtime', use: 'sig'}]});
}
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-public-agent-'));
  const owned = [];
  t.after(async () => {
    for (const close of owned.reverse()) await close();
    const target = fs.realpathSync(root), temp = fs.realpathSync(os.tmpdir());
    assert.equal(path.dirname(target), temp); assert.ok(path.basename(target).startsWith('lack-public-agent-'));
    fs.rmSync(target, {recursive: true, force: true});
  });
  const identityPath = path.join(root, 'db', 'identity.db');
  const identity = createIdentityStore({dbPath: identityPath});
  const user = identity.createUser({login: 'runtime-owner', passwordHash: '$scrypt$test-only$' + 'a'.repeat(64)});
  const workspace = identity.createWorkspace({name: 'Runtime workspace', ownerId: user.id});
  identity.linkExternalIdentity({issuer, sub: subject, userId: user.id});
  const db = new Database(path.join(root, 'db', 'lack.db'));
  const collaboration = createCollaborationStore({db, identity});
  db.prepare('INSERT INTO workspace_scopes VALUES(?)').run(workspace.id);
  collaboration.close(); db.close(); identity.close();
  const reservations = [];
  try {
    for (let i = 0; i < 3; i++) {
      const server = http.createServer();
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); reservations.push(server);
    }
    const ports = reservations.map(server => server.address().port);
    const config = {httpPort: ports[0], multiUser: {enabled: true, migrationReady: true},
      agentGateway: {enabled: true, port: ports[1], adminTokenEnv: 'FIXTURE_GATEWAY_TOKEN'},
      publicRuntime: {webOrigin: 'https://lack.runtime.invalid', agentsOrigin: 'https://agents.runtime.invalid', mcpPort: ports[2],
        agentOAuth: {enabled: true, issuer, resource, jwksUri: issuer + '/jwks',
          browserClientId: 'human-fixture', clientIds: ['native-fixture']}},
      identity: {oidc: {enabled: false, clientId: 'human-fixture'}},
      llmProvider: 'ollama', embeddingProvider: 'none', autoPullModels: false, agents: [], jspaceEnabled: false};
    return {root, config, user, workspace, own: close => owned.push(close), env: {FIXTURE_GATEWAY_TOKEN: 'x'.repeat(43)}};
  } finally {for (const server of reservations) await new Promise(resolve => server.close(resolve));}
}
// Use the real gateway/store; only the unrelated web application is omitted here.
async function gatewayWeb(options) {
  let ready = false;
  if (options.config.publicRuntime.agentOAuth?.enabled) {
    assert.equal(typeof options.agentAuthority?.assert, 'function');
    assert.throws(() => options.agentAuthority.assert({}, {scope: 'task.read'}), /service_closed/);
  }
  const gateway = await require('../gateway/runtime.cjs').startAgentGateway({...options, ready: () => ready});
  return {gateway, activate() {ready = true;}, isReady: () => ready, close: () => gateway.close()};
}
function grant(runtime, f) {
  const actor = runtime.identity.requireMembership(f.user.id, f.workspace.id);
  const node = runWithWorkspace(actor, () => runtime.gateway.workspaceAccess.forHuman(actor).createNode({
    name: 'Runtime node', capabilities: ['research.retrieve'], scopes: ['public']}));
  const value = runtime.agentAuthority.grant(actor, {subject, clientId: 'native-fixture', workspaceId: f.workspace.id,
    nodeId: node.id, scopes: ['task.read', 'task.claim', 'events.subscribe'], expiresAt: Date.now() + 600000});
  return {actor, node, value};
}
function mockKeys(t, fetchKeys = async () => jwks()) {
  const actual = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (url, options) => String(url) === issuer + '/jwks' ? fetchKeys(url, options) : actual(url, options));
}
async function rpc(f, method, params) {
  const response = await fetch(`http://127.0.0.1:${f.config.publicRuntime.mcpPort}/mcp`, {
    method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + jwt()},
    body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params}), signal: AbortSignal.timeout(5000)});
  return {status: response.status, body: await response.json()};
}

test('public Agent configuration rejects a foreign resource and browser-client alias before allocating', async t => {
  const f = await fixture(t); let loaded = false;
  for (const changes of [{resource: 'https://other.runtime.invalid/mcp'},
    {browserClientId: 'other-browser', clientIds: ['human-fixture']}, {jwksUri: 'http://pocket.runtime.invalid/jwks'}]) {
    const config = {...f.config, publicRuntime: {...f.config.publicRuntime, agentOAuth: {...f.config.publicRuntime.agentOAuth, ...changes}}};
    await assert.rejects(startPublicRuntime({config, dataRoot: f.root, env: f.env,
      loadLack: () => {loaded = true; throw Error('must_not_load');}}), /invalid_agent_|public_agent_/);
    assert.equal(loaded, false); assert.equal(fs.existsSync(path.join(f.root, '.public-runtime.lock')), false);
  }
});

test('public runtime binds a deny-first facade, routes real JWT discovery and invalidates revoked grants', async t => {
  const f = await fixture(t); mockKeys(t);
  const runtime = await startPublicRuntime({config: f.config, dataRoot: f.root, env: f.env, loadLack: () => ({startLackRuntime: gatewayWeb})});
  f.own(() => runtime.close());
  const g = grant(runtime, f);
  const metadata = await fetch(`http://127.0.0.1:${f.config.publicRuntime.mcpPort}/.well-known/oauth-protected-resource/mcp`);
  assert.equal(metadata.status, 200); assert.equal((await metadata.json()).resource, resource);
  const found = await rpc(f, 'tools/call', {name: 'chunlack_connections_list', arguments: {}});
  assert.equal(found.status, 200); assert.equal(found.body.result.structuredContent.connections[0].grantId, g.value.id);
  const proof = await runtime.agentAuthority.authenticate(jwt(), {grantId: g.value.id, scope: 'task.read'});
  const principal = runtime.gateway.store.authenticateAgent(proof, {scope: 'task.read'});
  assert.equal(runtime.gateway.store.assertAuthenticatedNode(principal, {scope: 'task.read', requireAgent: true}).id, g.node.id);
  runtime.agentAuthority.revoke(g.actor, {workspaceId: f.workspace.id, grantId: g.value.id});
  assert.throws(() => runtime.gateway.store.assertAuthenticatedNode(principal, {scope: 'task.read', requireAgent: true}));
  assert.equal((await rpc(f, 'tools/call', {name: 'chunlack_connections_list', arguments: {}})).status, 403);
  await runtime.close();
  assert.throws(() => runtime.agentAuthority.assert(proof, {scope: 'task.read'}), /service_closed/);
  assert.equal(fs.existsSync(path.join(f.root, '.public-runtime.lock')), false);
});

test('enabled Agent startup rollback closes authority and permits a clean restart', async t => {
  const f = await fixture(t); let authority;
  await assert.rejects(startPublicRuntime({config: f.config, dataRoot: f.root, env: f.env, loadLack: () => ({startLackRuntime: gatewayWeb}),
    startMcp: async options => {authority = options.agentAuthority; assert.ok(authority); throw Error('fixture_mcp_failure');}}), /fixture_mcp_failure/);
  assert.throws(() => authority.assert({}, {scope: 'task.read'}), /service_closed/);
  assert.equal(fs.existsSync(path.join(f.root, '.public-runtime.lock')), false);
  const runtime = await startPublicRuntime({config: f.config, dataRoot: f.root, env: f.env, loadLack: () => ({startLackRuntime: gatewayWeb})});
  f.own(() => runtime.close()); await runtime.close();
});

test('Agent shutdown aborts an active JWKS fetch before releasing the writer lock', async t => {
  const f = await fixture(t); let reached, signal;
  const started = new Promise(resolve => {reached = resolve;});
  mockKeys(t, async (url, options) => {
    signal = options.signal; reached();
    await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), {once: true}));
  });
  const runtime = await startPublicRuntime({config: f.config, dataRoot: f.root, env: f.env, loadLack: () => ({startLackRuntime: gatewayWeb})});
  f.own(() => runtime.close()); grant(runtime, f);
  const pending = runtime.agentAuthority.discover(jwt()).catch(error => error);
  await started; await runtime.close();
  assert.equal(signal.aborted, true); assert.equal((await pending).code, 'service_closed');
  assert.equal(fs.existsSync(path.join(f.root, '.public-runtime.lock')), false);
});

test('unsettled Agent verification retains the writer lease even after later settlement', {timeout: 25000}, async t => {
  const f = await fixture(t); let reached, settle;
  const started = new Promise(resolve => {reached = resolve;});
  mockKeys(t, () => new Promise(resolve => {settle = () => resolve(jwks()); reached();}));
  const runtime = await startPublicRuntime({config: f.config, dataRoot: f.root, env: f.env, loadLack: () => ({startLackRuntime: gatewayWeb})});
  grant(runtime, f);
  const pending = runtime.agentAuthority.discover(jwt()).catch(error => error);
  try {
    await started;
    await assert.rejects(runtime.close(), /public_shutdown_incomplete/);
    assert.equal(fs.existsSync(path.join(f.root, '.public-runtime.lock')), true);
    await assert.rejects(startPublicRuntime({config: f.config, dataRoot: f.root, env: f.env}), /public_writer_locked/);
  } finally {settle?.(); await pending; await runtime.close().catch(() => {});}
  assert.equal(fs.existsSync(path.join(f.root, '.public-runtime.lock')), true);
});

test('materialized application forwards the trusted authority without enabling human OIDC or changing providers', {timeout: 45000}, async t => {
  const f = await fixture(t); mockKeys(t);
  const output = path.join(f.root, 'package');
  execFileSync(process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), ['scripts/materialize.py', '--output', output],
    {cwd: path.join(__dirname, '..'), timeout: 20000, stdio: 'pipe', windowsHide: true});
  fs.symlinkSync(path.join(__dirname, '..', 'node_modules'), path.join(output, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const before = JSON.stringify(f.config);
  const runtime = await require(path.join(output, 'gateway/public-runtime.cjs')).startPublicRuntime({config: f.config, dataRoot: f.root, env: f.env});
  f.own(() => runtime.close());
  const actor = runtime.identity.requireMembership(f.user.id, f.workspace.id);
  const node = require(path.join(output, 'collaboration/context.cjs')).runWithWorkspace(actor, () => runtime.gateway.workspaceAccess.forHuman(actor)
    .createNode({name: 'Packaged node', capabilities: ['research.retrieve'], scopes: ['public']}));
  const value = runtime.agentAuthority.grant(actor, {subject, clientId: 'native-fixture', workspaceId: f.workspace.id,
    nodeId: node.id, scopes: ['task.read'], expiresAt: Date.now() + 600000});
  const reply = await rpc(f, 'tools/call', {name: 'chunlack_connections_list', arguments: {}});
  assert.equal(reply.status, 200); assert.equal(reply.body.result.structuredContent.connections[0].grantId, value.id);
  assert.equal((await fetch(`http://127.0.0.1:${f.config.httpPort}/health`)).status, 200);
  assert.equal(JSON.stringify(f.config), before);
  await runtime.close(); assert.equal(fs.existsSync(path.join(f.root, '.public-runtime.lock')), false);
});
