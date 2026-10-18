'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const {createIdentityStore} = require('../identity/store.cjs');
const {createCollaborationStore} = require('../collaboration/store.cjs');
const {startPublicRuntime} = require('../gateway/public-runtime.cjs');
const {createPackagedIngressFixture} = require('./helpers/packaged-ingress-fixture.cjs');

function deferred() {
  let resolve;
  const promise = new Promise(done => {resolve = done;});
  return {promise, resolve};
}

// The actual public-runtime orchestrator waits on an injected application loader.
// No fake timer or sleep determines when caller mutation occurs.
test('mcp-only startup snapshots caller REST policy across awaited application initialization', {timeout: 20000}, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-mcp-snapshot-'));
  const entered = deferred(), release = deferred();
  let identity, db, collaboration, starting, runtime;
  t.after(async () => {
    release.resolve();
    if (starting) await starting.catch(() => {});
    await runtime?.close();
    collaboration?.close();
    if (db?.open) db.close();
    identity?.close();
    const owned = fs.realpathSync(root);
    assert.equal(path.dirname(owned), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(owned).startsWith('lack-mcp-snapshot-'));
    fs.rmSync(owned, {recursive: true, force: true});
  });
  identity = createIdentityStore({dbPath: path.join(root, 'db', 'identity.db')});
  const user = identity.createUser({login: 'snapshot-owner', passwordHash: '$scrypt$test-only$' + 'a'.repeat(64)});
  const workspace = identity.createWorkspace({name: 'Snapshot only', ownerId: user.id});
  db = new Database(path.join(root, 'db', 'lack.db'));
  collaboration = createCollaborationStore({db, identity});
  db.prepare('INSERT INTO workspace_scopes VALUES(?)').run(workspace.id);
  collaboration.close(); collaboration = null;
  db.close(); db = null;
  identity.close(); identity = null;
  const config = {httpPort: 23721, multiUser: {enabled: true, migrationReady: true},
    agentGateway: {enabled: true, port: 23722, adminTokenEnv: 'SNAPSHOT_TEST_ADMIN'},
    publicRuntime: {webOrigin: 'https://lack.fixture.invalid', agentsOrigin: 'https://agents.fixture.invalid',
      mcpPort: 23723, nodeRestPublic: false}};
  let active = false, closed = 0, observed;
  starting = startPublicRuntime({config, dataRoot: root, env: {SNAPSHOT_TEST_ADMIN: 'x'.repeat(43)},
    loadLack: () => ({startLackRuntime: async options => {
      observed = options; entered.resolve(); await release.promise;
      return {gateway: {store: {}, workspaceAccess: {}}, isReady: () => active,
        activate() {active = true;}, close: async () => {closed++; active = false;}};
    }}),
    startMcp: async () => {
      assert.equal(active, false);
      assert.equal(observed.config.publicRuntime.nodeRestPublic, false);
      return {close: async () => {}};
    }}).then(value => {runtime = value; return value;});
  await entered.promise;
  assert.notEqual(observed.config, config);
  const originalPublic = config.publicRuntime;
  originalPublic.nodeRestPublic = true;
  config.publicRuntime = {...originalPublic, nodeRestPublic: true};
  assert.equal(config.publicRuntime.nodeRestPublic, true);
  assert.equal(observed.config.publicRuntime.nodeRestPublic, false);
  assert.notEqual(observed.config.publicRuntime, originalPublic);
  release.resolve(); await starting;
  assert.equal(active, true);
  assert.equal(observed.config.publicRuntime.nodeRestPublic, false);
  await runtime.close();
  assert.equal(closed, 1);
  assert.equal(fs.existsSync(path.join(root, '.public-runtime.lock')), false);
});

