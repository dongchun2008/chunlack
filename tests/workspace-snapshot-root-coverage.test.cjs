'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const Database = require('better-sqlite3');
const { prepareWorkspaceSnapshot, verifyWorkspaceSnapshot } = require('../scripts/workspace-snapshot.cjs');
const { prepareWorkspaceRestoreTrial, verifyWorkspaceRestoreTrial } = require('../scripts/workspace-restore-trial.cjs');
const { prepareMigrationRecovery, verifyMigrationRecovery } = require('../scripts/workspace-migration-recovery.cjs');
const { planMigration } = require('../scripts/migrate-workspaces.cjs');

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function put(root, relative, bytes) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, bytes, { mode: 0o600 });
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chunlack-root-coverage-'));
  const sourceRoot = path.join(root, 'source'), snapshotRoot = path.join(root, 'snapshot'), restoreRoot = path.join(root, 'restore');
  fs.mkdirSync(sourceRoot, { mode: 0o700 });
  put(sourceRoot, 'config/lack.config.json', '{"llm":{"defaultProvider":"ollama"}}');
  fs.mkdirSync(path.join(sourceRoot, 'db'), { mode: 0o700 });
  const db = new Database(path.join(sourceRoot, 'db/lack.db'));
  db.exec('CREATE TABLE messages (id INTEGER PRIMARY KEY, content TEXT); INSERT INTO messages VALUES (1, \'synthetic source\')');
  db.close();
  if (process.platform !== 'win32') fs.chmodSync(path.join(sourceRoot, 'db/lack.db'), 0o600);
  t.after(() => {
    const absolute = path.resolve(root);
    if (path.dirname(absolute) !== path.resolve(os.tmpdir()) || !path.basename(absolute).startsWith('chunlack-root-coverage-')) throw new Error('unsafe cleanup');
    fs.rmSync(absolute, { recursive: true, force: true });
  });
  return { root, sourceRoot, snapshotRoot, restoreRoot };
}
function seal(root, transform) {
  const file = path.join(root, 'manifest.json');
  const value = JSON.parse(fs.readFileSync(file)); transform(value);
  const bytes = Buffer.from(JSON.stringify(value)); fs.writeFileSync(file, bytes);
  const marker = path.join(root, 'snapshot-state.json'), state = JSON.parse(fs.readFileSync(marker));
  state.manifestSha256 = sha(bytes); fs.writeFileSync(marker, JSON.stringify(state));
}
function oldSnapshot(f) {
  const id = '11111111-1111-4111-8111-111111111111';
  fs.mkdirSync(f.snapshotRoot, { mode: 0o700 });
  const original = fs.readFileSync(path.join(f.sourceRoot, 'config/lack.config.json'));
  const candidate = Buffer.from('{"multiUser":{"migrationReady":false}}');
  const database = fs.readFileSync(path.join(f.sourceRoot, 'db/lack.db'));
  const records = [
    { relativePath: 'archive/config/lack.config.json', kind: 'file', bytes: original.length, sha256: sha(original) },
    { relativePath: 'candidate/config/lack.config.json', kind: 'config', bytes: candidate.length, sha256: sha(candidate) },
    { relativePath: 'candidate/db/lack.db', kind: 'sqlite', bytes: database.length, sha256: sha(database), tables: [{ name: 'messages', count: 1 }] }
  ];
  put(f.snapshotRoot, records[0].relativePath, original); put(f.snapshotRoot, records[1].relativePath, candidate); put(f.snapshotRoot, records[2].relativePath, database);
  const manifest = Buffer.from(JSON.stringify({ version: 1, kind: 'chunlack-offline-preparation', snapshotId: id,
    migrationReady: false, restoreReady: false, applicationConsistency: 'not_proven', scope: 'configured_database_allowlist_and_inventoried_files',
    permissionEvidence: process.platform === 'win32' ? 'windows_acl_not_verified' : 'private_posix_modes', unresolved: [], records }));
  put(f.snapshotRoot, 'manifest.json', manifest);
  put(f.snapshotRoot, 'snapshot-state.json', JSON.stringify({ version: 1, snapshotId: id, status: 'prepared', migrationReady: false, manifestSha256: sha(manifest) }));
}

