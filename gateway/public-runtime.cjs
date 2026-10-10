'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {once} = require('node:events');
const Database = require('better-sqlite3');
const writerLeases = new WeakMap();

function failure(code) {return Object.assign(new Error(code), {code});}
function safePath(target, {directory = false} = {}) {
  if (!path.isAbsolute(target)) throw failure('public_absolute_path_required');
  for (let current = path.resolve(target);; current = path.dirname(current)) {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw failure('public_linked_path_denied');
    if (path.dirname(current) === current) break;
  }
  const stat = fs.statSync(target);
  if (directory ? !stat.isDirectory() : !stat.isFile()) throw failure('public_invalid_path');
  return fs.realpathSync(target);
}
function origin(value) {
  let url; try {url = new URL(value);} catch {throw failure('public_invalid_origin');}
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(url.hostname)) throw failure('public_invalid_origin');
  return url.origin;
}
function configuration(config, env) {
  if (config?.multiUser?.enabled !== true) throw failure('public_multi_user_required');
  if (config.multiUser.migrationReady !== true) throw failure('migration_readiness_required');
  if (config.bindHost && config.bindHost !== '127.0.0.1' || env.LACK_BIND_HOST && env.LACK_BIND_HOST !== '127.0.0.1') throw failure('loopback_binding_required');
  if (config.agentGateway?.enabled !== true) throw failure('public_gateway_required');
  const options = config.publicRuntime || {}, webOrigin = origin(options.webOrigin), agentsOrigin = origin(options.agentsOrigin);
  const ports = [config.httpPort, config.agentGateway.port, options.mcpPort];
  if (webOrigin === agentsOrigin || ports.some(port => !Number.isInteger(port) || port < 1024 || port > 65535) || new Set(ports).size !== 3) throw failure('public_invalid_ports');
  const key = config.agentGateway.adminTokenEnv;
  if (typeof key !== 'string' || !/^[A-Z][A-Z0-9_]{1,100}$/.test(key) || typeof env[key] !== 'string' || env[key].length < 43 || env[key].length > 256) throw failure('public_private_gateway_credential_required');
  // Validate before acquiring a writer lease or opening an event database.
  if (options.events?.enabled === true) require('../integrations/mcp/runtime.cjs').validatePublicEventsOptions(options.events, env).encryptionKey.fill(0);
  return {webOrigin, agentsOrigin, mcpPort: options.mcpPort, events: options.events};
}
function validateMigration(root) {
  const identityPath = safePath(path.join(root, 'db', 'identity.db'));
  const dataPath = safePath(path.join(root, 'db', 'lack.db'));
  let identity, data;
  try {
    identity = new Database(identityPath, {readonly: true, fileMustExist: true});
    data = new Database(dataPath, {readonly: true, fileMustExist: true});
    for (const db of [identity, data]) {
      if (db.pragma('quick_check', {simple: true}) !== 'ok' || db.pragma('foreign_key_check').length) throw failure('migration_integrity_failed');
    }
    if (identity.prepare("SELECT version FROM schema_version WHERE component='identity'").get()?.version !== 1 || data.prepare("SELECT version FROM collaboration_schema WHERE component='collaboration'").get()?.version !== 1) throw failure('migration_schema_required');
    const workspaces = identity.prepare('SELECT id FROM workspaces WHERE disabled_at IS NULL').all();
    const owners = identity.prepare("SELECT m.workspace_id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.role='owner' AND u.disabled_at IS NULL").all();
    if (!workspaces.length || workspaces.some(w => !owners.some(o => o.workspace_id === w.id))) throw failure('migration_owner_required');
    const allWorkspaces = new Set(identity.prepare('SELECT id FROM workspaces').all().map(w => w.id));
    if (data.prepare('SELECT workspace_id FROM workspace_scopes').all().some(w => !allWorkspaces.has(w.workspace_id))) throw failure('migration_workspace_binding_required');
    const inventory = require('../collaboration/store.cjs').collaborationTableScopes;
    for (const row of data.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
      if (!Object.hasOwn(inventory, row.name)) throw failure('migration_unclassified_table');
      if (inventory[row.name] === 'workspace' && !data.prepare(`PRAGMA table_info(${row.name})`).all().some(c => c.name === 'workspace_id')) throw failure('migration_workspace_schema_required');
    }
    return identityPath;
  } catch (error) {
    if (error.code?.startsWith('migration_')) throw error;
    throw failure('migration_database_readiness_failed');
  } finally {data?.close(); identity?.close();}
}
function writerLock(root) {
  const file = path.join(root, '.public-runtime.lock'), instanceId = randomUUID(); let fd;
  try {fd = fs.openSync(file, 'wx', 0o600);} catch (error) {if (error.code === 'EEXIST') throw failure('public_writer_locked'); throw error;}
  const stat = fs.fstatSync(fd);
  try {fs.writeFileSync(fd, JSON.stringify({version: 1, pid: process.pid, instanceId, startedAt: Date.now()})); fs.fsyncSync(fd);}
  catch (error) {fs.closeSync(fd); fs.unlinkSync(file); throw error;}
  let released = false;
  const release = () => {
    if (released) return;
    const current = fs.lstatSync(file);
    if (current.isSymbolicLink() || current.dev !== stat.dev || current.ino !== stat.ino || JSON.parse(fs.readFileSync(file, 'utf8')).instanceId !== instanceId) throw failure('public_writer_lock_replaced');
    fs.unlinkSync(file); fs.closeSync(fd); released = true; writerLeases.delete(release);
  };
  writerLeases.set(release, {root, file, instanceId, stat});
  return release;
}
function assertWriterLease(root, lease) {
  const owner = typeof lease === 'function' ? writerLeases.get(lease) : null;
  if (!owner || path.resolve(root) !== owner.root) throw failure('public_writer_lease_required');
  try {
    const current = fs.lstatSync(owner.file);
    if (current.isSymbolicLink() || current.dev !== owner.stat.dev || current.ino !== owner.stat.ino || JSON.parse(fs.readFileSync(owner.file, 'utf8')).instanceId !== owner.instanceId) throw failure('public_writer_lease_required');
  } catch {throw failure('public_writer_lease_required');}
}
async function startMcpRuntime({gateway, root, port, ready, eventsOptions, env}) {
  const {store, workspaceAccess} = gateway;
  const artifacts = gateway.artifacts || require('./pilot-artifacts.cjs').createPilotArtifacts({store, root: path.join(root, 'artifacts', 'public-pilot')});
  const uploads = require('../integrations/mcp/artifact-upload.cjs').createArtifactUpload({store, artifacts});
  let mcp, eventRuntime, closing;
  function close(){if(closing)return closing;closing=(async()=>{const errors=[];for(const fn of [()=>mcp?.close(),()=>eventRuntime?.close()])try{await fn();}catch(error){errors.push(error);}if(errors.length)throw failure('public_mcp_shutdown_incomplete');})();return closing;}
  try {
    if(eventsOptions?.enabled===true)eventRuntime=require('../integrations/mcp/runtime.cjs').createPublicEventsRuntime({gateway,dataRoot:root,options:eventsOptions,env,ready});
    mcp = require('../integrations/mcp/pilot-server.cjs').createPilotMcp({store, artifacts, uploads, workspaceAccess, ready, events:eventRuntime?.events, resolvePrincipal: token => store.authenticate(token)});
    mcp.server.listen(port, '127.0.0.1'); await once(mcp.server, 'listening');
    return Object.freeze({server:mcp.server,events:eventRuntime?.events,close});
  } catch (error) {await close(); throw error;}
}
async function startPublicRuntime({config, dataRoot, env = process.env, loadLack = () => require('../server.js'), startMcp = startMcpRuntime} = {}) {
  const options = configuration(config, env), root = safePath(dataRoot, {directory: true});
  const identityPath = validateMigration(root), release = writerLock(root);
  let identity, capacity, web, mcp, closing;
  async function close() {
    if (closing) return closing;
    closing = (async () => {
      const errors = [];
      capacity?.close();
      for (const fn of [() => mcp?.close(), () => web?.close(), () => capacity?.drain({timeoutMs: 8000}), () => identity?.close()]) {
        try {await fn();} catch (error) {errors.push(error);}
      }
      if (errors.length) throw failure('public_shutdown_incomplete');
      release();
    })();
    return closing;
  }
  try {
    identity = require('../identity/store.cjs').createIdentityStore({dbPath: identityPath});
    capacity = require('../collaboration/capacity.cjs').createCapacityCoordinator({maxActive: 1, maxQueued: 100, maxQueuedPerWorkspace: 20});
    const module = loadLack();
    if (typeof module?.startLackRuntime !== 'function') throw failure('public_runtime_export_required');
    web = await module.startLackRuntime({config, dataRoot: root, identity, capacity, env, publicMode: true, bindHost: '127.0.0.1', webOrigin: options.webOrigin, identityPath, writerLease: release, deferReady: true});
    if (!web?.gateway?.workspaceAccess || typeof web.activate !== 'function') throw failure('public_workspace_gateway_required');
    mcp = await startMcp({gateway: web.gateway, root, port: options.mcpPort, ready: () => web.isReady(), eventsOptions: options.events, env});
    web.activate();
    return Object.freeze({identity, capacity, web, gateway: web.gateway, mcp, close});
  } catch (error) {
    try {await close();} catch {throw failure('public_startup_cleanup_incomplete');}
    throw error;
  }
}
module.exports = {startPublicRuntime, validateMigration, assertWriterLease};

if (require.main === module) {
  let runtime, start, stopping = false;
  async function stop() {if (stopping) return; stopping = true; try {runtime = runtime || await start; await runtime?.close();} catch {console.error('public_shutdown_failed'); process.exitCode = 1;}}
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, stop);
  start = (async () => {
    const dataRoot = process.env.LACK_DATA_ROOT;
    if (!dataRoot || !path.isAbsolute(dataRoot)) throw failure('public_absolute_path_required');
    const configFile = safePath(path.join(dataRoot, 'config', 'lack.config.json'));
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    runtime = await startPublicRuntime({config, dataRoot});
    console.log('PUBLIC_RUNTIME_READY');
    if (stopping) await runtime.close();
  })();
  start.catch(error => {console.error(/^[a-z0-9_]+$/.test(error.code || '') ? error.code : 'public_start_failed'); process.exitCode = 1;});
}
