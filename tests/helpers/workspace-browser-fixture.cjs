'use strict';
// Manual browser fixture only. It binds loopback, uses disposable accounts and
// explicitly substitutes local HTTP/cookies for production HTTPS. It cannot
// establish TLS/public deployment acceptance and is never materialized.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const net = require('node:net');
const {spawn, execFileSync} = require('node:child_process');
const {setTimeout: delay} = require('node:timers/promises');
const {once} = require('node:events');
const WebSocket = require('ws');
const {createIdentityStore} = require('../../identity/store.cjs');
const {createSessionService} = require('../../identity/sessions.cjs');
const {hashPassword} = require('../../identity/passwords.cjs');
const root = path.resolve(__dirname, '../..'), origin = 'https://lack.fixture.invalid';
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-workspace-browser-'));
const proxies = [], sockets = new Set(); let child, backend, identity, stopping = false;
async function freePort() {const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;}
async function stop() {
  if (stopping) return; stopping = true;
  process.stdin.destroy();
  for (const socket of sockets) socket.destroy();
  await Promise.all(proxies.map(server => new Promise(resolve => server.close(resolve))));
  if (child && child.exitCode === null) {const ended = once(child, 'exit'); child.kill(); await ended;}
  if (backend) await new Promise(resolve => backend.close(resolve));
  if (identity) identity.close();
  process.exitCode = 0;
}
async function main() {
  identity = createIdentityStore({dbPath: path.join(directory, 'identity.sqlite')});
  const sessions = createSessionService({store: identity}), password = 'public-browser-fixture-password', passwordHash = await hashPassword(password);
  const alice = identity.createUser({login: 'alice', passwordHash}), bob = identity.createUser({login: 'bob', passwordHash}), carol = identity.createUser({login: 'carol', passwordHash});
  const a = identity.createWorkspace({name: '研究 A <img src=x onerror=alert(1)>', ownerId: alice.id}), b = identity.createWorkspace({name: '开发 B', ownerId: bob.id});
  identity.setMembership(identity.requireMembership(alice.id, a.id), {workspaceId: a.id, userId: bob.id, role: 'member'});
  identity.setMembership(identity.requireMembership(alice.id, a.id), {workspaceId: a.id, userId: carol.id, role: 'viewer'});
  backend = http.createServer((req, res) => {res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(req.method === 'GET' ? {data: [{id: 'fixture-model'}]} : {choices: [{message: {content: 'LOCAL MOCK MODEL ONLY'}}]}));});
  await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
  const port = await freePort(), gatewayPort = await freePort();
  const source = JSON.parse(execFileSync(process.env.PYTHON || 'python', ['-c', 'import json,runpy; print(json.dumps(runpy.run_path("scripts/materialize.py")["embedded_sources"]()))'], {cwd: root, encoding: 'utf8', timeout: 10000}));
  fs.writeFileSync(path.join(directory, 'server.js'), source.SERVER_JS);
  fs.mkdirSync(path.join(directory, 'public')); fs.mkdirSync(path.join(directory, 'config'));
  const ui = JSON.parse(execFileSync(process.env.PYTHON || 'python', ['-c', 'import ast,json; t=ast.parse(open("lack.py",encoding="utf-8").read()); print(json.dumps(next(ast.literal_eval(n.value) for n in t.body if isinstance(n,ast.Assign) and any(isinstance(x,ast.Name) and x.id=="INDEX_HTML" for x in n.targets))))'], {cwd: root, encoding: 'utf8', timeout: 10000}));
  fs.writeFileSync(path.join(directory, 'public', 'index.html'), ui);
  fs.writeFileSync(path.join(directory, 'config', 'lack.config.json'), JSON.stringify({...JSON.parse(source.CONFIG_JSON), httpPort: port, llmProvider: 'local-test', embeddingProvider: 'none', autoPullModels: false, enablePublicMemory: false, agents: [],
    agentGateway: {enabled: true, port: gatewayPort, adminTokenEnv: 'LACK_BROWSER_FIXTURE_SECRET'},
    workspaceModelGrants: {[a.id]: {'local-test': {models: ['fixture-model']}}, [b.id]: {'local-test': {models: ['fixture-model']}}},
    llmProviders: [{id: 'local-test', local: true, requiresApiKey: false, baseUrl: `http://127.0.0.1:${backend.address().port}/v1`, models: ['fixture-model']}]}));
  for (const [folder, names] of Object.entries({identity: ['store', 'policy', 'sessions', 'passwords', 'admission', 'http', 'workspace-ui.js', 'workspace-shell.js', 'login.html'], collaboration: ['store', 'state', 'context', 'transport', 'resources', 'capacity', 'model-transport', 'task-control', 'controls-http'], gateway: ['protocol', 'store', 'server', 'research-bridge', 'runtime', 'workspace-access', 'pilot-schema', 'admin.html']})) {
    fs.mkdirSync(path.join(directory, folder)); for (const name of names) {const file = name.includes('.') ? name : name + '.cjs'; fs.copyFileSync(path.join(root, folder, file), path.join(directory, folder, file));}
  }
  let logs = '';
  child = spawn(process.execPath, [path.join(directory, 'server.js')], {cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: {...process.env, NODE_PATH: path.join(root, 'node_modules'), LACK_BIND_HOST: '127.0.0.1', LACK_MULTI_USER: '1', LACK_PUBLIC_MODE: '1', LACK_WEB_ORIGIN: origin, LACK_IDENTITY_DB: path.join(directory, 'identity.sqlite'), LACK_BROWSER_FIXTURE_SECRET: 'synthetic-browser-secret-'.repeat(3)}});
  child.stdout.on('data', value => {logs = (logs + value).slice(-6000);}); child.stderr.on('data', value => {logs = (logs + value).slice(-6000);});
  for (let i = 0; i < 100 && !logs.includes('Workspace-authenticated runtime listening'); i++) {if (child.exitCode !== null) throw new Error('Fixture child exited'); await delay(50);}
  if (!logs.includes('Workspace-authenticated runtime listening')) throw new Error('Fixture readiness timed out');
  for (const [login, workspace] of [['alice', a], ['bob', b]]) {
    const session = await sessions.login({login, password, source: 'browser-fixture-seed-' + login});
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/workspaces/${workspace.id}`, {headers: {Origin: origin, Cookie: '__Host-chunlack_session=' + session.token}});
    const messages = []; ws.on('message', value => messages.push(JSON.parse(value)));
    await once(ws, 'open'); ws.send(JSON.stringify({type: 'join', channelId: 'general'}));
    ws.send(JSON.stringify({type: 'message', channelId: 'general', content: 'PRIVATE_MARKER_' + (login === 'alice' ? 'A' : 'B') + ' <img src=x onerror=alert(1)>'}));
    for (let i = 0; i < 100 && !messages.some(frame => frame.type === 'new_message'); i++) await delay(20);
    if (!messages.some(frame => frame.type === 'new_message')) throw new Error('Fixture message was not acknowledged');
    ws.close(); await once(ws, 'close');
  }
  const urls = {};
  for (const login of ['alice', 'bob', 'carol']) {
    let cookieName;
    const headersFor = req => {
      // The request body is forwarded unchanged, including DELETE. Removing its
      // length makes Node omit DELETE body framing and correctly triggers the
      // production JSON guard; preserve the original framing instead.
      const headers = {...req.headers, origin, host: '127.0.0.1:' + port}; delete headers.connection;
      const value = (req.headers.cookie || '').split(';').map(item => item.trim()).find(item => item.startsWith(cookieName + '='));
      delete headers.cookie; if (value) headers.cookie = '__Host-chunlack_session=' + value.slice(cookieName.length + 1);
      return headers;
    };
    const proxy = http.createServer(async (req, res) => {
      const route = req.url.split('?')[0];
      if (route === '/fixture-browser.js') {
        res.setHeader('Content-Type', 'application/javascript'); res.end(`const fixtureFetch = window.fetch.bind(window), FixtureSocket = window.WebSocket; window.fetch = (url, options) => fixtureFetch(new URL(url, window.location.origin).pathname + new URL(url, window.location.origin).search, options); window.WebSocket = class extends FixtureSocket {constructor(url) {super('ws://' + window.location.host + new URL(url).pathname);}};`); return;
      }
      const request = http.request({hostname: '127.0.0.1', port, path: req.url, method: req.method, headers: headersFor(req)}, upstream => {
        const chunks = []; upstream.on('data', value => chunks.push(value)); upstream.on('end', () => {
          let content = Buffer.concat(chunks);
          for (const [name, value] of Object.entries(upstream.headers)) if (value !== undefined && !['content-length', 'transfer-encoding', 'connection', 'set-cookie', 'content-security-policy'].includes(name)) res.setHeader(name, value);
          if (upstream.headers['set-cookie']) res.setHeader('Set-Cookie', upstream.headers['set-cookie'].map(value => value.replace('__Host-chunlack_session=', cookieName + '=').replace(/;\s*Secure/gi, '')));
          if (upstream.statusCode === 200 && ['/', '/login'].includes(route)) {
            let html = content.toString('utf8');
            html = html.replace('<script src="/identity/workspace-ui.js">', '<script src="/fixture-browser.js"></script><script src="/identity/workspace-ui.js">');
            html = html.replace('WebSocket: window.WebSocket, location,', `WebSocket: window.WebSocket, location: {origin: '${origin}', host: 'lack.fixture.invalid'},`);
            html = html.replace('location: window.location,', `location: {origin: '${origin}', host: 'lack.fixture.invalid'},`);
            html = html.replace('</body>', '<aside style="position:fixed;bottom:0;right:0;z-index:99999;background:#fff3b2;padding:5px;font:11px monospace">LOCAL FIXTURE · TLS + model mocked · NOT PRODUCTION</aside></body>');
            content = Buffer.from(html);
          }
          res.statusCode = upstream.statusCode; res.end(content);
        });
      });
      request.on('error', () => {res.statusCode = 503; res.end('Fixture upstream unavailable');}); req.pipe(request);
    });
    proxy.on('connection', socket => {sockets.add(socket); socket.on('close', () => sockets.delete(socket));});
    proxy.on('upgrade', (req, socket, head) => {
      const request = http.request({hostname: '127.0.0.1', port, method: 'GET', path: req.url, headers: {...headersFor(req), connection: 'Upgrade', upgrade: 'websocket'} });
      request.on('upgrade', (response, peer, responseHead) => {sockets.add(peer); peer.on('close', () => sockets.delete(peer)); socket.write('HTTP/1.1 101 Switching Protocols\r\n' + Object.entries(response.headers).map(([key, value]) => key + ': ' + value).join('\r\n') + '\r\n\r\n'); if (responseHead.length) socket.write(responseHead); if (head.length) peer.write(head); socket.pipe(peer); peer.pipe(socket); socket.on('error', () => peer.destroy()); peer.on('error', () => socket.destroy());});
      request.on('response', response => {socket.end(`HTTP/1.1 ${response.statusCode} Rejected\r\nConnection: close\r\n\r\n`);}); request.on('error', () => socket.destroy()); request.end();
    });
    await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve)); proxies.push(proxy); cookieName = 'lack_fixture_' + proxy.address().port;
    urls[login] = `http://127.0.0.1:${proxy.address().port}/`;
  }
  console.log(JSON.stringify({kind: 'LOCAL_BROWSER_FIXTURE_NOT_TLS_ACCEPTANCE', urls, workspaceIds: {a: a.id, b: b.id}, directory}));
  process.stdin.setEncoding('utf8'); process.stdin.on('data', value => {if (value.trim() === 'STOP') void stop();});
  process.on('SIGINT', () => void stop()); process.on('SIGTERM', () => void stop());
  const deadline = setTimeout(() => void stop(), 20 * 60 * 1000); deadline.unref();
}
main().catch(async error => {console.error('BROWSER_FIXTURE_FAILED: ' + error.message); await stop(); process.exitCode = 1;});
