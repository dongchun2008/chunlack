'use strict';

// Offline recovery only. This module never starts an application or edits its source.
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { verifyWorkspaceSnapshot } = require('./workspace-snapshot.cjs');
const { prepareWorkspaceRestoreTrial, verifyWorkspaceRestoreTrial } = require('./workspace-restore-trial.cjs');
const { openWorkspaceSource } = require('./workspace-source-reader.cjs');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{64}$/;
const MAX_FILE = 64 * 1024 * 1024;
const MAX_TOTAL = 1024 * 1024 * 1024;
function fail(code) { return Object.assign(new Error(code), { code }); }
function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function absolute(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw fail('recovery_path_invalid');
  const result = path.resolve(value);
  for (let p = result;; p = path.dirname(p)) {
    if (fs.existsSync(p) && fs.lstatSync(p).isSymbolicLink()) throw fail('recovery_link_denied');
    if (path.dirname(p) === p) break;
  }
  return result;
}
function inside(parent, child) {
  const normalize = p => process.platform === 'win32' ? p.toLowerCase() : p;
  const rel = path.relative(normalize(parent), normalize(child));
  return rel === '' || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep));
}
function privateEntry(file, directory = false) {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink()) throw fail('recovery_link_denied');
  if (directory ? !stat.isDirectory() : !stat.isFile()) throw fail('recovery_path_invalid');
  if (process.platform !== 'win32' && (stat.mode & 0o077)) throw fail('recovery_permissions_invalid');
  return stat;
}
function bytes(file, limit = 2 * 1024 * 1024) {
  const stat = privateEntry(file);
  if (stat.size > limit) throw fail('recovery_metadata_invalid');
  return fs.readFileSync(file);
}
function json(file) {
  try { return JSON.parse(bytes(file).toString('utf8')); }
  catch (error) { if (error.code?.startsWith('recovery_')) throw error; throw fail('recovery_metadata_invalid'); }
}
function safeRelative(relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes(':') || relative.includes('\0') || relative.split('/').some(p => !p || p === '.' || p === '..')) throw fail('recovery_metadata_invalid');
  return relative;
}
function fileInfo(file) {
  const stat = privateEntry(file);
  if (stat.size > MAX_FILE) throw fail('recovery_limit_exceeded');
  const fd = fs.openSync(file, 'r'), hash = createHash('sha256'), buffer = Buffer.alloc(65536);
  let total = 0;
  try { for (;;) { const count = fs.readSync(fd, buffer, 0, buffer.length, null); if (!count) break; total += count; if (total > MAX_FILE) throw fail('recovery_limit_exceeded'); hash.update(buffer.subarray(0, count)); } }
  finally { fs.closeSync(fd); }
  const after = privateEntry(file);
  if (total !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ino !== stat.ino || after.dev !== stat.dev) throw fail('recovery_source_changed');
  return { bytes: total, sha256: hash.digest('hex') };
}
function databaseTables(file) {
  const source = openWorkspaceSource(file);
  try {
    const db = source.db;
    const integrity = db.prepare('PRAGMA integrity_check').all();
    if (integrity.length !== 1 || Object.values(integrity[0])[0] !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) throw fail('recovery_database_invalid');
    return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) => ({ name, count: db.prepare('SELECT count(*) AS count FROM "' + name.replaceAll('"', '""') + '"').get().count }));
  } finally { source.close(); }
}
function inventory(root, describeDatabases = true) {
  const records = []; let total = 0;
  function walk(dir, prefix, depth) {
    if (depth > 16) throw fail('recovery_limit_exceeded');
    privateEntry(dir, true);
    for (const name of fs.readdirSync(dir).sort()) {
      const relative = prefix ? prefix + '/' + name : name;
      if (!prefix && ['recovery-state.json', 'recovery-manifest.json'].includes(name)) continue;
      safeRelative(relative);
      const file = path.join(dir, name), stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) throw fail('recovery_link_denied');
      if (stat.isDirectory()) { walk(file, relative, depth + 1); continue; }
      const info = fileInfo(file); total += info.bytes;
      if (records.length >= 8192 || total > MAX_TOTAL) throw fail('recovery_limit_exceeded');
      records.push({ relativePath: relative, ...info, ...(describeDatabases && /\.(db|sqlite)$/.test(name) ? { tables: databaseTables(file) } : {}) });
    }
  }
  walk(root, '', 0); return records;
}
function sameRecords(a, b) {
  if (!Array.isArray(b) || JSON.stringify(a) !== JSON.stringify(b)) throw fail('recovery_file_mismatch');
}
function makeParent(file) { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); }
function copy(source, target, expected) {
  const before = fileInfo(source);
  if (before.bytes !== expected.bytes || before.sha256 !== expected.sha256) throw fail('recovery_source_mismatch');
  makeParent(target);
  const input = fs.openSync(source, 'r'), output = fs.openSync(target, 'wx', 0o600), buffer = Buffer.alloc(65536);
  try {
    let total = 0;
    for (;;) {
      const count = fs.readSync(input, buffer, 0, buffer.length, null); if (!count) break;
      total += count; if (total > MAX_FILE) throw fail('recovery_limit_exceeded');
      let written = 0; while (written < count) written += fs.writeSync(output, buffer, written, count - written);
    }
    fs.fsyncSync(output);
  } finally { fs.closeSync(input); fs.closeSync(output); }
  if (JSON.stringify(fileInfo(target)) !== JSON.stringify(before) || JSON.stringify(fileInfo(source)) !== JSON.stringify(before)) throw fail('recovery_source_changed');
}
function saveNew(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
function replaceState(root, state) {
  const temporary = path.join(root, '.recovery-state-' + randomUUID());
  saveNew(temporary, state); fs.renameSync(temporary, path.join(root, 'recovery-state.json'));
}
function sourceProof(candidateRoot) {
  privateEntry(candidateRoot, true);
  const stateFile = path.join(candidateRoot, 'migration-state.json'), raw = bytes(stateFile), state = JSON.parse(raw.toString('utf8'));
  if (state.version !== 1 || !UUID.test(state.instanceId) || !UUID.test(state.snapshotId) || !SHA.test(state.planSha256) || !['published', 'failed'].includes(state.status) || state.migrationReady !== (state.status === 'published')) throw fail('recovery_metadata_invalid');
  const snapshotRoot = path.join(candidateRoot, 'quarantine', 'snapshot');
  absolute(snapshotRoot);
  const snapshot = verifyWorkspaceSnapshot(snapshotRoot);
  if (snapshot.snapshotId !== state.snapshotId) throw fail('recovery_source_mismatch');
  const snapshotManifestSha256 = digest(bytes(path.join(snapshotRoot, 'manifest.json')));
  if (state.status === 'published') {
    const rawManifest = bytes(path.join(candidateRoot, 'migration-manifest.json'));
    if (digest(rawManifest) !== state.manifestSha256) throw fail('recovery_source_mismatch');
    const manifest = JSON.parse(rawManifest.toString('utf8'));
    if (manifest.snapshotId !== state.snapshotId || manifest.planSha256 !== state.planSha256 || manifest.snapshotManifestSha256 !== snapshotManifestSha256 || !Array.isArray(manifest.records)) throw fail('recovery_source_mismatch');
    const sourceRecords = inventory(snapshotRoot, false);
    const ledger = manifest.records.filter(r => r.relativePath?.startsWith('quarantine/snapshot/')).map(r => ({ relativePath: r.relativePath.slice('quarantine/snapshot/'.length), bytes: r.bytes, sha256: r.sha256 }));
    if (JSON.stringify(sourceRecords) !== JSON.stringify(ledger)) throw fail('recovery_source_mismatch');
  }
  return { state, stateSha256: digest(raw), snapshotRoot, snapshotManifestSha256, manifest: json(path.join(snapshotRoot, 'manifest.json')) };
}
function checkLegacyConfig(root) {
  const config = json(path.join(root, 'legacy-data', 'config', 'lack.config.json'));
  if (config.multiUser?.migrationReady !== false) throw fail('recovery_metadata_invalid');
}
function verifyMigrationRecovery(recoveryRoot) {
  const root = absolute(recoveryRoot); privateEntry(root, true);
  const state = json(path.join(root, 'recovery-state.json'));
  if (state.version !== 1 || !UUID.test(state.recoveryId) || !UUID.test(state.snapshotId) || state.status !== 'verified' || state.migrationReady !== false || state.restoreReady !== false || !SHA.test(state.manifestSha256)) throw fail('recovery_metadata_invalid');
  const raw = bytes(path.join(root, 'recovery-manifest.json'));
  if (digest(raw) !== state.manifestSha256) throw fail('recovery_metadata_invalid');
  const manifest = JSON.parse(raw.toString('utf8'));
  if (manifest.version !== 1 || manifest.kind !== 'chunlack-offline-legacy-recovery' || manifest.recoveryId !== state.recoveryId || manifest.snapshotId !== state.snapshotId || !['published', 'failed'].includes(manifest.sourceStatus) || !SHA.test(manifest.sourceStateSha256) || !SHA.test(manifest.snapshotManifestSha256) || manifest.migrationReady !== false || manifest.restoreReady !== false || manifest.applicationConsistency !== 'not_proven') throw fail('recovery_metadata_invalid');
  sameRecords(inventory(root), manifest.records);
  const trialRoot = path.join(root, 'snapshot-trial'), trial = verifyWorkspaceRestoreTrial(trialRoot);
  if (trial.snapshotId !== state.snapshotId || digest(bytes(path.join(trialRoot, 'payload', 'manifest.json'))) !== manifest.snapshotManifestSha256) throw fail('recovery_source_mismatch');
  const snapshotManifest = json(path.join(trialRoot, 'payload', 'manifest.json'));
  for (const record of snapshotManifest.records) {
    safeRelative(record.relativePath);
    const relative = record.relativePath.startsWith('candidate/') ? 'legacy-data/' + record.relativePath.slice(10) : record.relativePath === 'archive/config/lack.config.json' ? 'original-config/lack.config.json' : null;
    if (!relative) continue;
    const actual = fileInfo(path.join(root, relative));
    if (actual.bytes !== record.bytes || actual.sha256 !== record.sha256) throw fail('recovery_file_mismatch');
  }
  checkLegacyConfig(root);
  return { status: 'verified', recoveryId: state.recoveryId, snapshotId: state.snapshotId, sourceStatus: manifest.sourceStatus, legacyDataRoot: path.join(root, 'legacy-data'), fileCount: manifest.records.length, migrationReady: false, restoreReady: false, applicationConsistency: 'not_proven', permissionEvidence: process.platform === 'win32' ? 'windows_acl_not_verified' : 'private_posix_modes' };
}
function prepareMigrationRecovery({ candidateRoot, recoveryRoot, reviewed, onPhase } = {}) {
  if (reviewed !== true) throw fail('recovery_review_required');
  const candidate = absolute(candidateRoot), root = absolute(recoveryRoot);
  if (inside(candidate, root) || inside(root, candidate)) throw fail('recovery_roots_overlap');
  if (fs.existsSync(root)) throw fail('recovery_destination_exists');
  privateEntry(path.dirname(root), true);
  const proof = sourceProof(candidate);
  const sourceRecords = inventory(proof.snapshotRoot, false);
  const requiredBytes = sourceRecords.reduce((sum, r) => sum + r.bytes, 0) * 2 + 128 * 1024 * 1024;
  const free = fs.statfsSync(path.dirname(root));
  if (Number(free.bavail) * Number(free.bsize) < requiredBytes) throw fail('recovery_disk_space_insufficient');
  const state = { version: 1, recoveryId: randomUUID(), snapshotId: proof.state.snapshotId, status: 'building', migrationReady: false, restoreReady: false };
  fs.mkdirSync(root, { mode: 0o700 });
  const owned = fs.lstatSync(root);
  function assertOwned() { const current = privateEntry(root, true); if (current.ino !== owned.ino || current.dev !== owned.dev) throw fail('recovery_root_changed'); }
  try {
    saveNew(path.join(root, 'recovery-state.json'), state);
    const trialRoot = path.join(root, 'snapshot-trial');
    prepareWorkspaceRestoreTrial({ snapshotRoot: proof.snapshotRoot, restoreRoot: trialRoot });
    for (const record of proof.manifest.records) {
      safeRelative(record.relativePath);
      const destination = record.relativePath.startsWith('candidate/') ? 'legacy-data/' + record.relativePath.slice(10) : record.relativePath === 'archive/config/lack.config.json' ? 'original-config/lack.config.json' : null;
      if (destination) copy(path.join(trialRoot, 'payload', record.relativePath), path.join(root, destination), record);
    }
    checkLegacyConfig(root);
    if (onPhase !== undefined && typeof onPhase !== 'function') throw fail('recovery_options_invalid');
    onPhase?.('legacy-materialized'); assertOwned();
    const fresh = sourceProof(candidate);
    if (fresh.stateSha256 !== proof.stateSha256 || fresh.snapshotManifestSha256 !== proof.snapshotManifestSha256) throw fail('recovery_source_changed');
    sameRecords(inventory(proof.snapshotRoot, false), sourceRecords);
    const records = inventory(root);
    const manifest = { version: 1, kind: 'chunlack-offline-legacy-recovery', recoveryId: state.recoveryId, snapshotId: state.snapshotId, sourceStatus: proof.state.status, sourceStateSha256: proof.stateSha256, snapshotManifestSha256: proof.snapshotManifestSha256, migrationReady: false, restoreReady: false, applicationConsistency: 'not_proven', records };
    saveNew(path.join(root, 'recovery-manifest.json'), manifest);
    state.manifestSha256 = digest(bytes(path.join(root, 'recovery-manifest.json'))); state.status = 'verified';
    replaceState(root, state);
    return verifyMigrationRecovery(root);
  } catch (error) {
    try { assertOwned(); state.status = 'failed'; state.migrationReady = false; state.restoreReady = false; replaceState(root, state); } catch {}
    throw error;
  }
}
module.exports = { prepareMigrationRecovery, verifyMigrationRecovery };
