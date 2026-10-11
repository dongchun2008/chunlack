'use strict';
const {randomBytes, createHash, timingSafeEqual} = require('node:crypto');
const {IdentityError} = require('./policy.cjs');
const {createAdmission} = require('./admission.cjs');
const opaque = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const digest = value => createHash('sha256').update(value).digest();
const fail = (code, status = 401) => new IdentityError(code, status);

// No I/O on import. Only an explicitly enabled, privately configured RP starts discovery.
async function createOidcLogin({config, webOrigin, env = process.env, fetchImpl = globalThis.fetch, now = Date.now} = {}) {
  if (config?.enabled !== true) return null;
  let issuer, redirectUri, secret;
  try {
    issuer = new URL(config.issuer);
    const web = new URL(webOrigin);
    if (issuer.protocol !== 'https:' || issuer.origin !== config.issuer || issuer.username || issuer.password ||
        web.protocol !== 'https:' || web.origin !== webOrigin || web.username || web.password ||
        typeof config.clientId !== 'string' || !config.clientId || config.clientId.length > 256 ||
        /[\x00-\x20\x7f]/.test(config.clientId) || !/^[A-Z][A-Z0-9_]{0,127}$/.test(config.clientSecretEnv)) throw Error();
    secret = env[config.clientSecretEnv];
    if (typeof secret !== 'string' || !secret || secret.length > 4096 || /[\x00-\x1f\x7f]/.test(secret)) throw Error();
    redirectUri = webOrigin + '/auth/oidc/callback';
  } catch {throw fail('invalid_oidc_config', 503);}

  const trusted = value => {
    const url = new URL(value);
    if (url.origin !== issuer.origin || url.username || url.password || url.search || url.hash) throw Error('untrusted_endpoint');
    return url;
  };
  const boundedFetch = async (url, options = {}) => {
    trusted(String(url));
    const timeout = AbortSignal.timeout(15000);
    const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
    const response = await fetchImpl(url, {...options, redirect: 'error', signal});
    if (response.status !== 200 || Number(response.headers.get('content-length')) > 262144 || !response.body) {
      await response.body?.cancel(); throw Error('issuer_response_rejected');
    }
    const reader = response.body.getReader(), chunks = []; let bytes = 0;
    const abort = () => {reader.cancel().catch(() => {});};
    signal.addEventListener('abort', abort, {once: true});
    try {
      while (true) {
        signal.throwIfAborted();
        const {done, value} = await reader.read();
        signal.throwIfAborted();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 262144) {await reader.cancel(); throw Error('issuer_response_too_large');}
        chunks.push(value);
      }
      return new Response(Buffer.concat(chunks), {status: response.status, headers: response.headers});
    } finally {signal.removeEventListener('abort', abort); reader.releaseLock();}
  };
  let client, configuration;
  try {
    client = await import('openid-client');
    configuration = await client.discovery(issuer, config.clientId, {id_token_signed_response_alg: 'RS256'}, client.ClientSecretBasic(secret), {
      [client.customFetch]: boundedFetch, timeout: 15, execute: [client.enableNonRepudiationChecks]
    });
    const metadata = configuration.serverMetadata();
    if (metadata.issuer !== config.issuer || !metadata.code_challenge_methods_supported?.includes('S256') ||
        !metadata.response_types_supported?.includes('code') || !metadata.id_token_signing_alg_values_supported?.includes('RS256') ||
        !metadata.token_endpoint_auth_methods_supported?.includes('client_secret_basic')) throw Error('issuer_capability_missing');
    for (const key of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) trusted(metadata[key]);
  } catch {throw fail('oidc_unavailable', 503);}

  const pending = new Map(), proofs = new WeakMap(), admission = createAdmission({now});
  let closed = false, inFlight = 0;
  function clock() {
    if (closed) throw fail('service_closed', 503);
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0) throw fail('invalid_clock', 503);
    return value;
  }
  function prune(time) {for (const [state, row] of pending) if (time >= row.expiresAt || time < row.createdAt) pending.delete(state);}
  return Object.freeze({
    async begin({source}) {
      const time = clock(); prune(time);
      const release = admission.enter({source, login: 'oidc:' + String(source).slice(0, 200)});
      try {
        if (pending.size >= 32) throw fail('rate_limited', 429);
        const state = randomBytes(32).toString('base64url'), browserToken = randomBytes(32).toString('base64url');
        const row = {createdAt: time, expiresAt: time + 300000, browserHash: digest(browserToken),
          nonce: client.randomNonce(), verifier: client.randomPKCECodeVerifier()};
        pending.set(state, row);
        try {
          const challenge = await client.calculatePKCECodeChallenge(row.verifier); clock();
          const url = client.buildAuthorizationUrl(configuration, {redirect_uri: redirectUri, scope: 'openid profile email',
            code_challenge: challenge, code_challenge_method: 'S256', state, nonce: row.nonce});
          return {url: url.href, browserToken};
        } catch (error) {pending.delete(state); throw error;}
      } finally {release();}
    },
    async finish({url, browserToken}) {
      const time = clock(); prune(time);
      let callback;
      try {
        callback = new URL(url);
        if (callback.origin + callback.pathname !== redirectUri || callback.hash || callback.href.length > 8192 ||
            callback.username || callback.password || !opaque(browserToken)) throw Error();
        const allowed = new Set(['state', 'code', 'iss', 'error', 'error_description', 'error_uri']);
        for (const key of callback.searchParams.keys()) if (!allowed.has(key) || callback.searchParams.getAll(key).length !== 1) throw Error();
        if (!opaque(callback.searchParams.get('state')) || callback.searchParams.get('iss') !== config.issuer) throw Error();
      } catch {throw fail('unauthorized');}
      const state = callback.searchParams.get('state'), row = pending.get(state);
      if (!row || !timingSafeEqual(row.browserHash, digest(browserToken))) throw fail('unauthorized');
      if (inFlight >= 2) throw fail('rate_limited', 429);
      pending.delete(state); inFlight++;
      try {
        const tokens = await client.authorizationCodeGrant(configuration, callback, {
          pkceCodeVerifier: row.verifier, expectedNonce: row.nonce, expectedState: state, idTokenExpected: true
        });
        const time = clock(), claims = tokens.claims();
        if (time >= row.expiresAt || time < row.createdAt || claims?.iss !== config.issuer ||
            typeof claims.sub !== 'string' || !/^[\x21-\x7e]{1,255}$/.test(claims.sub)) throw Error();
        // Never return or persist the provider access/refresh/ID tokens.
        const proof = Object.freeze({});
        proofs.set(proof, {issuer: claims.iss, sub: claims.sub, createdAt: time, expiresAt: time + 30000});
        return proof;
      } catch {throw fail('oidc_login_failed');}
      finally {inFlight--;}
    },
    consume(proof) {
      const time = clock(), row = proofs.get(proof); proofs.delete(proof);
      if (!row || time >= row.expiresAt || time < row.createdAt) throw fail('unauthorized');
      return {issuer: row.issuer, sub: row.sub};
    },
    close() {closed = true; pending.clear();}
  });
}
module.exports = {createOidcLogin};
