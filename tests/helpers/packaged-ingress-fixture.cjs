'use strict';
// Actual generated application + actual TLS ingress, disposable data only.
// This is not a production browser rendering, real model or vendor-Agent test.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const https = require('node:https');
const {randomBytes} = require('node:crypto');
const {spawn, execFileSync} = require('node:child_process');
const {once} = require('node:events');
const {setTimeout: delay} = require('node:timers/promises');
const WebSocket = require('ws');
const Database = require('better-sqlite3');
const {createIdentityStore} = require('../../identity/store.cjs');
const {hashPassword} = require('../../identity/passwords.cjs');
const {createCollaborationStore} = require('../../collaboration/store.cjs');
const {renderPublicIngress} = require('../../deploy/public/render-ingress.cjs');
const root = path.resolve(__dirname, '../..');
const fixtureRoot = path.join(root, '.superpowers', 'sdd', '2026-10-09-multi-user-workspace-delivery', 'packaged-ingress-fixtures');
const credentials = Object.freeze({login: 'tls-owner', password: 'public-only-packaged-tls-fixture-password'});
async function freePort() {const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;}

const { createOwnedFixture } = require('./owned-fixture-lifecycle.cjs');
const { stopOwnedChild } = require('./owned-child-cleanup.cjs');

function createPackagedIngressFixture(options = {}) {
  return createOwnedFixture(options, signal => initializePackagedIngressFixture({ ...options, signal }));
}

