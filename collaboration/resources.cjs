'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {createHash, randomUUID} = require('node:crypto');
const {IdentityError, authorize} = require('../identity/policy.cjs');
const {requireWorkspaceContext} = require('./context.cjs');
const MAX_JSON_BYTES = 256 * 1024;
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,127}$/.test(value) && !/[. ]$/.test(value);
const denyPath = () => {throw new IdentityError('unsafe_resource_path', 400);};

function checkAncestors(target) {
  const absolute = path.resolve(target), parsed = path.parse(absolute);
  let current = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) denyPath();
      if (current !== absolute && !stat.isDirectory()) denyPath();
    } catch (error) {if (error.code !== 'ENOENT') throw error;}
  }
  return absolute;
}
function privateConfiguration(value, depth = 0) {
  if (depth > 30) throw new IdentityError('resource_too_large', 413);
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (/^(api_?key|password|credential_?ref|authorization|private_?key)$/i.test(key)) throw new IdentityError('private_resource_configuration', 400);
    privateConfiguration(item, depth + 1);
  }
}

function createWorkspaceResources({dataRoot, identity, providerCatalog = []} = {}) {
  if (typeof dataRoot !== 'string' || !path.isAbsolute(dataRoot) || !identity?.requireMembership || !Array.isArray(providerCatalog)) throw new IdentityError('invalid_resource_configuration', 503);
  const root = checkAncestors(dataRoot);
  if (!fs.statSync(root).isDirectory()) denyPath();
  // Copy only routing metadata. Secrets and private endpoints never enter the facade.
  const catalog = new Map();
  for (const item of providerCatalog) {
    if (!item || !id(item.id) || catalog.has(item.id)) throw new IdentityError('invalid_resource_configuration', 503);
    const grants = new Map();
    for (const [workspaceId, grant] of Object.entries(item.grants || {})) {
      if (!id(workspaceId) || !grant || !Array.isArray(grant.models) || grant.models.length > 100 || grant.models.some(m => typeof m !== 'string' || !m || m.length > 256 || /[\r\n\0]/.test(m) || m === '*')) throw new IdentityError('invalid_model_grant', 503);
      grants.set(workspaceId, Object.freeze([...new Set(grant.models)]));
    }
    catalog.set(item.id, Object.freeze({id: item.id, name: String(item.name || item.id).slice(0, 128), local: item.local === true, configured: item.configured !== false, grants}));
  }
  function fresh(actor, action = 'workspace.read') {
    const context = requireWorkspaceContext();
    if (!actor || context.userId !== actor.userId || context.workspaceId !== actor.workspaceId) throw new IdentityError('workspace_context_mismatch');
    if (!id(actor.workspaceId) || !id(actor.userId)) throw new IdentityError('invalid_context', 400);
    const principal = identity.requireMembership(actor.userId, actor.workspaceId);
    authorize(principal, action);
    return principal;
  }
  function workspaceRoot(actor) {
    fresh(actor);
    const directory = checkAncestors(path.join(root, 'workspaces', actor.workspaceId));
    fs.mkdirSync(directory, {recursive: true, mode: 0o700});
    return checkAncestors(directory);
  }
  function safePath(actor, relative) {
    fresh(actor);
    if (typeof relative !== 'string' || !relative || relative.length > 1024 || /[\\:\0]/.test(relative) || path.isAbsolute(relative)) denyPath();
    const parts = relative.split('/');
    if (parts[0] === 'users' && parts[1] !== actor.userId) throw new IdentityError('not_found', 404);
    if (parts.some(part => !id(part) || ['CON', 'PRN', 'AUX', 'NUL'].includes(part.split('.')[0].toUpperCase()) || /^(COM|LPT)[1-9](\.|$)/i.test(part))) denyPath();
    const directory = workspaceRoot(actor), target = path.resolve(directory, ...parts);
    const rel = path.relative(directory, target);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) denyPath();
    return checkAncestors(target);
  }
  function paths(actor) {
    const directory = workspaceRoot(actor), result = {root: directory};
    for (const [key, name] of Object.entries({memory: 'agent_memories', research: 'research', workspace: 'workspace', skills: 'skills', stack: 'lack_repos', threads: 'thread_repos', lineage: 'lineage', personal: `users/${actor.userId}`})) {
      result[key] = safePath(actor, name);
      fs.mkdirSync(result[key], {recursive: true, mode: 0o700});
      checkAncestors(result[key]);
    }
    return Object.freeze(result);
  }
  function writeJson(actor, relative, value) {
    fresh(actor, 'artifact.upload');
    privateConfiguration(value);
    const serialized = JSON.stringify(value);
    if (typeof serialized !== 'string' || Buffer.byteLength(serialized) > MAX_JSON_BYTES) throw new IdentityError('resource_too_large', 413);
    const target = safePath(actor, relative);
    fs.mkdirSync(path.dirname(target), {recursive: true, mode: 0o700});
    checkAncestors(target);
    const temporary = target + '.' + randomUUID() + '.tmp';
    try {
      fs.writeFileSync(temporary, serialized, {flag: 'wx', mode: 0o600});
      checkAncestors(target);
      fs.renameSync(temporary, target);
    } finally {if (fs.existsSync(temporary)) fs.unlinkSync(temporary);}
  }
  function readJson(actor, relative) {
    fresh(actor, 'artifact.read');
    const target = safePath(actor, relative);
    let stat;
    try {stat = fs.lstatSync(target);} catch (error) {if (error.code === 'ENOENT') return null; throw error;}
    if (!stat.isFile()) denyPath();
    if (stat.size > MAX_JSON_BYTES) throw new IdentityError('resource_too_large', 413);
    const value = JSON.parse(fs.readFileSync(target, 'utf8'));
    privateConfiguration(value);
    return value;
  }
  function authorizeProvider(actor, providerId, modelId = null, {localOnly = false} = {}) {
    fresh(actor, modelId === null ? 'model.read' : 'task.execute');
    const item = catalog.get(providerId), models = item?.grants.get(actor.workspaceId);
    if (!item || !item.configured || !models?.length || (localOnly && !item.local) || (modelId !== null && !models.includes(modelId))) throw new IdentityError('model_not_authorized');
    return Object.freeze({id: item.id, name: item.name, local: item.local, configured: true, models: Object.freeze([...models])});
  }
  function listProviders(actor) {
    fresh(actor, 'model.read');
    return Object.freeze([...catalog.values()].filter(p => p.configured && p.grants.get(actor.workspaceId)?.length).map(p => authorizeProvider(actor, p.id)));
  }
  function filterModels(actor, providerId, discovered) {
    const permitted = authorizeProvider(actor, providerId).models;
    return [...new Set(Array.isArray(discovered) ? discovered.filter(m => typeof m === 'string' && permitted.includes(m)) : [])];
  }
  function cacheKey(actor, {kind, userId = actor?.userId, resourceId} = {}) {
    fresh(actor);
    if (userId !== actor.userId) throw new IdentityError('forbidden');
    if (!id(kind) || typeof resourceId !== 'string' || Buffer.byteLength(resourceId) > MAX_JSON_BYTES) throw new IdentityError('invalid_cache_key', 400);
    return JSON.stringify([actor.workspaceId, actor.userId, kind, createHash('sha256').update(resourceId).digest('hex')]);
  }
  return Object.freeze({paths, safePath, writeJson, readJson, authorizeProvider, listProviders, filterModels, cacheKey});
}
module.exports = {createWorkspaceResources};
