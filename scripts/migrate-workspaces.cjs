'use strict';
// Offline preparation only: dry-run and SQLite-consistent snapshots, no activation.
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const Database = require('better-sqlite3');
const {collaborationTableScopes} = require('../collaboration/store.cjs');
const MAX_FILES = 4096, MAX_HASH_BYTES = 64 * 1024 * 1024;
function failure(code) {return Object.assign(new Error(code), {code});}
function absolute(value, {mustExist = true, directory = false} = {}) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /[\x00-\x1f\x7f]/.test(value)) throw failure('migration_absolute_path_required');
  const target = path.resolve(value);
  for (let current = target;; current = path.dirname(current)) {
    try {if (fs.lstatSync(current).isSymbolicLink()) throw failure('migration_linked_path_denied');}
    catch (error) {if (error.code !== 'ENOENT' || mustExist && current === target) throw error;}
    if (path.dirname(current) === current) break;
  }
  if (fs.existsSync(target)) {
    const stat = fs.lstatSync(target);
    if (directory ? !stat.isDirectory() : !stat.isFile()) throw failure('migration_invalid_path');
  } else if (mustExist) throw failure('migration_source_missing');
  return target;
}
function contains(parent, child) {const normalize = value => process.platform === 'win32' ? value.toLowerCase() : value; parent = normalize(parent); child = normalize(child); return parent === child || child.startsWith(parent + path.sep);}
function hashFile(file) {
  const handle = fs.openSync(file, 'r'), hash = createHash('sha256'), buffer = Buffer.alloc(65536);
  try {for (;;) {const size = fs.readSync(handle, buffer, 0, buffer.length, null); if (!size) break; hash.update(buffer.subarray(0, size));} return hash.digest('hex');}
  finally {fs.closeSync(handle);}
}
function name(value) {return typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\x00-\x1f\x7f]/.test(value) && !/^(?:sk-|ghp_|github_pat_)/.test(value) ? value : null;}
function identifier(value) {return typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);}
function quote(value) {return '"' + value.replaceAll('"', '""') + '"';}

function planMigration({sourceRoot, targetRoot, workspaceId, ownerId}) {
  sourceRoot = absolute(sourceRoot, {directory: true}); targetRoot = absolute(targetRoot, {directory: true, mustExist: false});
  if (contains(sourceRoot, targetRoot) || contains(targetRoot, sourceRoot)) throw failure('migration_roots_overlap');
  if (fs.existsSync(targetRoot) && fs.readdirSync(targetRoot).length) throw failure('migration_target_not_empty');
  const configPath = absolute(path.join(sourceRoot, 'config', 'lack.config.json'));
  if (fs.statSync(configPath).size > 2 * 1024 * 1024) throw failure('migration_config_too_large');
  let config; try {config = JSON.parse(fs.readFileSync(configPath, 'utf8'));} catch {throw failure('migration_config_invalid');}
  if (!config || Array.isArray(config) || typeof config !== 'object') throw failure('migration_config_invalid');
  const dbPath = absolute(path.join(sourceRoot, 'db', 'lack.db'));
  const unresolved = [], tables = [], files = [];
  let db;
  try {
    db = new Database(dbPath, {readonly: true, fileMustExist: true}); db.pragma('query_only=ON');
    db.transaction(() => {
      if (db.pragma('quick_check', {simple: true}) !== 'ok') throw failure('migration_source_integrity_failed');
      for (const table of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()) {
        if (tables.length >= 128) throw failure('migration_schema_inventory_limit');
        const classification = collaborationTableScopes[table.name] || 'unknown';
        const columns = db.prepare('PRAGMA table_info(' + quote(table.name) + ')').all();
        tables.push({name: table.name, classification, rows: db.prepare('SELECT count(*) AS n FROM ' + quote(table.name)).get().n,
          hasWorkspaceColumn: columns.some(column => column.name === 'workspace_id')});
        if (classification === 'unknown') unresolved.push({code: 'unknown_table', name: table.name});
      }
    }).deferred();
  } catch (error) {if (error.code?.startsWith('migration_')) throw error; throw failure('migration_source_database_invalid');}
  finally {db?.close();}
  let inventoryCount = 0;
  function collect(file, depth = 0) {
    if (++inventoryCount > MAX_FILES || depth > 8) throw failure('migration_file_inventory_limit');
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) throw failure('migration_linked_path_denied');
    if (stat.isDirectory()) {for (const entry of fs.readdirSync(file).sort()) collect(path.join(file, entry), depth + 1); return;}
    const relativePath = path.relative(sourceRoot, file).split(path.sep).join('/');
    if (!stat.isFile()) {unresolved.push({code: 'unsupported_file_type', relativePath}); return;}
    if (stat.size > MAX_HASH_BYTES) {unresolved.push({code: 'large_file_requires_review', relativePath, bytes: stat.size}); return;}
    files.push({relativePath, bytes: stat.size, sha256: hashFile(file)});
  }
  collect(configPath);
  const knownDirectories = ['memory', 'research', 'uploads', 'artifacts', 'attachments'];
  for (const folder of knownDirectories) {const target = path.join(sourceRoot, folder); if (fs.existsSync(target)) collect(target);}
  for (const entry of fs.readdirSync(sourceRoot).sort()) if (!['config', 'db', ...knownDirectories].includes(entry)) unresolved.push({code: 'unclassified_root_entry', name: entry});
  if (!identifier(workspaceId) || !identifier(ownerId)) unresolved.push({code: 'explicit_ownership_required'});
  let ownershipVerified = false;
  const identityPath = path.join(sourceRoot, 'db', 'identity.db');
  if (!fs.existsSync(identityPath)) unresolved.push({code: 'owner_identity_requires_bootstrap'});
  else if (identifier(workspaceId) && identifier(ownerId)) {
    let identity;
    try {
      absolute(identityPath); identity = new Database(identityPath, {readonly: true, fileMustExist: true});
      ownershipVerified = Boolean(identity.prepare("SELECT m.workspace_id FROM memberships m JOIN users u ON u.id=m.user_id JOIN workspaces w ON w.id=m.workspace_id WHERE m.workspace_id=? AND m.user_id=? AND m.role='owner' AND u.disabled_at IS NULL AND w.disabled_at IS NULL").get(workspaceId, ownerId));
      if (!ownershipVerified) unresolved.push({code: 'owner_binding_unverified'});
    } catch {unresolved.push({code: 'identity_source_unverified'});} finally {identity?.close();}
  }
  return {version: 1, mode: 'dry-run', readyToApply: false, implementationStage: 'planning_and_consistent_backup_only', sourceRoot, targetRoot,
    ownership: {workspaceId: identifier(workspaceId) ? workspaceId : null, ownerId: identifier(ownerId) ? ownerId : null, verified: ownershipVerified},
    database: {relativePath: 'db/lack.db', walPresent: fs.existsSync(dbPath + '-wal'), requiresOnlineBackup: true}, tables, files, unresolved,
    models: {defaultProvider: name(config.llmProvider) || 'ollama', defaultModel: name(config.defaultModel),
      providers: (Array.isArray(config.llmProviders) ? config.llmProviders : []).map(provider => name(provider?.id)).filter(Boolean),
      agents: (Array.isArray(config.agents) ? config.agents : []).map(agent => ({id: name(agent?.id), provider: name(agent?.provider) || name(config.llmProvider) || 'ollama', model: name(agent?.model) || name(config.defaultModel)}))}};
}

