'use strict';
// Reproductions of the disclosed lifecycle and cross-tab authentication defects.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const {workspaceFixture} = require('./helpers/workspace-fixture.cjs');
const {createOidcLogin} = require('../identity/oidc.cjs');
const {createSessionService} = require('../identity/sessions.cjs');
const {createIdentityRouter} = require('../identity/http.cjs');
const issuer = 'https://pocket-review.example.test', webOrigin = 'https://lack-review.example.test';
const clientId = 'review-client';

function deferred() {
  let resolve;
  const promise = new Promise(done => {resolve = done;});
  return {promise, resolve};
}

async function provider(t, {uncooperative = false} = {}) {
  const jose = await import('jose');
  const {privateKey, publicKey} = await jose.generateKeyPair('RS256');
  const jwk = {...await jose.exportJWK(publicKey), kid: 'review-key', use: 'sig', alg: 'RS256'};
  const reached = deferred(), release = deferred();
  let authorization, exchangeSignal;
  const metadata = {issuer, authorization_endpoint: issuer + '/authorize', token_endpoint: issuer + '/token',
    jwks_uri: issuer + '/jwks', response_types_supported: ['code'], subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'], code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic'], authorization_response_iss_parameter_supported: true};
  const oidc = await createOidcLogin({config: {enabled: true, issuer, clientId, clientSecretEnv: 'OIDC_REVIEW_SECRET'},
    webOrigin, env: {OIDC_REVIEW_SECRET: 'synthetic-review-secret'}, fetchImpl: async (url, options) => {
      if (String(url).endsWith('/.well-known/openid-configuration')) return Response.json(metadata);
      if (String(url) === issuer + '/jwks') return Response.json({keys: [jwk]});
      assert.equal(String(url), issuer + '/token');
      exchangeSignal = options.signal; reached.resolve();
      // A cooperative but stalled upstream request, with real cancellation semantics.
      await new Promise((resolve, reject) => {
        const abort = () => reject(options.signal.reason);
        if (options.signal.aborted) {abort(); return;}
        if (!uncooperative) options.signal.addEventListener('abort', abort, {once: true});
        release.promise.then(() => {options.signal.removeEventListener('abort', abort); resolve();});
      });
      const seconds = Math.floor(Date.now() / 1000);
      const id_token = await new jose.SignJWT({iss: issuer, sub: 'alice-subject', aud: clientId,
        iat: seconds, exp: seconds + 60, nonce: authorization.searchParams.get('nonce')})
        .setProtectedHeader({alg: 'RS256', kid: 'review-key'}).sign(privateKey);
      return Response.json({id_token, access_token: 'synthetic-review-access', token_type: 'Bearer', expires_in: 60});
    }});
  t.after(() => {release.resolve(); return oidc.close();});
  function callback(url) {
    authorization = new URL(url);
    const response = new URL(webOrigin + '/auth/oidc/callback');
    response.search = new URLSearchParams({code: 'synthetic-code', state: authorization.searchParams.get('state'), iss: issuer});
    return response;
  }
  return {oidc, callback, reached: reached.promise, release: release.resolve, signal: () => exchangeSignal};
}

test('OIDC close aborts an already-started cooperative token request before reporting completion', {timeout: 10000}, async t => {
  const f = await provider(t), start = await f.oidc.begin({source: 'review-close'});
  const exchange = f.oidc.finish({url: f.callback(start.url), browserToken: start.browserToken});
  // Attach rejection handling immediately; the cancellation must not become an
  // unhandled rejection, even when the product correctly cancels this request.
  const outcome = exchange.then(value => ({value}), error => ({error}));
  await f.reached;
  try {
    await f.oidc.close();
    assert.equal(f.signal().aborted, true, 'close returned while the upstream exchange still had a live signal');
    assert.ok((await outcome).error, 'closed OIDC service must not issue an identity proof');
  } finally {f.release(); await outcome;}
});

test('OIDC close reports an uncooperative request instead of falsely declaring shutdown complete', {timeout:10000}, async t=>{
  const f=await provider(t,{uncooperative:true}),start=await f.oidc.begin({source:'uncooperative'});
  const outcome=f.oidc.finish({url:f.callback(start.url),browserToken:start.browserToken}).catch(error=>error);
  await f.reached;
  try{await assert.rejects(f.oidc.close(),{code:'oidc_shutdown_incomplete'});assert.equal(f.signal().aborted,true);}
  finally{f.release();assert.equal((await outcome).code,'oidc_login_failed');await f.oidc.close();}
});

