'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const {spawn, execFileSync} = require('node:child_process');
const {once} = require('node:events');
const {setTimeout: delay} = require('node:timers/promises');
const WebSocket = require('ws');
const Database = require('better-sqlite3');
const {createIdentityStore} = require('../identity/store.cjs');
const {createSessionService} = require('../identity/sessions.cjs');
const {hashPassword} = require('../identity/passwords.cjs');
const origin = 'https://lack.fixture.invalid';
test('actual embedded process enforces human identity, viewer denial and workspace separation without global config writes', {timeout: 20000}, async () => {
  const root = path.resolve(__dirname, '..');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-workspace-runtime-'));
  const identity = createIdentityStore({dbPath: path.join(directory, 'identity.sqlite')});
  const sessions = createSessionService({store: identity});
  let child; let backend; let logs = ''; const peers = [];
  try {
    const password = 'public-runtime-fixture-password'; const passwordHash = await hashPassword(password);
    const alice = identity.createUser({login: 'alice', passwordHash});
    const bob = identity.createUser({login: 'bob', passwordHash});
    const carol = identity.createUser({login: 'carol', passwordHash});
    const a = identity.createWorkspace({name: 'A', ownerId: alice.id}); const b = identity.createWorkspace({name: 'B', ownerId: bob.id});
    identity.setMembership(identity.requireMembership(bob.id, b.id), {workspaceId: b.id, userId: carol.id, role: 'viewer'});
    const accounts = {};
    for (const name of ['alice', 'bob', 'carol']) accounts[name] = await sessions.login({login: name, password, source: 'runtime-fixture-' + name});
    let modelRequests = 0;
    backend = http.createServer((req, res) => {modelRequests++; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(req.method === 'GET' ? {data: [{id: 'fixture-model'}, {id: 'ungranted-model'}]} : {choices: [{message: {content: 'fixture-only reply'}}]}));});
    await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
    const reservation = net.createServer(); await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
    const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
    const gatewayReservation = net.createServer(); await new Promise(resolve => gatewayReservation.listen(0, '127.0.0.1', resolve));
    const gatewayPort = gatewayReservation.address().port; await new Promise(resolve => gatewayReservation.close(resolve));
    const sources = JSON.parse(execFileSync(process.env.PYTHON || 'python', ['-c', 'import json,runpy; print(json.dumps(runpy.run_path("scripts/materialize.py")["embedded_sources"]()))'], {cwd: root, encoding: 'utf8', timeout: 10000}));
    fs.writeFileSync(path.join(directory, 'server.js'), sources.SERVER_JS);
    fs.mkdirSync(path.join(directory, 'config')); fs.mkdirSync(path.join(directory, 'public'));
    const config = {...JSON.parse(sources.CONFIG_JSON), httpPort: port, llmProvider: 'local-test', embeddingProvider: 'none', autoPullModels: false, enablePublicMemory: false, agentGateway: {enabled: true, port: gatewayPort, adminTokenEnv: 'LACK_GATEWAY_FIXTURE_SECRET'}, agents: [], workspaceModelGrants: {[a.id]: {'local-test': {models: ['fixture-model']}}}, llmProviders: [{id: 'local-test', local: true, requiresApiKey: false, baseUrl: `http://127.0.0.1:${backend.address().port}/v1`, models: ['fixture-model']}]};
    const configFile = path.join(directory, 'config', 'lack.config.json'); fs.writeFileSync(configFile, JSON.stringify(config));
    const configBefore = fs.readFileSync(configFile);
    const gatewayStore = require('../gateway/store.cjs').createGatewayStore({dbPath: path.join(directory, 'db', 'agent-gateway.db'), multiUser: true});
    const gatewayAccess = require('../gateway/workspace-access.cjs').createWorkspaceGatewayAccess({store: gatewayStore, identity});
    let nodeCredentials;
    try {
      const actor = identity.requireMembership(alice.id, a.id);
      const node = require('../collaboration/context.cjs').runWithWorkspace(actor, () => gatewayAccess.forHuman(actor).createNode({name: 'Runtime fixture', capabilities: ['browser.public_read'], scopes: ['public']}));
      nodeCredentials = gatewayStore.pair(node.pairingCode);
    } finally {gatewayStore.close();}
    for (const [folder, names] of Object.entries({identity: ['store', 'policy', 'sessions', 'passwords', 'admission', 'http'], collaboration: ['store', 'state', 'context', 'transport', 'resources'], gateway: ['protocol', 'store', 'server', 'research-bridge', 'runtime', 'workspace-access', 'pilot-schema']})) {
      fs.mkdirSync(path.join(directory, folder));
      for (const name of names) fs.copyFileSync(path.join(root, folder, name + '.cjs'), path.join(directory, folder, name + '.cjs'));
      if (folder === 'gateway') fs.copyFileSync(path.join(root, folder, 'admin.html'), path.join(directory, folder, 'admin.html'));
    }
    child = spawn(process.execPath, [path.join(directory, 'server.js')], {cwd: directory, env: {...process.env, NODE_PATH: path.join(root, 'node_modules'), LACK_BIND_HOST: '127.0.0.1', LACK_MULTI_USER: '1', LACK_PUBLIC_MODE: '1', LACK_WEB_ORIGIN: origin, LACK_IDENTITY_DB: path.join(directory, 'identity.sqlite'), LACK_GATEWAY_FIXTURE_SECRET: 'synthetic-only-fixture-'.repeat(3)}, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true});
    child.stdout.on('data', chunk => {logs += chunk;}); child.stderr.on('data', chunk => {logs += chunk;});
    for (let attempt = 0; attempt < 100 && !logs.includes('Workspace-authenticated runtime listening'); attempt++) {
      if (child.exitCode !== null) break;
      await delay(50);
    }
    assert.ok(logs.includes('Workspace-authenticated runtime listening'), 'Runtime failed to start: ' + logs.slice(-3000));
    assert.ok(!/workspace_context_required|Uncaught Exception/.test(logs), logs.slice(-3000));
    const gatewayHealth = await fetch(`http://127.0.0.1:${gatewayPort}/v1/manifest`);
    assert.equal(gatewayHealth.status, 401, 'Enabled workspace gateway rejects anonymous node reads');
    const nodeManifest = await (await fetch(`http://127.0.0.1:${gatewayPort}/v1/manifest`, {headers: {Authorization: 'Bearer ' + nodeCredentials.token}})).json();
    assert.equal(nodeManifest.workspaceId, a.id);
    assert.equal((await fetch(`http://127.0.0.1:${gatewayPort}/admin/v1/tasks`, {headers: {Authorization: 'Bearer ' + 'synthetic-only-fixture-'.repeat(3)}})).status, 404);
    const base = `http://127.0.0.1:${port}`;
    async function request(route, name, workspaceId, method = 'GET') {
      const headers = {Origin: origin, 'X-Workspace-Id': workspaceId};
      if (name) headers.Cookie = '__Host-chunlack_session=' + accounts[name].token;
      const response = await fetch(base + route, {method, headers});
      return {status: response.status, body: await response.json()};
    }
    assert.equal((await request('/api/channels', null, a.id)).status, 401);
    assert.equal((await request('/api/channels', 'alice', b.id)).status, 404);
    assert.equal((await request('/api/channels', 'alice', a.id)).body.channels[0].id, 'general');
    async function connect(name, workspaceId) {
      const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws/workspaces/' + workspaceId, {headers: {Origin: origin, Cookie: '__Host-chunlack_session=' + accounts[name].token}, handshakeTimeout: 5000});
      const frames = []; ws.on('message', value => frames.push(JSON.parse(value))); peers.push(ws);
      await once(ws, 'open');
      return {ws, frames};
    }
    async function frame(peer, predicate) {
      for (let i = 0; i < 100; i++) {const index = peer.frames.findIndex(predicate); if (index >= 0) return peer.frames.splice(index, 1)[0]; await delay(20);}
      assert.fail('Expected runtime frame missing: ' + logs.slice(-1500));
    }
    const peerA = await connect('alice', a.id); const peerB = await connect('bob', b.id); const viewer = await connect('carol', b.id);
    for (const peer of [peerA, peerB, viewer]) {peer.ws.send(JSON.stringify({type: 'join', channelId: 'general'})); await frame(peer, value => value.type === 'history'); peer.frames.length = 0;}
    peerA.ws.send(JSON.stringify({type: 'set_username', username: 'root', userId: bob.id}));
    peerA.ws.send(JSON.stringify({type: 'message', content: 'a-secret-fixture', username: 'root', userId: bob.id}));
    const persisted = await frame(peerA, value => value.type === 'new_message' && value.message.content === 'a-secret-fixture');
    assert.equal(persisted.message.sender, 'alice');
    await delay(50); assert.ok(!peerB.frames.some(value => JSON.stringify(value).includes('a-secret-fixture')));
    viewer.ws.send(JSON.stringify({type: 'message', content: '/ground'}));
    assert.equal((await frame(viewer, value => value.type === 'error')).code, 'forbidden');
    assert.equal(modelRequests, 0);
    assert.equal((await request('/api/models?provider=local-test', 'bob', b.id)).status, 403);
    assert.equal(modelRequests, 0, 'Ungranted workspace must not discover models over the network');
    const models = await request('/api/models?provider=local-test', 'alice', a.id);
    assert.deepEqual(models.body.models, ['fixture-model']);
    const requestsAfterDiscovery = modelRequests;
    peerA.ws.send(JSON.stringify({type: 'spawn_agent', name: 'Forbidden-agent', model: 'ungranted-model', provider: 'local-test', channels: ['general']}));
    assert.equal((await frame(peerA, value => value.type === 'error')).code, 'model_not_authorized');
    assert.equal(modelRequests, requestsAfterDiscovery);
    peerA.ws.send(JSON.stringify({type: 'spawn_agent', name: 'A-agent', model: 'fixture-model', provider: 'local-test', channels: ['general'], systemPrompt: 'fixture prompt'}));
    const spawned = await frame(peerA, value => value.type === 'spawn_confirm');
    assert.ok(spawned.agent.id);
    await delay(50); assert.ok(!peerB.frames.some(value => JSON.stringify(value).includes('A-agent')));
    assert.ok(configBefore.equals(fs.readFileSync(configFile)), 'Workspace agent mutation must not rewrite global config');
    assert.ok(!fs.existsSync(path.join(directory, 'agent_memories', spawned.agent.id + '.json')));
    const stopped = once(peerA.ws, 'close');
    assert.equal((await request('/auth/logout', 'alice', a.id, 'POST')).status, 415);
    sessions.logout(accounts.alice.token);
    // Different process writes are observed by passive revalidation, not an in-memory callback.
    peerA.ws.send(JSON.stringify({type: 'join', channelId: 'general'}));
    assert.equal((await stopped)[0], 1008);
    assert.ok(!logs.includes(accounts.alice.token)); assert.ok(!logs.includes(password));
  } finally {
    for (const peer of peers) peer.terminate();
    if (child && child.exitCode === null) {const exited = once(child, 'exit'); child.kill(); await exited;}
    if (backend) {backend.closeAllConnections(); await new Promise(resolve => backend.close(resolve));}
    sessions.close(); identity.close();
    fs.rmSync(directory, {recursive: true, force: true});
  }
});
