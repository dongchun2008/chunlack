const test = require('node:test');
const assert = require('node:assert/strict');
const {execFileSync, spawn} = require('node:child_process');
const {once} = require('node:events');
const {setTimeout: delay} = require('node:timers/promises');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const {randomUUID} = require('node:crypto');
const Database = require('better-sqlite3');
const {createIdentityStore} = require('../identity/store.cjs');
const {createCollaborationStore} = require('../collaboration/store.cjs');

test('materialized server exports an explicit owned lifecycle instead of auto-starting on import', () => {
  const source = execFileSync('python', ['-X', 'utf8', '-c',
    'import ast; p=ast.parse(open("lack.py",encoding="utf-8").read()); print(next(ast.literal_eval(n.value) for n in p.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=="SERVER_JS" for t in n.targets)))'],
  {cwd: path.join(__dirname, '..'), encoding: 'utf8'});
  assert.equal(/module\.exports\s*=\s*\{[^}]*startLackRuntime/.test(source), true);
  assert.equal(/require\.main\s*===\s*module/.test(source), true);
});

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-public-runtime-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const identityPath = path.join(root, 'db', 'identity.db');
  const identity = createIdentityStore({dbPath: identityPath});
  const idb = new Database(identityPath), userId = randomUUID(), workspaceId = randomUUID(), now = Date.now();
  idb.prepare('INSERT INTO users VALUES(?,?,?,?,NULL)').run(userId, 'fixture-owner', 'synthetic-hash-not-a-login-credential', now);
  idb.prepare('INSERT INTO workspaces VALUES(?,?,?,NULL)').run(workspaceId, 'fixture workspace', now);
  idb.prepare('INSERT INTO memberships VALUES(?,?,?,1,?,?)').run(workspaceId, userId, 'owner', now, now);
  idb.close();
  const db = new Database(path.join(root, 'db', 'lack.db'));
  const store = createCollaborationStore({db, identity});
  db.prepare('INSERT INTO workspace_scopes VALUES(?)').run(workspaceId);
  store.close(); db.close(); identity.close();
  const config = {httpPort: 23721, multiUser: {enabled: true, migrationReady: true},
    agentGateway: {enabled: true, port: 23722, adminTokenEnv: 'FIXTURE_GATEWAY_TOKEN'},
    publicRuntime: {webOrigin: 'https://lack.fixture.invalid', agentsOrigin: 'https://agents.fixture.invalid', mcpPort: 23723}};
  return {root, config, userId, workspaceId, env: {FIXTURE_GATEWAY_TOKEN: 'x'.repeat(43)}};
}

async function fakeServer(options) {
  let ready = false, closed = false;
  const server = http.createServer((req, res) => {res.writeHead(ready ? 200 : 503); res.end('fixture');});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {server, gateway: {store: {}, workspaceAccess: {}}, isReady: () => ready,
    activate() {ready = true;}, async close() {if (closed) return; closed = true; server.closeAllConnections(); await new Promise(resolve => server.close(resolve));},
    supplied: options};
}

test('public runtime rejects legacy mode, incomplete migration and non-loopback configuration before allocating resources', async t => {
  const {startPublicRuntime} = require('../gateway/public-runtime.cjs'), f = fixture(t);
  let loaded = 0;
  const loadLack = () => {loaded++; return {startLackRuntime: fakeServer};};
  for (const config of [{...f.config, multiUser: {enabled: false}}, {...f.config, multiUser: {enabled: true}}, {...f.config, bindHost: '0.0.0.0'}, {...f.config, publicRuntime: {...f.config.publicRuntime, mcpPort: f.config.httpPort}}]) {
    await assert.rejects(startPublicRuntime({config, dataRoot: f.root, env: f.env, loadLack}), /public_|loopback_|migration_/);
  }
  assert.equal(loaded, 0);
  assert.equal(fs.existsSync(path.join(f.root, '.public-runtime.lock')), false);
});

test('public runtime validates real workspace ownership and quarantines old collaboration schema', async t => {
  const {startPublicRuntime} = require('../gateway/public-runtime.cjs'), f = fixture(t);
  const db = new Database(path.join(f.root, 'db', 'identity.db'));
  db.prepare('DELETE FROM memberships').run(); db.close();
  await assert.rejects(startPublicRuntime({config: f.config, dataRoot: f.root, env: f.env}), /migration_/);
  assert.equal(fs.existsSync(path.join(f.root, '.public-runtime.lock')), false);
});

