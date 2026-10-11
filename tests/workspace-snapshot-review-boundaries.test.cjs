'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { createIdentityStore } = require('../identity/store.cjs');
const { hashPassword } = require('../identity/passwords.cjs');
const { prepareWorkspaceSnapshot, verifyWorkspaceSnapshot } = require('../scripts/workspace-snapshot.cjs');
const { prepareWorkspaceRestoreTrial } = require('../scripts/workspace-restore-trial.cjs');
const { planMigration, applyMigration, verifyMigration } = require('../scripts/migrate-workspaces.cjs');
const { prepareMigrationRecovery } = require('../scripts/workspace-migration-recovery.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chunlack-review-boundary-'));
  const sourceRoot = path.join(root, 'source'), snapshotRoot = path.join(root, 'snapshot'), restoreRoot = path.join(root, 'restore');
  for (const folder of ['config','db']) fs.mkdirSync(path.join(sourceRoot, folder), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(sourceRoot, 'config/lack.config.json'), '{"llmProvider":"ollama","defaultModel":"private-quant","agents":[],"llmProviders":[{"id":"ollama","local":true}]}', { mode: 0o600 });
  const db = new Database(path.join(sourceRoot, 'db/lack.db'));
  db.exec(`CREATE TABLE agents(id TEXT PRIMARY KEY,name TEXT,model TEXT,provider TEXT,system_prompt TEXT,channels TEXT,strict_channel TEXT,status TEXT,is_embed_operator INTEGER,is_code_moderator INTEGER);
    INSERT INTO agents VALUES('agent','Synthetic Agent','private-quant','ollama','synthetic','["general"]',NULL,'idle',0,0);
    CREATE TABLE messages(id TEXT PRIMARY KEY,store_id TEXT,sender TEXT,sender_type TEXT,content TEXT,timestamp INTEGER,parent_id TEXT,thread_id TEXT,reply_count INTEGER,reactions TEXT);
    INSERT INTO messages VALUES('message','general','Synthetic Human','human','synthetic',10,NULL,NULL,0,'{}');
    CREATE TABLE agent_memory(agent_id TEXT PRIMARY KEY,e_pool TEXT,x_pool TEXT,weights TEXT,stats TEXT,last_update INTEGER);
    CREATE TABLE project_states(store_id TEXT PRIMARY KEY,state TEXT,timestamp INTEGER);
    CREATE TABLE pipeline_results(id TEXT PRIMARY KEY,agent_id TEXT,thread_id TEXT,code_hash TEXT,passed INTEGER,attempt INTEGER,feedback TEXT,timestamp INTEGER);
    CREATE TABLE loop_health(loop_id TEXT PRIMARY KEY,loop_type TEXT,iterations INTEGER,convergence REAL,stagnation REAL,token_spend INTEGER,last_update INTEGER);
    CREATE TABLE research_sessions(id TEXT PRIMARY KEY,data TEXT,timestamp INTEGER);
    CREATE TABLE research_sources(id TEXT PRIMARY KEY,research_id TEXT,url TEXT,title TEXT,excerpt TEXT,timestamp INTEGER);`);
  db.close();
  t.after(() => {
    const absolute = path.resolve(root);
    if (path.dirname(absolute) !== path.resolve(os.tmpdir()) || !path.basename(absolute).startsWith('chunlack-review-boundary-')) throw new Error('unsafe fixture cleanup');
    fs.rmSync(absolute, { recursive: true, force: true });
  });
  return { root, sourceRoot, snapshotRoot, restoreRoot };
}

test('the approved source depth twelve survives existing preflight and independent restore', async t => {
  const f = fixture(t), relative = 'memory/' + Array.from({ length: 11 }, (_, i) => 'd' + i).join('/');
  fs.mkdirSync(path.join(f.sourceRoot, relative), { recursive: true, mode: 0o700 });
  assert.equal((await prepareWorkspaceSnapshot(f)).status, 'verified');
  prepareWorkspaceRestoreTrial(f);
  assert.deepEqual(fs.readdirSync(path.join(f.restoreRoot, 'payload/candidate', relative)), []);
});

test('case-equivalent Windows overlap is denied before the source snapshot can be modified', async t => {
  const f = fixture(t); await prepareWorkspaceSnapshot(f);
  const sourceAlias = process.platform === 'win32' ? f.snapshotRoot.toUpperCase() : f.snapshotRoot;
  const restoreRoot = path.join(sourceAlias, 'nested-restore');
  assert.throws(() => prepareWorkspaceRestoreTrial({ snapshotRoot: f.snapshotRoot, restoreRoot }), { code: 'restore_roots_overlap' });
  assert.equal(fs.existsSync(restoreRoot), false);
  assert.equal(verifyWorkspaceSnapshot(f.snapshotRoot).status, 'verified');
});

test('ordinary db/sqlite attachments stay opaque through actual reviewed migration and recovery', async t => {
  const f = fixture(t), targetRoot = path.join(f.root, 'candidate');
  fs.mkdirSync(path.join(f.sourceRoot, 'uploads/empty'), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(f.sourceRoot, 'uploads/document.db'), 'ordinary attachment, not SQLite', { mode: 0o600 });
  fs.writeFileSync(path.join(f.sourceRoot, 'uploads/document.sqlite'), 'also ordinary attachment', { mode: 0o600 });
  const identitySourcePath = path.join(f.root, 'identity.sqlite'), identity = createIdentityStore({ dbPath: identitySourcePath });
  let owner;
  try { owner = identity.bootstrapIdentity({ login: 'synthetic-boundary-owner', passwordHash: await hashPassword('synthetic-boundary-password'), workspaceName: 'Synthetic boundary workspace' }); }
  finally { identity.close(); }
  const plan = planMigration({ sourceRoot: f.sourceRoot, targetRoot, workspaceId: owner.workspace.id, ownerId: owner.user.id });
  await prepareWorkspaceSnapshot(f);
  const result = await applyMigration(plan, { reviewed: true, snapshotRoot: f.snapshotRoot, identitySourcePath, modelGrants: { ollama: { models: ['private-quant'] } } });
  assert.equal(result.status, 'verified');
  assert.equal(fs.readFileSync(path.join(targetRoot, 'workspaces', owner.workspace.id, 'uploads/document.db'), 'utf8'), 'ordinary attachment, not SQLite');
  const recoveryRoot = path.join(f.root, 'recovery');
  assert.equal(prepareMigrationRecovery({ candidateRoot: targetRoot, recoveryRoot, reviewed: true }).status, 'verified');
  assert.equal(fs.readFileSync(path.join(recoveryRoot, 'legacy-data/uploads/document.sqlite'), 'utf8'), 'also ordinary attachment');
  assert.deepEqual(fs.readdirSync(path.join(recoveryRoot, 'legacy-data/uploads/empty')), []);
  fs.rmdirSync(path.join(targetRoot, 'quarantine/snapshot/candidate/uploads/empty'));
  assert.throws(() => verifyMigration(plan));
});
