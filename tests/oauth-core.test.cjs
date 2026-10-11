'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const Database = require('better-sqlite3');
const {workspaceFixture} = require('./helpers/workspace-fixture.cjs');
const issuer = 'https://lack.example.test';
const resource = 'https://agents.example.test/mcp';
const redirectUri = 'https://client.example.test/callback';
const verifier = 'a'.repeat(43);
const challenge = createHash('sha256').update(verifier).digest('base64url');

function fixture(t, options = {}) {
  const {installIsolatedOAuthSchema} = require('../identity/oauth-schema.cjs');
  const {createOAuthCore} = require('../identity/oauth-core.cjs');
  const f = workspaceFixture(t), db = new Database(':memory:');
  installIsolatedOAuthSchema(db);
  t.after(() => db.close());
  let time = Date.now();
  const node = {id: 'browser-node', workspaceId: f.workspaces.a.id, status: 'active', capabilities: ['browser.public_read']};
  const config = {db, identity: f.store, resolveNode: id => id === node.id ? node : null,
    issuer, resource, now: () => time};
  const core = createOAuthCore(config);
  const client = core.registerClient({id: 'fixture-client', redirectUris: [redirectUri],
    authentication: options.confidential ? 'client_secret_post' : 'none'});
  const actor = f.actor('alice', 'a');
  const query = {client_id: client.id, redirect_uri: redirectUri, response_type: 'code',
    code_challenge: challenge, code_challenge_method: 'S256', state: 'fixture-state',
    scope: 'task.read task.claim task.result', resource};
  const authorize = (patch = {}, extra = {}) => core.authorize({actor, nodeId: node.id,
    allowRefresh: true, query: {...query, ...patch}, ...extra});
  const exchange = (code, patch = {}) => core.exchange({grant_type: 'authorization_code',
    client_id: client.id, ...(client.secret ? {client_secret: client.secret} : {}),
    code, redirect_uri: redirectUri, code_verifier: verifier, resource, ...patch});
  const refresh = (token, patch = {}) => core.exchange({grant_type: 'refresh_token',
    client_id: client.id, ...(client.secret ? {client_secret: client.secret} : {}),
    refresh_token: token, resource, ...patch});
  return {...f, db, core, config, client, node, query, authorize, exchange, refresh,
    advanceOAuth: ms => {time += ms;}};
}

test('OAuth core PKCE round trip binds issuer, human, workspace, node and scopes', async t => {
  const f = fixture(t), approval = await f.authorize();
  const location = new URL(approval.location);
  assert.equal(location.origin + location.pathname, redirectUri);
  assert.equal(location.searchParams.get('state'), 'fixture-state');
  assert.equal(location.searchParams.get('iss'), issuer);
  assert.equal(location.searchParams.get('code'), approval.code);
  const tokens = await f.exchange(approval.code);
  assert.equal(tokens.token_type, 'Bearer');
  assert.ok(tokens.expires_in > 0 && tokens.expires_in <= 300);
  assert.match(tokens.access_token, /^cloa_[A-Za-z0-9_-]{43}$/);
  assert.match(tokens.refresh_token, /^clor_[A-Za-z0-9_-]{43}$/);
  const principal = f.core.verify(tokens.access_token, {resource, scope: 'task.read'});
  assert.equal(principal.userId, f.users.alice.id);
  assert.equal(principal.workspaceId, f.workspaces.a.id);
  assert.equal(principal.nodeId, f.node.id);
  assert.deepEqual(principal.taskTypes, ['browser.public_read']);
  assert.throws(() => f.core.verify(tokens.access_token, {resource, scope: 'events.subscribe'}));
  assert.throws(() => f.core.verify(tokens.access_token, {resource: issuer, scope: 'task.read'}));
});

