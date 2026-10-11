'use strict';
// Own a separate process: an intentionally retained writer lease must not be
// manually released in a running runtime just to let the fixture clean up.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const [entry, root, mode] = process.argv.slice(2);
  const config = JSON.parse(fs.readFileSync(path.join(root, 'config', 'lack.config.json'), 'utf8'));
  const issuer = config.identity.oidc.issuer;
  const module = require(path.join(path.dirname(entry), '..', 'identity', 'oidc.cjs'));
  const original = module.createOidcLogin;
  let oidc, release, reading, outcome;
  const held = new Promise(resolve => {release = resolve;});
  const started = new Promise(resolve => {reading = resolve;});
  const metadata = {issuer, authorization_endpoint: issuer + '/authorize', token_endpoint: issuer + '/token',
    jwks_uri: issuer + '/jwks', response_types_supported: ['code'], subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'], code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic'], authorization_response_iss_parameter_supported: true};
  module.createOidcLogin = async options => {
    oidc = await original({...options, fetchImpl: async url => {
      if (String(url).endsWith('/.well-known/openid-configuration')) return Response.json(metadata);
      assert.equal(String(url), issuer + '/token');
      return new Response(new ReadableStream({
        start(controller) {controller.enqueue(Buffer.from('{'));},
        pull() {reading();},
        cancel() {return held;}
      }), {headers: {'content-type': 'application/json'}});
    }});
    return oidc;
  };
  async function exchange() {
    const start = await oidc.begin({source: 'packaged-uncooperative-body'});
    const url = new URL(config.publicRuntime.webOrigin + '/auth/oidc/callback');
    url.search = new URLSearchParams({state: new URL(start.url).searchParams.get('state'), code: 'synthetic', iss: issuer});
    outcome = oidc.finish({url, browserToken: start.browserToken}).catch(error => error);
    await started;
  }
  const {startPublicRuntime} = require(entry), lock = path.join(root, '.public-runtime.lock');
  let originalLock;
  try {
    if (mode === 'rollback') {
      await assert.rejects(startPublicRuntime({config, dataRoot: root, startMcp: async () => {
        originalLock = fs.readFileSync(lock, 'utf8');
        await exchange(); throw Error('synthetic_mcp_failure');
      }}), {code: 'public_startup_cleanup_incomplete'});
    } else {
      const runtime = await startPublicRuntime({config, dataRoot: root});
      originalLock = fs.readFileSync(lock, 'utf8');
      await exchange();
      await assert.rejects(runtime.close(), {code: 'public_shutdown_incomplete'});
    }
    assert.equal(fs.readFileSync(lock, 'utf8'), originalLock);
    await assert.rejects(startPublicRuntime({config, dataRoot: root}), {code: 'public_writer_locked'});
    release();
    assert.equal((await outcome).code, 'oidc_login_failed');
    await oidc.close();
    // A later drain does not silently turn failed runtime teardown into release.
    assert.equal(fs.readFileSync(lock, 'utf8'), originalLock);
    await assert.rejects(startPublicRuntime({config, dataRoot: root}), {code: 'public_writer_locked'});
    console.log('OIDC_DRAIN_LOCK_RETAINED=' + mode);
  } finally {release(); await outcome; await oidc?.close();}
}
main().then(() => process.exit(0), error => {console.error(error); process.exit(1);});