// Real generated app and Caddy, real certificate verification, synthetic identity
// and credentials only. No external Agent, real OAuth issuer or model is called.
test('mcp-only verified HTTPS denies valid paired-node REST across both hosts and path aliases',
  {timeout: 90000, skip: !process.env.CADDY_TEST_BIN}, async t => {
    const jose = await import('jose'), keys = await jose.generateKeyPair('RS256');
    const issuer = 'https://pocket.fixture.invalid', resource = 'https://agents.fixture.invalid/mcp';
    const jwk = {...await jose.exportJWK(keys.publicKey), kid: 'composite-only', alg: 'RS256', use: 'sig'};
    const originalFetch = globalThis.fetch;
    t.mock.method(globalThis, 'fetch', (url, options) => String(url) === issuer + '/jwks'
      ? Promise.resolve(Response.json({keys: [jwk]})) : originalFetch(url, options));
    const f = await createPackagedIngressFixture({signal: t.signal, caddyBin: process.env.CADDY_TEST_BIN,
      configure: ({config}) => {
        config.publicRuntime.nodeRestPublic = false;
        config.publicRuntime.agentOAuth = {enabled: true, issuer, resource, jwksUri: issuer + '/jwks',
          browserClientId: 'composite-human', clientIds: ['composite-agent']};
        config.identity = {oidc: {enabled: false, clientId: 'composite-human'}};
      }});
    t.after(() => f.close());
    const actor = f.runtime.identity.requireMembership(f.ownerId, f.workspaceId);
    const context = require(path.join(f.codeRoot, 'collaboration/context.cjs'));
    const human = action => context.runWithWorkspace(actor, () => action(f.runtime.gateway.workspaceAccess.forHuman(actor)));
    const pairedNode = human(h => h.createNode({name: 'Composite paired node', capabilities: ['browser.public_read'], scopes: ['public']}));
    const pendingNode = human(h => h.createNode({name: 'Unconsumed pairing', capabilities: ['browser.public_read'], scopes: ['public']}));
    const task = human(h => h.enqueueTask({targetNodeId: pairedNode.id, scopeId: 'public', taskType: 'browser.public_read',
      input: {url: 'https://example.com/', challenge: 'A'.repeat(43)}, deadlineAt: Date.now() + 120000}));
    const paired = f.runtime.gateway.store.pair(pairedNode.pairingCode);
    async function privateGet(uri) {
      const response = await fetch('http://127.0.0.1:' + f.runtime.gateway.server.address().port + uri,
        {headers: {Authorization: 'Bearer ' + paired.token}, signal: AbortSignal.timeout(8000)});
      await response.arrayBuffer(); return response.status;
    }
    assert.equal(await privateGet('/v1/manifest'), 200, 'paired token must really work before public rejection');
    assert.equal(await privateGet('/v1/events'), 200);
    const subject = '11111111-1111-4111-8111-111111111111';
    f.runtime.identity.linkExternalIdentity({issuer, sub: subject, userId: f.ownerId});
    const grant = f.runtime.agentAuthority.grant(actor, {subject, clientId: 'composite-agent',
      workspaceId: f.workspaceId, nodeId: pairedNode.id, scopes: ['task.read'], expiresAt: Date.now() + 600000});
    const at = Math.floor(Date.now() / 1000);
    const oauth = await new jose.SignJWT({iss: issuer, aud: resource, sub: subject, client_id: 'composite-agent',
      jti: 'composite-task', iat: at, exp: at + 300, scope: 'openid task.read'})
      .setProtectedHeader({alg: 'RS256', typ: 'at+jwt', kid: 'composite-only'}).sign(keys.privateKey);
    const oauthHeaders = {Authorization: 'Bearer ' + oauth};
    const initialize = await f.request('agents', '/mcp', {method: 'POST', headers: oauthHeaders,
      json: {jsonrpc: '2.0', id: 1, method: 'initialize', params: {
        protocolVersion: '2026-07-28', capabilities: {}, clientInfo: {name: 'composite-test', version: '1'}}}});
    assert.equal(initialize.status, 200); assert.ok(JSON.parse(initialize.text).result);
    const paths = ['/v1', '/v1/', '/v1/manifest', '/v1/events', '/v1/events?integration_probe=1',
      '/v1/events/', '/v1/./events', '/v1/nested/../events', '/v1//events', '/v1/tasks/' + task.taskId];
    for (const host of ['web', 'agents']) {
      for (const uri of paths) {
        for (const headers of [{Authorization: 'Bearer ' + paired.token}, oauthHeaders]) {
          const response = await f.request(host, uri, {headers});
          assert.equal(response.status, 404, host + ' ' + uri);
        }
      }
      const pair = await f.request(host, '/v1/workspaces/' + f.workspaceId + '/pair', {method: 'POST',
        headers: {Authorization: 'Bearer ' + paired.token}, json: {code: pendingNode.pairingCode}});
      assert.equal(pair.status, 404);
      const claim = await f.request(host, '/v1/tasks/claim', {method: 'POST',
        headers: {Authorization: 'Bearer ' + paired.token}, json: {scopeId: 'public'}});
      assert.equal(claim.status, 404);
    }
    assert.equal(human(h => h.getTask(task.taskId)).status, 'queued', 'public requests must not claim the task');
    assert.ok(f.runtime.gateway.store.pair(pendingNode.pairingCode).token, 'public pair requests must not consume the code');
    assert.equal(await privateGet('/v1/manifest'), 200, 'private authenticated REST remains available');
    const connections = await f.request('agents', '/mcp', {method: 'POST', headers: oauthHeaders,
      json: {jsonrpc: '2.0', id: 2, method: 'tools/call', params: {name: 'chunlack_connections_list', arguments: {}}}});
    assert.equal(connections.status, 200);
    const result = JSON.parse(connections.text);
    assert.ok(result.result && !result.error); assert.ok(connections.text.includes(grant.id));
    assert.equal((await f.request('web', '/health')).status, 200);
  });
