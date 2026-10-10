'use strict';
// Reviewed offline candidates only. No listener, production switch or model call.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {createHash, randomUUID} = require('node:crypto');
const Database = require('better-sqlite3');
const {openWorkspaceSource} = require('./workspace-source-reader.cjs');
const {createIdentityStore} = require('../identity/store.cjs');
const {convertLegacyCollaboration} = require('./convert-legacy-collaboration.cjs');
const {convertLegacyGateway} = require('./convert-legacy-gateway.cjs');
const MAX_FILES = 8192, MAX_BYTES = 64 * 1024 * 1024, MAX_TOTAL = 1024 * 1024 * 1024;
const fail = code => Object.assign(new Error(code), {code});
const bytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const sha = value => createHash('sha256').update(value).digest('hex');
function checked(value, directory = false, missing = false) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /[\x00-\x1f\x7f]/.test(value)) throw fail('migration_invalid_path');
  value = path.resolve(value);
  for (let current = value;; current = path.dirname(current)) {
    try { if (fs.lstatSync(current).isSymbolicLink()) throw fail('migration_link_denied'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (path.dirname(current) === current) break;
  }
  if (fs.existsSync(value)) {
    if (directory ? !fs.statSync(value).isDirectory() : !fs.statSync(value).isFile()) throw fail('migration_invalid_path');
  } else if (!missing) throw fail('migration_path_missing');
  return value;
}
function within(parent, child) {
  if (process.platform === 'win32') {parent = parent.toLowerCase(); child = child.toLowerCase();}
  return parent === child || child.startsWith(parent + path.sep);
}
function relative(root, value) {
  if (typeof value !== 'string' || value.length > 1024 || /[\\\x00-\x1f]/.test(value) || value.split('/').some(p => !p || p === '.' || p === '..' || p.includes(':'))) throw fail('migration_invalid_path');
  const result = checked(path.join(root, ...value.split('/')), false, true);
  if (!within(root, result) || result === root) throw fail('migration_invalid_path');
  return result;
}
function digest(file) {
  file = checked(file);
  const stat = fs.statSync(file);
  if (stat.size > MAX_BYTES) throw fail('migration_capacity_exceeded');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  const hash = createHash('sha256'), buffer = Buffer.alloc(65536); let count = 0;
  try {
    for (;;) {const n = fs.readSync(fd, buffer, 0, buffer.length, null); if (!n) break; count += n; if (count > MAX_BYTES) throw fail('migration_capacity_exceeded'); hash.update(buffer.subarray(0, n));}
    if (count !== stat.size) throw fail('migration_file_mismatch');
  } finally {fs.closeSync(fd);}
  return {bytes: count, sha256: hash.digest('hex')};
}
function readJson(file, limit = 2 * 1024 * 1024) {
  checked(file); if (fs.statSync(file).size > limit) throw fail('migration_metadata_invalid');
  try {return JSON.parse(fs.readFileSync(file, 'utf8'));} catch {throw fail('migration_metadata_invalid');}
}
function write(file, value) {
  const fd = fs.openSync(file, 'wx', 0o600);
  try {fs.writeFileSync(fd, value); fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
}
function dirs(directory, root) {
  if (!within(root, directory)) throw fail('migration_invalid_path');
  let current = root;
  for (const part of path.relative(root, directory).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    checked(current, true, true);
    if (!fs.existsSync(current)) fs.mkdirSync(current, {mode: 0o700});
    if (process.platform !== 'win32' && (fs.statSync(current).mode & 0o077)) throw fail('migration_permissions_invalid');
  }
}
function copy(source, destination, expected, root) {
  source = checked(source); dirs(path.dirname(destination), root);
  if (fs.existsSync(destination)) throw fail('migration_destination_exists');
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  if (process.platform !== 'win32') fs.chmodSync(destination, 0o600);
  const fd = fs.openSync(destination, 'r+'); try {fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
  const actual = digest(destination);
  if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) throw fail('migration_file_mismatch');
}
function canonical(file) {
  const db = new Database(file, {fileMustExist: true, timeout: 1000});
  try {
    if (db.pragma('wal_checkpoint(TRUNCATE)').some(row => row.busy !== 0) || db.pragma('journal_mode=DELETE', {simple: true}) !== 'delete') throw fail('migration_database_busy');
    if (db.pragma('integrity_check', {simple: true}) !== 'ok' || db.pragma('foreign_key_check').length) throw fail('migration_data_integrity_failed');
  } finally {db.close();}
  if (process.platform !== 'win32') fs.chmodSync(file, 0o600);
}
function tableCounts(file) {
  const reader = openWorkspaceSource(file);
  try {
    if (reader.db.pragma('integrity_check', {simple: true}) !== 'ok' || reader.db.pragma('foreign_key_check').length) throw fail('migration_data_integrity_failed');
    const names = reader.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    if (names.length > 128) throw fail('migration_capacity_exceeded');
    return names.map(({name}) => ({name, count: reader.db.prepare('SELECT COUNT(*) n FROM "' + name.replaceAll('"', '""') + '"').get().n}));
  } finally {reader.close();}
}
function ownership(db, binding) {
  try {
    const row = db.prepare("SELECT m.*,u.disabled_at AS user_disabled,w.disabled_at AS workspace_disabled FROM memberships m JOIN users u ON u.id=m.user_id JOIN workspaces w ON w.id=m.workspace_id WHERE m.user_id=? AND m.workspace_id=? AND m.role='owner' AND u.disabled_at IS NULL AND w.disabled_at IS NULL").get(binding.ownerId, binding.workspaceId);
    if (!row) throw fail('migration_owner_binding_invalid');
    return row;
  } catch {throw fail('migration_owner_binding_invalid');}
}
function identityFingerprint(file) {return {main: digest(file), wal: fs.existsSync(file + '-wal') ? digest(file + '-wal') : null};}
function planBinding(plan) {
  if (!plan || plan.version !== 1 || plan.mode !== 'dry-run' || !/^[A-Za-z0-9_-]{1,100}$/.test(plan.ownership?.workspaceId) || !/^[A-Za-z0-9_-]{1,100}$/.test(plan.ownership?.ownerId) || !Array.isArray(plan.files) || !Array.isArray(plan.tables) || !Array.isArray(plan.unresolved)) throw fail('migration_plan_invalid');
  const sourceRoot = checked(plan.sourceRoot, true), targetRoot = checked(plan.targetRoot, true, true);
  if (within(sourceRoot, targetRoot) || within(targetRoot, sourceRoot)) throw fail('migration_roots_overlap');
  return {sourceRoot, targetRoot, workspaceId: plan.ownership.workspaceId, ownerId: plan.ownership.ownerId, planSha256: sha(bytes(plan))};
}
function grants(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 20 || !Object.keys(value).length) throw fail('migration_model_grants_required');
  const result = {};
  for (const [provider, grant] of Object.entries(value)) {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(provider) || ['__proto__','constructor','prototype'].includes(provider) || !grant || typeof grant !== 'object' || Object.keys(grant).some(key => key !== 'models') || !Array.isArray(grant.models) || !grant.models.length || grant.models.length > 100 || grant.models.some(model => typeof model !== 'string' || !model || model.length > 256 || /[\x00-\x1f]/.test(model) || model === '*')) throw fail('migration_model_grants_required');
    result[provider] = {models: [...new Set(grant.models)]};
  }
  return result;
}
function inventory(root, expectedConfig) {
  const records = []; let total = 0;
  function walk(directory, prefix = '', depth = 0) {
    if (depth > 16) throw fail('migration_capacity_exceeded');
    checked(directory, true);
    if (process.platform !== 'win32' && (fs.statSync(directory).mode & 0o077)) throw fail('migration_permissions_invalid');
    for (const name of fs.readdirSync(directory).sort()) {
      const rel = prefix ? prefix + '/' + name : name;
      if (!prefix && ['migration-state.json','migration-manifest.json'].includes(name)) continue;
      const file = path.join(directory, name); const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) throw fail('migration_link_denied');
      if (stat.isDirectory()) {walk(file, rel, depth + 1); continue;}
      if (!stat.isFile() || records.length >= MAX_FILES) throw fail('migration_capacity_exceeded');
      if (process.platform !== 'win32' && (stat.mode & 0o077)) throw fail('migration_permissions_invalid');
      const value = rel === 'config/lack.config.json' && expectedConfig ? {bytes: expectedConfig.length, sha256: sha(expectedConfig)} : digest(file);
      total += value.bytes; if (total > MAX_TOTAL) throw fail('migration_capacity_exceeded');
      const item = {relativePath: rel, ...value};
      if (rel.endsWith('.db')) item.tables = tableCounts(file);
      records.push(item);
    }
  }
  walk(root); return records;
}
function verifyPublishedRoot(root, expected) {
  root = checked(root, true);
  let state;
  try {state = readJson(path.join(root, 'migration-state.json'), 16384);} catch {throw fail('migration_publication_incomplete');}
  if (state.version !== 1 || state.status !== 'published' || state.migrationReady !== true) throw fail('migration_publication_incomplete');
  const manifestPath = path.join(root, 'migration-manifest.json'), manifest = readJson(manifestPath);
  if (state.manifestSha256 !== digest(manifestPath).sha256 || manifest.version !== 1 || manifest.kind !== 'chunlack-reviewed-workspace-migration' || manifest.migrationReady !== true || manifest.restoreReady !== false || state.planSha256 !== manifest.planSha256 || !Array.isArray(manifest.records) || manifest.records.length > MAX_FILES || expected && (expected.planSha256 !== manifest.planSha256 || expected.workspaceId !== manifest.workspaceId || expected.ownerId !== manifest.ownerId)) throw fail('migration_metadata_invalid');
  const config = readJson(path.join(root, 'config', 'lack.config.json'));
  if (config.multiUser?.migrationReady !== true || config.multiUser?.enabled !== true) throw fail('migration_publication_incomplete');
  const actual = inventory(root);
  if (JSON.stringify(actual) !== JSON.stringify(manifest.records)) throw fail('migration_file_mismatch');
  const reader = openWorkspaceSource(path.join(root, 'db', 'identity.db'));
  try {ownership(reader.db, manifest);} finally {reader.close();}
  require('../gateway/public-runtime.cjs').validateMigration(root);
  return {status: 'verified', migrationReady: true, restoreReady: false, workspaceId: manifest.workspaceId, ownerId: manifest.ownerId, snapshotId: manifest.snapshotId, fileCount: manifest.records.length, applicationConsistency: 'not_proven'};
}
function verifyReviewedMigration(plan) {const binding = planBinding(plan); return verifyPublishedRoot(binding.targetRoot, binding);}

