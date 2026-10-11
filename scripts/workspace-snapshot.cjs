'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const Database = require('better-sqlite3');
const { planMigration, backupDatabase } = require('./migrate-workspaces.cjs');
const { openWorkspaceSource } = require('./workspace-source-reader.cjs');

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
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.ino !== stat.ino || opened.dev !== stat.dev) throw fail('snapshot_source_changed');
    let count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      bytes += count;
      if (bytes > MAX_FILE_BYTES) throw fail('snapshot_file_limit');
      hash.update(buffer.subarray(0, count));
    }
  } finally { fs.closeSync(fd); }
  const after = fs.lstatSync(file);
  if (after.isSymbolicLink() || !after.isFile() || bytes !== stat.size || after.size !== stat.size ||
      after.ino !== stat.ino || after.dev !== stat.dev || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) throw fail('snapshot_source_changed');
  return { bytes, sha256: hash.digest('hex') };
}

function identity(stat) {
  return { dev: stat.dev, ino: stat.ino, mode: stat.mode, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs };
}

function inspectSource(root) {
  const files = [], directories = [], databases = [];
  let total = 0;
  const rootIdentity = identity(fs.lstatSync(root));
  function walk(directory, relative, depth) {
    if (depth > 12) throw fail('snapshot_depth_limit');
    const stat = fs.lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw fail('snapshot_directory_type_denied');
    for (const entry of fs.readdirSync(directory).sort()) {
      if (files.length + directories.length >= MAX_FILES) throw fail('snapshot_inventory_limit');
      const child = relative ? relative + '/' + entry : entry;
      if (child.split('/').length > 12) throw fail('snapshot_depth_limit');
      const file = safeFile(root, child), childStat = fs.lstatSync(file);
      if (childStat.isSymbolicLink()) throw fail('snapshot_link_denied');
      if (childStat.isDirectory()) {
        directories.push({ relativePath: child, sourceIdentity: identity(childStat) });
        walk(file, child, depth + 1);
      } else {
        if (!childStat.isFile()) throw fail('snapshot_file_type_denied');
        const value = digest(file);
        if (JSON.stringify(identity(fs.lstatSync(file))) !== JSON.stringify(identity(childStat))) throw fail('snapshot_source_changed');
        total += value.bytes;
        if (total > MAX_TOTAL_BYTES) throw fail('snapshot_inventory_limit');
        files.push({ relativePath: child, ...value, sourceIdentity: identity(childStat) });
        if (DATABASES.some(name => child === 'db/' + name)) databases.push(child);
      }
    }
  }
  walk(root, '', 0);
  return { files, databases, directories, rootIdentity };
}

function placement(relative, kind, databases) {
  if (kind === 'directory') {
    const known = ['config', 'db'].includes(relative) || FOLDERS.includes(relative.split('/')[0]);
    return { strategy: 'directory', destination: (known ? 'candidate/' : 'archive/legacy-root/') + relative };
  }
  if (databases.has(relative)) return { strategy: 'database', destination: 'candidate/' + relative };
  for (const database of databases) {
    if (['-wal', '-shm', '-journal'].some(suffix => relative === database + suffix)) {
      return { strategy: 'database-support', databaseRelativePath: database };
    }
  }
  return { strategy: 'copied', destination: relative === 'config/lack.config.json' ? 'archive/' + relative :
    (FOLDERS.includes(relative.split('/')[0]) ? 'candidate/' : 'archive/legacy-root/') + relative };
}

function sourceInventory(value) {
  const databases = new Set(value.databases);
  return [
    ...value.files.map(item => ({ ...item, kind: 'file', ...placement(item.relativePath, 'file', databases) })),
    ...value.directories.map(item => ({ ...item, kind: 'directory', ...placement(item.relativePath, 'directory', databases) }))
  ].sort((a, b) => a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0);
}

function directoryRecords(root, inventory, records) {
  const sources = new Map(inventory.filter(x => x.kind === 'directory').map(x => [x.destination, x.relativePath]));
  function walk(directory, prefix = '') {
    for (const name of fs.readdirSync(directory).sort()) {
      const relativePath = prefix ? prefix + '/' + name : name;
      const file = safeFile(root, relativePath);
      if (!fs.lstatSync(file).isDirectory()) continue;
      if (records.length >= MAX_FILES) throw fail('snapshot_inventory_limit');
      const sourceRelativePath = sources.get(relativePath);
      records.push({ relativePath, kind: 'directory', ...(sourceRelativePath ? { sourceRelativePath } : { derived: true }) });
      walk(file, relativePath);
    }
  }
  walk(root);
}

