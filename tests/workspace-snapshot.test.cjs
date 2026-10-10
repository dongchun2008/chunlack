'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const Database = require('better-sqlite3');
const { prepareWorkspaceSnapshot, verifyWorkspaceSnapshot } = require('../scripts/workspace-snapshot.cjs');

function sha(file) { return createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chunlack-snapshot-'));
  const sourceRoot = path.join(root, 'source');
  const snapshotRoot = path.join(root, 'snapshot');
  for (const name of ['config', 'db', 'memory', 'research', 'uploads', 'artifacts', 'attachments']) {
    fs.mkdirSync(path.join(sourceRoot, name), { recursive: true });
  }
  const config = {
    multiUser: { enabled: true, migrationReady: true },
    llm: { defaultProvider: 'ollama', defaultModel: 'retained-local-model', providers: [{ id: 'ollama', type: 'ollama' }, { id: 'lan-llama', type: 'openai-compatible', apiKey: 'synthetic-fixture-only' }] },
    agents: [{ id: 'research', provider: 'lan-llama', model: 'retained-custom-model' }]
  };
  fs.writeFileSync(path.join(sourceRoot, 'config', 'lack.config.json'), JSON.stringify(config));
  fs.writeFileSync(path.join(sourceRoot, 'memory', 'original.json'), JSON.stringify({ source: 'https://example.com/original', conclusion: 'missing_evidence', verified: false }));
  fs.writeFileSync(path.join(sourceRoot, 'research', 'sources.json'), '[{"url":"https://example.com/source","verified":false}]');
  fs.writeFileSync(path.join(sourceRoot, 'uploads', 'upload.bin'), Buffer.from([0, 1, 2, 253, 254, 255]));
  fs.writeFileSync(path.join(sourceRoot, 'attachments', 'attachment.bin'), Buffer.from([4, 5, 6]));
  fs.writeFileSync(path.join(sourceRoot, 'artifacts', 'task.json'), '{"taskId":"local-fixture","realVendor":false}');
  fs.writeFileSync(path.join(sourceRoot, 'unknown-private-file'), 'not in approved inventory');
  const db = new Database(path.join(sourceRoot, 'db', 'lack.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('wal_autocheckpoint = 0');
  for (const name of ['messages', 'agents', 'agent_memory', 'project_states', 'pipeline_results', 'loop_health', 'unknown_notes']) {
    db.exec('CREATE TABLE ' + name + ' (id INTEGER PRIMARY KEY, content TEXT)');
    db.prepare('INSERT INTO ' + name + ' (content) VALUES (?)').run('preserved');
  }
  for (let index = 0; index < 50; index++) db.prepare('INSERT INTO messages (content) VALUES (?)').run('wal-row-' + index);
  const identity = new Database(path.join(sourceRoot, 'db', 'identity.db'));
  identity.exec('CREATE TABLE users (id TEXT PRIMARY KEY); INSERT INTO users VALUES (\'fixture-owner\')');
  identity.close();
  t.after(() => {
    db.close();
    const absolute = path.resolve(root);
    if (!absolute.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(absolute).startsWith('chunlack-snapshot-')) throw new Error('unsafe fixture cleanup');
    fs.rmSync(absolute, { recursive: true, force: true });
  });
  return { root, sourceRoot, snapshotRoot, db, config };
}

function rewriteManifest(snapshotRoot, transform) {
  const manifestPath = path.join(snapshotRoot, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  transform(manifest);
  const bytes = Buffer.from(JSON.stringify(manifest));
  fs.writeFileSync(manifestPath, bytes);
  const markerPath = path.join(snapshotRoot, 'snapshot-state.json');
  const marker = JSON.parse(fs.readFileSync(markerPath));
  marker.manifestSha256 = createHash('sha256').update(bytes).digest('hex');
  fs.writeFileSync(markerPath, JSON.stringify(marker));
}

test('private snapshot preserves source WAL, original config, evidence and attachments; its candidate cannot activate', async t => {
  const f = fixture(t);
  const paths = ['config/lack.config.json', 'memory/original.json', 'research/sources.json', 'uploads/upload.bin', 'attachments/attachment.bin', 'artifacts/task.json', 'db/lack.db', 'db/lack.db-wal'];
  const hashes = paths.map(relative => sha(path.join(f.sourceRoot, relative)));
  const result = await prepareWorkspaceSnapshot(f);
  assert.equal(result.status, 'verified');
  assert.equal(result.migrationReady, false);
  assert.equal(result.restoreReady, false);
  assert.equal(result.applicationConsistency, 'not_proven');
  assert.deepEqual(paths.map(relative => sha(path.join(f.sourceRoot, relative))), hashes);
  assert.deepEqual(fs.readFileSync(path.join(f.snapshotRoot, 'archive/config/lack.config.json')), fs.readFileSync(path.join(f.sourceRoot, 'config/lack.config.json')));
  const candidateConfig = JSON.parse(fs.readFileSync(path.join(f.snapshotRoot, 'candidate/config/lack.config.json')));
  assert.equal(candidateConfig.multiUser.migrationReady, false);
  assert.deepEqual(candidateConfig.llm, f.config.llm);
  assert.deepEqual(candidateConfig.agents, f.config.agents);
  for (const relative of paths.filter(relative => /^(memory|research|uploads|attachments|artifacts)\//.test(relative))) {
    assert.equal(sha(path.join(f.snapshotRoot, 'candidate', relative)), sha(path.join(f.sourceRoot, relative)));
  }
  assert.equal(fs.existsSync(path.join(f.snapshotRoot, 'candidate/unknown-private-file')), false);
  assert.equal(result.databases.length, 2);
  for (const item of result.databases) {
    const copiedFile = path.join(f.snapshotRoot, item.relativePath);
    const copied = new Database(copiedFile, { readonly: true, fileMustExist: true });
    try { assert.equal(copied.pragma('journal_mode', { simple: true }), 'delete'); }
    finally { copied.close(); }
    assert.equal(fs.existsSync(copiedFile + '-wal'), false);
    assert.equal(fs.existsSync(copiedFile + '-shm'), false);
  }
  assert.equal(f.db.pragma('journal_mode', { simple: true }), 'wal');
  assert.equal(result.databases.find(item => item.relativePath.endsWith('/lack.db')).tables.find(item => item.name === 'messages').count, 51);
  assert.equal(result.databases.find(item => item.relativePath.endsWith('/lack.db')).tables.find(item => item.name === 'unknown_notes').count, 1);
  assert.equal(JSON.stringify(result).includes('synthetic-fixture-only'), false);
  f.db.prepare('INSERT INTO messages (content) VALUES (?)').run('source writer remains usable');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM messages').get().n, 52);
  assert.equal(verifyWorkspaceSnapshot(f.snapshotRoot).status, 'verified');
});

test('snapshot verification rejects changed evidence bytes and undeclared payloads', async t => {
  const f = fixture(t);
  await prepareWorkspaceSnapshot(f);
  const evidence = path.join(f.snapshotRoot, 'candidate/memory/original.json');
  const original = fs.readFileSync(evidence);
  fs.writeFileSync(evidence, '{}');
  assert.throws(() => verifyWorkspaceSnapshot(f.snapshotRoot), { code: 'snapshot_file_mismatch' });
  fs.writeFileSync(evidence, original);
  fs.writeFileSync(path.join(f.snapshotRoot, 'unexpected-secret.txt'), 'synthetic-only');
  assert.throws(() => verifyWorkspaceSnapshot(f.snapshotRoot), { code: 'snapshot_unlisted_file' });
});

test('even a resealed manifest cannot escape the snapshot or authorize activation', async t => {
  const f = fixture(t);
  await prepareWorkspaceSnapshot(f);
  const outside = path.join(f.root, 'outside');
  fs.writeFileSync(outside, 'untouched');
  rewriteManifest(f.snapshotRoot, manifest => { manifest.records[0].relativePath = '../../outside'; });
  assert.throws(() => verifyWorkspaceSnapshot(f.snapshotRoot), { code: 'snapshot_manifest_entry_invalid' });
  assert.equal(fs.readFileSync(outside, 'utf8'), 'untouched');
  rewriteManifest(f.snapshotRoot, manifest => { manifest.migrationReady = true; });
  assert.throws(() => verifyWorkspaceSnapshot(f.snapshotRoot), { code: 'snapshot_metadata_invalid' });
});

test('preparation never replaces a preexisting destination or follows linked source trees', async t => {
  const f = fixture(t);
  fs.mkdirSync(f.snapshotRoot);
  fs.writeFileSync(path.join(f.snapshotRoot, 'sentinel'), 'keep');
  await assert.rejects(prepareWorkspaceSnapshot(f));
  assert.equal(fs.readFileSync(path.join(f.snapshotRoot, 'sentinel'), 'utf8'), 'keep');
  const linkedRoot = path.join(f.root, 'linked-snapshot');
  fs.symlinkSync(f.snapshotRoot, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(prepareWorkspaceSnapshot({ sourceRoot: f.sourceRoot, snapshotRoot: linkedRoot }));
  fs.symlinkSync(f.snapshotRoot, path.join(f.sourceRoot, 'memory', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const another = path.join(f.root, 'another');
  await assert.rejects(prepareWorkspaceSnapshot({ sourceRoot: f.sourceRoot, snapshotRoot: another }));
  assert.equal(fs.existsSync(another), false);
});

test('a bad source database cannot produce a prepared snapshot or alter source rows', async t => {
  const f = fixture(t);
  f.db.pragma('foreign_keys = OFF');
  f.db.exec('CREATE TABLE parent (id INTEGER PRIMARY KEY); CREATE TABLE child (parent_id INTEGER REFERENCES parent(id)); INSERT INTO child VALUES (999)');
  f.db.pragma('foreign_keys = ON');
  await assert.rejects(prepareWorkspaceSnapshot(f), { code: 'snapshot_database_foreign_keys_failed' });
  assert.equal(fs.existsSync(f.snapshotRoot), false);
  assert.equal(f.db.prepare('SELECT parent_id FROM child').get().parent_id, 999);
});

test('a file changed during copying fails closed and leaves a non-activatable failed marker', async t => {
  const f = fixture(t);
  const sourceFile = path.join(f.sourceRoot, 'memory', 'original.json');
  const open = fs.openSync;
  let numericReads = 0;
  t.mock.method(fs, 'openSync', function(file, flags, ...args) {
    if (file === sourceFile && typeof flags === 'number' && ++numericReads === 2) {
      fs.writeFileSync(sourceFile, '{"changedByTestFixture":true}');
    }
    return open.call(fs, file, flags, ...args);
  });
  await assert.rejects(prepareWorkspaceSnapshot(f), { code: 'snapshot_source_changed' });
  const marker = JSON.parse(fs.readFileSync(path.join(f.snapshotRoot, 'snapshot-state.json')));
  assert.equal(marker.status, 'failed');
  assert.equal(marker.migrationReady, false);
  assert.throws(() => verifyWorkspaceSnapshot(f.snapshotRoot));
});

test('snapshot database count evidence is checked independently of the resealable manifest digest', async t => {
  const f = fixture(t);
  await prepareWorkspaceSnapshot(f);
  rewriteManifest(f.snapshotRoot, manifest => {
    manifest.records.find(item => item.kind === 'sqlite').tables[0].count++;
  });
  assert.throws(() => verifyWorkspaceSnapshot(f.snapshotRoot), { code: 'snapshot_database_counts_mismatch' });
});

test('snapshot preparation reports Windows ACL uncertainty rather than claiming Linux permission proof', async t => {
  const f = fixture(t);
  const result = await prepareWorkspaceSnapshot(f);
  assert.equal(result.permissionEvidence, process.platform === 'win32' ? 'windows_acl_not_verified' : 'private_posix_modes');
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(f.snapshotRoot).mode & 0o077, 0);
    assert.equal(fs.statSync(path.join(f.snapshotRoot, 'candidate/db/lack.db')).mode & 0o077, 0);
  }
});
