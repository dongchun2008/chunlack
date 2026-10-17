'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {EventEmitter} = require('node:events');
const {renderPublicIngress} = require('../deploy/public/render-ingress.cjs');
const {startPublicRuntime} = require('../gateway/public-runtime.cjs');
const {createAgentGateway} = require('../gateway/server.cjs');
const {publicAgentFixture} = require('./helpers/public-agent-fixture.cjs');
const {createPackagedIngressFixture} = require('./helpers/packaged-ingress-fixture.cjs');

function configuration(nodeRestPublic) {
  return {httpPort: 13721, multiUser: {enabled: true, migrationReady: true},
    agentGateway: {enabled: true, port: 13722, adminTokenEnv: 'MCP_ONLY_TEST_TOKEN'},
    publicRuntime: {webOrigin: 'https://lack.fixture.invalid', agentsOrigin: 'https://agents.fixture.invalid',
      mcpPort: 13723, ...(nodeRestPublic === undefined ? {} : {nodeRestPublic})}};
}

test('mcp-only renderer closes node REST without removing metadata or MCP routes', () => {
  const rendered = renderPublicIngress(configuration(false));
  assert.match(rendered, /respond @discovery_node 404/);
  assert.match(rendered, /X-Chunlack-Agent-Mode mcp-only/);
  assert.match(rendered, /handle @mcp_metadata/);
  assert.match(rendered, /handle @mcp \{/);
  for (const setting of [undefined, true]) {
    const normal = renderPublicIngress(configuration(setting));
    assert.doesNotMatch(normal, /respond @discovery_node 404/);
    assert.match(normal, /X-Chunlack-Agent-Mode normal/);
  }
  const discovery = configuration(true);
  discovery.publicRuntime.agentOAuth = {enabled: true, discoveryOnly: true};
  assert.match(renderPublicIngress(discovery), /X-Chunlack-Agent-Mode discovery-only/);
  assert.match(renderPublicIngress(discovery), /respond @discovery_node 404/);
});

test('mcp-only configuration rejects malformed policy before filesystem access', async () => {
  for (const value of ['false', 0, null, {}, []]) {
    const config = configuration(value);
    assert.throws(() => renderPublicIngress(config), {code: 'ingress_invalid_node_rest_mode'});
    await assert.rejects(startPublicRuntime({config,
      dataRoot: path.resolve('does-not-exist-mcp-only-validation'),
      env: {MCP_ONLY_TEST_TOKEN: 'x'.repeat(43)}}), {code: 'public_invalid_node_rest_mode'});
  }
});

test('mcp-only gateway option rejects malformed direct constructor policy', async () => {
  for (const value of ['false', 0, null, {}, []]) {
    let gateway;
    try {
      assert.throws(() => {gateway = createAgentGateway({
        store: {multiUser: false, changes: new EventEmitter()}, adminToken: 'x'.repeat(43), nodeRestPublic: value
      });}, {code: 'invalid_gateway_configuration'});
    } finally {await gateway?.close();}
  }
});

test('mcp-only runtime retains OAuth MCP and private REST while denying all forwarded node paths', {timeout: 60000}, async t => {
  const f = await publicAgentFixture(t, {nodeRestPublic: false});
  const discovered = await f.rpc('tools/call', {name: 'chunlack_connections_list', arguments: {}});
  assert.equal(discovered.status, 200);
  assert.ok(discovered.body.result && !discovered.body.error);
  const paired = f.runtime.gateway.store.pair(f.nodes.a.pairingCode);
  const base = `http://127.0.0.1:${f.ports[1]}`;
  async function request(uri, headers = {}, method = 'GET', body) {
    const response = await fetch(base + uri, {method, headers: {
      Authorization: 'Bearer ' + paired.token, ...(body ? {'Content-Type': 'application/json'} : {}), ...headers},
      body, signal: AbortSignal.timeout(8000)});
    await response.arrayBuffer(); return response.status;
  }
  assert.equal(await request('/v1/manifest'), 200);
  assert.equal(await request('/v1/events'), 200);
  f.config.publicRuntime.nodeRestPublic = true;
  for (const header of [
    {'X-Forwarded-Proto': 'https'}, {'X-Forwarded-Host': 'agents.e2e.invalid'},
    {'X-Forwarded-For': '192.0.2.10'}, {'X-Real-IP': '192.0.2.10'},
    {Forwarded: 'for=192.0.2.10'}, {'X-Chunlack-Agent-Mode': 'mcp-only'},
    {'X-Chunlack-Agent-Mode': 'normal'}, {'X-Forwarded-Proto': ''}
  ]) assert.equal(await request('/v1/events', header), 404);
  for (const uri of ['/v1', '/v1/', '/v1/manifest', '/v1/openapi.json', '/v1/events',
    '/v1/tasks/' + f.tasks.a.taskId, '/v1/not-an-existing-route']) {
    assert.equal(await request(uri, {'X-Forwarded-Proto': 'https'}), 404, uri);
  }
  assert.equal(await request('/v1/workspaces/' + f.workspaces.b.id + '/pair',
    {'X-Forwarded-Proto': 'https'}, 'POST', JSON.stringify({code: f.nodes.b.pairingCode})), 404);
  assert.ok(f.runtime.gateway.store.pair(f.nodes.b.pairingCode).token);
  assert.equal(await request('/v1/tasks/claim', {'X-Forwarded-Proto': 'https'}, 'POST', '{}'), 404);
  assert.equal(f.human('a', h => h.getTask(f.tasks.a.taskId)).status, 'queued');
  const again = await f.rpc('tools/call', {name: 'chunlack_connections_list', arguments: {}});
  assert.equal(again.status, 200); assert.ok(again.body.result && !again.body.error);
});

test('mcp-only HTTPS routes verify signed OAuth for MCP while public node REST stays closed',
  {timeout: 90000, skip: !process.env.CADDY_TEST_BIN}, async t => {
    const jose = await import('jose'), keys = await jose.generateKeyPair('RS256');
    const issuer = 'https://pocket.fixture.invalid', resource = 'https://agents.fixture.invalid/mcp';
    const jwk = {...await jose.exportJWK(keys.publicKey), kid: 'mcp-only-tls', alg: 'RS256', use: 'sig'};
    const originalFetch = globalThis.fetch;
    t.mock.method(globalThis, 'fetch', (url, options) => String(url) === issuer + '/jwks'
      ? Promise.resolve(Response.json({keys: [jwk]})) : originalFetch(url, options));
    const f = await createPackagedIngressFixture({signal: t.signal, caddyBin: process.env.CADDY_TEST_BIN,
      configure: ({config}) => {
        config.publicRuntime.nodeRestPublic = false;
        config.publicRuntime.agentOAuth = {enabled: true, issuer, resource, jwksUri: issuer + '/jwks',
          browserClientId: 'mcp-only-human', clientIds: ['mcp-only-agent']};
        config.identity = {oidc: {enabled: false, clientId: 'mcp-only-human'}};
      }});
    t.after(() => f.close());
    const subject = '11111111-1111-4111-8111-111111111111';
    f.runtime.identity.linkExternalIdentity({issuer, sub: subject, userId: f.ownerId});
    const actor = f.runtime.identity.requireMembership(f.ownerId, f.workspaceId);
    const context = require(path.join(f.codeRoot, 'collaboration/context.cjs'));
    const node = context.runWithWorkspace(actor, () => f.runtime.gateway.workspaceAccess.forHuman(actor)
      .createNode({name: 'TLS MCP only', capabilities: ['browser.public_read'], scopes: ['public']}));
    const grant = f.runtime.agentAuthority.grant(actor, {subject, clientId: 'mcp-only-agent',
      workspaceId: f.workspaceId, nodeId: node.id, scopes: ['task.read'], expiresAt: Date.now() + 600000});
    const at = Math.floor(Date.now() / 1000);
    const token = await new jose.SignJWT({iss: issuer, aud: resource, sub: subject,
      client_id: 'mcp-only-agent', jti: 'mcp-only-tls-task', iat: at, exp: at + 300, scope: 'openid task.read'})
      .setProtectedHeader({alg: 'RS256', typ: 'at+jwt', kid: 'mcp-only-tls'}).sign(keys.privateKey);
    const rpc = json => f.request('agents', '/mcp', {method: 'POST',
      headers: {Authorization: 'Bearer ' + token}, json});
    const initialized = await rpc({jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2026-07-28', capabilities: {}, clientInfo: {name: 'mcp-only-test', version: '1'}}});
    assert.equal(initialized.status, 200); assert.ok(JSON.parse(initialized.text).result);
    const connections = await rpc({jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: {name: 'chunlack_connections_list', arguments: {}}});
    assert.equal(connections.status, 200);
    const result = JSON.parse(connections.text);
    assert.ok(result.result && !result.error);
    assert.ok(connections.text.includes(grant.id));
    for (const uri of ['/v1', '/v1/', '/v1/manifest', '/v1/events', '/v1/not-an-existing-route']) {
      for (const headers of [{}, {Authorization: 'Bearer ' + token}]) {
        assert.equal((await f.request('agents', uri, {headers})).status, 404, uri);
      }
    }
    const denied = await f.request('agents', '/mcp', {method: 'POST', json: {
      jsonrpc: '2.0', id: 3, method: 'tools/call', params: {name: 'chunlack_connections_list', arguments: {}}}});
    assert.equal(denied.status, 401);
    assert.equal((await f.request('web', '/health')).status, 200);
  });
