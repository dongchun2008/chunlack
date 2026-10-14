'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createAgentResource} = require('../identity/agent-resource.cjs');
const {agentAuthorityFixture} = require('./helpers/agent-authority-fixture.cjs');
const {createPilotMcp} = require('../integrations/mcp/pilot-server.cjs');
const config = {enabled: true, issuer: 'https://pocket.example.test', resource: 'https://agents.example.test/mcp'};
const paths = ['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource'];

test('resource discovery is opt-in and returns only immutable configured public facts', () => {
  assert.equal(createAgentResource(), null);
  assert.equal(createAgentResource({enabled: false}), null);
  const profile = createAgentResource(config);
  assert.deepEqual(profile.paths, paths);
  assert.deepEqual(profile.metadata, {resource: config.resource, authorization_servers: [config.issuer],
    bearer_methods_supported: ['header'], scopes_supported: ['openid', 'task.read', 'task.claim', 'task.result', 'events.read', 'events.subscribe']});
  assert.ok(Object.isFrozen(profile)); assert.ok(Object.isFrozen(profile.metadata));
  assert.ok(Object.isFrozen(profile.metadata.authorization_servers)); assert.ok(Object.isFrozen(profile.metadata.scopes_supported));
  assert.ok(Object.isFrozen(profile.paths));
});

test('resource discovery rejects noncanonical, unsafe, or unrelated endpoint configuration', () => {
  for (const value of ['http://pocket.example.test', 'https://user@pocket.example.test', config.issuer + '/', config.issuer + '/tenant', config.issuer + '?q=1', config.issuer + '\r\n']) {
    assert.throws(() => createAgentResource({...config, issuer: value}), {code: 'invalid_agent_resource_config'});
  }
  for (const value of ['http://agents.example.test/mcp', 'https://u:p@agents.example.test/mcp', config.resource + '/', config.resource + '?q=1', config.resource + '#x', 'https://agents.example.test/%6dcp', 'https://agents.example.test/other']) {
    assert.throws(() => createAgentResource({...config, resource: value}), {code: 'invalid_agent_resource_config'});
  }
});

test('OAuth challenges use fixed metadata, least operation scope, and never interpolate arbitrary text', () => {
  const profile = createAgentResource(config);
  assert.equal(profile.challenge(), 'Bearer resource_metadata="https://agents.example.test/.well-known/oauth-protected-resource/mcp", scope="openid task.read"');
  assert.equal(profile.challenge({scope: 'events.subscribe', error: 'insufficient_scope'}), 'Bearer resource_metadata="https://agents.example.test/.well-known/oauth-protected-resource/mcp", scope="openid events.subscribe", error="insufficient_scope"');
  assert.match(profile.challenge({error: 'invalid_token'}), /error="invalid_token"$/);
  assert.throws(() => profile.challenge({scope: 'task.read"\r\nInjected: yes'}), {code: 'invalid_agent_resource_challenge'});
  assert.throws(() => profile.challenge({error: 'server_error'}), {code: 'invalid_agent_resource_challenge'});
});

async function fixture(t, extra = {}) {
  const f = await agentAuthorityFixture(t), agent = await f.agent();
  const options = {store: f.gateway, workspaceAccess: f.access, agentOAuth: config,
    resolvePrincipal: token => f.gateway.authenticate(token),
    resolveAgentPrincipal: async (token, {scope}) => {
      const proof = await f.authority.authenticate(token, {grantId: agent.grant.id, scope});
      return f.gateway.authenticateAgent(proof, {scope});
    }, ...extra};
  const mcp = createPilotMcp(options); t.after(() => mcp.close());
  await new Promise((resolve, reject) => {mcp.server.once('error', reject); mcp.server.listen(0, '127.0.0.1', resolve);});
  const base = 'http://127.0.0.1:' + mcp.server.address().port;
  const request = (url, init = {}) => fetch(base + url, {signal: AbortSignal.timeout(10000), ...init});
  const rpc = (body, token, headers = {}) => request('/mcp', {method: 'POST', headers: {'Content-Type': 'application/json', ...(token ? {Authorization: 'Bearer ' + token} : {}), ...headers}, body: JSON.stringify(body)});
  return {...f, options, mcp, request, rpc};
}