async function applyReviewedMigration(plan, options) {
  const binding = planBinding(plan), root = binding.targetRoot;
  if (!options || options.reviewed !== true || !options.snapshotRoot || !options.identitySourcePath) throw fail('migration_apply_not_ready');
  if (fs.existsSync(root)) {
    if (fs.existsSync(path.join(root, 'migration-state.json')) && readJson(path.join(root, 'migration-state.json'), 16384).status === 'published') return verifyPublishedRoot(root, binding);
    throw fail('migration_destination_exists');
  }
  const modelGrants = grants(options.modelGrants);
  const snapshotRoot = checked(options.snapshotRoot, true), identitySource = checked(options.identitySourcePath);
  for (const other of [snapshotRoot, path.dirname(identitySource)]) if (within(root, other) || within(other, root) && other === snapshotRoot) throw fail('migration_roots_overlap');
  if (plan.unresolved.some(item => !['unknown_table','explicit_ownership_required','owner_identity_requires_bootstrap','owner_binding_unverified','identity_source_unverified'].includes(item.code))) throw fail('migration_unresolved_input');
  const {verifyWorkspaceSnapshot} = require('./workspace-snapshot.cjs');
  const prepared = verifyWorkspaceSnapshot(snapshotRoot), originalManifest = readJson(path.join(snapshotRoot, 'manifest.json'));
  const snapshotManifestSha256 = digest(path.join(snapshotRoot, 'manifest.json')).sha256;
  const records = new Map(originalManifest.records.map(item => [item.relativePath, item]));
  if (plan.files.length > 4096 || plan.tables.length > 128) throw fail('migration_plan_invalid');
  for (const file of plan.files) {
    const rel = file.relativePath === 'config/lack.config.json' ? 'archive/' + file.relativePath : 'candidate/' + file.relativePath;
    const captured = records.get(rel);
    if (!captured || captured.bytes !== file.bytes || captured.sha256 !== file.sha256) throw fail('migration_plan_snapshot_mismatch');
  }
  const legacyTables = records.get('candidate/db/lack.db')?.tables;
  if (!Array.isArray(legacyTables) || plan.tables.some(item => legacyTables.find(table => table.name === item.name)?.count !== item.rows) || legacyTables.length !== plan.tables.length) throw fail('migration_plan_snapshot_mismatch');
  const identityBefore = identityFingerprint(identitySource);
  let identityReader = openWorkspaceSource(identitySource), proof;
  try {proof = ownership(identityReader.db, binding);} finally {identityReader.close(); identityReader = null;}
  const parent = checked(path.dirname(root), true);
  const required = originalManifest.records.reduce((sum, item) => sum + item.bytes * 2, 0) + identityBefore.main.bytes * 2 + 128 * 1024 * 1024;
  const space = fs.statfsSync(parent);
  if (space.bavail * space.bsize < required) throw fail('migration_disk_budget_insufficient');
  fs.mkdirSync(root, {mode: 0o700}); const rootStat = fs.lstatSync(root), instanceId = randomUUID();
  dirs(path.join(root, 'config'), root); dirs(path.join(root, 'db'), root);
  const archivedConfig = readJson(relative(snapshotRoot, 'archive/config/lack.config.json'));
  const config = {...archivedConfig, multiUser: {...(archivedConfig.multiUser || {}), enabled: true, migrationReady: false}, workspaceModelGrants: {[binding.workspaceId]: modelGrants}};
  const configPath = path.join(root, 'config', 'lack.config.json'); write(configPath, bytes(config));
  const statePath = path.join(root, 'migration-state.json');
  let currentState = {version: 1, instanceId, status: 'building', migrationReady: false, planSha256: binding.planSha256, snapshotId: prepared.snapshotId};
  write(statePath, bytes(currentState));
  let identity, target, sourceReader, gatewayReader;
  function owned() {
    checked(root, true); const stat = fs.lstatSync(root);
    if (stat.ino !== rootStat.ino || stat.dev !== rootStat.dev || readJson(statePath, 16384).instanceId !== instanceId) throw fail('migration_candidate_replaced');
  }
  function atomic(file, value) {
    owned(); checked(file); const staging = path.join(path.dirname(file), '.migration-write-' + randomUUID()); write(staging, value);
    fs.renameSync(staging, file);
  }
  function phase(name) {owned(); if (options.onPhase) options.onPhase(name); owned();}
  try {
    const quarantine = path.join(root, 'quarantine', 'snapshot'); dirs(quarantine, root);
    for (const item of originalManifest.records) copy(relative(snapshotRoot, item.relativePath), relative(quarantine, item.relativePath), item, root);
    for (const name of ['manifest.json','snapshot-state.json']) copy(path.join(snapshotRoot, name), path.join(quarantine, name), digest(path.join(snapshotRoot, name)), root);
    for (const item of originalManifest.records) {
      if (!item.relativePath.startsWith('candidate/') || item.kind === 'sqlite' || item.kind === 'config') continue;
      const parts = item.relativePath.split('/').slice(1), folder = parts.shift();
      const destinationFolder = folder === 'memory' ? 'agent_memories' : folder;
      const destination = relative(root, 'workspaces/' + binding.workspaceId + '/' + destinationFolder + '/' + parts.join('/'));
      copy(relative(snapshotRoot, item.relativePath), destination, item, root);
    }
    phase('snapshot-retained');
    identityReader = openWorkspaceSource(identitySource);
    await identityReader.db.backup(path.join(root, 'db', 'identity.db'));
    identityReader.close(); identityReader = null;
    canonical(path.join(root, 'db', 'identity.db'));
    identity = createIdentityStore({dbPath: path.join(root, 'db', 'identity.db')});
    if (identity.requireMembership(binding.ownerId, binding.workspaceId).role !== 'owner') throw fail('migration_owner_binding_invalid');
    sourceReader = openWorkspaceSource(relative(snapshotRoot, 'candidate/db/lack.db'));
    target = new Database(path.join(root, 'db', 'lack.db'));
    let collaboration;
    try {collaboration = convertLegacyCollaboration({source: sourceReader.db, target, identity, workspaceId: binding.workspaceId, ownerId: binding.ownerId, defaultModel: config.defaultModel});}
    catch {throw fail('migration_data_integrity_failed');}
    const agents = target.prepare('SELECT provider,model FROM agents WHERE workspace_id=?').all(binding.workspaceId);
    if (agents.some(agent => !modelGrants[agent.provider]?.models.includes(agent.model))) throw fail('migration_model_grants_required');
    target.close(); target = null; sourceReader.close(); sourceReader = null;
    let gateway;
    if (records.has('candidate/db/agent-gateway.db')) {
      gatewayReader = openWorkspaceSource(relative(snapshotRoot, 'candidate/db/agent-gateway.db'));
      const artifactFiles = new Map();
      for (const meta of gatewayReader.db.prepare('SELECT * FROM pilot_artifacts').iterate()) {
        if (!/^[a-f0-9-]{36}$/i.test(meta.id)) throw fail('migration_attachment_integrity_failed');
        const suffix = meta.content_type === 'image/png' ? '.png' : '.jpg';
        const found = originalManifest.records.filter(item => item.relativePath.startsWith('candidate/artifacts/') && path.posix.basename(item.relativePath) === meta.id + suffix);
        if (!found.length) throw fail('migration_attachment_missing');
        if (found.length !== 1 || found[0].sha256 !== meta.sha256 || found[0].bytes !== meta.size_bytes || meta.size_bytes > 2 * 1024 * 1024) throw fail('migration_attachment_integrity_failed');
        if (meta.content_type !== 'image/png') throw fail('migration_attachment_unsupported');
        artifactFiles.set(meta.id, relative(snapshotRoot, found[0].relativePath));
      }
      try {gateway = convertLegacyGateway({source: gatewayReader.db, targetRoot: root, identity, workspaceId: binding.workspaceId, ownerId: binding.ownerId, readArtifact: meta => fs.readFileSync(artifactFiles.get(meta.id))});}
      catch {throw fail('migration_data_integrity_failed');}
      gatewayReader.close(); gatewayReader = null;
    } else {
      const store = require('../gateway/store.cjs').createGatewayStore({dbPath: path.join(root, 'db', 'agent-gateway.db'), multiUser: true}); store.close();
    }
    identity.close(); identity = null;
    for (const name of ['lack.db','identity.db','agent-gateway.db']) canonical(path.join(root, 'db', name));
    phase('data-converted');
    verifyWorkspaceSnapshot(snapshotRoot);
    if (digest(path.join(snapshotRoot, 'manifest.json')).sha256 !== snapshotManifestSha256 || JSON.stringify(identityFingerprint(identitySource)) !== JSON.stringify(identityBefore)) throw fail('migration_source_changed');
    identityReader = openWorkspaceSource(identitySource);
    if (JSON.stringify(ownership(identityReader.db, binding)) !== JSON.stringify(proof)) throw fail('migration_owner_binding_invalid');
    identityReader.close(); identityReader = null;
    require('../gateway/public-runtime.cjs').validateMigration(root);
    const finalConfig = bytes({...config, multiUser: {...config.multiUser, migrationReady: true}});
    const manifest = {version: 1, kind: 'chunlack-reviewed-workspace-migration', planSha256: binding.planSha256, snapshotId: prepared.snapshotId, snapshotManifestSha256, workspaceId: binding.workspaceId, ownerId: binding.ownerId,
      migrationReady: true, restoreReady: false, applicationConsistency: 'not_proven', historicalOwnership: 'operator-assigned-not-author-verified',
      permissionEvidence: process.platform === 'win32' ? 'windows_acl_not_verified' : 'private_posix_modes', converted: {collaboration: collaboration.converted, gateway: gateway?.converted || {}},
      quarantinedTables: {collaboration: collaboration.unassignedTables, gateway: gateway?.unassignedTables || []}, records: inventory(root, finalConfig)};
    const manifestBytes = bytes(manifest); owned(); write(path.join(root, 'migration-manifest.json'), manifestBytes);
    phase('verified-before-publication');
    currentState = {...currentState, status: 'published', migrationReady: true, manifestSha256: sha(manifestBytes)};
    atomic(statePath, bytes(currentState));
    atomic(configPath, finalConfig);
    return verifyPublishedRoot(root, binding);
  } catch (error) {
    try {
      if (identity) {identity.close(); identity = null;}
      if (target?.open) {target.close(); target = null;}
      owned();
      atomic(configPath, bytes({...config, multiUser: {...config.multiUser, migrationReady: false}}));
      atomic(statePath, bytes({...currentState, status: 'failed', migrationReady: false, error: 'migration_execution_failed'}));
    } catch {throw fail('migration_failure_marker_incomplete');}
    throw error;
  } finally {
    try {if (target?.open) target.close(); if (identity) identity.close();}
    finally {try {sourceReader?.close();} finally {try {gatewayReader?.close();} finally {identityReader?.close();}}}
  }
}
module.exports = {applyReviewedMigration, verifyReviewedMigration, verifyPublishedRoot};