async function backupDatabase({sourcePath, targetPath}) {
  sourcePath = absolute(sourcePath); targetPath = absolute(targetPath, {mustExist: false});
  const parent = absolute(path.dirname(targetPath), {directory: true}), sourceParent = path.dirname(sourcePath);
  const sourceRoot = path.basename(sourceParent) === 'db' ? path.dirname(sourceParent) : sourceParent;
  if (contains(sourceRoot, targetPath)) throw failure('migration_roots_overlap');
  if (fs.existsSync(targetPath)) throw failure('migration_target_exists');
  const staging = fs.mkdtempSync(path.join(parent, '.migration-backup-')), snapshot = path.join(staging, 'snapshot.db');
  let source, check;
  try {
    source = new Database(sourcePath, {readonly: true, fileMustExist: true}); source.pragma('query_only=ON');
    await source.backup(snapshot); source.close(); source = null;
    check = new Database(snapshot, {readonly: true, fileMustExist: true});
    if (check.pragma('integrity_check', {simple: true}) !== 'ok' || check.pragma('foreign_key_check').length) throw failure('migration_backup_integrity_failed');
    check.close(); check = null;
    const sha256 = hashFile(snapshot), bytes = fs.statSync(snapshot).size;
    // Atomic no-replace publication. No copy/rename fallback may overwrite a file.
    try {fs.linkSync(snapshot, targetPath);} catch (error) {if (error.code === 'EEXIST') throw failure('migration_target_exists'); throw failure('migration_backup_publication_failed');}
    return {method: 'sqlite-online-backup', integrity: 'ok', sha256, bytes};
  } catch (error) {if (error.code?.startsWith('migration_')) throw error; throw failure('migration_backup_failed');}
  finally {
    check?.close(); source?.close();
    const cleanup = path.resolve(staging);
    if (!cleanup.startsWith(parent + path.sep)) throw failure('migration_unsafe_cleanup');
    fs.rmSync(cleanup, {recursive: true, force: true});
  }
}

// This checkpoint must not be mistaken for schema migration or readiness.
function applyMigration() {throw failure('migration_apply_not_ready');}
function verifyMigration() {throw failure('migration_verification_not_ready');}
function cliOptions(args) {
  const names = {'--source-root': 'sourceRoot', '--target-root': 'targetRoot', '--workspace-id': 'workspaceId', '--owner-id': 'ownerId'};
  const options = Object.create(null); let apply = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--apply' && !apply) {apply = true; continue;}
    const key = Object.hasOwn(names, args[i]) && names[args[i]], value = args[++i];
    if (!key || Object.hasOwn(options, key) || typeof value !== 'string' || !value || value.startsWith('--')) throw failure('migration_invalid_options');
    options[key] = value;
  }
  return {options, apply};
}
if (require.main === module) {
  try {const {options, apply} = cliOptions(process.argv.slice(2)), plan = planMigration(options); if (apply) applyMigration(plan); console.log(JSON.stringify(plan, null, 2));}
  catch (error) {console.log(JSON.stringify({readyToApply: false, error: /^migration_[a-z0-9_]+$/.test(error.code || '') ? error.code : 'migration_plan_failed'})); process.exitCode = 2;}
}
module.exports = {planMigration, backupDatabase, applyMigration, verifyMigration};