test('strict authorization input rejects redirect, PKCE, resource and scope widening', async t => {
  const f = fixture(t);
  for (const patch of [
    {redirect_uri: redirectUri + '/extra'}, {client_id: 'unknown-client'},
    {resource: issuer}, {scope: 'shell.execute'}, {scope: ''},
    {response_type: 'token'}, {code_challenge_method: 'plain'},
    {code_challenge: undefined}, {state: ''}, {state: 'x'.repeat(513)},
    {client_id: ['fixture-client']}, {unexpected: 'value'}
  ]) await assert.rejects(f.authorize(patch));
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM oauth_grants').get().n, 0);
});

test('only a current owner may authorize a same-workspace active browser node', async t => {
  const f = fixture(t);
  await assert.rejects(f.authorize({}, {actor: f.actor('bob', 'a')}));
  await assert.rejects(f.authorize({}, {actor: f.actor('bob', 'b')}));
  f.node.status = 'paused';
  await assert.rejects(f.authorize());
  f.node.status = 'active'; f.node.capabilities = ['shell.execute'];
  await assert.rejects(f.authorize());
});

test('authorization code is single use even with simultaneous exchanges', async t => {
  const f = fixture(t), approval = await f.authorize();
  const results = await Promise.allSettled([f.exchange(approval.code), f.exchange(approval.code)]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(results.filter(x => x.status === 'rejected').length, 1);
  await assert.rejects(f.exchange(approval.code));
});

test('wrong verifier consumes the code; missing verifier never issues tokens', async t => {
  const f = fixture(t), a = await f.authorize();
  await assert.rejects(f.exchange(a.code, {code_verifier: 'b'.repeat(43)}));
  await assert.rejects(f.exchange(a.code));
  const b = await f.authorize();
  await assert.rejects(f.exchange(b.code, {code_verifier: undefined}));
});

test('exchange binds client, redirect and exact resource without credential fallback', async t => {
  const f = fixture(t, {confidential: true}), a = await f.authorize();
  for (const patch of [{resource: issuer}, {client_secret: undefined}, {client_secret: 'wrong'},
    {grant_type: 'client_credentials'}, {code: [a.code]}, {access_token: 'injected'}]) {
    await assert.rejects(f.exchange(a.code, patch));
  }
  const tokens = await f.exchange(a.code);
  assert.ok(tokens.access_token);
  const b = await f.authorize();
  await assert.rejects(f.exchange(b.code, {redirect_uri: redirectUri + '/extra'}));
});

test('refresh rotates and replay revokes every token in the same grant family', async t => {
  const f = fixture(t), a = await f.authorize(), first = await f.exchange(a.code);
  const next = await f.refresh(first.refresh_token);
  assert.notEqual(first.refresh_token, next.refresh_token);
  f.core.verify(next.access_token, {resource, scope: 'task.read'});
  await assert.rejects(f.refresh(first.refresh_token));
  assert.throws(() => f.core.verify(next.access_token, {resource, scope: 'task.read'}));
  assert.throws(() => f.core.verify(first.access_token, {resource, scope: 'task.read'}));
  await assert.rejects(f.refresh(next.refresh_token));
});

test('another client cannot consume or revoke a stolen refresh token', async t => {
  const f = fixture(t), a = await f.authorize(), first = await f.exchange(a.code);
  f.core.registerClient({id: 'other-client', redirectUris: [redirectUri], authentication: 'none'});
  await assert.rejects(f.refresh(first.refresh_token, {client_id: 'other-client'}));
  const next = await f.refresh(first.refresh_token);
  f.core.verify(next.access_token, {resource, scope: 'task.read'});
});

test('simultaneous refresh cannot leave a valid token after replay detection', async t => {
  const f = fixture(t), a = await f.authorize(), first = await f.exchange(a.code);
  const results = await Promise.allSettled([f.refresh(first.refresh_token), f.refresh(first.refresh_token)]);
  assert.ok(results.some(x => x.status === 'rejected'));
  for (const result of results) if (result.status === 'fulfilled') {
    assert.throws(() => f.core.verify(result.value.access_token, {resource, scope: 'task.read'}));
  }
});

test('refresh cannot widen a reduced scope and requires explicit consent', async t => {
  const f = fixture(t), a = await f.authorize(), first = await f.exchange(a.code);
  const narrowed = await f.refresh(first.refresh_token, {scope: 'task.read'});
  await assert.rejects(f.refresh(narrowed.refresh_token, {scope: 'task.read task.claim'}));
  const b = await f.authorize({}, {allowRefresh: false}), accessOnly = await f.exchange(b.code);
  assert.equal(accessOnly.refresh_token, undefined);
});

test('live membership version and node status revoke access and refresh before side effects', async t => {
  const f = fixture(t), a = await f.authorize(), first = await f.exchange(a.code);
  f.node.status = 'paused';
  assert.throws(() => f.core.verify(first.access_token, {resource, scope: 'task.read'}));
  await assert.rejects(f.refresh(first.refresh_token));
  f.node.status = 'active';
  f.store.setMembership(f.actor('alice', 'a'), {workspaceId: f.workspaces.a.id, userId: f.users.alice.id, role: 'owner'});
  assert.throws(() => f.core.verify(first.access_token, {resource, scope: 'task.read'}));
  await assert.rejects(f.refresh(first.refresh_token));
});

test('expiry, owner revocation and restore invalidation reject old credentials', async t => {
  const f = fixture(t), a = await f.authorize(), first = await f.exchange(a.code);
  f.advanceOAuth(300001);
  assert.throws(() => f.core.verify(first.access_token, {resource, scope: 'task.read'}));
  const next = await f.refresh(first.refresh_token);
  assert.throws(() => f.core.revokeGrant(f.actor('bob', 'b'), a.grantId));
  f.core.revokeGrant(f.actor('alice', 'a'), a.grantId);
  assert.throws(() => f.core.verify(next.access_token, {resource, scope: 'task.read'}));
  const b = await f.authorize(), second = await f.exchange(b.code);
  f.core.invalidateAll();
  await assert.rejects(f.refresh(second.refresh_token));
  assert.throws(() => f.core.verify(second.access_token, {resource, scope: 'task.read'}));
});

test('restart preserves hashed credentials and canonical issuer binding', async t => {
  const f = fixture(t, {confidential: true}), a = await f.authorize(), first = await f.exchange(a.code);
  const rows = ['oauth_clients', 'oauth_grants', 'oauth_codes', 'oauth_tokens'].flatMap(table => f.db.prepare(`SELECT * FROM ${table}`).all());
  const serialized = JSON.stringify(rows);
  for (const secret of [f.client.secret, a.code, first.access_token, first.refresh_token, verifier]) {
    assert.ok(!serialized.includes(secret), 'raw secret must not be persisted');
  }
  const {createOAuthCore} = require('../identity/oauth-core.cjs');
  const reopened = createOAuthCore(f.config);
  reopened.verify(first.access_token, {resource, scope: 'task.read'});
  assert.throws(() => createOAuthCore({...f.config, issuer: 'https://other.example.test'}));
});

test('schema installer refuses production identity databases and unknown schema', t => {
  const f = fixture(t), {installIsolatedOAuthSchema} = require('../identity/oauth-schema.cjs');
  const identityDb = new Database(f.dbPath);
  try {assert.throws(() => installIsolatedOAuthSchema(identityDb));} finally {identityDb.close();}
  f.db.prepare('UPDATE oauth_meta SET version=99').run();
  assert.throws(() => installIsolatedOAuthSchema(f.db));
});

test('client count, HTTPS redirect and scope admission remain bounded', t => {
  const f = fixture(t);
  for (const uri of ['http://client.example.test/cb', redirectUri + '#fragment', 'https://user:pass@client.example.test/cb', 'https://*.example.test/cb']) {
    assert.throws(() => f.core.registerClient({id: 'bad-client', redirectUris: [uri], authentication: 'none'}));
  }
  for (let n = 1; n < 32; n++) f.core.registerClient({id: `client-${n}`, redirectUris: [redirectUri], authentication: 'none'});
  assert.throws(() => f.core.registerClient({id: 'client-overflow', redirectUris: [redirectUri], authentication: 'none'}));
});
