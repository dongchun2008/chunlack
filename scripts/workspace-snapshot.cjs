'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const Database = require('better-sqlite3');
const { planMigration, backupDatabase } = require('./migrate-workspaces.cjs');

const DATABASES = ['lack.db', 'identity.db', 'agent-gateway.db', 'mcp-events.db'];
const FOLDERS = ['memory', 'research', 'uploads', 'artifacts', 'attachments'];
const MAX_FILES = 4096;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function checkedPath(value, allowMissing = false) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /[\x00-\x1f]/.test(value)) {
    throw fail('snapshot_invalid_path');
  }
  const result = path.resolve(value);
  let current = path.parse(result).root;
  for (const part of result.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) {
      if (!allowMissing) throw fail('snapshot_path_missing');
      continue;
    }
    if (fs.lstatSync(current).isSymbolicLink()) throw fail('snapshot_link_denied');
  }
  return result;
}

function safeFile(root, relative) {
  if (typeof relative !== 'string' || relative.length > 1024 || /[\\\x00-\x1f]/.test(relative) ||
      relative.split('/').some(part => !part || part === '.' || part === '..' || part.includes(':'))) {
    throw fail('snapshot_invalid_relative_path');
  }
  const target = checkedPath(path.join(root, ...relative.split('/')), true);
  if (!target.startsWith(root + path.sep)) throw fail('snapshot_path_escape');
  return target;
}

function digest(file) {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) throw fail('snapshot_file_type_denied');
  if (stat.size > MAX_FILE_BYTES) throw fail('snapshot_file_limit');
  const hash = createHash('sha256');
  const buffer = Buffer.alloc(64 * 1024);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  let bytes = 0;
  try {
    let count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      bytes += count;
      if (bytes > MAX_FILE_BYTES) throw fail('snapshot_file_limit');
      hash.update(buffer.subarray(0, count));
    }
  } finally { fs.closeSync(fd); }
  if (bytes !== stat.size) throw fail('snapshot_source_changed');
  return { bytes, sha256: hash.digest('hex') };
}

function inspectSource(root) {
  const files = [];
  let total = 0;
  function add(relative) {
    const value = digest(safeFile(root, relative));
    total += value.bytes;
    if (files.length >= MAX_FILES || total > MAX_TOTAL_BYTES) throw fail('snapshot_inventory_limit');
    files.push({ relativePath: relative, ...value });
  }
  function walk(relative, depth) {
    if (depth > 12) throw fail('snapshot_depth_limit');
    const directory = safeFile(root, relative);
    const stat = fs.lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw fail('snapshot_directory_type_denied');
    for (const entry of fs.readdirSync(directory).sort()) {
      const child = relative + '/' + entry;
      const childStat = fs.lstatSync(safeFile(root, child));
      if (childStat.isSymbolicLink()) throw fail('snapshot_link_denied');
      if (childStat.isDirectory()) walk(child, depth + 1);
      else add(child);
    }
  }
  add('config/lack.config.json');
  for (const folder of FOLDERS) {
    if (fs.existsSync(path.join(root, folder))) walk(folder, 0);
  }
  const databases = [];
  for (const name of DATABASES) {
    const relative = 'db/' + name;
    if (!fs.existsSync(path.join(root, 'db', name))) continue;
    add(relative);
    if (fs.existsSync(path.join(root, 'db', name + '-wal'))) add(relative + '-wal');
    databases.push(relative);
  }
  return { files, databases };
}

function describeDatabase(file) {
  const db = new Database(file, { readonly: true, fileMustExist: true, timeout: 1000 });
  try {
    db.pragma('query_only = ON');
    return db.transaction(() => {
      const integrity = db.pragma('integrity_check').map(row => Object.values(row)[0]);
      if (integrity.length !== 1 || integrity[0] !== 'ok') throw fail('snapshot_database_integrity_failed');
      if (db.pragma('foreign_key_check').length) throw fail('snapshot_database_foreign_keys_failed');
      const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
      if (names.length > 128) throw fail('snapshot_table_limit');
      return names.map(({ name }) => ({
        name,
        count: db.prepare('SELECT COUNT(*) AS total FROM "' + name.replaceAll('"', '""') + '"').get().total
      }));
    })();
  } finally { db.close(); }
}

function canonicalizeOwnedSnapshotDatabase(file) {
  // Only call for a newly backed-up database inside the owned snapshot.
  // SQLite, not filesystem deletion, must retire its WAL and SHM sidecars.
  const db = new Database(file, { fileMustExist: true, timeout: 1000 });
  try {
    const checkpoint = db.pragma('wal_checkpoint(TRUNCATE)');
    if (checkpoint.some(row => row.busy !== 0)) throw fail('snapshot_database_checkpoint_busy');
    if (db.pragma('journal_mode = DELETE', { simple: true }) !== 'delete') {
      throw fail('snapshot_database_journal_failed');
    }
  } finally { db.close(); }
}

function privateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}

function writeExclusive(file, bytes) {
  const fd = fs.openSync(file, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
}

function jsonBytes(value) { return Buffer.from(JSON.stringify(value, null, 2) + '\n'); }
function hashBytes(value) { return createHash('sha256').update(value).digest('hex'); }

function state(root, value, initial = false) {
  const target = path.join(root, 'snapshot-state.json');
  if (initial) return writeExclusive(target, jsonBytes(value));
  const staging = path.join(root, '.snapshot-state-' + randomUUID());
  writeExclusive(staging, jsonBytes(value));
  fs.renameSync(staging, target);
}

function copyChecked(source, target, expected) {
  privateDirectory(path.dirname(target));
  const input = fs.openSync(source, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  let output;
  const hash = createHash('sha256');
  const buffer = Buffer.alloc(64 * 1024);
  let bytes = 0;
  try {
    output = fs.openSync(target, 'wx', 0o600);
    let count;
    while ((count = fs.readSync(input, buffer, 0, buffer.length, null)) > 0) {
      bytes += count;
      if (bytes > MAX_FILE_BYTES) throw fail('snapshot_file_limit');
      hash.update(buffer.subarray(0, count));
      let offset = 0;
      while (offset < count) offset += fs.writeSync(output, buffer, offset, count - offset);
    }
    fs.fsyncSync(output);
  } finally {
    fs.closeSync(input);
    if (output !== undefined) fs.closeSync(output);
  }
  const actual = { bytes, sha256: hash.digest('hex') };
  if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) throw fail('snapshot_source_changed');
  return actual;
}

async function prepareWorkspaceSnapshot({ sourceRoot, snapshotRoot }) {
  // This is preparation for migration, not publication of a migrated workspace.
  const plan = planMigration({ sourceRoot, targetRoot: snapshotRoot });
  const source = checkedPath(sourceRoot);
  const target = checkedPath(snapshotRoot, true);
  if (fs.existsSync(target)) throw fail('snapshot_destination_exists');
  if (!fs.statSync(path.dirname(target)).isDirectory()) throw fail('snapshot_parent_missing');
  const before = inspectSource(source);
  const sourceTables = new Map(before.databases.map(relative => [relative, describeDatabase(safeFile(source, relative))]));
  const snapshotId = randomUUID();
  fs.mkdirSync(target, { mode: 0o700 });
  state(target, { version: 1, snapshotId, status: 'building', migrationReady: false }, true);
  try {
    const records = [];
    for (const item of before.files) {
      if (item.relativePath.startsWith('db/')) continue;
      const relativePath = item.relativePath === 'config/lack.config.json'
        ? 'archive/' + item.relativePath : 'candidate/' + item.relativePath;
      const copied = copyChecked(safeFile(source, item.relativePath), safeFile(target, relativePath), item);
      records.push({ relativePath, kind: 'file', ...copied });
    }
    const archived = fs.readFileSync(safeFile(target, 'archive/config/lack.config.json'));
    const config = JSON.parse(archived.toString('utf8'));
    if (config.multiUser !== undefined && (!config.multiUser || typeof config.multiUser !== 'object' || Array.isArray(config.multiUser))) {
      throw fail('snapshot_invalid_multi_user_config');
    }
    config.multiUser = { ...(config.multiUser || {}), migrationReady: false };
    const configBytes = jsonBytes(config);
    privateDirectory(path.join(target, 'candidate', 'config'));
    writeExclusive(safeFile(target, 'candidate/config/lack.config.json'), configBytes);
    records.push({ relativePath: 'candidate/config/lack.config.json', kind: 'config', bytes: configBytes.length, sha256: hashBytes(configBytes) });
    privateDirectory(path.join(target, 'candidate', 'db'));
    for (const relative of before.databases) {
      const relativePath = 'candidate/' + relative;
      const destination = safeFile(target, relativePath);
      await backupDatabase({ sourcePath: safeFile(source, relative), targetPath: destination });
      canonicalizeOwnedSnapshotDatabase(destination);
      if (process.platform !== 'win32') fs.chmodSync(destination, 0o600);
      const tables = describeDatabase(destination);
      if (JSON.stringify(tables) !== JSON.stringify(sourceTables.get(relative))) throw fail('snapshot_source_changed');
      records.push({ relativePath, kind: 'sqlite', ...digest(destination), tables });
    }
    if (JSON.stringify(inspectSource(source)) !== JSON.stringify(before)) throw fail('snapshot_source_changed');
    const manifest = {
      version: 1, kind: 'chunlack-offline-preparation', snapshotId,
      migrationReady: false, restoreReady: false, applicationConsistency: 'not_proven',
      permissionEvidence: process.platform === 'win32' ? 'windows_acl_not_verified' : 'private_posix_modes',
      scope: 'configured_database_allowlist_and_inventoried_files',
      unresolved: plan.unresolved, records
    };
    const manifestBytes = jsonBytes(manifest);
    writeExclusive(path.join(target, 'manifest.json'), manifestBytes);
    state(target, { version: 1, snapshotId, status: 'prepared', migrationReady: false, manifestSha256: hashBytes(manifestBytes) });
    return verifyWorkspaceSnapshot(target);
  } catch (error) {
    state(target, { version: 1, snapshotId, status: 'failed', migrationReady: false, error: 'snapshot_preparation_failed' });
    throw error;
  }
}

function readBoundedJson(file, limit) {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > limit) throw fail('snapshot_metadata_invalid');
  const bytes = fs.readFileSync(file);
  try { return { bytes, value: JSON.parse(bytes.toString('utf8')) }; }
  catch { throw fail('snapshot_metadata_invalid'); }
}

