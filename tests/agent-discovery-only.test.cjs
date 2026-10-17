'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createAgentAccessVerifier} = require('../identity/agent-access.cjs');
const {createPilotMcp} = require('../integrations/mcp/pilot-server.cjs');
const {publicAgentFixture} = require('./helpers/public-agent-fixture.cjs');
const config = {enabled: true, issuer: 'https://pocket.example.test', resource: 'https://agents.example.test/mcp',
  jwksUri: 'https://pocket.example.test/jwks', browserClientId: 'human-client', clientIds: ['agent-client']};

test('discovery-only verifier denies a valid signed token without fetching keys or producing identity evidence', async t => {
  const jose = await import('jose'), key = await jose.generateKeyPair('RS256');
  const jwk = {...await jose.exportJWK(key.publicKey), kid: 'discovery-test', alg: 'RS256', use: 'sig'};
  const now = Math.floor(Date.now() / 1000);
  const token = await new jose.SignJWT({iss: config.issuer, aud: config.resource,
    sub: '11111111-1111-4111-8111-111111111111', client_id: 'agent-client', jti: 'test-discovery-only',
    iat: now, exp: now + 300, scope: 'openid task.read task.claim task.result events.read events.subscribe'})
    .setProtectedHeader({alg: 'RS256', typ: 'at+jwt', kid: 'discovery-test'}).sign(key.privateKey);
  const active = await createAgentAccessVerifier({config, fetchImpl: async () => Response.json({keys: [jwk]})});
  t.after(() => active.close());
  const proof = await active.verify(token, {scope: 'task.read'});
  assert.equal(active.consume(proof).clientId, 'agent-client', 'control token must actually verify');
  let fetches = 0;
  const mutable = {...config, discoveryOnly: true, clientIds: []};
  const denied = await createAgentAccessVerifier({config: mutable, fetchImpl: async () => {fetches++; return Response.json({keys: [jwk]});}});
  t.after(() => denied.close());
  mutable.discoveryOnly = false; mutable.clientIds.push('agent-client');
  for (const scope of ['task.read', 'task.claim', 'task.result', 'events.read', 'events.subscribe']) {
    await assert.rejects(denied.verify(token, {scope}), {code: 'invalid_token'});
  }
  assert.throws(() => denied.consume(proof), {code: 'invalid_token'});
  assert.equal(fetches, 0);
  await denied.close(); await denied.close();
  await assert.rejects(denied.verify(token, {scope: 'task.read'}), {code: 'service_closed'});
});

test('empty enrollment is explicit and incompatible or malformed mode settings fail closed', async () => {
  for (const change of [
    {clientIds: []}, {discoveryOnly: false, clientIds: []},
    {discoveryOnly: true}, {discoveryOnly: 'true'}, {discoveryOnly: 1},
    {discoveryOnly: true, enabled: false, clientIds: []}
  ]) await assert.rejects(createAgentAccessVerifier({config: {...config, ...change}}), {code: 'invalid_agent_access_config'});
});

test('packaged discovery-only runtime serves public metadata but rejects every MCP task path including paired nodes', {timeout: 60000}, async t => {
  const f = await publicAgentFixture(t, {discoveryOnly: true});
  const base = `http://127.0.0.1:${f.ports[2]}`;
  const request = (url, options = {}) => fetch(base + url, {...options, signal: AbortSignal.timeout(8000)});
  for (const path of ['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource']) {
    const response = await request(path);
    assert.equal(response.status, 200);
    const metadata = await response.json();
    assert.equal(metadata.resource, 'https://agents.e2e.invalid/mcp');
    assert.deepEqual(metadata.authorization_servers, ['https://pocket.e2e.invalid']);
    assert.equal(response.headers.get('set-cookie'), null);
    const head = await request(path, {method: 'HEAD'});
    assert.equal(head.status, 200); assert.equal(await head.text(), '');
  }
  assert.equal(f.runtime.agentAuthority, undefined);
  assert.equal(f.runtime.mcp.events, undefined);
  const paired = f.runtime.gateway.store.pair(f.nodes.a.pairingCode);
  const bodies = [
    {jsonrpc: '2.0', id: 1, method: 'initialize', params: {protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {name: 'test', version: '1'}}},
    {jsonrpc: '2.0', method: 'notifications/initialized'},
    ...['ping', 'server/discover', 'tools/list', 'events/list', 'events/subscribe', 'events/unsubscribe'].map(method => ({jsonrpc: '2.0', id: 2, method, params: {}})),
    ...['pilot.read_task', 'pilot.claim_task', 'pilot.submit_result', 'pilot.artifact_begin', 'chunlack_connections_list'].map(name =>
      ({jsonrpc: '2.0', id: 3, method: 'tools/call', params: {name, arguments: {taskId: f.tasks.a.taskId}}}))
  ];
  for (const token of [undefined, f.token(), paired.token]) {
    const headers = {'Content-Type': 'application/json', ...(token ? {Authorization: 'Bearer ' + token} : {})};
    for (const body of bodies) {
      const response = await request('/mcp', {method: 'POST', headers, body: JSON.stringify(body)});
      assert.equal(response.status, 401, body.method + ':' + (body.params?.name || ''));
      assert.match(response.headers.get('www-authenticate'), /resource_metadata="https:\/\/agents\.e2e\.invalid\/\.well-known\/oauth-protected-resource\/mcp"/);
      const result = await response.text(); assert.equal(result.includes(f.tasks.a.taskId), false);
    }
    const get = await request('/mcp', {headers}); assert.equal(get.status, 401); await get.text();
  }
  assert.equal(f.human('a', h => h.getTask(f.tasks.a.taskId)).status, 'queued');
  assert.equal(f.human('b', h => h.getTask(f.tasks.b.taskId)).status, 'queued');
  assert.deepEqual(f.callbacks, []);
  const origin = await request('/mcp', {headers: {Origin: 'https://untrusted.invalid'}});
  assert.equal(origin.status, 403); await origin.text();
  const wrong = await request('/.well-known/oauth-protected-resource/mcp?x=1');
  assert.equal(wrong.status, 404); await wrong.text();
  const health = await fetch(`http://127.0.0.1:${f.ports[0]}/health`, {signal: AbortSignal.timeout(8000)});
  assert.equal(health.status, 200); await health.text();

  // The exported handler also denies access without consulting trusted resolvers.
  let resolutions = 0;
  const mcp = createPilotMcp({store: f.runtime.gateway.store, workspaceAccess: f.runtime.gateway.workspaceAccess,
    agentOAuth: f.config.publicRuntime.agentOAuth, resolvePrincipal: () => {resolutions++; throw Error('must not resolve');}});
  t.after(() => mcp.close());
  const result = await mcp.handleRpc(bodies[0], paired.token);
  assert.equal(result.error.code, -32001); assert.equal(resolutions, 0);

  const {startPublicRuntime} = require('../gateway/public-runtime.cjs');
  for (const [patch, expected] of [
    [{events: {enabled: true}}, 'public_discovery_only_events_forbidden'],
    [{agentOAuth: {...f.config.publicRuntime.agentOAuth, enabled: false}}, 'invalid_agent_access_config'],
    [{agentOAuth: {...f.config.publicRuntime.agentOAuth, discoveryOnly: 'true'}}, 'invalid_agent_access_config']
  ]) await assert.rejects(startPublicRuntime({config: {...f.config, publicRuntime: {...f.config.publicRuntime, ...patch}},
    dataRoot: f.root, env: {FIXTURE_GATEWAY_TOKEN: 'x'.repeat(43)}}), {code: expected});
});