test('runtime uses one identity and capacity instance, is not ready during MCP initialization and closes idempotently', async t => {
  const {startPublicRuntime} = require('../gateway/public-runtime.cjs'), f = fixture(t);
  let web, mcpClosed = 0;
  const runtime = await startPublicRuntime({config: f.config, dataRoot: f.root, env: f.env,
    loadLack: () => ({startLackRuntime: async options => (web = await fakeServer(options))}),
    startMcp: async options => {assert.equal(web.isReady(), false); assert.equal(options.gateway, web.gateway); return {close: async () => {mcpClosed++;}};}});
  assert.equal(web.supplied.identity, runtime.identity); assert.equal(web.supplied.capacity, runtime.capacity);
  assert.equal(web.isReady(), true);
  await assert.rejects(startPublicRuntime({config: f.config, dataRoot: f.root, env: f.env}), /public_writer_locked/);
  await runtime.close(); await runtime.close();
  assert.equal(mcpClosed, 1); assert.equal(web.server.listening, false);
  assert.equal(fs.existsSync(path.join(f.root, '.public-runtime.lock')), false);
});

test('half-start failure closes listeners and databases and releases only the owned writer lock', async t => {
  const {startPublicRuntime} = require('../gateway/public-runtime.cjs'), f = fixture(t); let web;
  await assert.rejects(startPublicRuntime({config: f.config, dataRoot: f.root, env: f.env,
    loadLack: () => ({startLackRuntime: async options => (web = await fakeServer(options))}),
    startMcp: async () => {throw new Error('synthetic_mcp_start_failed');}}), /synthetic_mcp_start_failed/);
  assert.equal(web.server.listening, false); assert.equal(fs.existsSync(path.join(f.root, '.public-runtime.lock')), false);
  const db = new Database(path.join(f.root, 'db', 'identity.db')); assert.equal(db.pragma('quick_check', {simple: true}), 'ok'); db.close();
  const runtime = await startPublicRuntime({config: f.config, dataRoot: f.root, env: f.env,
    loadLack: () => ({startLackRuntime: fakeServer}), startMcp: async () => ({close: async () => {}})});
  await runtime.close();
});

test('writer guard never automatically takes over a stale or replaced lock', async t => {
  const {startPublicRuntime} = require('../gateway/public-runtime.cjs'), f = fixture(t);
  const lock = path.join(f.root, '.public-runtime.lock');
  fs.writeFileSync(lock, 'synthetic prior-owner lock');
  await assert.rejects(startPublicRuntime({config: f.config, dataRoot: f.root, env: f.env}), /public_writer_locked/);
  assert.equal(fs.readFileSync(lock, 'utf8'), 'synthetic prior-owner lock');
});

test('capacity shutdown waits for actual transport settlement and reports an unresponsive operation', async t => {
  const capacity = require('../collaboration/capacity.cjs').createCapacityCoordinator();
  let settle; const work = capacity.submit({workspaceId: 'fixture', taskId: 'inflight', kind: 'model.generate', deadlineAt: Date.now() + 10000,
    run: () => new Promise(resolve => {settle = resolve;})});
  const rejected = assert.rejects(work, error => error.code === 'capacity_closed');
  await new Promise(resolve => setImmediate(resolve)); capacity.close();
  await assert.rejects(capacity.drain({timeoutMs: 20}), /capacity_shutdown_incomplete/);
  let drained = false; const drain = capacity.drain({timeoutMs: 1000}).then(() => {drained = true;});
  await delay(20); assert.equal(drained, false); settle(); await rejected; await drain;
  assert.equal(drained, true);
});

