'use strict';
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const {spawnSync} = require('node:child_process');
const express = require('express');
const WebSocket = require('ws');
const {workspaceFixture} = require('./workspace-fixture.cjs');
const {hashPassword} = require('../../identity/passwords.cjs');
const {createSessionService} = require('../../identity/sessions.cjs');
const {createWorkspaceStateRegistry} = require('../../collaboration/state.cjs');
const {runWithWorkspace} = require('../../collaboration/context.cjs');
const {createWorkspaceTransport} = require('../../collaboration/transport.cjs');
let hashPromise; let tls;
const password = 'public-transport-fixture-password';
function certificate(directory) {
  if (tls) return tls;
  const executable = process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl';
  const key = path.join(directory, 'local-test.key'); const cert = path.join(directory, 'local-test.crt');
  const result = spawnSync(executable, ['req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], {timeout: 10000, encoding: 'utf8'});
  if (result.status !== 0) throw new Error('Local TLS fixture generation failed');
  fs.chmodSync(key, 0o600);
  tls = {key: fs.readFileSync(key), cert: fs.readFileSync(cert)};
  return tls;
}
async function transportFixture(t, {maxConnections = 128} = {}) {
  hashPromise ||= hashPassword(password);
  const f = workspaceFixture(t, {passwordHash: await hashPromise});
  const app = express(); const server = https.createServer(certificate(f.dir), app);
  const wss = new WebSocket.Server({noServer: true, maxPayload: 65536, perMessageDeflate: false});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `https://127.0.0.1:${server.address().port}`;
  const registry = createWorkspaceStateRegistry({identity: f.store});
  let transport;
  const sessions = createSessionService({store: f.store, now: f.now, onRevoke: event => transport?.revoke(event)});
  transport = createWorkspaceTransport({identity: f.store, sessions, state: registry, webOrigin: origin, maxConnections});
  const calls = [];
  for (const [user, workspace] of [['alice', 'a'], ['bob', 'b']]) runWithWorkspace(f.actor(user, workspace), () => {
    registry.get().channels.set('general', {id: 'general', name: workspace, messages: [{id: 'same-thread', content: workspace}]});
    registry.get().agents.set('moderator', {id: 'moderator', name: workspace});
  });
  runWithWorkspace(f.actor('alice', 'a'), () => registry.get().channels.set('private', {id: 'private', allowedUsers: [f.users.alice.id], messages: []}));
  app.use('/api', transport.httpContext);
  app.use(express.json({limit: '64kb'}));
  app.get('/api/channels', (req, res) => res.json({userId: req.workspace.userId, role: req.workspace.role, channels: [...registry.get().channels.keys()]}));
  app.delete('/api/agent/:id', (req, res) => {calls.push({kind: 'delete', userId: req.workspace.userId}); res.json({ok: true});});
  app.post('/api/cron/wipe', (req, res) => {calls.push({kind: 'wipe'}); res.json({ok: true});});
  app.get('/api/jspace', (req, res) => {calls.push({kind: 'model'}); res.json({ok: true});});
  app.get('/api/unknown', (req, res) => {calls.push({kind: 'unknown'}); res.json({ok: true});});
  server.on('upgrade', (req, socket, head) => {
    try {
      const principal = transport.authorizeUpgrade(req);
      wss.handleUpgrade(req, socket, head, ws => {
        transport.attach(ws, principal);
        ws.on('message', raw => {
          try {
            const decision = transport.authorizeMessage(ws, JSON.parse(raw));
            runWithWorkspace(decision.actor, () => {
              const message = decision.message;
              if (message.type === 'message' || message.type === 'spawn_agent') calls.push({kind: message.type, userId: decision.actor.userId, content: message.content});
              ws.send(JSON.stringify({type: 'accepted', userId: decision.actor.userId, username: decision.client.username, channelId: decision.client.channelId}));
            });
          } catch (error) {if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({type: 'denied', error: error.code || 'invalid_request'}));}
        });
      });
    } catch (error) {
      socket.end(`HTTP/1.1 ${error.statusCode || 403} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    }
  });
  t.after(async () => {
    transport.close(); sessions.close(); registry.close();
    for (const ws of wss.clients) ws.terminate();
    await new Promise(resolve => wss.close(resolve));
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  });
  async function login(user = 'alice') {
    const account = await sessions.login({login: user, password, source: `fixture-${user}`});
    return {...account, cookie: `__Host-chunlack_session=${account.token}`};
  }
  async function request(route, {auth, workspaceId = f.workspaces.a.id, method = 'GET', requestOrigin = origin, csrf = true, headers = {}, body} = {}) {
    const allHeaders = {...headers};
    if (auth) allHeaders.Cookie = auth.cookie;
    if (workspaceId !== null) allHeaders['X-Workspace-Id'] = workspaceId;
    if (requestOrigin !== null) allHeaders.Origin = requestOrigin;
    if (auth && csrf) allHeaders['X-CSRF-Token'] = auth.csrfToken;
    if (body !== undefined) allHeaders['Content-Type'] = 'application/json';
    return new Promise((resolve, reject) => {
      const req = https.request(origin + route, {method, headers: allHeaders, ca: tls.cert, rejectUnauthorized: true, timeout: 5000}, res => {
        let text = ''; res.on('data', chunk => {text += chunk;}); res.on('end', () => {let json; try {json = JSON.parse(text);} catch {} resolve({status: res.statusCode, json, text});});
      });
      req.on('timeout', () => req.destroy(new Error('Fixture HTTP timeout'))); req.on('error', reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }
  async function open({auth, workspaceId = f.workspaces.a.id, requestOrigin = origin, url, ca = tls.cert} = {}) {
    const headers = {};
    if (auth) headers.Cookie = auth.cookie;
    if (requestOrigin !== null) headers.Origin = requestOrigin;
    const ws = new WebSocket(url || origin.replace('https:', 'wss:') + '/ws/workspaces/' + workspaceId, {headers, ca, rejectUnauthorized: true, handshakeTimeout: 5000});
    const messages = []; ws.on('message', raw => messages.push(JSON.parse(raw)));
    await new Promise((resolve, reject) => {
      ws.once('open', resolve); ws.once('error', reject);
      ws.once('unexpected-response', (req, res) => {res.resume(); ws.terminate(); reject(Object.assign(new Error('Rejected upgrade'), {statusCode: res.statusCode}));});
    });
    return {ws, messages};
  }
  async function send(peer, value) {
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Fixture frame timeout')), 5000); timer.unref();
      peer.ws.once('message', raw => {clearTimeout(timer); resolve(JSON.parse(raw));});
    });
    peer.ws.send(JSON.stringify(value)); return result;
  }
  return {...f, openStore: f.open, sessions, transport, registry, origin, calls, login, request, open, send};
}
module.exports = {transportFixture};