test('unknown memories, repositories and extra config/db bytes are privately archived and independently restored', async t => {
  const f = fixture(t);
  const files = {
    'agent_memories/research.json': '{"claim":"missing_evidence","url":"https://example.com/original"}',
    'lack_repos/project/readme.txt': 'retained project',
    'workspace/report.txt': 'retained work',
    'lineage/history.json': '{"verified":false}',
    'config/extra-private.json': 'synthetic-private-config',
    'db/unclassified.db': 'opaque bytes, not a SQLite database',
    'root-note.txt': 'retained root file'
  };
  for (const [relative, bytes] of Object.entries(files)) put(f.sourceRoot, relative, bytes);
  fs.mkdirSync(path.join(f.sourceRoot, 'git'), { mode: 0o700 });
  fs.mkdirSync(path.join(f.sourceRoot, 'memory/empty'), { recursive: true, mode: 0o700 });
  const result = await prepareWorkspaceSnapshot(f);
  assert.equal(result.formatVersion, 2);
  assert.equal(result.scope, 'bounded_complete_root_inventory');
  assert.equal(result.verificationMode, 'offline_package_integrity');
  assert.equal(result.migrationReady, false); assert.equal(result.restoreReady, false);
  assert.equal(result.applicationConsistency, 'not_proven');
  for (const [relative, bytes] of Object.entries(files)) {
    assert.equal(fs.readFileSync(path.join(f.snapshotRoot, 'archive/legacy-root', relative), 'utf8'), bytes);
    assert.equal(fs.existsSync(path.join(f.snapshotRoot, 'candidate', relative)), false);
  }
  assert.equal(fs.statSync(path.join(f.snapshotRoot, 'archive/legacy-root/git')).isDirectory(), true);
  assert.equal(fs.statSync(path.join(f.snapshotRoot, 'candidate/memory/empty')).isDirectory(), true);
  const restored = prepareWorkspaceRestoreTrial(f);
  assert.equal(restored.formatVersion, 2); assert.equal(restored.directoryCount, result.directoryCount);
  for (const [relative, bytes] of Object.entries(files)) assert.equal(fs.readFileSync(path.join(f.restoreRoot, 'payload/archive/legacy-root', relative), 'utf8'), bytes);
  assert.deepEqual(fs.readdirSync(path.join(f.restoreRoot, 'payload/archive/legacy-root/git')), []);
  const dry = planMigration({ sourceRoot: f.sourceRoot, targetRoot: path.join(f.root, 'future') });
  assert.equal(dry.readyToApply, false);
  assert.ok(dry.unresolved.some(x => x.code === 'unclassified_root_entry'));
  assert.ok(dry.unresolved.some(x => x.code === 'explicit_ownership_required'));
  assert.equal(JSON.stringify(result).includes('synthetic-private-config'), false);
});

test('missing or unlisted empty directories invalidate v2 packages and restored payloads', async t => {
  const f = fixture(t); fs.mkdirSync(path.join(f.sourceRoot, 'home'), { mode: 0o700 });
  await prepareWorkspaceSnapshot(f); prepareWorkspaceRestoreTrial(f);
  const original = path.join(f.snapshotRoot, 'archive/legacy-root/home'); fs.rmdirSync(original);
  assert.throws(() => verifyWorkspaceSnapshot(f.snapshotRoot));
  fs.mkdirSync(original, { mode: 0o700 });
  fs.mkdirSync(path.join(f.snapshotRoot, 'unlisted-empty'), { mode: 0o700 });
  assert.throws(() => verifyWorkspaceSnapshot(f.snapshotRoot), { code: 'snapshot_unlisted_directory' });
  fs.rmdirSync(path.join(f.restoreRoot, 'payload/archive/legacy-root/home'));
  assert.throws(() => verifyWorkspaceRestoreTrial(f.restoreRoot));
});

test('resealed coverage cannot drop an archived source, duplicate a target or relabel a database', async t => {
  for (const mutation of ['missing', 'duplicate', 'database']) {
    const f = fixture(t); put(f.sourceRoot, 'agent_memories/a.json', '{}'); await prepareWorkspaceSnapshot(f);
    seal(f.snapshotRoot, manifest => {
      assert.ok(Array.isArray(manifest.sourceInventory));
      if (mutation === 'missing') manifest.sourceInventory = manifest.sourceInventory.filter(x => x.relativePath !== 'agent_memories/a.json');
      if (mutation === 'duplicate') manifest.records.push({ ...manifest.records[0] });
      if (mutation === 'database') manifest.records.find(x => x.relativePath === 'archive/legacy-root/agent_memories/a.json').kind = 'sqlite';
    });
    assert.throws(() => verifyWorkspaceSnapshot(f.snapshotRoot));
  }
});

test('source empty-directory changes during preparation fail closed', async t => {
  const f = fixture(t); put(f.sourceRoot, 'agent_memories/a.json', '{}');
  const selected = path.join(f.sourceRoot, 'agent_memories/a.json'), open = fs.openSync; let reads = 0;
  t.mock.method(fs, 'openSync', function(file, flags, ...args) {
    if (file === selected && typeof flags === 'number' && ++reads === 2) fs.mkdirSync(path.join(f.sourceRoot, 'new-empty'), { mode: 0o700 });
    return open.call(fs, file, flags, ...args);
  });
  await assert.rejects(prepareWorkspaceSnapshot(f), { code: 'snapshot_source_changed' });
  const marker = JSON.parse(fs.readFileSync(path.join(f.snapshotRoot, 'snapshot-state.json')));
  assert.equal(marker.status, 'failed'); assert.equal(marker.migrationReady, false);
});