test('public resource GET and HEAD use pinned configuration even with untrusted forwarded headers', async t => {
  const f = await fixture(t);
  for (const url of paths) {
    const response = await f.request(url, {headers: {Origin: 'https://untrusted.example', 'X-Forwarded-Host': 'untrusted.example', 'X-Forwarded-Proto': 'http'}});
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.equal(response.headers.get('access-control-allow-credentials'), null);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.deepEqual(await response.json(), createAgentResource(config).metadata);
    const head = await f.request(url, {method: 'HEAD'});
    assert.equal(head.status, 200); assert.equal(await head.text(), '');
  }
});

test('unauthenticated and invalid JWT requests receive bounded resource discovery challenges', async t => {
  const f = await fixture(t), request = {jsonrpc: '2.0', id: 1, method: 'tools/list', params: {}};
  const missing = await f.rpc(request);
  assert.equal(missing.status, 401);
  assert.equal(missing.headers.get('www-authenticate'), createAgentResource(config).challenge());
  const invalid = await f.rpc(request, 'invalid.jwt.token');
  assert.equal(invalid.status, 401);
  assert.equal(invalid.headers.get('www-authenticate'), createAgentResource(config).challenge({error: 'invalid_token'}));
  const text = await invalid.text(); assert.equal(text.includes('invalid.jwt.token'), false);
});

test('verified insufficient scope produces an operation-specific 403 challenge without granting access', async t => {
  const f = await fixture(t);
  const denied = await f.rpc({jsonrpc: '2.0', id: 2, method: 'events/subscribe', params: {}}, f.token(['events.read']));
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('www-authenticate'), createAgentResource(config).challenge({scope: 'events.subscribe', error: 'insufficient_scope'}));
  assert.equal((await denied.json()).error.data.reason, 'insufficient_scope');
  const allowed = await f.rpc({jsonrpc: '2.0', id: 3, method: 'tools/list', params: {}}, f.token(['task.read']));
  assert.equal(allowed.status, 200); assert.equal(allowed.headers.get('www-authenticate'), null);
  assert.ok((await allowed.json()).result.tools.length > 0);
});

test('discovery does not weaken MCP Origin protection or accept metadata queries and methods', async t => {
  const f = await fixture(t);
  const forbidden = await f.rpc({jsonrpc: '2.0', id: 4, method: 'tools/list'}, f.token(), {Origin: 'https://untrusted.example'});
  assert.equal(forbidden.status, 403); assert.equal(forbidden.headers.get('www-authenticate'), null);
  for (const [url, method] of [[paths[0] + '?resource=https://evil.example', 'GET'], [paths[0] + '/', 'GET'], [paths[0], 'POST'], [paths[1], 'OPTIONS']]) {
    const response = await f.request(url, {method}); assert.equal(response.status, 404);
  }
});

test('disabled metadata preserves legacy missing-auth behavior and unknown routes', async t => {
  const f = await fixture(t, {agentOAuth: undefined});
  assert.equal((await f.request(paths[0])).status, 404);
  const response = await f.rpc({jsonrpc: '2.0', id: 5, method: 'tools/list'});
  assert.equal(response.status, 401); assert.equal(response.headers.get('www-authenticate'), null);
});

test('resource discovery cannot be enabled without the trusted Agent token resolver', async t => {
  const f = await agentAuthorityFixture(t);
  assert.throws(() => createPilotMcp({store: f.gateway, workspaceAccess: f.access, agentOAuth: config,
    resolvePrincipal: token => f.gateway.authenticate(token)}), {code: 'agent_mcp_configuration'});
});

test('readiness gate holds public discovery until the owning runtime is ready', async t => {
  const f = await fixture(t, {ready: () => false});
  const response = await f.request(paths[0]);
  assert.equal(response.status, 503); assert.equal((await response.json()).error, 'runtime_starting');
});
