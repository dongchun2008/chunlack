'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const express = require('express');
const Database = require('better-sqlite3');
const {workspaceFixture, throwsCode} = require('./helpers/workspace-fixture.cjs');
const issuer = 'https://pocket.example.test';
const webOrigin = 'https://lack.example.test';
const callback = webOrigin + '/auth/oidc/callback';
const cfg = {enabled: true, issuer, clientId: 'chunlack-test', clientSecretEnv: 'OIDC_TEST_SECRET'};
const env = {OIDC_TEST_SECRET: 'synthetic-client-secret-only'};

async function fixture(t, options = {}) {
  const {createOidcLogin} = require('../identity/oidc.cjs');
  const jose = await import('jose');
  const keys = await jose.generateKeyPair('RS256');
  const jwk = {...await jose.exportJWK(keys.publicKey), kid: 'fixture-key', alg: 'RS256', use: 'sig'};
  let auth, exchanges = 0, time = Date.now();
  const metadata = {issuer, authorization_endpoint: issuer + '/authorize', token_endpoint: issuer + '/token',
    jwks_uri: issuer + '/jwks', response_types_supported: ['code'], subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'], token_endpoint_auth_methods_supported: ['client_secret_basic'],
    code_challenge_methods_supported: ['S256'], authorization_response_iss_parameter_supported: true,
    ...options.metadata};
  const fetchImpl = async (url, init) => {
    assert.equal(init.redirect, 'error');
    if (String(url).endsWith('/.well-known/openid-configuration')) return Response.json(metadata);
    if (String(url) === issuer + '/jwks') return Response.json({keys: [jwk]});
    assert.equal(String(url), issuer + '/token'); exchanges++;
    const form = new URLSearchParams(init.body);
    assert.equal(form.get('redirect_uri'), callback);
    assert.equal(form.get('grant_type'), 'authorization_code');
    assert.equal(createHash('sha256').update(form.get('code_verifier')).digest('base64url'), auth.searchParams.get('code_challenge'));
    const headers = new Headers(init.headers);
    assert.match(headers.get('authorization'), /^Basic /);
    let claims = {iss: issuer, sub: 'pocket-alice', aud: cfg.clientId, iat: Math.floor(Date.now()/1000),
      exp: Math.floor(Date.now()/1000) + 60, nonce: auth.searchParams.get('nonce'), ...options.claims};
    const signing = options.badSignature ? (await jose.generateKeyPair('RS256')).privateKey : keys.privateKey;
    const id_token = await new jose.SignJWT(claims).setProtectedHeader({alg: 'RS256', kid: 'fixture-key'}).sign(signing);
    return Response.json({access_token: 'synthetic-access-token', token_type: 'Bearer', expires_in: 60, id_token});
  };
  const oidc = await createOidcLogin({config: cfg, webOrigin, env, fetchImpl, now: () => time});
  t.after(() => oidc.close());
  async function begin() {const result = await oidc.begin({source: 'fixture'}); auth = new URL(result.url); return result;}
  function response(start, extra = {}) {
    const url = new URL(callback);
    url.search = new URLSearchParams({code: 'fixture-code', state: new URL(start.url).searchParams.get('state'), iss: issuer, ...extra});
    return url;
  }
  return {oidc, begin, response, advance: ms => {time += ms;}, exchanges: () => exchanges};
}

test('OIDC verifies PKCE and signed identity, then issues only a single-use opaque proof', async t => {
  const f = await fixture(t), start = await f.begin();
  assert.equal(new URL(start.url).searchParams.get('code_challenge_method'), 'S256');
  assert.equal(new URL(start.url).searchParams.get('scope'), 'openid profile email');
  const proof = await f.oidc.finish({url: f.response(start), browserToken: start.browserToken});
  assert.deepEqual(Object.keys(proof), []);
  assert.deepEqual(f.oidc.consume(proof), {issuer, sub: 'pocket-alice'});
  throwsCode(() => f.oidc.consume(proof), 'unauthorized');
  throwsCode(() => f.oidc.consume({issuer, sub: 'pocket-alice'}), 'unauthorized');
  await assert.rejects(f.oidc.finish({url: f.response(start), browserToken: start.browserToken}), {code: 'unauthorized'});
  assert.equal(f.exchanges(), 1);
});

for (const [name, options] of Object.entries({signature: {badSignature: true}, nonce: {claims: {nonce: 'wrong'}},
  audience: {claims: {aud: 'another-app'}}, issuer: {claims: {iss: 'https://evil.test'}}, expired: {claims: {exp: 1}}})) {
  test('OIDC denies invalid ' + name + ' without an authenticated identity', async t => {
    const f = await fixture(t, options), start = await f.begin();
    await assert.rejects(f.oidc.finish({url: f.response(start), browserToken: start.browserToken}), {code: 'oidc_login_failed'});
  });
}

test('OIDC denies wrong browser, expired state, duplicate query, cross-issuer callback and restart replay before exchange', async t => {
  const f = await fixture(t), start = await f.begin();
  for (const [url, browserToken] of [[f.response(start), 'x'.repeat(43)],
    [f.response(start, {iss: 'https://evil.test'}), start.browserToken],
    [new URL(f.response(start) + '&state=duplicate'), start.browserToken]]) {
    await assert.rejects(f.oidc.finish({url, browserToken}), {code: 'unauthorized'});
  }
  f.advance(300000);
  await assert.rejects(f.oidc.finish({url: f.response(start), browserToken: start.browserToken}), {code: 'unauthorized'});
  assert.equal(f.exchanges(), 0);
  const other = await fixture(t);
  await assert.rejects(other.oidc.finish({url: f.response(start), browserToken: start.browserToken}), {code: 'unauthorized'});
});