test('a second begin reuses browser binding and cancels the older attempt', async t=>{
  const f=await provider(t),first=await f.oidc.begin({source:'two-tabs'});
  const oldCallback=f.callback(first.url);
  const second=await f.oidc.begin({source:'two-tabs',browserToken:first.browserToken});
  assert.equal(second.browserToken,first.browserToken);
  await assert.rejects(f.oidc.finish({url:oldCallback,browserToken:first.browserToken}),{code:'unauthorized'});
  f.release();
  const proof=await f.oidc.finish({url:f.callback(second.url),browserToken:second.browserToken});
  f.oidc.authenticationChanged(second.browserToken);
  assert.throws(()=>f.oidc.consume(proof),{code:'unauthorized'});
});

test('newer browser login revokes an already issued older session without retaining bearer tokens',async t=>{
  const r=workspaceFixture(t),f=await provider(t),start=await f.oidc.begin({source:'late-response'});
  r.store.linkExternalIdentity({issuer,sub:'alice-subject',userId:r.users.alice.id});
  const sessions=createSessionService({store:r.store,oidc:f.oidc,now:r.now});t.after(()=>sessions.close());
  f.release();
  const auth=sessions.loginOidc({proof:await f.oidc.finish({url:f.callback(start.url),browserToken:start.browserToken})});
  sessions.browserAuthenticationChanged(start.browserToken,auth.sessionId);
  assert.equal(sessions.authenticate(auth.token).userId,r.users.alice.id);
  sessions.browserAuthenticationChanged(start.browserToken,'new-server-owned-session-id');
  assert.throws(()=>sessions.authenticate(auth.token),{code:'unauthorized'});
});

test('a delayed OIDC callback cannot overwrite a newer successful local login in the same browser', {timeout: 15000}, async t => {
  const password = 'synthetic-review-local-password';
  const hash = await require('../identity/passwords.cjs').hashPassword(password);
  const r = workspaceFixture(t, {passwordHash: hash}), f = await provider(t);
  r.store.linkExternalIdentity({issuer, sub: 'alice-subject', userId: r.users.alice.id});
  const sessions = createSessionService({store: r.store, oidc: f.oidc, now: r.now});
  const app = express(); app.use(createIdentityRouter({store: r.store, sessions, webOrigin, oidc: f.oidc}));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {sessions.close(); await new Promise(resolve => server.close(resolve));});
  const base = 'http://127.0.0.1:' + server.address().port, jar = new Map();
  function cookies() {return [...jar].map(([name, value]) => name + '=' + value).join('; ');}
  function acceptCookies(response) {
    for (const value of response.headers.getSetCookie()) {
      const pair = value.split(';')[0], index = pair.indexOf('='), name = pair.slice(0, index);
      if (/max-age=0/i.test(value)) jar.delete(name); else jar.set(name, pair.slice(index + 1));
    }
  }
  const started = await fetch(base + '/auth/oidc/begin', {method: 'POST', headers: {origin: webOrigin, 'content-type': 'application/json'}, body: '{}'});
  assert.equal(started.status, 200); acceptCookies(started);
  const cb = f.callback((await started.json()).url);
  const pending = fetch(base + cb.pathname + cb.search, {headers: {cookie: cookies()}, redirect: 'manual'});
  await f.reached;
  try {
    const local = await fetch(base + '/auth/login', {method: 'POST', headers: {cookie: cookies(), origin: webOrigin,
      'content-type': 'application/json'}, body: JSON.stringify({login: 'bob', password})});
    assert.equal(local.status, 200); acceptCookies(local);
    const localBody = await local.json(); assert.equal(localBody.user.id, r.users.bob.id);
    const bobToken = jar.get('__Host-chunlack_session');
    assert.equal(sessions.authenticate(bobToken).userId, r.users.bob.id);
    f.release();
    const callbackResponse = await pending;
    assert.ok([401, 409].includes(callbackResponse.status), 'stale identity callback must fail closed, got HTTP ' + callbackResponse.status);
    assert.equal(callbackResponse.headers.getSetCookie().some(value => value.startsWith('__Host-chunlack_session=')), false);
    assert.equal(sessions.authenticate(bobToken).userId, r.users.bob.id, 'the newer local login remains usable');
  } finally {f.release(); await pending;}
});