async function packageFixture(t) {
  const f = fixture(t), packageRoot = path.join(f.root, 'package');
  execFileSync('python', ['scripts/materialize.py', '--output', packageRoot], {cwd: path.join(__dirname, '..'), timeout: 10000, stdio: 'pipe'});
  const reservations = [];
  for (let i = 0; i < 3; i++) {const server = http.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); reservations.push(server);}
  [f.config.httpPort, f.config.agentGateway.port, f.config.publicRuntime.mcpPort] = reservations.map(server => server.address().port);
  for (const server of reservations) await new Promise(resolve => server.close(resolve));
  Object.assign(f.config, {llmProvider: 'ollama', embeddingProvider: 'none', autoPullModels: false, agents: [], jspaceEnabled: false});
  fs.mkdirSync(path.join(f.root, 'config')); fs.writeFileSync(path.join(f.root, 'config', 'lack.config.json'), JSON.stringify(f.config));
  return {...f, packageRoot, entry: path.join(packageRoot, 'gateway', 'public-runtime.cjs'),
    childEnv: {...process.env, ...f.env, NODE_PATH: path.join(__dirname, '..', 'node_modules')}};
}
function childRuntime(t, f) {
  const child = spawn(process.execPath, [path.join(__dirname, 'helpers', 'public-runtime-child.cjs'), f.entry, f.root],
    {env: f.childEnv, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true});
  let logs = ''; child.stdout.on('data', data => {logs += data;}); child.stderr.on('data', data => {logs += data;});
  const exited = once(child, 'exit');
  t.after(async () => {if (child.exitCode === null) {child.stdin.write('STOP\n'); await Promise.race([exited, delay(5000)]); if (child.exitCode === null) {child.kill(); await exited;}}});
  return {child, exited, logs: () => logs};
}
async function ready(f) {
  for (let i = 0; i < 160; i++) {if (f.logs().includes('PUBLIC_RUNTIME_READY')) return; if (f.child.exitCode !== null) break; await delay(50);}
  assert.fail('Actual packaged runtime not ready: ' + f.logs().slice(-1800));
}
test('actual materialized import allocates no data directory, listeners or retained startup timers', {timeout: 15000}, async t => {
  const f = await packageFixture(t);
  const result = execFileSync(process.execPath, ['-e', "require(process.argv[1]); console.log('IMPORT_ONLY_OK')", path.join(f.packageRoot, 'server.js')],
    {env: f.childEnv, timeout: 5000, encoding: 'utf8'});
  assert.equal(result.trim(), 'IMPORT_ONLY_OK'); assert.equal(fs.existsSync(path.join(f.packageRoot, 'db')), false);
  assert.equal(fs.existsSync(path.join(f.packageRoot, 'jspace')), false);
});
test('actual packaged web, node REST and MCP share a guarded lifecycle and restart after graceful close', {timeout: 25000}, async t => {
  const f = await packageFixture(t), configBefore = fs.readFileSync(path.join(f.root, 'config', 'lack.config.json'));
  const first = childRuntime(t, f); await ready(first);
  const request = port => `http://127.0.0.1:${port}`;
  assert.equal((await fetch(request(f.config.httpPort) + '/health')).status, 200);
  assert.equal((await fetch(request(f.config.httpPort) + '/login')).status, 200, 'code assets come from the package, not the private data root');
  assert.equal((await fetch(request(f.config.agentGateway.port) + '/v1/manifest')).status, 401);
  assert.equal((await fetch(request(f.config.publicRuntime.mcpPort) + '/mcp', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'})).status, 401);
  first.child.stdin.write('STOP\n'); assert.deepEqual(await first.exited, [0, null]);
  assert.match(first.logs(), /PUBLIC_RUNTIME_CLOSED/); assert.equal(fs.existsSync(path.join(f.root, '.public-runtime.lock')), false);
  assert.deepEqual(fs.readFileSync(path.join(f.root, 'config', 'lack.config.json')), configBefore);
  const second = childRuntime(t, f); await ready(second); second.child.stdin.write('STOP\n'); assert.deepEqual(await second.exited, [0, null]);
});
test('actual MCP port conflict rolls back web and gateway startup without leaving a writer lock', {timeout: 20000}, async t => {
  const f = await packageFixture(t), conflict = http.createServer();
  await new Promise(resolve => conflict.listen(f.config.publicRuntime.mcpPort, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => conflict.close(resolve)));
  const running = childRuntime(t, f); const exit = await running.exited;
  assert.equal(exit[0], 1); assert.ok(!running.logs().includes('PUBLIC_RUNTIME_READY'));
  assert.equal(fs.existsSync(path.join(f.root, '.public-runtime.lock')), false);
  for (const port of [f.config.httpPort, f.config.agentGateway.port]) await assert.rejects(fetch(`http://127.0.0.1:${port}/health`, {signal: AbortSignal.timeout(1000)}));
  assert.equal(conflict.listening, true, 'unrelated occupied service remains running');
});

test('legacy server entry cannot bypass the public data-root writer guard', {timeout: 20000}, async t => {
  const f = await packageFixture(t), running = childRuntime(t, f); await ready(running);
  try {
    const program = `const fs=require('node:fs'),path=require('node:path');const root=process.argv[2];const config=JSON.parse(fs.readFileSync(path.join(root,'config','lack.config.json'),'utf8'));require(process.argv[1]).startLackRuntime({config,dataRoot:root,env:{...process.env,LACK_MULTI_USER:'1',LACK_IDENTITY_DB:path.join(root,'db','identity.db'),LACK_WEB_ORIGIN:config.publicRuntime.webOrigin}}).then(r=>r.close()).catch(e=>console.log('DIRECT_START_ERROR='+e.message));`;
    const output = execFileSync(process.execPath, ['-e', program, path.join(f.packageRoot, 'server.js'), f.root], {env: f.childEnv, timeout: 5000, encoding: 'utf8'});
    assert.match(output, /DIRECT_START_ERROR=public_writer_lease_required/);
    assert.equal((await fetch(`http://127.0.0.1:${f.config.httpPort}/health`)).status, 200);
  } finally {running.child.stdin.write('STOP\n'); await running.exited;}
});

test('enabled public events validate persistent keys and workspace callback grants before runtime allocation', async t => {
  const {startPublicRuntime}=require('../gateway/public-runtime.cjs'), f=fixture(t); let loaded=0;
  const events={enabled:true,encryptionKeyEnv:'FIXTURE_EVENTS_KEY',allowedHosts:['callback.example'],workspaceCallbackHosts:{[f.workspaceId]:['callback.example']}};
  const config={...f.config,publicRuntime:{...f.config.publicRuntime,events}};
  await assert.rejects(startPublicRuntime({config,dataRoot:f.root,env:f.env,loadLack:()=>{loaded++;}}),/events_encryption_key_required/);
  await assert.rejects(startPublicRuntime({config:{...config,publicRuntime:{...config.publicRuntime,events:{...events,workspaceCallbackHosts:{[f.workspaceId]:['unapproved.example']}}}},dataRoot:f.root,
    env:{...f.env,FIXTURE_EVENTS_KEY:'ab'.repeat(32)},loadLack:()=>{loaded++;}}),/invalid_workspace_callback_grants/);
  assert.equal(loaded,0); assert.equal(fs.existsSync(path.join(f.root,'.public-runtime.lock')),false);
  assert.equal(fs.existsSync(path.join(f.root,'db','mcp-events.db')),false);
});

test('actual materialized runtime exposes scoped MCP Events and closes its event timer and database on restart', {timeout:25000}, async t=>{
  const f=await packageFixture(t);
  f.config.publicRuntime.events={enabled:true,encryptionKeyEnv:'FIXTURE_EVENTS_KEY',allowedHosts:['callback.example'],workspaceCallbackHosts:{[f.workspaceId]:['callback.example']}};
  fs.writeFileSync(path.join(f.root,'config','lack.config.json'),JSON.stringify(f.config));
  Object.assign(f.childEnv,{FIXTURE_EVENTS_KEY:'ab'.repeat(32),PUBLIC_EVENTS_FIXTURE_WORKSPACE:f.workspaceId,PUBLIC_EVENTS_FIXTURE_USER:f.userId});
  for(let i=0;i<2;i++){
    const running=childRuntime(t,f); await ready(running);
    assert.match(running.logs(),/PUBLIC_EVENTS_SCHEMA_OK/);
    assert.equal((await fetch(`http://127.0.0.1:${f.config.httpPort}/health`)).status,200);
    running.child.stdin.write('STOP\n'); assert.deepEqual(await running.exited,[0,null]);
    assert.equal(fs.existsSync(path.join(f.root,'.public-runtime.lock')),false);
    const db=new Database(path.join(f.root,'db','mcp-events.db'));
    assert.equal(db.pragma('quick_check',{simple:true}),'ok'); assert.equal(db.pragma('foreign_key_check').length,0); db.close();
  }
});