test('OIDC refuses unsafe metadata and disabled configuration makes no outbound request', async t => {
  const {createOidcLogin} = require('../identity/oidc.cjs');
  assert.equal(await createOidcLogin({config: {}, fetchImpl: () => {throw Error('network must not run');}}), null);
  for (const metadata of [{token_endpoint: 'https://evil.test/token'}, {jwks_uri: issuer + '/jwks?secret=1'},
    {issuer: 'https://evil.test'}, {code_challenge_methods_supported: ['plain']}]) {
    await assert.rejects(fixture(t, {metadata}), {code: 'oidc_unavailable'});
  }
  await assert.rejects(createOidcLogin({config: {...cfg, issuer: 'http://pocket.example.test'}, webOrigin, env}), {code: 'invalid_oidc_config'});
  await assert.rejects(createOidcLogin({config: cfg, webOrigin, env: {}}), {code: 'invalid_oidc_config'});
});

test('external identity binding persists, never merges by email, and unlink invalidates old sessions', async t => {
  const r = workspaceFixture(t), f = await fixture(t);
  const {createSessionService} = require('../identity/sessions.cjs');
  const sessions = createSessionService({store: r.store, oidc: f.oidc, now: r.now});
  t.after(() => sessions.close());
  const start = await f.begin(), proof = await f.oidc.finish({url: f.response(start), browserToken: start.browserToken});
  throwsCode(() => sessions.loginOidc({proof}), 'unauthorized');
  r.store.linkExternalIdentity({issuer, sub: 'pocket-alice', userId: r.users.alice.id});
  throwsCode(() => r.store.linkExternalIdentity({issuer, sub: 'pocket-alice', userId: r.users.bob.id}), 'identity_already_linked');
  assert.equal(r.open().resolveExternalIdentity({issuer, sub: 'pocket-alice'}).id, r.users.alice.id);
  const next = await f.begin();
  const auth = sessions.loginOidc({proof: await f.oidc.finish({url: f.response(next), browserToken: next.browserToken})});
  assert.equal(sessions.authenticate(auth.token).userId, r.users.alice.id);
  assert.deepEqual(r.store.listWorkspaces(auth.user.id).map(w => w.id), [r.workspaces.a.id]);
  r.store.unlinkExternalIdentity({issuer, sub: 'pocket-alice'});
  throwsCode(() => sessions.authenticate(auth.token), 'unauthorized');
  throwsCode(() => r.store.resolveExternalIdentity({issuer, sub: 'pocket-alice'}), 'unauthorized');
});

test('identity v1 migration is explicit and v2 classifies links for archive inventories', t => {
  const r = workspaceFixture(t); r.store.close();
  const db = new Database(r.dbPath);
  db.exec("DROP TABLE IF EXISTS external_identities; UPDATE schema_version SET version=1 WHERE component='identity'"); db.close();
  const {createIdentityStore, identityTableScopes} = require('../identity/store.cjs');
  throwsCode(() => createIdentityStore({dbPath: r.dbPath}), 'identity_migration_required');
  const store = r.own(createIdentityStore({dbPath: r.dbPath, migrate: true}));
  store.linkExternalIdentity({issuer, sub: 'pocket-alice', userId: r.users.alice.id});
  assert.equal(identityTableScopes.external_identities, 'user');
  assert.equal(store.requireMembership(r.users.alice.id, r.workspaces.a.id).role, 'owner');
});

test('HTTP callback requires browser binding and returns a local session, not provider tokens', async t => {
  const r = workspaceFixture(t), f = await fixture(t);
  r.store.linkExternalIdentity({issuer, sub: 'pocket-alice', userId: r.users.alice.id});
  const sessions = require('../identity/sessions.cjs').createSessionService({store: r.store, oidc: f.oidc, now: r.now});
  const app = express();
  app.use(require('../identity/http.cjs').createIdentityRouter({store: r.store, sessions, webOrigin, oidc: f.oidc}));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {sessions.close(); await new Promise(resolve => server.close(resolve));});
  const base = 'http://127.0.0.1:' + server.address().port;
  const start = await fetch(base + '/auth/oidc/begin', {method: 'POST', headers: {'content-type': 'application/json', origin: 'https://evil.test'}, body: '{}'});
  assert.equal(start.status, 403);
  // Prepare through the same provider to inspect the synthetic issuer's nonce/PKCE.
  const login = await f.begin(), url = f.response(login);
  const response = await fetch(base + url.pathname + url.search, {redirect: 'manual', headers: {cookie: '__Host-chunlack_oidc=' + login.browserToken}});
  assert.equal(response.status, 303); assert.equal(response.headers.get('location'), '/');
  const cookies = response.headers.getSetCookie(), session = cookies.find(c => c.startsWith('__Host-chunlack_session='));
  assert.ok(session); for (const flag of ['Secure', 'HttpOnly', 'SameSite=Lax', 'Path=/']) assert.ok(session.includes(flag));
  const me = await fetch(base + '/auth/me', {headers: {cookie: session.split(';')[0]}});
  const meBody = await me.json(); assert.equal(meBody.user.id, r.users.alice.id); assert.equal(meBody.access_token, undefined);
  const replay = await fetch(base + url.pathname + url.search, {redirect: 'manual', headers: {cookie: '__Host-chunlack_oidc=' + login.browserToken}});
  assert.equal(replay.status, 401);
  assert.equal((await fetch(base + '/auth/me?x=1')).status, 404);
});