async function initializePackagedIngressFixture({signal, caddyBin, threeHumans = false, configure}) {
  signal.throwIfAborted();
  let restarting;

  fs.mkdirSync(fixtureRoot, {recursive: true});
  const directory = fs.mkdtempSync(path.join(fixtureRoot, 'owned-'));
  const codeRoot = path.join(directory, 'package'), dataRoot = path.join(directory, 'data');
  const sockets = new Set(), received = new WeakMap(); let runtime, caddy, identity, collaboration, certificate;
  let closed = false, caddyOutput = '';
  const close = async () => {
    if (closed) return;
    closed = true;
    const failures = [];
    if (restarting) {
      try { await restarting; } catch (error) { if (error.name !== 'AbortError') failures.push(error.message); }
    }
    for (const socket of sockets) socket.terminate();
    signal.removeEventListener('abort', cancelSockets);
    if (caddy && caddy.exitCode === null && caddy.signalCode === null) {
      try {
        const ended = once(caddy, 'exit');
        caddy.kill('SIGTERM');
        await stopOwnedChild(caddy, ended, { graceMs: 3000, forceMs: 3000 });
      } catch (error) { failures.push(error.message); }
    }
    for (const item of [runtime, collaboration, identity]) {
      if (item) try { await item.close(); } catch (error) { failures.push(error.message); }
    }
    // Preserve diagnostic evidence if owned resources did not close.
    if (failures.length) throw new Error('Owned fixture close failed: ' + failures.join(', '));
    const absolute = path.resolve(directory);
    if (!absolute.startsWith(path.resolve(fixtureRoot) + path.sep)) throw new Error('Unsafe fixture cleanup target');
    fs.rmSync(absolute, { recursive: true, force: true });
  };
  function cancelSockets() { for (const socket of sockets) socket.terminate(); }
  signal.addEventListener('abort', cancelSockets, { once: true });


  const listenPort = await (signal.throwIfAborted(), freePort)(), webHost = 'lack.fixture.invalid', agentsHost = 'agents.fixture.invalid';
  const webOrigin = 'https://' + webHost, agentsOrigin = 'https://' + agentsHost;
  const request = (surface, requestPath, options = {}) => new Promise((resolve, reject) => {
    const host = surface === 'web' ? webHost : surface === 'agents' ? agentsHost : null;
    if (!host || typeof requestPath !== 'string' || !requestPath.startsWith('/')) return reject(new Error('Invalid fixture request'));
    if (options.bytes !== undefined && options.json !== undefined) return reject(new Error('Ambiguous fixture body'));
    const body = options.bytes === undefined ? options.json === undefined ? undefined : JSON.stringify(options.json) : Buffer.from(options.bytes);
    const headers = {Host: host, ...(body === undefined ? {} : {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body)}), ...options.headers};
    const outgoing = https.request({signal, host: '127.0.0.1', port: listenPort, servername: host, ca: certificate, rejectUnauthorized: true,
      method: options.method || 'GET', path: requestPath, headers, agent: false}, response => {
      const chunks = []; let size = 0;
      response.on('data', value => {size += value.length; if (size > 1024 * 1024) outgoing.destroy(new Error('Fixture response too large')); else chunks.push(value);});
      response.on('error', reject); response.on('end', () => {const bytes = Buffer.concat(chunks); resolve({status: response.statusCode, headers: response.headers, bytes, text: bytes.toString('utf8')});});
    });
    outgoing.setTimeout(5000, () => outgoing.destroy(new Error('Fixture HTTPS request timed out')));
    outgoing.on('error', reject); outgoing.end(body);
  });
  const login = async (account = credentials) => {
    const response = await request('web', '/auth/login', {method: 'POST', headers: {Origin: webOrigin}, json: account});
    if (response.status !== 200) throw new Error('Actual TLS login failed: ' + response.status + ' ' + response.text);
    const body = JSON.parse(response.text), cookie = response.headers['set-cookie']?.[0]?.split(';')[0];
    if (!cookie || !body.csrfToken) throw new Error('Actual TLS login returned incomplete identity');
    return {cookie, csrfToken: body.csrfToken};
  };
  const connect = async ({cookie, workspaceId}) => {
    signal.throwIfAborted();
    const socket = new WebSocket('wss://127.0.0.1:' + listenPort + '/ws/workspaces/' + workspaceId,
      {servername: webHost, ca: certificate, rejectUnauthorized: true, headers: {Host: webHost, Origin: webOrigin, Cookie: cookie}});
    sockets.add(socket); const frames = []; received.set(socket, frames);
    socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket));
    socket.on('message', value => {if (frames.length < 100) frames.push(JSON.parse(value.toString()));});
    let timer;
    try {await Promise.race([once(socket, 'open'), new Promise((_, reject) => {timer = setTimeout(() => reject(new Error('Owned WSS open timed out')), 5000);})]); return socket;}
    catch (error) {socket.terminate(); throw error;} finally {clearTimeout(timer);}
  };
  const frame = async (socket, predicate) => {
    signal.throwIfAborted();
    for (let i = 0; i < 100; i++) {const frames = received.get(socket); const index = frames.findIndex(predicate); if (index >= 0) return frames.splice(index, 1)[0]; await delay(30, undefined, { signal });}
    throw new Error('Actual TLS workspace frame not received');
  };

  try {
    (signal.throwIfAborted(), execFileSync)(process.env.PYTHON || 'python', ['scripts/materialize.py', '--output', codeRoot], {cwd: root, timeout: 10000, stdio: 'pipe'});
    fs.mkdirSync(path.join(dataRoot, 'db'), {recursive: true}); fs.mkdirSync(path.join(dataRoot, 'config'));
    identity = (signal.throwIfAborted(), createIdentityStore)({dbPath: path.join(dataRoot, 'db', 'identity.db')});
    const passwordHash = await hashPassword(credentials.password), owner = identity.createUser({login: credentials.login, passwordHash});
    const other = identity.createUser({login: 'other-tls-owner', passwordHash});
    const workspace = identity.createWorkspace({name: 'Actual TLS A', ownerId: owner.id}), otherWorkspace = identity.createWorkspace({name: 'Actual TLS B', ownerId: other.id});
    if (threeHumans) {
      const viewer = identity.createUser({login: 'viewer-tls-user', passwordHash});
      identity.setMembership(identity.requireMembership(owner.id, workspace.id), {workspaceId: workspace.id, userId: other.id, role: 'member'});
      identity.setMembership(identity.requireMembership(other.id, otherWorkspace.id), {workspaceId: otherWorkspace.id, userId: viewer.id, role: 'viewer'});
    }
    collaboration = new Database(path.join(dataRoot, 'db', 'lack.db'));
    createCollaborationStore({db: collaboration, identity});
    collaboration.close(); collaboration = null; identity.close(); identity = null;
    const config = JSON.parse(fs.readFileSync(path.join(codeRoot, 'config', 'lack.config.json'), 'utf8'));
    Object.assign(config, {httpPort: await (signal.throwIfAborted(), freePort)(), embeddingProvider: 'none', autoPullModels: false, jspaceEnabled: false,
      enableMusing: false, enableTriangulation: false, enablePublicMemory: false, agents: [], llmCloudProviders: [], llmProviders: [],
      multiUser: {enabled: true, migrationReady: true}, workspaceModelGrants: {},
      agentGateway: {enabled: true, port: await (signal.throwIfAborted(), freePort)(), adminTokenEnv: 'LACK_PACKAGED_TLS_FIXTURE_SECRET'},
      publicRuntime: {webOrigin, agentsOrigin, mcpPort: await (signal.throwIfAborted(), freePort)(), events: {enabled: false}}});
    if (configure !== undefined) {
      if (typeof configure !== 'function') throw new Error('invalid_fixture_configuration');
      configure({config, workspaceId: workspace.id, otherWorkspaceId: otherWorkspace.id});
    }
    (signal.throwIfAborted(), fs.writeFileSync)(path.join(dataRoot, 'config', 'lack.config.json'), JSON.stringify(config));
    const {startPublicRuntime} = require(path.join(codeRoot, 'gateway', 'public-runtime.cjs'));
    const runtimeEnv = {PATH: process.env.PATH, LACK_PACKAGED_TLS_FIXTURE_SECRET: randomBytes(48).toString('hex')};
    runtime = await (signal.throwIfAborted(), startPublicRuntime)({config, dataRoot, env: runtimeEnv});
    const restart = () => {
      signal.throwIfAborted();
      if (restarting) return restarting;
      restarting = (async () => {
        await runtime.close();
        runtime = null;
        signal.throwIfAborted();
        runtime = await startPublicRuntime({ config, dataRoot, env: runtimeEnv });
        signal.throwIfAborted();
      })().finally(() => { restarting = null; });
      return restarting;
    };
    const certFile = path.join(directory, 'fixture-cert.pem'), keyFile = path.join(directory, 'fixture-key.pem');
    const openssl = process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl';
    (signal.throwIfAborted(), execFileSync)(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-nodes', '-days', '1', '-keyout', keyFile, '-out', certFile,
      '-subj', '/CN=lack.fixture.invalid', '-addext', 'subjectAltName=DNS:lack.fixture.invalid,DNS:agents.fixture.invalid'], {timeout: 10000, stdio: 'pipe'});
    certificate = fs.readFileSync(certFile);
    const candidate = path.join(directory, 'Caddyfile');
    (signal.throwIfAborted(), fs.writeFileSync)(candidate, renderPublicIngress(config, {fixture: {listenPort, certFile, keyFile}}));
    const env = {...process.env, XDG_DATA_HOME: path.join(directory, 'caddy-data'), XDG_CONFIG_HOME: path.join(directory, 'caddy-config')};
    (signal.throwIfAborted(), execFileSync)(caddyBin, ['validate', '--config', candidate, '--adapter', 'caddyfile'], {env, timeout: 10000, stdio: 'pipe', windowsHide: true});
    caddy = (signal.throwIfAborted(), spawn)(caddyBin, ['run', '--config', candidate, '--adapter', 'caddyfile'], {env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    caddy.stdout.on('data', value => {caddyOutput = (caddyOutput + value).slice(-4000);}); caddy.stderr.on('data', value => {caddyOutput = (caddyOutput + value).slice(-4000);});
    let ready = false;
    for (let i = 0; i < 80; i++) {
      if (caddy.exitCode !== null) throw new Error('Owned Caddy exited: ' + caddyOutput);
      try {if ((await request('web', '/health')).status === 200) {ready = true; break;}} catch (error) {if (!['ECONNREFUSED', 'ECONNRESET'].includes(error.code)) throw error;}
      await delay(50, undefined, { signal });
    }
    if (!ready) throw new Error('Owned Caddy did not become ready: ' + caddyOutput);
    return {request, login, connect, frame, close, restart, credentials,
      accounts: {owner: credentials, other: {login: 'other-tls-owner', password: credentials.password}, ...(threeHumans ? {viewer: {login: 'viewer-tls-user', password: credentials.password}} : {})},
      webOrigin, agentsOrigin, workspaceId: workspace.id, otherWorkspaceId: otherWorkspace.id};
  } catch (error) {try {await close();} catch (cleanup) {throw new AggregateError([error, cleanup], 'Fixture initialization and close failed');} throw error;}
}
module.exports = {createPackagedIngressFixture};
