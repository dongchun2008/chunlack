'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const {Agent} = require('undici');
const {execFileSync} = require('node:child_process');
const {randomBytes, createHash, createHmac, generateKeyPairSync, sign} = require('node:crypto');
const Database = require('better-sqlite3');
const {createIdentityStore} = require('../identity/store.cjs');
const {createCollaborationStore} = require('../collaboration/store.cjs');

test('packaged human grant administration and MCP use one live authority; disabled restart exposes availability without mutations', {timeout: 60000}, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-packaged-grants-'));
  let runtime, dispatcher = new Agent();
  async function closeClient() {
    const current = dispatcher; dispatcher = undefined;
    if (!current) return;
    let timer;
    try {
      await Promise.race([current.close(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('test_client_pool_close_timeout')), 5000);
      })]);
    } catch (error) {await current.destroy(); throw error;}
    finally {clearTimeout(timer);}
  }
  t.after(async () => {
    try {await closeClient();} finally {await runtime?.close();}
    const target = fs.realpathSync(root);
    assert.equal(path.dirname(target), fs.realpathSync(os.tmpdir())); assert.ok(path.basename(target).startsWith('lack-packaged-grants-'));
    fs.rmSync(target, {recursive: true, force: true});
  });
  const webOrigin = 'https://lack.packaged.invalid', issuer = 'https://pocket.packaged.invalid', resource = 'https://agents.packaged.invalid/mcp';
  const subject = '11111111-1111-4111-8111-111111111111', passwordHash = '$scrypt$test-only$' + 'a'.repeat(64);
  const identity = createIdentityStore({dbPath: path.join(root, 'db', 'identity.db')});
  const user = identity.createUser({login: 'packaged-owner', passwordHash});
  const workspace = identity.createWorkspace({name: 'Packaged grant workspace', ownerId: user.id});
  identity.linkExternalIdentity({issuer, sub: subject, userId: user.id});
  const db = new Database(path.join(root, 'db', 'lack.db'));
  const collaboration = createCollaborationStore({db, identity});
  db.prepare('INSERT INTO workspace_scopes VALUES(?)').run(workspace.id);
  collaboration.close(); db.close(); identity.close();
  const output = path.join(root, 'package');
  execFileSync(process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), ['scripts/materialize.py', '--output', output],
    {cwd: path.join(__dirname, '..'), timeout: 20000, stdio: 'pipe', windowsHide: true});
  fs.symlinkSync(path.join(__dirname, '..', 'node_modules'), path.join(output, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const reservations = [], ports = [];
  try {
    for (let i = 0; i < 3; i++) {
      const server = http.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      reservations.push(server); ports.push(server.address().port);
    }
  } finally {for (const server of reservations) await new Promise(resolve => server.close(resolve));}
  const config = {httpPort: ports[0], multiUser: {enabled: true, migrationReady: true},
    agentGateway: {enabled: true, port: ports[1], adminTokenEnv: 'FIXTURE_GATEWAY_TOKEN'},
    publicRuntime: {webOrigin, agentsOrigin: 'https://agents.packaged.invalid', mcpPort: ports[2],
      agentOAuth: {enabled: true, issuer, resource, jwksUri: issuer + '/jwks', browserClientId: 'human-client', clientIds: ['agent-client']}},
    identity: {oidc: {enabled: false, clientId: 'human-client'}},
    llmProvider: 'ollama', embeddingProvider: 'none', autoPullModels: false, agents: [], jspaceEnabled: false};
  const keys = generateKeyPairSync('rsa', {modulusLength: 2048});
  const jwk = {...keys.publicKey.export({format: 'jwk'}), kid: 'packaged', alg: 'RS256', use: 'sig'};
  const actualFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (url, options) => String(url) === issuer + '/jwks' ? Promise.resolve(Response.json({keys: [jwk]})) : actualFetch(url, options));
  const start = require(path.join(output, 'gateway/public-runtime.cjs')).startPublicRuntime;
  const options = {config, dataRoot: root, env: {FIXTURE_GATEWAY_TOKEN: 'x'.repeat(43)}};
  runtime = await start(options);
  const actor = runtime.identity.requireMembership(user.id, workspace.id);
  const node = require(path.join(output, 'collaboration/context.cjs')).runWithWorkspace(actor, () => runtime.gateway.workspaceAccess.forHuman(actor)
    .createNode({name: 'Packaged node', capabilities: ['research.retrieve'], scopes: ['public']}));
  const session = randomBytes(32).toString('base64url');
  const csrf = createHmac('sha256', session).update('chunlack-csrf-v1').digest('base64url');
  const hash = value => createHash('sha256').update(value).digest('hex');
  runtime.identity.createSessionRecord({userId: user.id, expectedPasswordHash: passwordHash,
    tokenHash: hash(session), csrfHash: hash(csrf), expiresAt: Date.now() + 600000});
  const route = `/api/workspaces/${workspace.id}/agent-grants`;
  const headers = {Origin: webOrigin, Cookie: '__Host-chunlack_session=' + session, 'X-CSRF-Token': csrf,
    'X-Workspace-Id': workspace.id, 'Content-Type': 'application/json'};
  const request = (suffix = '', init = {}) => fetch(`http://127.0.0.1:${ports[0]}` + route + suffix,
    {headers, signal: AbortSignal.timeout(5000), ...init, dispatcher});
  const input = {subject, clientId: 'agent-client', nodeId: node.id, scopes: ['task.read'], expiresAt: Date.now() + 600000};
  const create = await request('', {method: 'POST', body: JSON.stringify(input)});
  assert.equal(create.status, 201); const grantId = (await create.json()).grant.id;
  const records = await request(); assert.equal(records.status, 200);
  assert.deepEqual((await records.json()).grants.map(grant => grant.id), [grantId]);
  const at = Math.floor(Date.now() / 1000);
  const tokenInput = Buffer.from(JSON.stringify({alg: 'RS256', typ: 'at+jwt', kid: 'packaged'})).toString('base64url') + '.' +
    Buffer.from(JSON.stringify({iss: issuer, sub: subject, aud: resource, iat: at, exp: at + 600,
      jti: 'packaged', client_id: 'agent-client', scope: 'openid task.read'})).toString('base64url');
  const token = tokenInput + '.' + sign('RSA-SHA256', Buffer.from(tokenInput), keys.privateKey).toString('base64url');
  const discover = () => fetch(`http://127.0.0.1:${ports[2]}/mcp`, {method: 'POST', dispatcher,
    headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'}, signal: AbortSignal.timeout(5000),
    body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name: 'chunlack_connections_list', arguments: {}}})});
  const before = await discover(); assert.equal(before.status, 200);
  assert.equal((await before.json()).result.structuredContent.connections[0].grantId, grantId);
  const agentAsHuman = await request('', {method: 'POST', body: JSON.stringify(input),
    headers: {Origin: webOrigin, 'Content-Type': 'application/json', Authorization: 'Bearer ' + token}});
  assert.equal(agentAsHuman.status, 401); await agentAsHuman.arrayBuffer();
  const removed = await request('/' + grantId, {method: 'DELETE', body: '{}'});
  assert.equal(removed.status, 200); assert.deepEqual(await removed.json(), {ok: true});
  const after = await discover(); assert.equal(after.status, 403); await after.arrayBuffer();
  await closeClient();
  await runtime.close(); assert.equal(fs.existsSync(path.join(root, '.public-runtime.lock')), false);
  config.publicRuntime.agentOAuth = {enabled: false};
  runtime = await start(options);
  dispatcher = new Agent();
  const disabled = await request(); assert.equal(disabled.status, 200);
  assert.deepEqual(await disabled.json(), {available: false});
  const disabledCreate = await request('', {method: 'POST', body: JSON.stringify(input)});
  assert.equal(disabledCreate.status, 404); await disabledCreate.arrayBuffer();
  const disabledRevoke = await request('/' + grantId, {method: 'DELETE', body: '{}'});
  assert.equal(disabledRevoke.status, 404); await disabledRevoke.arrayBuffer();
  await closeClient();
  await runtime.close(); assert.equal(fs.existsSync(path.join(root, '.public-runtime.lock')), false);
});
