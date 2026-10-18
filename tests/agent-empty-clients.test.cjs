'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Database = require('better-sqlite3');
const {gatewayFixture} = require('./helpers/workspace-gateway-fixture.cjs');
const {createAgentAccessVerifier} = require('../identity/agent-access.cjs');
const {createAgentAuthority} = require('../identity/agent-authority.cjs');
const {createPackagedIngressFixture} = require('./helpers/packaged-ingress-fixture.cjs');
const issuer = 'https://pocket.fixture.invalid', resource = 'https://agents.fixture.invalid/mcp';
const subject = '11111111-1111-4111-8111-111111111111';
const base = {enabled: true, discoveryOnly: false, issuer, resource, jwksUri: issuer + '/jwks',
  browserClientId: 'empty-human', clientIds: ['empty-agent']};
let jose, keys, jwk;
test.before(async () => {
  jose = await import('jose'); keys = await jose.generateKeyPair('RS256');
  jwk = {...await jose.exportJWK(keys.publicKey), kid: 'empty-policy', alg: 'RS256', use: 'sig'};
});
function token(now = Date.now(), clientId = 'empty-agent') {
  const at = Math.floor(now / 1000);
  return new jose.SignJWT({iss: issuer, aud: resource, sub: subject, client_id: clientId,
    jti: 'empty-policy-test', iat: at, exp: at + 300, scope: 'openid task.read task.claim task.result events.read events.subscribe'})
    .setProtectedHeader({alg: 'RS256', typ: 'at+jwt', kid: jwk.kid}).sign(keys.privateKey);
}
async function verifier(config, count = () => {}) {
  return createAgentAccessVerifier({config, fetchImpl: async () => {count(); return Response.json({keys: [jwk]});}});
}
function authorityFixture(t) {
  const r = gatewayFixture(t), db = new Database(r.dbPath);
  r.own({close() {if (db.open) db.close();}});
  r.store.linkExternalIdentity({issuer, sub: subject, userId: r.users.alice.id});
  return {...r, db};
}

test('empty Agent clients reject a positively verified token without JWKS retrieval or caller-mutation reopening', async t => {
  let enabled, empty, activeFetches = 0, emptyFetches = 0;
  t.after(async () => {await empty?.close(); await enabled?.close();});
  enabled = await verifier(base, () => {activeFetches++;});
  const raw = await token(), evidence = enabled.consume(await enabled.verify(raw, {scope: 'task.read'}));
  assert.equal(evidence.clientId, 'empty-agent'); assert.equal(activeFetches, 1);
  const config = {...base, clientIds: []};
  await assert.doesNotReject(async () => {empty = await verifier(config, () => {emptyFetches++;});});
  config.clientIds.push('empty-agent');
  for (const scope of ['task.read', 'task.claim', 'task.result', 'events.read', 'events.subscribe'])
    await assert.rejects(empty.verify(raw, {scope}), {code: 'invalid_token'});
  assert.throws(() => empty.consume({}), {code: 'invalid_token'});
  assert.equal(emptyFetches, 0);
  await empty.close();
  await assert.rejects(empty.verify(raw, {scope: 'task.read'}), {code: 'service_closed'});
});

test('empty Agent clients initialize schema and epochs without granting authority or changing identity records', async t => {
  const r = authorityFixture(t), config = {...base, clientIds: []};
  let check, authority; t.after(async () => {authority?.close(); await check?.close();});
  const members = r.db.prepare('SELECT * FROM memberships ORDER BY workspace_id,user_id').all();
  const users = r.db.prepare('SELECT * FROM users ORDER BY id').all();
  await assert.doesNotReject(async () => {check = await createAgentAccessVerifier({config, now: r.now});});
  assert.doesNotThrow(() => {authority = createAgentAuthority({db: r.db, identity: r.store, workspaceAccess: r.access, verifier: check, config, now: r.now});});
  assert.deepEqual(r.db.prepare('SELECT * FROM memberships ORDER BY workspace_id,user_id').all(), members);
  assert.deepEqual(r.db.prepare('SELECT * FROM users ORDER BY id').all(), users);
  assert.equal(r.db.prepare('SELECT COUNT(*) AS n FROM agent_membership_epochs').get().n, members.length);
  assert.equal(r.db.prepare('SELECT COUNT(*) AS n FROM agent_authority_grants').get().n, 0);
  assert.deepEqual(r.db.prepare("SELECT component,version FROM schema_version WHERE component IN ('agent-authority','agent-membership-epochs') ORDER BY component").all(),
    [{component: 'agent-authority', version: 1}, {component: 'agent-membership-epochs', version: 1}]);
  config.clientIds.push('empty-agent');
  for (const clientId of ['empty-agent', 'empty-human', 'other-agent'])
    assert.throws(() => authority.grant(r.actor('alice', 'a'), {subject, clientId, workspaceId: r.workspaces.a.id,
      nodeId: r.nodes.a.id, scopes: ['task.read'], expiresAt: r.now() + 600000}), {code: 'invalid_agent_grant'});
  assert.equal(r.db.prepare('SELECT COUNT(*) AS n FROM agent_authority_grants').get().n, 0);
});

