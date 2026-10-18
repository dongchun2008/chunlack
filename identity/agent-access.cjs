'use strict';
const {IdentityError} = require('./policy.cjs');
const SCOPES = Object.freeze(['task.read', 'task.claim', 'task.result', 'events.read', 'events.subscribe']);
const fail = (code = 'invalid_token', status = 401) => new IdentityError(code, status);
const clean = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\x00-\x20\x7f]/.test(value);

// Identity evidence only: no node credentials, sessions, grants or listeners.
// The caller must separately bind this evidence to current local authority.
async function createAgentAccessVerifier({config, fetchImpl = globalThis.fetch, now = Date.now} = {}) {
  if (config?.discoveryOnly !== undefined && typeof config.discoveryOnly !== 'boolean' ||
      config?.discoveryOnly === true && config?.enabled !== true) throw fail('invalid_agent_access_config', 503);
  if (config?.enabled !== true) return null;
  const discoveryOnly = config.discoveryOnly === true;
  let issuer, resource, jwks, clients;
  try {
    const canonical = value => {
      const url = new URL(value);
      if (!clean(value, 2048) || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw Error();
      return url;
    };
    issuer = canonical(config.issuer); resource = canonical(config.resource); jwks = canonical(config.jwksUri);
    if (issuer.origin !== config.issuer || resource.href !== config.resource ||
        jwks.href !== config.jwksUri || jwks.origin !== issuer.origin ||
        !clean(config.browserClientId, 256) || !Array.isArray(config.clientIds) ||
        (discoveryOnly && config.clientIds.length !== 0) || config.clientIds.length > 32 ||
        config.clientIds.some(id => !clean(id, 256) || id === config.browserClientId) ||
        new Set(config.clientIds).size !== config.clientIds.length ||
        typeof fetchImpl !== 'function' || typeof now !== 'function') throw Error();
    clients = new Set(config.clientIds);
  } catch {throw fail('invalid_agent_access_config', 503);}
  // Enrollment and an empty allowlist both fail closed without fetching keys.
  // Caller mutation cannot make this immutable instance usable for access.
  if (discoveryOnly || clients.size === 0) {
    let closed = false;
    const deny = () => {throw closed ? fail('service_closed', 503) : fail();};
    return Object.freeze({async verify() {deny();}, consume() {deny();}, async close() {closed = true;}});
  }
  const jose = await import('jose');
  const controller = new AbortController(), operations = new Set();
  let closed = false, closing, active = 0, nextFetchAt = 0, proofs = new WeakMap(), rate = {minute: -1, count: 0};
  function clock() {
    if (closed) throw fail('service_closed', 503);
    const time = now();
    if (!Number.isSafeInteger(time) || time < 0) throw fail('invalid_clock', 503);
    return time;
  }
  function validateKeys(value) {
    if (!value || !Array.isArray(value.keys) || !value.keys.length || value.keys.length > 8) throw Error();
    const seen = new Set();
    for (const key of value.keys) {
      if (!key || key.kty !== 'RSA' || !clean(key.kid, 128) || seen.has(key.kid) ||
          key.alg !== undefined && key.alg !== 'RS256' || key.use !== undefined && key.use !== 'sig' ||
          key.key_ops !== undefined && (!Array.isArray(key.key_ops) || key.key_ops.length !== 1 || key.key_ops[0] !== 'verify') ||
          ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'].some(field => Object.hasOwn(key, field)) ||
          typeof key.n !== 'string' || !/^[A-Za-z0-9_-]{342,683}$/.test(key.n) ||
          typeof key.e !== 'string' || !/^[A-Za-z0-9_-]{1,8}$/.test(key.e)) throw Error();
      const modulus = Buffer.from(key.n, 'base64url');
      const bits = (modulus.length - 1) * 8 + 32 - Math.clz32(modulus[0]);
      if (!modulus[0] || bits < 2048 || bits > 4096) throw Error();
      seen.add(key.kid);
    }
    return value;
  }
  async function boundedFetch(url, options) {
    if (String(url) !== jwks.href || closed) throw Error();
    // JOSE cools down successful refreshes; failed attempts must be bounded too.
    const time = clock();
    if (time < nextFetchAt) throw Error();
    nextFetchAt = time + 30000;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(3000), options.signal]);
    signal.throwIfAborted();
    const response = await fetchImpl(url, {...options, method: 'GET', redirect: 'error', credentials: 'omit', signal});
    if (signal.aborted || response.status !== 200 || !response.body ||
        Number(response.headers.get('content-length')) > 65536) {
      await response.body?.cancel(); throw Error();
    }
    const reader = response.body.getReader(), chunks = [];
    let size = 0, done = false, cancellation;
    const cancel = () => cancellation || (cancellation = Promise.resolve().then(() => reader.cancel()).catch(() => {}));
    const abort = () => {void cancel();};
    signal.addEventListener('abort', abort, {once: true});
    try {
      while (!done) {
        signal.throwIfAborted();
        const item = await reader.read(); signal.throwIfAborted(); done = item.done;
        if (done) break;
        size += item.value.byteLength;
        if (size > 65536) throw Error();
        chunks.push(item.value);
      }
      const value = validateKeys(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      return Response.json(value);
    } finally {
      signal.removeEventListener('abort', abort);
      if (!done) await cancel();
      await cancellation; reader.releaseLock();
    }
  }
  const keySet = jose.createRemoteJWKSet(jwks, {
    [jose.customFetch]: boundedFetch, timeoutDuration: 3000,
    cooldownDuration: 30000, cacheMaxAge: 300000
  });
  function facts(payload, scope) {
    if (typeof payload.sub !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.sub) ||
        !clients.has(payload.client_id) || !clean(payload.jti, 128) ||
        !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) ||
        payload.exp <= payload.iat || payload.exp - payload.iat > 3600 ||
        typeof payload.scope !== 'string' || payload.scope.length > 1024 ||
        !/^[\x21\x23-\x5b\x5d-\x7e]+(?: [\x21\x23-\x5b\x5d-\x7e]+)*$/.test(payload.scope)) throw fail();
    const requested = payload.scope.split(' ');
    if (requested.length > 32 || new Set(requested).size !== requested.length || !requested.includes('openid')) throw fail();
    if (!requested.includes(scope)) throw fail('insufficient_scope', 403);
    return Object.freeze({issuer: issuer.origin, subject: payload.sub, clientId: payload.client_id,
      resource: resource.href, scopes: Object.freeze(SCOPES.filter(item => requested.includes(item))),
      issuedAt: payload.iat, expiresAt: payload.exp, tokenId: payload.jti});
  }
  return Object.freeze({
    async verify(token, {scope} = {}) {
      const time = clock(), minute = Math.floor(time / 60000);
      if (!SCOPES.includes(scope)) throw fail('invalid_scope', 400);
      if (rate.minute !== minute) rate = {minute, count: 0};
      if (active >= 4 || rate.count >= 120) throw fail('rate_limited', 429);
      rate.count++;
      if (typeof token !== 'string' || token.length > 8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw fail();
      let header;
      try {header = jose.decodeProtectedHeader(token);} catch {throw fail();}
      if (header.alg !== 'RS256' || header.typ !== 'at+jwt' || !clean(header.kid, 128) ||
          ['jku', 'jwk', 'x5u', 'x5c', 'crit', 'b64'].some(field => Object.hasOwn(header, field))) throw fail();
      active++;
      const operation = (async () => {
        const {payload} = await jose.jwtVerify(token, keySet, {
          algorithms: ['RS256'], typ: 'at+jwt', issuer: issuer.origin, audience: resource.href,
          requiredClaims: ['iss', 'sub', 'aud', 'exp', 'iat', 'jti', 'client_id', 'scope'],
          currentDate: new Date(time), clockTolerance: 5, maxTokenAge: 3600
        });
        const evidence = facts(payload, scope);
        if (Math.floor(clock() / 1000) >= evidence.expiresAt) throw fail();
        const proof = Object.freeze({}); proofs.set(proof, evidence); return proof;
      })();
      operations.add(operation);
      try {return await operation;}
      catch (error) {
        if (closed) throw fail('service_closed', 503);
        if (error instanceof IdentityError && error.code === 'insufficient_scope') throw error;
        throw fail();
      } finally {active--; operations.delete(operation);}
    },
    consume(proof) {
      const time = clock(), evidence = proofs.get(proof);
      if (!evidence) throw fail();
      proofs.delete(proof);
      if (Math.floor(time / 1000) >= evidence.expiresAt) throw fail();
      return evidence;
    },
    close() {
      if (closing) return closing;
      closed = true; proofs = new WeakMap(); controller.abort();
      closing = Promise.allSettled([...operations]).then(() => {});
      return closing;
    }
  });
}
module.exports = {createAgentAccessVerifier};
