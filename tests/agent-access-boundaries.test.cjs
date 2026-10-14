'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {generateKeyPairSync, sign} = require('node:crypto');
const {createAgentAccessVerifier} = require('../identity/agent-access.cjs');

const issuer = 'https://pocket.example.test';
const resource = 'https://agents.example.test/mcp';
const subject = '0260c437-d400-41d4-8027-da545ff150f5';
const config = {enabled: true, issuer, resource, jwksUri: issuer + '/.well-known/jwks.json',
  clientIds: ['native-test-client'], browserClientId: 'human-login-client'};
let keys;
test.before(() => {
  keys = ['initial', 'rotated'].map(kid => {
    const pair = generateKeyPairSync('rsa', {modulusLength: 2048});
    return {...pair, jwk: {...pair.publicKey.export({format: 'jwk'}), kid, alg: 'RS256', use: 'sig'}};
  });
});
const deferred = () => {
  let resolve;
  const promise = new Promise(done => {resolve = done;});
  return {promise, resolve};
};
async function fixture(t, respond) {
  const originalNow = Date.now;
  let time = Math.floor(originalNow() / 60000) * 60000 + 1000;
  let calls = 0, handler = respond || (() => Response.json({keys: [keys[0].jwk]}));
  // JOSE's cache and the verifier's injected clock must advance together.
  Date.now = () => time;
  const service = await createAgentAccessVerifier({config, now: () => time,
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(String(url), config.jwksUri);
      assert.equal(options.redirect, 'error');
      return handler(options);
    }});
  t.after(async () => {try {await service.close();} finally {Date.now = originalNow;}});
  return {service, calls: () => calls, advance: ms => {time += ms;}, respond: value => {handler = value;},
    token: (claims = {}, keyIndex = 0, headers = {}) => {
      const iat = Math.floor(time / 1000);
      const head = {alg: 'RS256', typ: 'at+jwt', kid: keys[keyIndex].jwk.kid, ...headers};
      const body = {iss: issuer, sub: subject, aud: resource, iat, exp: iat + 600,
        jti: 'boundary-test-token', client_id: config.clientIds[0], scope: 'openid task.read', ...claims};
      const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
      const input = encode(head) + '.' + encode(body);
      return input + '.' + sign('RSA-SHA256', Buffer.from(input), keys[keyIndex].privateKey).toString('base64url');
    }};
}
const verify = (f, token = f.token()) => f.service.verify(token, {scope: 'task.read'});
const invalid = {code: 'invalid_token'};

test('signed subject must be a primitive UUID string, never coercible mutable evidence', async t => {
  const f = await fixture(t);
  for (const sub of [[subject], {value: subject}, null, 42, true, '', 'not-a-uuid']) {
    await assert.rejects(verify(f, f.token({sub})), invalid);
  }
  const evidence = f.service.consume(await verify(f));
  assert.equal(typeof evidence.subject, 'string');
  assert.equal(evidence.subject, subject);
  assert.ok(Object.isFrozen(evidence));
});

for (const failure of ['http', 'malformed']) {
  test('failed JWKS refresh is cooled down after a successful cache: ' + failure, async t => {
    const f = await fixture(t);
    f.service.consume(await verify(f));
    f.advance(31000);
    f.respond(() => failure === 'http' ? new Response('', {status: 503}) : Response.json({keys: []}));
    const rotated = f.token({}, 1);
    await assert.rejects(verify(f, rotated), invalid);
    await assert.rejects(verify(f, rotated), invalid);
    assert.equal(f.calls(), 2, 'one initial fetch and only one failed refresh');
    f.respond(() => Response.json({keys: [keys[1].jwk]}));
    f.advance(29999);
    await assert.rejects(verify(f, rotated), invalid);
    assert.equal(f.calls(), 2);
    f.advance(1);
    f.service.consume(await verify(f, rotated));
    assert.equal(f.calls(), 3, 'recovery at the next attempt boundary');
  });
}

test('cold JWKS failure shares one attempt and suppresses immediate retries', async t => {
  const gate = deferred();
  const f = await fixture(t, async () => {await gate.promise; return new Response('', {status: 503});});
  const attempts = Array.from({length: 4}, () => assert.rejects(verify(f), invalid));
  gate.resolve();
  await Promise.all(attempts);
  assert.equal(f.calls(), 1);
  await assert.rejects(verify(f), invalid);
  assert.equal(f.calls(), 1);
  f.advance(30000);
  f.respond(() => Response.json({keys: [keys[0].jwk]}));
  f.service.consume(await verify(f));
  assert.equal(f.calls(), 2);
});