test('empty Agent clients preserve existing grants and epochs but cannot reactivate their access', async t => {
  const r = authorityFixture(t); let active, empty, previous, current;
  t.after(async () => {current?.close(); previous?.close(); await empty?.close(); await active?.close();});
  active = await createAgentAccessVerifier({config: base, now: r.now, fetchImpl: async () => Response.json({keys: [jwk]})});
  previous = createAgentAuthority({db: r.db, identity: r.store, workspaceAccess: r.access, verifier: active, config: base, now: r.now});
  const grant = previous.grant(r.actor('alice', 'a'), {subject, clientId: 'empty-agent', workspaceId: r.workspaces.a.id,
    nodeId: r.nodes.a.id, scopes: ['task.read'], expiresAt: r.now() + 600000});
  const raw = await token(r.now()), proof = await previous.authenticate(raw, {grantId: grant.id, scope: 'task.read'});
  assert.equal(previous.assert(proof, {scope: 'task.read'}).grantId, grant.id);
  const grants = r.db.prepare('SELECT * FROM agent_authority_grants ORDER BY id').all();
  const epochs = r.db.prepare('SELECT * FROM agent_membership_epochs ORDER BY workspace_id,user_id').all();
  previous.close(); await active.close();
  const config = {...base, clientIds: []};
  await assert.doesNotReject(async () => {empty = await createAgentAccessVerifier({config, now: r.now});});
  assert.doesNotThrow(() => {current = createAgentAuthority({db: r.db, identity: r.store, workspaceAccess: r.access, verifier: empty, config, now: r.now});});
  assert.deepEqual(r.db.prepare('SELECT * FROM agent_authority_grants ORDER BY id').all(), grants);
  assert.deepEqual(r.db.prepare('SELECT * FROM agent_membership_epochs ORDER BY workspace_id,user_id').all(), epochs);
  await assert.rejects(current.authenticate(raw, {grantId: grant.id, scope: 'task.read'}), {code: 'invalid_token'});
  assert.throws(() => current.assert(proof, {scope: 'task.read'}), {code: 'unauthorized'});
});

test('empty Agent clients over verified HTTPS deny OAuth and valid paired-node MCP while migration and private REST remain available',
  {timeout: 90000, skip: !process.env.CADDY_TEST_BIN}, async t => {
    const started = performance.now();
    const mark = stage => t.diagnostic(JSON.stringify({stage, elapsedMs: Math.round(performance.now() - started)}));
    let f; t.after(async () => {
      mark('cleanup.start');
      try {await f?.close(); mark('cleanup.complete');}
      catch (error) {t.diagnostic(JSON.stringify({stage: 'cleanup.failed', code: error.code || error.name})); throw error;}
    });
    const originalFetch = globalThis.fetch; let keyFetches = 0;
    t.mock.method(globalThis, 'fetch', (url, options) => String(url) === issuer + '/jwks'
      ? (keyFetches++, Promise.resolve(Response.json({keys: [jwk]}))) : originalFetch(url, options));
    mark('fixture.start');
    await assert.doesNotReject(async () => {f = await createPackagedIngressFixture({signal: t.signal, caddyBin: process.env.CADDY_TEST_BIN,
      configure: ({config}) => {
        config.publicRuntime.nodeRestPublic = false;
        config.publicRuntime.agentOAuth = {...base, clientIds: []};
        config.identity = {oidc: {enabled: false, clientId: 'empty-human'}};
      }});});
    mark('fixture.ready');
    const db = new Database(path.join(path.dirname(f.codeRoot), 'data/db/identity.db'), {readonly: true, fileMustExist: true});
    try {
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agent_authority_grants').get().n, 0);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agent_membership_epochs').get().n,
        db.prepare('SELECT COUNT(*) AS n FROM memberships').get().n);
    } finally {db.close();}
    mark('schema.checked');
    const actor = f.runtime.identity.requireMembership(f.ownerId, f.workspaceId);
    const context = require(path.join(f.codeRoot, 'collaboration/context.cjs'));
    const node = context.runWithWorkspace(actor, () => f.runtime.gateway.workspaceAccess.forHuman(actor)
      .createNode({name: 'Empty policy private node', capabilities: ['browser.public_read'], scopes: ['public']}));
    const paired = f.runtime.gateway.store.pair(node.pairingCode);
    mark('private-rest.start');
    const response = await fetch('http://127.0.0.1:' + f.runtime.gateway.server.address().port + '/v1/manifest',
      {headers: {Authorization: 'Bearer ' + paired.token}, signal: AbortSignal.timeout(8000)});
    assert.equal(response.status, 200); await response.arrayBuffer();
    mark('private-rest.complete');
    const oauth = await token();
    for (const headers of [{}, {Authorization: 'Bearer ' + oauth}, {Authorization: 'Bearer ' + paired.token}]) {
      for (const rpc of [
        {jsonrpc: '2.0', id: 1, method: 'initialize', params: {protocolVersion: '2026-07-28', capabilities: {}, clientInfo: {name: 'empty', version: '1'}}},
        {jsonrpc: '2.0', id: 2, method: 'tools/list', params: {}},
        {jsonrpc: '2.0', id: 3, method: 'tools/call', params: {name: 'chunlack_connections_list', arguments: {}}}
      ]) {
        mark('mcp.post.' + rpc.method);
        const denied = await f.request('agents', '/mcp', {method: 'POST', headers, json: rpc});
        assert.equal(denied.status, 401); assert.match(denied.headers['www-authenticate'], /resource_metadata=/);
      }
      mark('mcp.get');
      assert.equal((await f.request('agents', '/mcp', {headers})).status, 401);
      for (const host of ['web', 'agents'])
        for (const uri of ['/v1', '/v1/manifest', '/v1/events', '/v1/tasks/claim'])
          assert.equal((await f.request(host, uri, {headers})).status, 404);
    }
    mark('public-rest.checked');
    const metadata = await f.request('agents', '/.well-known/oauth-protected-resource/mcp');
    assert.equal(metadata.status, 200); assert.equal(JSON.parse(metadata.text).resource, resource);
    assert.equal((await f.request('web', '/health')).status, 200);
    assert.equal(keyFetches, 0);
    mark('assertions.complete');
  });
