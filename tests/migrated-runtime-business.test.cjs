'use strict';
// Disposable loopback acceptance. Models are synthetic; this is not public TLS,
// a real cloud provider, or the vendor-owned Muse/dots cloud computer.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const https = require('node:https');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { createHash } = require('node:crypto');
const Database = require('better-sqlite3');
const WebSocket = require('ws');
const { createIdentityStore } = require('../identity/store.cjs');
const { hashPassword } = require('../identity/passwords.cjs');
const { planMigration, applyMigration, verifyMigration } = require('../scripts/migrate-workspaces.cjs');
const { prepareWorkspaceSnapshot } = require('../scripts/workspace-snapshot.cjs');
const { prepareMigrationRecovery } = require('../scripts/workspace-migration-recovery.cjs');
const repository = path.resolve(__dirname, '..');
const origin = 'https://lack.business.fixture.invalid';
const password = 'synthetic-migration-business-password';
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function until(predicate, label, milliseconds = 10000) {
  const end = Date.now() + milliseconds;
  while (Date.now() < end) { const result = predicate(); if (result) return result; await delay(25); }
  assert.fail('Acceptance timed out: ' + label);
}
async function ports() {
  const reservations = [];
  for (let i = 0; i < 3; i++) { const server = http.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); reservations.push(server); }
  const result = reservations.map(server => server.address().port);
  for (const server of reservations) await new Promise(resolve => server.close(resolve));
  return result;
}
function stop(child) {
  if (child.process.exitCode !== null) return child.exited;
  child.process.stdin.write('STOP\n'); return child.exited;
}
function start(f, dataRoot, legacy = false) {
  const packageRoot = f.packageRoot;
  const args = [path.join(__dirname, 'helpers', 'migrated-runtime-child.cjs'), legacy ? path.join(packageRoot, 'server.js') : path.join(packageRoot, 'gateway', 'public-runtime.cjs'), dataRoot, legacy ? 'legacy' : 'public'];
  const processChild = spawn(process.execPath, args, { cwd: packageRoot, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, NODE_PATH: path.join(repository, 'node_modules'), NODE_EXTRA_CA_CERTS: f.certificatePath, CLOUD_TEST_API_KEY: 'synthetic-cloud-business-key', BUSINESS_GATEWAY_SECRET: 'synthetic-gateway-business-'.repeat(3), LACK_BIND_HOST: '127.0.0.1' } });
  let logs = ''; processChild.stdout.on('data', value => { logs = (logs + value).slice(-6000); }); processChild.stderr.on('data', value => { logs = (logs + value).slice(-6000); });
  const child = { process: processChild, exited: once(processChild, 'exit'), logs: () => logs };
  f.addCleanup(async () => { if (processChild.exitCode === null) { const ending = stop(child); await Promise.race([ending, delay(5000)]); if (processChild.exitCode === null) { processChild.kill(); await child.exited; } } });
  return child;
}
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-migrated-business-')); fs.chmodSync(root, 0o700);
  const cleanup = [], addCleanup = fn => cleanup.push(fn);
  t.after(async () => {
    const errors = [];
    for (const close of cleanup.reverse()) { try { await close(); } catch (error) { errors.push(error); } }
    try { const owned = path.resolve(root); assert.ok(owned.startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(owned, { recursive: true, force: true }); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, 'business_fixture_cleanup_failed');
  });
  const sourceRoot = path.join(root, 'source'), candidateRoot = path.join(root, 'candidate'), snapshotRoot = path.join(root, 'snapshot'), packageRoot = path.join(root, 'package');
  for (const dir of ['db', 'config', 'memory', 'attachments']) fs.mkdirSync(path.join(sourceRoot, dir), { recursive: true, mode: 0o700 });
  const identitySourcePath = path.join(root, 'identity.sqlite'), identity = createIdentityStore({ dbPath: identitySourcePath });
  const passwordHash = await hashPassword(password);
  const users = Object.fromEntries(['alice', 'bob', 'carol'].map(login => [login, identity.createUser({ login, passwordHash })]));
  const a = identity.createWorkspace({ name: 'Migration research', ownerId: users.alice.id }), b = identity.createWorkspace({ name: 'Independent development', ownerId: users.bob.id });
  identity.setMembership(identity.requireMembership(users.alice.id, a.id), { workspaceId: a.id, userId: users.bob.id, role: 'member' });
  identity.setMembership(identity.requireMembership(users.bob.id, b.id), { workspaceId: b.id, userId: users.carol.id, role: 'viewer' });
  identity.close(); fs.chmodSync(identitySourcePath, 0o600);
  const keyPath = path.join(root, 'fixture.key'), certificatePath = path.join(root, 'fixture.crt');
  execFileSync(process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-nodes', '-keyout', keyPath, '-out', certificatePath, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { timeout: 10000, stdio: 'pipe' });
  fs.chmodSync(keyPath, 0o600);
  const calls = [];
  const handleModel = (req, res) => {
    let body = ''; req.on('data', value => { body += value; }); req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'GET') { res.end(JSON.stringify({ data: [{ id: 'fixture-model' }] })); return; }
      const parsed = JSON.parse(body); calls.push({ path: req.url, body: parsed });
      const provider = req.url.split('/')[1];
      res.end(JSON.stringify({ choices: [{ message: { content: 'SYNTHETIC_BUSINESS_REPLY_' + provider + (JSON.stringify(parsed).includes('GROUND:') ? '_GROUND' : '_NORMAL') } }] }));
    });
  };
  const mock = http.createServer(handleModel), cloudMock = https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certificatePath) }, handleModel);
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
  addCleanup(async () => { mock.closeAllConnections(); await new Promise(resolve => mock.close(resolve)); });
  await new Promise(resolve => cloudMock.listen(0, '127.0.0.1', resolve));
  addCleanup(async () => { cloudMock.closeAllConnections(); await new Promise(resolve => cloudMock.close(resolve)); });
  const [webPort, gatewayPort, mcpPort] = await ports();
  const providers = ['local-test', 'cloud-test'].map(id => ({ id, local: id === 'local-test', requiresApiKey: id === 'cloud-test', baseUrl: `${id === 'cloud-test' ? 'https' : 'http'}://127.0.0.1:${id === 'cloud-test' ? cloudMock.address().port : mock.address().port}/${id}/v1`, models: ['fixture-model'] }));
  const config = { httpPort: webPort, bindHost: '127.0.0.1', llmProvider: 'local-test', defaultModel: 'fixture-model', embeddingProvider: 'none', autoPullModels: false, enablePublicMemory: false, enableMusing: false, enableTriangulation: false, jspaceEnabled: false, agents: [],
    llmProviders: [...providers, { id: 'ollama', local: true }], channels: [{ id: 'general', name: 'general' }], multiUser: { enabled: false },
    agentGateway: { enabled: true, port: gatewayPort, adminTokenEnv: 'BUSINESS_GATEWAY_SECRET' },
    publicRuntime: { webOrigin: origin, agentsOrigin: 'https://agents.business.fixture.invalid', mcpPort } };
  fs.writeFileSync(path.join(sourceRoot, 'config', 'lack.config.json'), JSON.stringify(config), { mode: 0o600 });
  fs.writeFileSync(path.join(sourceRoot, 'memory', 'agent.json'), JSON.stringify({ sourceUrl: 'https://example.com/original', missingEvidence: true }), { mode: 0o600 });
  fs.writeFileSync(path.join(sourceRoot, 'attachments', 'original.bin'), Buffer.from([0, 2, 255]), { mode: 0o600 });
  const sourceDb = path.join(sourceRoot, 'db', 'lack.db'), writer = new Database(sourceDb); writer.pragma('journal_mode=WAL'); writer.pragma('wal_autocheckpoint=0');
  writer.exec(`CREATE TABLE agents(id TEXT PRIMARY KEY,name TEXT,model TEXT,provider TEXT,system_prompt TEXT,channels TEXT,strict_channel TEXT,status TEXT,is_embed_operator INTEGER,is_code_moderator INTEGER);
    INSERT INTO agents VALUES('local-agent','LegacyLocal','fixture-model','local-test','Be brief.','["general"]',NULL,'idle',0,0);
    INSERT INTO agents VALUES('cloud-agent','LegacyCloud','fixture-model','cloud-test','Be brief.','["general"]',NULL,'idle',0,0);
    CREATE TABLE messages(id TEXT PRIMARY KEY,store_id TEXT,sender TEXT,sender_type TEXT,content TEXT,timestamp INTEGER,parent_id TEXT,thread_id TEXT,reply_count INTEGER,reactions TEXT);
    INSERT INTO messages VALUES('legacy-root','general','Original Human','human','ORIGINAL_RESEARCH_A https://example.com/original',10,NULL,NULL,1,'{}');
    INSERT INTO messages VALUES('legacy-reply','general','LegacyLocal','agent','Original result lacks evidence',11,'legacy-root','legacy-root',0,'{}');
    CREATE TABLE agent_memory(agent_id TEXT PRIMARY KEY,e_pool TEXT,x_pool TEXT,weights TEXT,stats TEXT,last_update INTEGER);
    INSERT INTO agent_memory VALUES('local-agent','[{"url":"https://example.com/original"}]','[]','{}','{}',12);
    CREATE TABLE project_states(store_id TEXT PRIMARY KEY,state TEXT,timestamp INTEGER);INSERT INTO project_states VALUES('general','{"stage":"review"}',13);
    CREATE TABLE pipeline_results(id TEXT PRIMARY KEY,agent_id TEXT,thread_id TEXT,code_hash TEXT,passed INTEGER,attempt INTEGER,feedback TEXT,timestamp INTEGER);
    INSERT INTO pipeline_results VALUES('pipeline','local-agent','legacy-root','${'a'.repeat(64)}',1,1,'original feedback',14);
    CREATE TABLE loop_health(loop_id TEXT PRIMARY KEY,loop_type TEXT,iterations INTEGER,convergence REAL,stagnation REAL,token_spend INTEGER,last_update INTEGER);
    INSERT INTO loop_health VALUES('loop','review',1,0.5,0,10,15);
    CREATE TABLE research_sessions(id TEXT PRIMARY KEY,data TEXT,timestamp INTEGER);INSERT INTO research_sessions VALUES('research','{"id":"research","missingEvidence":true}',16);
    CREATE TABLE research_sources(id TEXT PRIMARY KEY,research_id TEXT,url TEXT,title TEXT,excerpt TEXT,timestamp INTEGER);
    INSERT INTO research_sources VALUES('citation','research','https://example.com/original','Original title','Original excerpt',17);
    CREATE TABLE unknown_notes(id TEXT PRIMARY KEY,content TEXT);INSERT INTO unknown_notes VALUES('original','never discard');`);
  fs.chmodSync(sourceDb, 0o600); fs.chmodSync(sourceDb + '-wal', 0o600);
  addCleanup(() => writer.close());
  const sourceBefore = { main: hash(sourceDb), wal: hash(sourceDb + '-wal'), config: hash(path.join(sourceRoot, 'config', 'lack.config.json')) };
  const plan = planMigration({ sourceRoot, targetRoot: candidateRoot, workspaceId: a.id, ownerId: users.alice.id });
  await prepareWorkspaceSnapshot({ sourceRoot, snapshotRoot });
  const grants = Object.fromEntries(providers.map(p => [p.id, { models: ['fixture-model'] }]));
  await applyMigration(plan, { reviewed: true, snapshotRoot, identitySourcePath, modelGrants: grants });
  verifyMigration(plan);
  const recoveryRoot = path.join(root, 'recovery');
  const recovered = prepareMigrationRecovery({ candidateRoot, recoveryRoot, reviewed: true });
  assert.equal(recovered.restoreReady, false);
  execFileSync(process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), ['scripts/materialize.py', '--output', packageRoot], { cwd: repository, timeout: 10000, stdio: 'pipe' });
  return { root, sourceRoot, sourceDb, sourceBefore, candidateRoot, packageRoot, recovered, users, a, b, calls, webPort, addCleanup, certificatePath };
}
function client(f) {
  const base = 'http://127.0.0.1:' + f.webPort;
  async function request(route, { auth, workspaceId, method = 'GET', body, csrf = true, headers = {} } = {}) {
    const all = { Origin: origin, ...headers };
    if (auth) { all.Cookie = auth.cookie; if (csrf) all['X-CSRF-Token'] = auth.csrfToken; }
    if (workspaceId) all['X-Workspace-Id'] = workspaceId;
    if (body !== undefined) all['Content-Type'] = 'application/json';
    const response = await fetch(base + route, { method, headers: all, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000), redirect: 'manual' });
    const text = await response.text(); let json; try { json = JSON.parse(text); } catch {}
    return { status: response.status, json, text, headers: response.headers };
  }
  async function login(name) { const response = await request('/auth/login', { method: 'POST', body: { login: name, password } }); assert.equal(response.status, 200, response.text); return { ...response.json, cookie: response.headers.get('set-cookie').split(';')[0] }; }
  async function open(t, auth, workspaceId, legacy = false) {
    const ws = new WebSocket(base.replace('http:', 'ws:') + (legacy ? '/' : '/ws/workspaces/' + workspaceId), { headers: { Origin: origin, ...(auth ? { Cookie: auth.cookie } : {}) }, handshakeTimeout: 5000 });
    const messages = []; ws.on('message', raw => messages.push(JSON.parse(raw))); f.addCleanup(() => ws.terminate());
    await once(ws, 'open'); ws.send(JSON.stringify({ type: 'join', channelId: 'general' }));
    await until(() => messages.find(m => m.type === 'history'), 'real channel history');
    return { ws, messages };
  }
  return { request, login, open };
}
test('migrated packaged runtime serves three humans in two workspaces, actual model routes, restart and legacy-compatible recovery', { timeout: 90000 }, async t => {
  const f = await fixture(t), api = client(f), running = start(f, f.candidateRoot);
  await until(() => running.logs().includes('PUBLIC_RUNTIME_READY') || running.process.exitCode !== null, 'packaged public runtime');
  assert.equal(running.process.exitCode, null, running.logs());
  assert.equal((await api.request('/health')).status, 200);
  // Admission intentionally bounds password hashing to one operation. Three
  // authenticated sessions coexist; a simultaneous login burst is not promised.
  const alice = await api.login('alice'), bob = await api.login('bob'), carol = await api.login('carol');
  const lists = await Promise.all([alice, bob, carol].map(auth => api.request('/api/workspaces', { auth })));
  assert.deepEqual(lists.map(r => r.json.workspaces.map(w => w.id).sort()), [[f.a.id], [f.a.id, f.b.id].sort(), [f.b.id]]);
  assert.equal((await api.request('/api/channels', { auth: alice, workspaceId: f.b.id, headers: { 'X-Role': 'owner', 'X-User-ID': f.users.bob.id } })).status, 404);
  const a = await api.open(t, alice, f.a.id), b = await api.open(t, bob, f.b.id), viewer = await api.open(t, carol, f.b.id);
  assert.ok(JSON.stringify(a.messages).includes('ORIGINAL_RESEARCH_A'));
  assert.ok(!JSON.stringify(b.messages).includes('ORIGINAL_RESEARCH_A'));
  for (const [peer, marker] of [[a, 'NEW_PRIVATE_A'], [b, 'NEW_PRIVATE_B']]) { peer.ws.send(JSON.stringify({ type: 'message', content: marker })); await until(() => JSON.stringify(peer.messages).includes(marker), 'persisted workspace message'); }
  assert.ok(!JSON.stringify(a.messages).includes('NEW_PRIVATE_B')); assert.ok(!JSON.stringify(b.messages).includes('NEW_PRIVATE_A'));
  viewer.ws.send(JSON.stringify({ type: 'message', content: 'VIEWER_MUST_NOT_PERSIST' }));
  assert.equal((await api.request('/api/agent/local-agent', { auth: carol, workspaceId: f.b.id, method: 'DELETE' })).status, 403);
  assert.equal((await api.request('/api/agent/local-agent', { auth: alice, workspaceId: f.a.id, method: 'DELETE', csrf: false })).status, 403);
  await until(() => JSON.stringify(a.messages).includes('_NORMAL'), 'ordinary model response before explicit round');
  // Existing response cooldown is 2200 ms. Do not disable it or count a skipped
  // branch as a completed round; request the next round after that boundary.
  await delay(2300);
  a.ws.send(JSON.stringify({ type: 'message', content: '/ground' }));
  for (const provider of ['local-test', 'cloud-test']) {
    await until(() => JSON.stringify(a.messages).includes('SYNTHETIC_BUSINESS_REPLY_' + provider + '_GROUND'), 'actual full-round provider response ' + provider, 20000).catch(error => {
      const errorLogs = [f.packageRoot, f.candidateRoot].map(root => path.join(root, 'logs', 'error.log')).filter(file => fs.existsSync(file)).map(file => fs.readFileSync(file, 'utf8').slice(-3500));
      error.message += '\n' + JSON.stringify({ frames: a.messages.slice(-6), calls: f.calls.map(c => ({ path: c.path, ground: JSON.stringify(c.body).includes('GROUND:') })), logs: running.logs().slice(-2000), errorLogs }); throw error;
    });
    const call = f.calls.find(c => c.path === '/' + provider + '/v1/chat/completions' && JSON.stringify(c.body).includes('GROUND:')); assert.ok(call);
    assert.ok(JSON.stringify(call.body).includes('ORIGINAL_RESEARCH_A')); assert.ok(!JSON.stringify(call.body).includes('NEW_PRIVATE_B'));
  }
  assert.ok(f.calls.every(call => !JSON.stringify(call.body).includes('NEW_PRIVATE_B')));
  for (const peer of [a, b, viewer]) peer.ws.terminate();
  assert.deepEqual(await stop(running), [0, null]);
  const db = new Database(path.join(f.candidateRoot, 'db', 'lack.db'), { readonly: true });
  try { assert.equal(db.prepare("SELECT count(*) AS n FROM messages WHERE content='VIEWER_MUST_NOT_PERSIST'").get().n, 0); assert.equal(db.prepare("SELECT url FROM research_sources WHERE id='citation'").get().url, 'https://example.com/original'); assert.equal(JSON.parse(db.prepare("SELECT data FROM research_sessions WHERE id='research'").get().data).missingEvidence, true); } finally { db.close(); }
  const restarted = start(f, f.candidateRoot);
  await until(() => restarted.logs().includes('PUBLIC_RUNTIME_READY') || restarted.process.exitCode !== null, 'restart'); assert.equal(restarted.process.exitCode, null, restarted.logs());
  const nextAlice = await api.login('alice'), nextBob = await api.login('bob');
  const nextA = await api.open(t, nextAlice, f.a.id), nextB = await api.open(t, nextBob, f.b.id);
  assert.ok(JSON.stringify(nextA.messages).includes('NEW_PRIVATE_A')); assert.ok(!JSON.stringify(nextA.messages).includes('NEW_PRIVATE_B'));
  assert.ok(JSON.stringify(nextB.messages).includes('NEW_PRIVATE_B')); assert.ok(!JSON.stringify(nextB.messages).includes('NEW_PRIVATE_A'));
  const closed = once(nextA.ws, 'close'); assert.equal((await api.request('/auth/logout', { auth: nextAlice, method: 'POST', body: {} })).status, 200); assert.equal((await closed)[0], 1008);
  nextB.ws.terminate(); assert.deepEqual(await stop(restarted), [0, null]);
  const legacy = start(f, f.recovered.legacyDataRoot, true);
  await until(() => legacy.logs().includes('LEGACY_READY') || legacy.process.exitCode !== null, 'legacy-compatible recovered runtime'); assert.equal(legacy.process.exitCode, null, legacy.logs());
  assert.equal((await api.request('/health')).status, 200);
  const old = await api.open(t, null, null, true);
  assert.ok(JSON.stringify(old.messages).includes('ORIGINAL_RESEARCH_A')); assert.ok(!JSON.stringify(old.messages).includes('NEW_PRIVATE_A'));
  old.ws.terminate(); assert.deepEqual(await stop(legacy), [0, null]);
  const oldDb = new Database(path.join(f.recovered.legacyDataRoot, 'db', 'lack.db'), { readonly: true });
  try { assert.equal(oldDb.prepare('SELECT content FROM unknown_notes').get().content, 'never discard'); assert.equal(oldDb.pragma('integrity_check', { simple: true }), 'ok'); } finally { oldDb.close(); }
  assert.deepEqual({ main: hash(f.sourceDb), wal: hash(f.sourceDb + '-wal'), config: hash(path.join(f.sourceRoot, 'config', 'lack.config.json')) }, f.sourceBefore);
});