test('key rotation respects cooldown then refreshes once', async t => {
  const f = await fixture(t);
  f.service.consume(await verify(f));
  f.respond(() => Response.json({keys: [keys[1].jwk]}));
  const rotated = f.token({}, 1);
  await assert.rejects(verify(f, rotated), invalid);
  assert.equal(f.calls(), 1);
  f.advance(30001);
  const proofs = await Promise.all(Array.from({length: 4}, () => verify(f, rotated)));
  for (const proof of proofs) f.service.consume(proof);
  assert.equal(f.calls(), 2);
  await assert.rejects(verify(f, f.token()), invalid);
  assert.equal(f.calls(), 2, 'removed key cannot trigger an immediate refresh');
});

test('removed keys expire from cache; outage never extends stale-key acceptance', async t => {
  const f = await fixture(t);
  const initial = f.token();
  f.service.consume(await verify(f, initial));
  f.respond(() => new Response('', {status: 503}));
  f.advance(299999);
  f.service.consume(await verify(f, initial));
  assert.equal(f.calls(), 1, 'documented cache window is not immediate issuer revocation');
  f.advance(2);
  await assert.rejects(verify(f, initial), invalid);
  await assert.rejects(verify(f, initial), invalid);
  assert.equal(f.calls(), 2);
  f.respond(() => Response.json({keys: [keys[1].jwk]}));
  f.advance(30000);
  f.service.consume(await verify(f, f.token({}, 1)));
  await assert.rejects(verify(f, initial), invalid);
  assert.equal(f.calls(), 3);
});

test('body-stage timeout cancels a stalled JWKS body and does not issue proof', {timeout: 10000}, async t => {
  let cancelled = false;
  const f = await fixture(t, () => new Response(new ReadableStream({cancel() {cancelled = true;}})));
  const keepAlive = setInterval(() => {}, 100);
  try {await assert.rejects(verify(f), invalid);} finally {clearInterval(keepAlive);}
  assert.equal(cancelled, true);
  assert.equal(f.calls(), 1);
});

test('close waits for asynchronous body cancellation and is idempotent', {timeout: 10000}, async t => {
  const pulled = deferred(), cancelling = deferred(), release = deferred();
  const f = await fixture(t, () => new Response(new ReadableStream({
    pull() {pulled.resolve();},
    cancel() {cancelling.resolve(); return release.promise;}
  })));
  const pending = assert.rejects(verify(f), {code: 'service_closed'});
  await pulled.promise;
  let settled = false;
  const closing = f.service.close();
  closing.then(() => {settled = true;});
  try {
    assert.equal(f.service.close(), closing);
    await cancelling.promise;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(settled, false, 'close must not release authority before cancellation settles');
  } finally {release.resolve();}
  await Promise.all([pending, closing]);
  assert.equal(settled, true);
  await assert.rejects(verify(f), {code: 'service_closed'});
});

test('120 malformed attempts exhaust the global minute budget; next minute resets', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 120; i++) await assert.rejects(verify(f, 'malformed'), invalid);
  await assert.rejects(verify(f), {code: 'rate_limited'});
  assert.equal(f.calls(), 0);
  f.advance(60000);
  f.service.consume(await verify(f));
  assert.equal(f.calls(), 1);
});

test('opaque evidence cannot cross verifier instances', async t => {
  const f = await fixture(t);
  const other = await createAgentAccessVerifier({config, fetchImpl: () => {throw Error('unexpected network');}});
  t.after(() => other.close());
  const proof = await verify(f);
  assert.throws(() => other.consume(proof), invalid);
  assert.equal(f.service.consume(proof).subject, subject);
});

test('audience matching is exact; a valid multi-audience array is supported', async t => {
  const f = await fixture(t);
  for (const aud of [resource + '/', [], [resource + '/'], {value: resource}, 42, null]) {
    await assert.rejects(verify(f, f.token({aud})), invalid);
  }
  f.service.consume(await verify(f, f.token({aud: [resource, 'https://another.example.test/mcp']})));
});

test('token-supplied key locations and critical header overrides are rejected before fetch', async t => {
  const f = await fixture(t);
  for (const field of ['jku', 'jwk', 'x5u', 'x5c', 'crit', 'b64']) {
    await assert.rejects(verify(f, f.token({}, 0, {[field]: null})), invalid);
  }
  assert.equal(f.calls(), 0);
});

for (const bits of [2047, 4097]) {
  test('JWKS modulus outside the allowed bit range is rejected: ' + bits, async t => {
    const modulus = Buffer.alloc(Math.ceil(bits / 8), 255);
    modulus[0] = (1 << ((bits - 1) % 8 + 1)) - 1;
    const f = await fixture(t, () => Response.json({keys: [{...keys[0].jwk, n: modulus.toString('base64url')}]}));
    await assert.rejects(verify(f), invalid);
    assert.equal(f.calls(), 1);
  });
}
