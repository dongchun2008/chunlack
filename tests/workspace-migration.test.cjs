'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {createHash} = require('node:crypto');
const {spawnSync} = require('node:child_process');
const Database = require('better-sqlite3');
const repo = path.resolve(__dirname, '..');
function hash(file) {return createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-migration-plan-'));
  const sourceRoot = path.join(root, 'source'), targetRoot = path.join(root, 'candidate');
  fs.mkdirSync(path.join(sourceRoot, 'db'), {recursive: true}); fs.mkdirSync(path.join(sourceRoot, 'config'));
  fs.mkdirSync(path.join(sourceRoot, 'memory')); fs.mkdirSync(path.join(sourceRoot, 'attachments'));
  fs.writeFileSync(path.join(sourceRoot, 'config', 'lack.config.json'), JSON.stringify({llmProvider: 'ollama', defaultModel: 'legacy-custom-model',
    apiKey: 'DO_NOT_PRINT_THIS_KEY', agents: [{id: 'old-agent', name: 'Old Agent', model: 'custom-quant-model'}], llmProviders: [{id: 'private-llama', baseUrl: 'http://127.0.0.1:8080/v1'}]}));
  fs.writeFileSync(path.join(sourceRoot, 'memory', 'agent-memories.json'), JSON.stringify({agent: {summary: 'original memory', sourceUrl: 'https://example.com/original'}}));
  fs.writeFileSync(path.join(sourceRoot, 'attachments', 'original.bin'), Buffer.from([0, 1, 2, 255]));
  const dbPath = path.join(sourceRoot, 'db', 'lack.db'), db = new Database(dbPath);
  db.pragma('journal_mode=WAL'); db.pragma('wal_autocheckpoint=0');
  for (const name of ['messages', 'agents', 'agent_memory', 'project_states', 'pipeline_results', 'loop_health']) {
    db.exec('CREATE TABLE ' + name + '(id TEXT PRIMARY KEY, content TEXT)'); db.prepare('INSERT INTO ' + name + ' VALUES(?,?)').run(name + '_1', 'original data');
  }
  db.exec('CREATE TABLE unknown_notes(id TEXT, content TEXT)'); db.prepare('INSERT INTO unknown_notes VALUES(?,?)').run('unknown', 'must not silently discard');
  t.after(() => {db.close(); const absolute = path.resolve(root); if (!absolute.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe test cleanup'); fs.rmSync(absolute, {recursive: true, force: true});});
  return {root, sourceRoot, targetRoot, db, dbPath, workspaceId: 'ws_explicit', ownerId: 'user_explicit'};
}

test('dry-run inventories six legacy tables and unknown ownership without modifying source bytes or creating a candidate', t => {
  const input = fixture(t), {planMigration} = require('../scripts/migrate-workspaces.cjs');
  const config = path.join(input.sourceRoot, 'config', 'lack.config.json'), memory = path.join(input.sourceRoot, 'memory', 'agent-memories.json');
  const before = [hash(input.dbPath), hash(config), hash(memory)], plan = planMigration(input);
  assert.equal(plan.mode, 'dry-run'); assert.equal(plan.readyToApply, false);
  assert.equal(plan.tables.filter(item => item.classification === 'workspace').length, 6);
  for (const name of ['messages', 'agents', 'agent_memory', 'project_states', 'pipeline_results', 'loop_health']) assert.equal(plan.tables.find(item => item.name === name).rows, 1);
  assert.ok(plan.unresolved.some(item => item.code === 'unknown_table' && item.name === 'unknown_notes'));
  assert.ok(plan.unresolved.some(item => item.code === 'owner_identity_requires_bootstrap'));
  assert.equal(plan.models.agents[0].provider, 'ollama'); assert.equal(plan.models.agents[0].model, 'custom-quant-model');
  assert.ok(plan.files.some(item => item.relativePath === 'memory/agent-memories.json' && item.sha256 === before[2]));
  assert.ok(plan.files.some(item => item.relativePath === 'attachments/original.bin'));
  assert.ok(!JSON.stringify(plan).includes('DO_NOT_PRINT_THIS_KEY'));
  assert.deepEqual([hash(input.dbPath), hash(config), hash(memory)], before); assert.equal(fs.existsSync(input.targetRoot), false);
});

test('actual SQLite online backup includes committed WAL rows while preserving the open source writer and bytes', async t => {
  const input = fixture(t), {backupDatabase} = require('../scripts/migrate-workspaces.cjs');
  for (let i = 0; i < 50; i++) input.db.prepare('INSERT INTO messages VALUES(?,?)').run('wal_' + i, 'committed WAL row');
  const mainBefore = hash(input.dbPath), walBefore = hash(input.dbPath + '-wal');
  const backupRoot = path.join(input.root, 'snapshots'); fs.mkdirSync(backupRoot);
  const destination = path.join(backupRoot, 'snapshot.db');
  const result = await backupDatabase({sourcePath: input.dbPath, targetPath: destination});
  assert.equal(result.method, 'sqlite-online-backup'); assert.equal(result.integrity, 'ok');
  const copy = new Database(destination, {readonly: true, fileMustExist: true});
  try {assert.equal(copy.prepare('SELECT count(*) n FROM messages').get().n, 51); assert.equal(copy.pragma('integrity_check', {simple: true}), 'ok'); assert.deepEqual(copy.pragma('foreign_key_check'), []);} finally {copy.close();}
  assert.equal(hash(input.dbPath), mainBefore); assert.equal(hash(input.dbPath + '-wal'), walBefore);
  input.db.prepare('INSERT INTO messages VALUES(?,?)').run('writer_still_usable', 'not stopped');
  assert.equal(input.db.prepare('SELECT count(*) n FROM messages').get().n, 52);
});

test('backup never overwrites an existing destination or changes it on failure', async t => {
  const input = fixture(t), {backupDatabase} = require('../scripts/migrate-workspaces.cjs');
  const destination = path.join(input.root, 'existing.db'); fs.writeFileSync(destination, 'keep original candidate bytes'); const before = hash(destination);
  await assert.rejects(backupDatabase({sourcePath: input.dbPath, targetPath: destination}), /migration_target_exists/);
  assert.equal(hash(destination), before);
});

test('planning rejects nonempty, overlapping and linked candidate/source paths before any candidate writes', t => {
  const input = fixture(t), {planMigration} = require('../scripts/migrate-workspaces.cjs');
  fs.mkdirSync(input.targetRoot); fs.writeFileSync(path.join(input.targetRoot, 'keep.txt'), 'existing bytes');
  assert.throws(() => planMigration(input), /migration_target_not_empty/);
  assert.throws(() => planMigration({...input, targetRoot: path.join(input.sourceRoot, 'candidate')}), /migration_roots_overlap/);
  const linked = path.join(input.root, 'linked-source'); fs.symlinkSync(input.sourceRoot, linked, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => planMigration({...input, sourceRoot: linked, targetRoot: path.join(input.root, 'other-candidate')}), /migration_linked_path_denied/);
  assert.equal(fs.readFileSync(path.join(input.targetRoot, 'keep.txt'), 'utf8'), 'existing bytes');
});

test('malformed config and absent ownership never become a migration-ready publication', t => {
  const input = fixture(t), {planMigration, applyMigration} = require('../scripts/migrate-workspaces.cjs');
  const plan = planMigration({...input, workspaceId: undefined, ownerId: undefined});
  assert.ok(plan.unresolved.some(item => item.code === 'explicit_ownership_required'));
  assert.throws(() => applyMigration(plan), /migration_apply_not_ready/);
  assert.equal(fs.existsSync(input.targetRoot), false);
  fs.writeFileSync(path.join(input.sourceRoot, 'config', 'lack.config.json'), '{malformed');
  assert.throws(() => planMigration(input), /migration_config_invalid/);
});

test('CLI defaults to a redacted dry-run and explicit apply fails closed while migration implementation is incomplete', t => {
  const input = fixture(t), args = ['scripts/migrate-workspaces.cjs', '--source-root', input.sourceRoot, '--target-root', input.targetRoot, '--workspace-id', input.workspaceId, '--owner-id', input.ownerId];
  const read = spawnSync(process.execPath, args, {cwd: repo, encoding: 'utf8', timeout: 5000, windowsHide: true});
  assert.equal(read.status, 0); assert.equal(JSON.parse(read.stdout).mode, 'dry-run'); assert.ok(!read.stdout.includes('DO_NOT_PRINT_THIS_KEY')); assert.equal(fs.existsSync(input.targetRoot), false);
  const apply = spawnSync(process.execPath, [...args, '--apply'], {cwd: repo, encoding: 'utf8', timeout: 5000, windowsHide: true});
  assert.equal(apply.status, 2); assert.match(apply.stdout, /migration_apply_not_ready/); assert.equal(fs.existsSync(input.targetRoot), false);
});
