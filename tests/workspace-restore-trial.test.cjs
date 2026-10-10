'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const Database = require('better-sqlite3');
const { prepareWorkspaceSnapshot } = require('../scripts/workspace-snapshot.cjs');

function api() { return require('../scripts/workspace-restore-trial.cjs'); }
function sha(file) { return createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chunlack-restore-trial-'));
  const sourceRoot = path.join(root, 'source');
  const snapshotRoot = path.join(root, 'snapshot');
  const restoreRoot = path.join(root, 'restore');
  for (const folder of ['config', 'db', 'memory', 'research', 'artifacts', 'attachments']) {
    fs.mkdirSync(path.join(sourceRoot, folder), { recursive: true });
  }
  fs.writeFileSync(path.join(sourceRoot, 'config/lack.config.json'), JSON.stringify({
    multiUser: { enabled: true, migrationReady: true },
    llm: { providers: [{ id: 'fixture-local', type: 'openai-compatible', apiKey: 'synthetic-only-not-a-real-key' }] }
  }));
  fs.writeFileSync(path.join(sourceRoot, 'memory/source.json'), '{"url":"https://example.com/original","verified":false,"status":"missing_evidence"}');
  fs.writeFileSync(path.join(sourceRoot, 'research/sources.json'), '[{"url":"https://example.com/source","excerpt":"original fixture excerpt"}]');
  fs.writeFileSync(path.join(sourceRoot, 'artifacts/task.json'), '{"id":"original-task","accepted":false}');
  fs.writeFileSync(path.join(sourceRoot, 'attachments/evidence.bin'), Buffer.from([0, 1, 2, 128, 255]));
  const db = new Database(path.join(sourceRoot, 'db/lack.db'));
  t.after(() => {
    if (db.open) db.close();
    const resolved = path.resolve(root);
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('chunlack-restore-trial-')) throw new Error('unsafe cleanup');
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  db.pragma('journal_mode = WAL');
  db.pragma('wal_autocheckpoint = 0');
  for (const name of ['messages', 'agents', 'agent_memory', 'project_states', 'pipeline_results', 'loop_health', 'unclassified_notes']) {
    db.exec('CREATE TABLE ' + name + ' (id INTEGER PRIMARY KEY, value TEXT)');
    db.prepare('INSERT INTO ' + name + ' (value) VALUES (?)').run('original-' + name);
  }
  db.prepare('INSERT INTO messages (value) VALUES (?)').run('committed-wal-message');
  await prepareWorkspaceSnapshot({ sourceRoot, snapshotRoot });
  return { root, sourceRoot, snapshotRoot, restoreRoot, db };
}

test('restore trial opens real copied SQLite data and preserves evidence bytes without activating or changing the original', async t => {
  const f = await fixture(t);
  const before = ['db/lack.db', 'db/lack.db-wal', 'config/lack.config.json'].map(file => sha(path.join(f.sourceRoot, file)));
  const report = api().prepareWorkspaceRestoreTrial(f);
  assert.equal(report.status, 'verified');
  assert.equal(report.migrationReady, false);
  assert.equal(report.restoreReady, false);
  assert.equal(report.applicationConsistency, 'not_proven');
  assert.equal(JSON.stringify(report).includes('synthetic-only-not-a-real-key'), false);
  assert.deepEqual(['db/lack.db', 'db/lack.db-wal', 'config/lack.config.json'].map(file => sha(path.join(f.sourceRoot, file))), before);
  const payload = path.join(f.restoreRoot, 'payload');
  for (const file of ['memory/source.json', 'research/sources.json', 'artifacts/task.json', 'attachments/evidence.bin']) {
    assert.equal(sha(path.join(payload, 'candidate', file)), sha(path.join(f.sourceRoot, file)));
  }
  assert.equal(sha(path.join(payload, 'archive/config/lack.config.json')), sha(path.join(f.sourceRoot, 'config/lack.config.json')));
  const config = JSON.parse(fs.readFileSync(path.join(payload, 'candidate/config/lack.config.json')));
  assert.equal(config.multiUser.migrationReady, false);
  const restored = new Database(path.join(payload, 'candidate/db/lack.db'), { readonly: true, fileMustExist: true });
  try {
    assert.deepEqual(restored.prepare('SELECT value FROM messages ORDER BY id').all().map(row => row.value), ['original-messages', 'committed-wal-message']);
    assert.equal(restored.prepare('SELECT value FROM unclassified_notes').get().value, 'original-unclassified_notes');
    assert.equal(restored.pragma('integrity_check', { simple: true }), 'ok');
    assert.equal(restored.pragma('journal_mode', { simple: true }), 'delete');
  } finally { restored.close(); }
  f.db.prepare('INSERT INTO messages (value) VALUES (?)').run('writer-still-usable');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM messages').get().n, 3);
  fs.renameSync(f.snapshotRoot, path.join(f.root, 'snapshot-moved-after-restore'));
  assert.deepEqual(api().verifyWorkspaceRestoreTrial(f.restoreRoot), report);
  assert.equal(fs.existsSync(path.join(payload, 'candidate/db/lack.db-wal')), false);
  assert.equal(fs.existsSync(path.join(payload, 'candidate/db/lack.db-shm')), false);
});

test('restore trial never overwrites a preexisting destination', async t => {
  const f = await fixture(t);
  fs.mkdirSync(f.restoreRoot);
  fs.writeFileSync(path.join(f.restoreRoot, 'sentinel'), 'keep');
  assert.throws(() => api().prepareWorkspaceRestoreTrial(f), { code: 'restore_destination_exists' });
  assert.equal(fs.readFileSync(path.join(f.restoreRoot, 'sentinel'), 'utf8'), 'keep');
  assert.deepEqual(fs.readdirSync(f.restoreRoot), ['sentinel']);
});

test('restore trial rejects overlapping roots and linked parents before any writes', async t => {
  const f = await fixture(t);
  const overlap = path.join(f.snapshotRoot, 'nested-restore');
  assert.throws(() => api().prepareWorkspaceRestoreTrial({ snapshotRoot: f.snapshotRoot, restoreRoot: overlap }), { code: 'restore_roots_overlap' });
  assert.equal(fs.existsSync(overlap), false);
  const link = path.join(f.root, 'linked-parent');
  fs.symlinkSync(f.snapshotRoot, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => api().prepareWorkspaceRestoreTrial({ snapshotRoot: f.snapshotRoot, restoreRoot: path.join(link, 'new-restore') }), { code: 'restore_link_denied' });
  assert.equal(fs.existsSync(path.join(f.snapshotRoot, 'new-restore')), false);
});

test('tampered snapshots cannot create a restore trial', async t => {
  const f = await fixture(t);
  fs.writeFileSync(path.join(f.snapshotRoot, 'candidate/memory/source.json'), '{}');
  assert.throws(() => api().prepareWorkspaceRestoreTrial(f), { code: 'snapshot_file_mismatch' });
  assert.equal(fs.existsSync(f.restoreRoot), false);
});

test('independent restored-payload verification detects altered evidence and unknown files', async t => {
  const f = await fixture(t);
  api().prepareWorkspaceRestoreTrial(f);
  const evidence = path.join(f.restoreRoot, 'payload/candidate/memory/source.json');
  const original = fs.readFileSync(evidence);
  fs.writeFileSync(evidence, '{}');
  assert.throws(() => api().verifyWorkspaceRestoreTrial(f.restoreRoot), { code: 'snapshot_file_mismatch' });
  fs.writeFileSync(evidence, original);
  fs.writeFileSync(path.join(f.restoreRoot, 'undeclared-private-file'), 'synthetic');
  assert.throws(() => api().verifyWorkspaceRestoreTrial(f.restoreRoot), { code: 'restore_unlisted_file' });
});

test('a mid-copy source mutation leaves a failed trial that cannot be accepted', async t => {
  const f = await fixture(t);
  const selected = path.join(f.snapshotRoot, 'candidate/memory/source.json');
  const originalOpen = fs.openSync;
  let reads = 0;
  t.mock.method(fs, 'openSync', function(file, flags, ...args) {
    if (file === selected && typeof flags === 'number' && ++reads === 2) {
      fs.writeFileSync(selected, '{"changedByFixture":true}');
    }
    return originalOpen.call(fs, file, flags, ...args);
  });
  assert.throws(() => api().prepareWorkspaceRestoreTrial(f), { code: 'restore_copy_mismatch' });
  const marker = JSON.parse(fs.readFileSync(path.join(f.restoreRoot, 'restore-trial-state.json')));
  assert.equal(marker.status, 'failed');
  assert.equal(marker.migrationReady, false);
  assert.throws(() => api().verifyWorkspaceRestoreTrial(f.restoreRoot), { code: 'restore_metadata_invalid' });
});

test('restore trial refuses activation flags and reports Windows ACL uncertainty explicitly', async t => {
  const f = await fixture(t);
  const result = api().prepareWorkspaceRestoreTrial(f);
  assert.equal(result.permissionEvidence, process.platform === 'win32' ? 'windows_acl_not_verified' : 'private_posix_modes');
  const markerPath = path.join(f.restoreRoot, 'restore-trial-state.json');
  const marker = JSON.parse(fs.readFileSync(markerPath));
  marker.migrationReady = true;
  fs.writeFileSync(markerPath, JSON.stringify(marker));
  assert.throws(() => api().verifyWorkspaceRestoreTrial(f.restoreRoot), { code: 'restore_metadata_invalid' });
});