function verifyWorkspaceSnapshot(snapshotRoot) {
  const root = checkedPath(snapshotRoot);
  const current = readBoundedJson(path.join(root, 'snapshot-state.json'), 16384).value;
  const { bytes, value: manifest } = readBoundedJson(path.join(root, 'manifest.json'), 2 * 1024 * 1024);
  if (current.version !== 1 || current.status !== 'prepared' || current.migrationReady !== false ||
      manifest.version !== 1 || manifest.kind !== 'chunlack-offline-preparation' ||
      manifest.snapshotId !== current.snapshotId || !/^[0-9a-f-]{36}$/.test(current.snapshotId) ||
      current.manifestSha256 !== hashBytes(bytes) || manifest.migrationReady !== false || manifest.restoreReady !== false ||
      manifest.applicationConsistency !== 'not_proven' || !Array.isArray(manifest.records) || manifest.records.length > MAX_FILES) {
    throw fail('snapshot_metadata_invalid');
  }
  const listed = new Set(['snapshot-state.json', 'manifest.json']);
  let total = 0;
  const databases = [];
  for (const item of manifest.records) {
    if (!item || !['file', 'config', 'sqlite'].includes(item.kind) || listed.has(item.relativePath) ||
        !/^(?:archive\/config\/lack\.config\.json|candidate\/(?:config\/lack\.config\.json|db\/[^/]+|(?:memory|research|uploads|artifacts|attachments)\/.+))$/.test(item.relativePath)) {
      throw fail('snapshot_manifest_entry_invalid');
    }
    const file = safeFile(root, item.relativePath);
    const actual = digest(file);
    total += actual.bytes;
    if (total > MAX_TOTAL_BYTES || actual.bytes !== item.bytes || actual.sha256 !== item.sha256) throw fail('snapshot_file_mismatch');
    if (process.platform !== 'win32' && (fs.statSync(file).mode & 0o077)) throw fail('snapshot_permissions_invalid');
    listed.add(item.relativePath);
    if (item.kind === 'sqlite') {
      if (!DATABASES.includes(path.basename(file)) || !item.relativePath.startsWith('candidate/db/')) throw fail('snapshot_manifest_entry_invalid');
      const tables = describeDatabase(file);
      if (JSON.stringify(tables) !== JSON.stringify(item.tables)) throw fail('snapshot_database_counts_mismatch');
      databases.push({ relativePath: item.relativePath, tables });
    }
  }
  for (const required of ['archive/config/lack.config.json', 'candidate/config/lack.config.json', 'candidate/db/lack.db']) {
    if (!listed.has(required)) throw fail('snapshot_required_file_missing');
  }
  const config = readBoundedJson(safeFile(root, 'candidate/config/lack.config.json'), 2 * 1024 * 1024).value;
  if (config.multiUser?.migrationReady !== false) throw fail('snapshot_candidate_can_activate');
  let entries = 0;
  function checkDirectory(directory, relative = '', depth = 0) {
    if (depth > 16) throw fail('snapshot_depth_limit');
    if (process.platform !== 'win32' && (fs.statSync(directory).mode & 0o077)) throw fail('snapshot_permissions_invalid');
    for (const name of fs.readdirSync(directory)) {
      if (++entries > MAX_FILES * 2) throw fail('snapshot_inventory_limit');
      const childRelative = relative ? relative + '/' + name : name;
      const file = safeFile(root, childRelative);
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) throw fail('snapshot_link_denied');
      if (stat.isDirectory()) checkDirectory(file, childRelative, depth + 1);
      else if (!stat.isFile() || !listed.has(childRelative)) throw fail('snapshot_unlisted_file');
    }
  }
  checkDirectory(root);
  return {
    status: 'verified', snapshotId: manifest.snapshotId, fileCount: manifest.records.length,
    databases, migrationReady: false, restoreReady: false, applicationConsistency: 'not_proven',
    permissionEvidence: manifest.permissionEvidence
  };
}

module.exports = { prepareWorkspaceSnapshot, verifyWorkspaceSnapshot };