function describeDatabase(file) {
  const reader = openWorkspaceSource(file);
  const db = reader.db;
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
  } finally { reader.close(); }
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
  const inventory = sourceInventory(before);
  const sourceTables = new Map(before.databases.map(relative => [relative, describeDatabase(safeFile(source, relative))]));
  const snapshotId = randomUUID();
  fs.mkdirSync(target, { mode: 0o700 });
  state(target, { version: 2, snapshotId, status: 'building', migrationReady: false }, true);
  try {
    const records = [];
    for (const item of inventory.filter(x => x.kind === 'directory')) privateDirectory(safeFile(target, item.destination));
    for (const item of inventory.filter(x => x.kind === 'file')) {
      if (item.strategy !== 'copied') continue;
      const relativePath = item.destination;
      const copied = copyChecked(safeFile(source, item.relativePath), safeFile(target, relativePath), item);
      records.push({ relativePath, kind: 'file', sourceRelativePath: item.relativePath, ...copied });
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
    records.push({ relativePath: 'candidate/config/lack.config.json', kind: 'config', sourceRelativePath: 'config/lack.config.json', derived: true, bytes: configBytes.length, sha256: hashBytes(configBytes) });
    privateDirectory(path.join(target, 'candidate', 'db'));
    for (const relative of before.databases) {
      const relativePath = 'candidate/' + relative;
      const destination = safeFile(target, relativePath);
      await backupDatabase({ sourcePath: safeFile(source, relative), targetPath: destination });
      canonicalizeOwnedSnapshotDatabase(destination);
      if (process.platform !== 'win32') fs.chmodSync(destination, 0o600);
      const tables = describeDatabase(destination);
      if (JSON.stringify(tables) !== JSON.stringify(sourceTables.get(relative))) throw fail('snapshot_source_changed');
      records.push({ relativePath, kind: 'sqlite', sourceRelativePath: relative, ...digest(destination), tables });
    }
    if (JSON.stringify(inspectSource(source)) !== JSON.stringify(before)) throw fail('snapshot_source_changed');
    directoryRecords(target, inventory, records);
    const manifest = {
      version: 2, kind: 'chunlack-offline-preparation', snapshotId,
      migrationReady: false, restoreReady: false, applicationConsistency: 'not_proven',
      permissionEvidence: process.platform === 'win32' ? 'windows_acl_not_verified' : 'private_posix_modes',
      scope: 'bounded_complete_root_inventory', sourceInventory: inventory,
      sourceStability: 'preparation_before_after_inventory_checked',
      unresolved: plan.unresolved, records
    };
    const manifestBytes = jsonBytes(manifest);
    if (manifestBytes.length > 2 * 1024 * 1024) throw fail('snapshot_metadata_invalid');
    writeExclusive(path.join(target, 'manifest.json'), manifestBytes);
    state(target, { version: 2, snapshotId, status: 'prepared', migrationReady: false, manifestSha256: hashBytes(manifestBytes) });
    return verifyWorkspaceSnapshot(target);
  } catch (error) {
    state(target, { version: 2, snapshotId, status: 'failed', migrationReady: false, error: 'snapshot_preparation_failed' });
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

function verifyCoverage(root, manifest) {
  if (manifest.scope !== 'bounded_complete_root_inventory' || manifest.sourceStability !== 'preparation_before_after_inventory_checked' ||
      !Array.isArray(manifest.sourceInventory) || manifest.sourceInventory.length > MAX_FILES) throw fail('snapshot_coverage_invalid');
  const sources = new Map(), normalized = new Set();
  let total = 0;
  for (const item of manifest.sourceInventory) {
    if (!item || !['file', 'directory'].includes(item.kind)) throw fail('snapshot_coverage_invalid');
    safeFile(root, item.relativePath);
    if (item.relativePath.split('/').length > 12) throw fail('snapshot_depth_limit');
    const key = process.platform === 'win32' ? item.relativePath.toLowerCase() : item.relativePath;
    if (normalized.has(key)) throw fail('snapshot_coverage_invalid');
    normalized.add(key); sources.set(item.relativePath, item);
    if (!item.sourceIdentity || ['dev','ino','mode','mtimeMs','ctimeMs'].some(name => !Number.isFinite(item.sourceIdentity[name]))) throw fail('snapshot_coverage_invalid');
    if (item.kind === 'file') {
      if (!Number.isSafeInteger(item.bytes) || item.bytes < 0 || item.bytes > MAX_FILE_BYTES || !/^[a-f0-9]{64}$/.test(item.sha256)) throw fail('snapshot_coverage_invalid');
      total += item.bytes;
      if (total > MAX_TOTAL_BYTES) throw fail('snapshot_inventory_limit');
    } else if (item.bytes !== undefined || item.sha256 !== undefined) throw fail('snapshot_coverage_invalid');
  }
  const databases = new Set([...sources.values()].filter(x => x.kind === 'file' && DATABASES.some(name => x.relativePath === 'db/' + name)).map(x => x.relativePath));
  const byTarget = new Map(manifest.records.map(x => [x.relativePath, x]));
  const expected = new Set(['candidate/config/lack.config.json']);
  const directories = new Map();
  for (const item of sources.values()) {
    const parent = path.posix.dirname(item.relativePath);
    if (parent !== '.' && sources.get(parent)?.kind !== 'directory') throw fail('snapshot_coverage_invalid');
    const rule = placement(item.relativePath, item.kind, databases);
    if (item.strategy !== rule.strategy || item.destination !== rule.destination || item.databaseRelativePath !== rule.databaseRelativePath) throw fail('snapshot_coverage_invalid');
    if (rule.strategy === 'database-support') {
      if (item.relativePath.endsWith('-journal') && item.bytes !== 0) throw fail('snapshot_coverage_invalid');
      continue;
    }
    const captured = byTarget.get(rule.destination);
    const kind = rule.strategy === 'database' ? 'sqlite' : item.kind;
    if (!captured || captured.kind !== kind || captured.sourceRelativePath !== item.relativePath || captured.derived !== undefined) throw fail('snapshot_coverage_invalid');
    if (kind === 'file' && (item.bytes !== captured.bytes || item.sha256 !== captured.sha256)) throw fail('snapshot_coverage_invalid');
    expected.add(rule.destination);
    if (kind === 'directory') directories.set(rule.destination, item.relativePath);
  }
  if (sources.get('config/lack.config.json')?.kind !== 'file' || !databases.has('db/lack.db')) throw fail('snapshot_coverage_invalid');
  const derivedConfig = byTarget.get('candidate/config/lack.config.json');
  if (derivedConfig?.kind !== 'config' || derivedConfig.derived !== true || derivedConfig.sourceRelativePath !== 'config/lack.config.json') throw fail('snapshot_coverage_invalid');
  for (const relative of [...expected]) {
    for (let parent = path.posix.dirname(relative); parent !== '.'; parent = path.posix.dirname(parent)) expected.add(parent);
  }
  for (const record of manifest.records) {
    if (!expected.has(record.relativePath)) throw fail('snapshot_coverage_invalid');
    if (record.kind === 'directory' && !directories.has(record.relativePath) && (record.derived !== true || record.sourceRelativePath !== undefined)) throw fail('snapshot_coverage_invalid');
  }
  if (expected.size !== byTarget.size) throw fail('snapshot_coverage_invalid');
}

function verifyWorkspaceSnapshot(snapshotRoot) {
  const root = checkedPath(snapshotRoot);
  const current = readBoundedJson(path.join(root, 'snapshot-state.json'), 16384).value;
  const { bytes, value: manifest } = readBoundedJson(path.join(root, 'manifest.json'), 2 * 1024 * 1024);
  if (![1, 2].includes(current.version) || current.version !== manifest.version || current.status !== 'prepared' || current.migrationReady !== false ||
      manifest.kind !== 'chunlack-offline-preparation' ||
      manifest.snapshotId !== current.snapshotId || !/^[0-9a-f-]{36}$/.test(current.snapshotId) ||
      current.manifestSha256 !== hashBytes(bytes) || manifest.migrationReady !== false || manifest.restoreReady !== false ||
      manifest.applicationConsistency !== 'not_proven' || !Array.isArray(manifest.records) || manifest.records.length > MAX_FILES) {
    throw fail('snapshot_metadata_invalid');
  }
  const listed = new Set(['snapshot-state.json', 'manifest.json']);
  const normalized = new Set(listed);
  const v2 = manifest.version === 2;
  let total = 0;
  const databases = []; let directoryCount = 0, fileCount = 0;
  for (const item of manifest.records) {
    const isDirectory = v2 && item?.kind === 'directory';
    const key = typeof item?.relativePath === 'string' && process.platform === 'win32' ? item.relativePath.toLowerCase() : item?.relativePath;
    const allowed = isDirectory ? /^(?:archive(?:\/config|\/legacy-root(?:\/.+)?)?|candidate(?:\/(?:config|db|memory|research|uploads|artifacts|attachments)(?:\/.+)?)?)$/.test(item.relativePath) :
      /^(?:archive\/config\/lack\.config\.json|candidate\/(?:config\/lack\.config\.json|db\/[^/]+|(?:memory|research|uploads|artifacts|attachments)\/.+))$/.test(item?.relativePath) || v2 && /^archive\/legacy-root\/.+/.test(item?.relativePath);
    if (!item || !['file', 'config', 'sqlite', ...(v2 ? ['directory'] : [])].includes(item.kind) || normalized.has(key) || !allowed) {
      throw fail('snapshot_manifest_entry_invalid');
    }
    let file;
    try { file = safeFile(root, item.relativePath); } catch { throw fail('snapshot_manifest_entry_invalid'); }
    listed.add(item.relativePath); normalized.add(key);
    if (isDirectory) {
      const stat = fs.lstatSync(file);
      if (!stat.isDirectory() || stat.isSymbolicLink() || item.bytes !== undefined || item.sha256 !== undefined) throw fail('snapshot_manifest_entry_invalid');
      if (process.platform !== 'win32' && (stat.mode & 0o077)) throw fail('snapshot_permissions_invalid');
      directoryCount++; continue;
    }
    if (!Number.isSafeInteger(item.bytes) || item.bytes < 0 || !/^[a-f0-9]{64}$/.test(item.sha256)) throw fail('snapshot_manifest_entry_invalid');
    const actual = digest(file);
    total += actual.bytes;
    if (total > MAX_TOTAL_BYTES || actual.bytes !== item.bytes || actual.sha256 !== item.sha256) throw fail('snapshot_file_mismatch');
    if (process.platform !== 'win32' && (fs.statSync(file).mode & 0o077)) throw fail('snapshot_permissions_invalid');
    fileCount++;
    if (item.kind === 'sqlite') {
      if (!DATABASES.includes(path.basename(file)) || !item.relativePath.startsWith('candidate/db/')) throw fail('snapshot_manifest_entry_invalid');
      const tables = describeDatabase(file);
      if (JSON.stringify(tables) !== JSON.stringify(item.tables)) throw fail('snapshot_database_counts_mismatch');
      databases.push({ relativePath: item.relativePath, tables });
    }
  }
  if (v2) verifyCoverage(root, manifest);
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
      if (++entries > (v2 ? MAX_FILES + 2 : MAX_FILES * 2)) throw fail('snapshot_inventory_limit');
      const childRelative = relative ? relative + '/' + name : name;
      const file = safeFile(root, childRelative);
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) throw fail('snapshot_link_denied');
      if (stat.isDirectory()) {
        if (v2 && !listed.has(childRelative)) throw fail('snapshot_unlisted_directory');
        checkDirectory(file, childRelative, depth + 1);
      }
      else if (!stat.isFile() || !listed.has(childRelative)) throw fail('snapshot_unlisted_file');
    }
  }
  checkDirectory(root);
  return {
    status: 'verified', snapshotId: manifest.snapshotId, fileCount, directoryCount: v2 ? directoryCount : null,
    entryCount: manifest.records.length, formatVersion: manifest.version,
    scope: v2 ? 'bounded_complete_root_inventory' : 'configured_database_allowlist_and_inventoried_files',
    sourceCoverage: v2 ? 'bounded_root_inventory_recorded' : 'legacy_partial_scope',
    verificationMode: 'offline_package_integrity', manifestSha256: hashBytes(bytes),
    databases, migrationReady: false, restoreReady: false, applicationConsistency: 'not_proven',
    permissionEvidence: process.platform === 'win32' ? 'windows_acl_not_verified' : 'private_posix_modes'
  };
}

module.exports = { prepareWorkspaceSnapshot, verifyWorkspaceSnapshot };