test('unknown linked directories are rejected before creating the snapshot', async t => {
  const f = fixture(t), external = path.join(f.root, 'external'); fs.mkdirSync(external);
  fs.symlinkSync(external, path.join(f.sourceRoot, 'agent_memories'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(prepareWorkspaceSnapshot(f), { code: 'snapshot_link_denied' });
  assert.equal(fs.existsSync(f.snapshotRoot), false);
});

test('directory entries count toward the bounded source limit', async t => {
  const f = fixture(t), many = path.join(f.sourceRoot, 'many'); fs.mkdirSync(many);
  for (let i = 0; i < 4096; i++) fs.mkdirSync(path.join(many, 'd' + i));
  await assert.rejects(prepareWorkspaceSnapshot(f), { code: 'snapshot_inventory_limit' });
  assert.equal(fs.existsSync(f.snapshotRoot), false);
});

test('independent old-format fixture stays readable with an explicit partial scope', t => {
  const f = fixture(t); oldSnapshot(f);
  const result = verifyWorkspaceSnapshot(f.snapshotRoot);
  assert.equal(result.formatVersion, 1);
  assert.equal(result.scope, 'configured_database_allowlist_and_inventoried_files');
  assert.equal(result.sourceCoverage, 'legacy_partial_scope');
  const restored = prepareWorkspaceRestoreTrial(f); assert.equal(restored.formatVersion, 1);
  assert.equal(restored.sourceCoverage, 'legacy_partial_scope');
  assert.equal(verifyWorkspaceRestoreTrial(f.restoreRoot).status, 'verified');
});

test('unknown snapshot versions cannot create a restore destination', t => {
  const f = fixture(t); oldSnapshot(f);
  seal(f.snapshotRoot, value => { value.version = 99; });
  assert.throws(() => prepareWorkspaceRestoreTrial(f), { code: 'snapshot_metadata_invalid' });
  assert.equal(fs.existsSync(f.restoreRoot), false);
});

test('failed-candidate recovery retains v2 empty directories and opaque archives without activating them', async t => {
  const f = fixture(t); put(f.sourceRoot, 'db/unclassified.db', 'not a database');
  fs.mkdirSync(path.join(f.sourceRoot, 'thread_repos'), { mode: 0o700 });
  const snapshot = await prepareWorkspaceSnapshot(f);
  const candidateRoot = path.join(f.root, 'failed-candidate'), recoveryRoot = path.join(f.root, 'recovered');
  fs.mkdirSync(candidateRoot, { mode: 0o700 });
  fs.mkdirSync(path.join(candidateRoot, 'quarantine'), { mode: 0o700 });
  fs.cpSync(f.snapshotRoot, path.join(candidateRoot, 'quarantine/snapshot'), { recursive: true });
  put(candidateRoot, 'migration-state.json', JSON.stringify({ version: 1, instanceId: randomUUID(), snapshotId: snapshot.snapshotId,
    planSha256: '0'.repeat(64), status: 'failed', migrationReady: false }));
  if (process.platform !== 'win32') {
    const copiedSnapshot = path.join(candidateRoot, 'quarantine/snapshot');
    fs.chmodSync(copiedSnapshot, 0o755);
    assert.throws(() => prepareMigrationRecovery({ candidateRoot,
      recoveryRoot: path.join(f.root, 'insecure-copy-recovery'), reviewed: true }),
    { code: 'snapshot_permissions_invalid' });
    const makeCopiedDirectoriesPrivate = directory => {
      fs.chmodSync(directory, 0o700);
      for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
        assert.equal(item.isSymbolicLink(), false);
        if (item.isDirectory()) makeCopiedDirectoriesPrivate(path.join(directory, item.name));
      }
    };
    makeCopiedDirectoriesPrivate(copiedSnapshot);
  }
  const result = prepareMigrationRecovery({ candidateRoot, recoveryRoot, reviewed: true });
  assert.equal(result.status, 'verified'); assert.equal(result.migrationReady, false);
  assert.equal(fs.readFileSync(path.join(recoveryRoot, 'snapshot-trial/payload/archive/legacy-root/db/unclassified.db'), 'utf8'), 'not a database');
  assert.deepEqual(fs.readdirSync(path.join(recoveryRoot, 'snapshot-trial/payload/archive/legacy-root/thread_repos')), []);
  assert.equal(fs.existsSync(path.join(recoveryRoot, 'legacy-data/db/unclassified.db')), false);
  assert.equal(verifyMigrationRecovery(recoveryRoot).status, 'verified');
});
