'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const {execFileSync} = require('node:child_process');
const {randomBytes, createHash, createHmac, generateKeyPairSync, sign} = require('node:crypto');
const Database = require('better-sqlite3');
const {createIdentityStore} = require('../../identity/store.cjs');
const {createCollaborationStore} = require('../../collaboration/store.cjs');
let keys;
function deferred() {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};}
async function bounded(promise, label) {
  let timer;
  try {return await Promise.race([promise, new Promise((_, reject) => {timer = setTimeout(() => reject(Error(label)), 5000);})]);}
  finally {clearTimeout(timer);}
}
async function publicAgentFixture(t, {agentOAuthEnabled = true, discoveryOnly = false, nodeRestPublic = true, humanOidcEnabled = false, foreignWorkspace = false} = {}) {
  assert.equal(typeof agentOAuthEnabled, 'boolean');
  assert.equal(typeof discoveryOnly, 'boolean');
  assert.equal(typeof nodeRestPublic, 'boolean');
  assert.equal(typeof humanOidcEnabled, 'boolean');
  assert.equal(typeof foreignWorkspace, 'boolean');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-agent-e2e-'));
  let runtime; const gates = [];
  t.after(async () => {
    for (const gate of gates) gate.resolve();
    await runtime?.close();
    const target = fs.realpathSync(root);
    assert.equal(path.dirname(target), fs.realpathSync(os.tmpdir())); assert.ok(path.basename(target).startsWith('lack-agent-e2e-'));
    fs.rmSync(target, {recursive: true, force: true});
  });
  const issuer = 'https://pocket.e2e.invalid', origin = 'https://lack.e2e.invalid', resource = 'https://agents.e2e.invalid/mcp';
  const subject = '11111111-1111-4111-8111-111111111111', passwordHash = '$scrypt$test-only$' + 'a'.repeat(64);
  const identity = createIdentityStore({dbPath: path.join(root, 'db', 'identity.db')});
  const user = identity.createUser({login: 'e2e-owner', passwordHash});
  const workspaces = {a: identity.createWorkspace({name: 'E2E A', ownerId: user.id}), b: identity.createWorkspace({name: 'E2E B', ownerId: user.id})};
  const otherUser = foreignWorkspace ? identity.createUser({login: 'e2e-other-owner', passwordHash}) : null;
  if (otherUser) workspaces.c = identity.createWorkspace({name: 'E2E C', ownerId: otherUser.id});
  identity.linkExternalIdentity({issuer, sub: subject, userId: user.id});
  const db = new Database(path.join(root, 'db', 'lack.db')), collaboration = createCollaborationStore({db, identity});
  for (const workspace of Object.values(workspaces)) db.prepare('INSERT INTO workspace_scopes VALUES(?)').run(workspace.id);
  collaboration.close(); db.close(); identity.close();
  const output = path.join(root, 'package');
  execFileSync(process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), ['scripts/materialize.py', '--output', output],
    {cwd: path.join(__dirname, '../..'), timeout: 20000, stdio: 'pipe', windowsHide: true});
  fs.symlinkSync(path.join(__dirname, '../..', 'node_modules'), path.join(output, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const servers = [], ports = [];
  try {
    for (let i = 0; i < 3; i++) {const server = http.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); servers.push(server); ports.push(server.address().port);}
  } finally {for (const server of servers) await new Promise(resolve => server.close(resolve));}
  const scopes = ['task.read', 'task.claim', 'task.result', 'events.read', 'events.subscribe'];
  const config = {httpPort: ports[0], multiUser: {enabled: true, migrationReady: true},
    agentGateway: {enabled: true, port: ports[1], adminTokenEnv: 'FIXTURE_GATEWAY_TOKEN'},
    publicRuntime: {webOrigin: origin, agentsOrigin: 'https://agents.e2e.invalid', mcpPort: ports[2], nodeRestPublic,
      agentOAuth: {enabled: agentOAuthEnabled, discoveryOnly, issuer, resource, jwksUri: issuer + '/jwks', browserClientId: 'human-client', clientIds: discoveryOnly ? [] : ['agent-client']},
      events: {enabled: !discoveryOnly, encryptionKeyEnv: 'FIXTURE_EVENTS_KEY', allowedHosts: ['callback.example'],
        workspaceCallbackHosts: {[workspaces.a.id]: ['callback.example'], [workspaces.b.id]: ['callback.example']}}},
    identity: {oidc: {enabled: humanOidcEnabled, issuer, clientId: 'human-client', clientSecretEnv: 'FIXTURE_OIDC_SECRET'}},
    llmProvider: 'ollama', embeddingProvider: 'none', autoPullModels: false, agents: [], jspaceEnabled: false};
  keys ||= generateKeyPairSync('rsa', {modulusLength: 2048});
  const jwk = {...keys.publicKey.export({format: 'jwk'}), kid: 'e2e', alg: 'RS256', use: 'sig'};
  const actualFetch = globalThis.fetch;
  const authorizationCodes = new Map(), oidcCalls = {metadata: 0, jwks: 0, token: 0};
  const oidcSecret = 'synthetic-e2e-human-client-secret';
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url) === issuer + '/jwks') {oidcCalls.jwks++; return Response.json({keys: [jwk]});}
    if (humanOidcEnabled && String(url) === issuer + '/.well-known/openid-configuration') {
      oidcCalls.metadata++;
      return Response.json({issuer, authorization_endpoint: issuer + '/authorize', token_endpoint: issuer + '/token',
        jwks_uri: issuer + '/jwks', response_types_supported: ['code'], subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'], token_endpoint_auth_methods_supported: ['client_secret_basic'],
        code_challenge_methods_supported: ['S256'], authorization_response_iss_parameter_supported: true});
    }
    if (humanOidcEnabled && String(url) === issuer + '/token') {
      oidcCalls.token++;
      const form = new URLSearchParams(options.body), auth = authorizationCodes.get(form.get('code'));
      assert.ok(auth, 'only a fixture-issued single-use authorization code can be exchanged');
      authorizationCodes.delete(form.get('code'));
      assert.equal(form.get('grant_type'), 'authorization_code');
      assert.equal(form.get('redirect_uri'), origin + '/auth/oidc/callback');
      assert.equal(createHash('sha256').update(form.get('code_verifier')).digest('base64url'), auth.get('code_challenge'));
      const basic = new Headers(options.headers).get('authorization')?.match(/^Basic ([A-Za-z0-9+/]+={0,2})$/i);
      assert.ok(basic, 'the token request must use Basic authentication');
      const credentials = Buffer.from(basic[1], 'base64');
      assert.equal(credentials.toString('base64'), basic[1], 'Basic credentials must use canonical base64');
      const parts = credentials.toString('utf8').split(':');
      assert.equal(parts.length, 2);
      // OAuth Basic encodes each credential as form data before base64.
      const decode = value => decodeURIComponent(value.replace(/\+/g, ' '));
      assert.equal(decode(parts[0]), 'human-client');
      assert.equal(decode(parts[1]), oidcSecret);
      const at = Math.floor(Date.now() / 1000);
      const input = Buffer.from(JSON.stringify({alg: 'RS256', kid: 'e2e'})).toString('base64url') + '.' +
        Buffer.from(JSON.stringify({iss: issuer, sub: subject, aud: 'human-client', iat: at, exp: at + 60, nonce: auth.get('nonce')})).toString('base64url');
      const id_token = input + '.' + sign('RSA-SHA256', Buffer.from(input), keys.privateKey).toString('base64url');
      return Response.json({access_token: 'synthetic-human-access-token', token_type: 'Bearer', expires_in: 60, id_token});
    }
    return actualFetch(url, options);
  });
  const callbacks = [], delivered = deferred(), deliveryAttempt = deferred(), secret = 'whsec_' + Buffer.alloc(32, 41).toString('base64');
  let lookup = async () => [{address: '8.8.8.8', family: 4}];
  const webhook = require(path.join(output, 'integrations/mcp/webhook-transport.cjs')), originalTransport = webhook.createWebhookTransport;
  // Keep the real allowlists, signatures and pre/post-DNS authorizer. Only the
  // external DNS/network edges are synthetic, with no actual callback traffic.
  t.mock.method(webhook, 'createWebhookTransport', options => {
    const transport = originalTransport({...options,
    lookup: (...args) => lookup(...args), post: async (url, options) => {
      assert.equal(new URL(url).hostname, 'callback.example');
      const headers = options.headers;
      const expected = 'v1,' + createHmac('sha256', Buffer.from(secret.slice(6), 'base64'))
        .update(headers['webhook-id'] + '.' + headers['webhook-timestamp'] + '.' + options.body).digest('base64');
      assert.equal(headers['webhook-signature'], expected);
      const body = JSON.parse(options.body); callbacks.push(body);
      if (body.type === 'verification') return Response.json({challenge: body.challenge});
      delivered.resolve(body); return new Response(null, {status: 204});
    }});
    return async (url, request, binding) => {
      const isDelivery = JSON.parse(request.body).type !== 'verification';
      try {
        const response = await transport(url, request, binding);
        if (isDelivery) deliveryAttempt.resolve({status: 'fulfilled', aborted: request.signal?.aborted === true});
        return response;
      } catch (error) {
        if (isDelivery) deliveryAttempt.resolve({status: 'rejected', reason: error.reason, aborted: request.signal?.aborted === true});
        throw error;
      }
    };
  });
  runtime = await require(path.join(output, 'gateway/public-runtime.cjs')).startPublicRuntime({config, dataRoot: root,
    env: {FIXTURE_GATEWAY_TOKEN: 'x'.repeat(43), FIXTURE_EVENTS_KEY: Buffer.alloc(32, 42).toString('hex'), FIXTURE_OIDC_SECRET: oidcSecret}});
  const context = require(path.join(output, 'collaboration/context.cjs'));
  const human = (workspace, fn) => {
    const actor = runtime.identity.requireMembership(workspace === 'c' ? otherUser.id : user.id, workspaces[workspace].id);
    return context.runWithWorkspace(actor, () => fn(runtime.gateway.workspaceAccess.forHuman(actor)));
  };
  const nodes = {}, tasks = {}, grants = {};
  for (const workspace of Object.keys(workspaces)) {
    nodes[workspace] = human(workspace, h => h.createNode({name: 'Browser ' + workspace, capabilities: ['browser.public_read'], scopes: ['public']}));
    tasks[workspace] = human(workspace, h => h.enqueueTask({targetNodeId: nodes[workspace].id, scopeId: 'public', taskType: 'browser.public_read',
      input: {url: 'https://example.com/', challenge: 'A'.repeat(43)}, deadlineAt: Date.now() + 120000}));
    // The foreign owner's workspace is deliberately not granted to this subject.
    if (agentOAuthEnabled && !discoveryOnly && workspace !== 'c') grants[workspace] = runtime.agentAuthority.grant(runtime.identity.requireMembership(user.id, workspaces[workspace].id), {
      subject, clientId: 'agent-client', workspaceId: workspaces[workspace].id, nodeId: nodes[workspace].id,
      scopes: workspace === 'a' ? ['task.read'] : scopes, expiresAt: Date.now() + 600000});
  }
  const session = randomBytes(32).toString('base64url'), csrf = createHmac('sha256', session).update('chunlack-csrf-v1').digest('base64url');
  const hash = value => createHash('sha256').update(value).digest('hex');
  runtime.identity.createSessionRecord({userId: user.id, expectedPasswordHash: passwordHash, tokenHash: hash(session), csrfHash: hash(csrf), expiresAt: Date.now() + 600000});
  let foreignCookie;
  if (otherUser) {
    const foreignSession = randomBytes(32).toString('base64url');
    const foreignCsrf = createHmac('sha256', foreignSession).update('chunlack-csrf-v1').digest('base64url');
    runtime.identity.createSessionRecord({userId: otherUser.id, expectedPasswordHash: passwordHash, tokenHash: hash(foreignSession), csrfHash: hash(foreignCsrf), expiresAt: Date.now() + 600000});
    foreignCookie = '__Host-chunlack_session=' + foreignSession;
  }
  function authorizeHuman(value) {
    assert.equal(humanOidcEnabled, true);
    const auth = new URL(value);
    assert.equal(auth.origin + auth.pathname, issuer + '/authorize');
    assert.equal(auth.searchParams.get('client_id'), 'human-client');
    assert.equal(auth.searchParams.get('redirect_uri'), origin + '/auth/oidc/callback');
    assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(auth.searchParams.get('scope'), 'openid profile email');
    assert.ok(auth.searchParams.get('state')); assert.ok(auth.searchParams.get('nonce'));
    const code = randomBytes(24).toString('base64url'); authorizationCodes.set(code, auth.searchParams);
    const callback = new URL(origin + '/auth/oidc/callback');
    callback.search = new URLSearchParams({code, state: auth.searchParams.get('state'), iss: issuer, scope: 'openid profile email'});
    return callback.pathname + callback.search;
  }
  function token(selectedScopes = scopes) {
    const at = Math.floor(Date.now() / 1000), input = Buffer.from(JSON.stringify({alg: 'RS256', typ: 'at+jwt', kid: 'e2e'})).toString('base64url') + '.' +
      Buffer.from(JSON.stringify({iss: issuer, sub: subject, aud: resource, iat: at, exp: at + 600, jti: 'e2e-token', client_id: 'agent-client',
        scope: ['openid', ...selectedScopes].join(' ')})).toString('base64url');
    return input + '.' + sign('RSA-SHA256', Buffer.from(input), keys.privateKey).toString('base64url');
  }
  async function rpc(method, params, bearer = token()) {
    const response = await fetch(`http://127.0.0.1:${ports[2]}/mcp`, {method: 'POST',
      headers: {Authorization: 'Bearer ' + bearer, 'Content-Type': 'application/json'}, signal: AbortSignal.timeout(8000),
      body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params})});
    return {status: response.status, body: await response.json()};
  }
  async function revoke(workspace) {
    const response = await fetch(`http://127.0.0.1:${ports[0]}/api/workspaces/${workspaces[workspace].id}/agent-grants/${grants[workspace].id}`, {
      method: 'DELETE', headers: {Origin: origin, Cookie: '__Host-chunlack_session=' + session, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json'},
      body: '{}', signal: AbortSignal.timeout(5000)});
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), {ok: true});
  }
  const params = agentOAuthEnabled && !discoveryOnly ? {grantId: grants.b.id, name: 'pilot.task_ready', arguments: {taskId: tasks.b.taskId}, ttlMs: 60000,
    delivery: {mode: 'webhook', url: 'https://callback.example/ready', secret}} : null;
  return {runtime, root, config, ports, humanCookie: '__Host-chunlack_session=' + session, foreignCookie, user, otherUser,
    authorizeHuman, oidcRequests: () => ({...oidcCalls}), workspaces, nodes, tasks, grants, rpc, revoke, params, callbacks, human, token,
    delivered: () => bounded(delivered.promise, 'callback_not_delivered'),
    deliveryAttempt: () => bounded(deliveryAttempt.promise, 'delivery_attempt_not_settled'),
    holdDns(after = 0) {
      const entered = deferred(), release = deferred(); gates.push(release); let calls = 0;
      lookup = async () => {if (++calls > after) {entered.resolve(); await release.promise;} return [{address: '8.8.8.8', family: 4}];};
      return {entered: () => bounded(entered.promise, 'dns_gate_not_reached'), release: release.resolve};
    }};
}
module.exports = {publicAgentFixture};
