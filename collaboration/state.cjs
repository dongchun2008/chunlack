'use strict';
const {IdentityError} = require('../identity/policy.cjs');
const {requireWorkspaceContext} = require('./context.cjs');
const workspaceMapNames = Object.freeze([
  'channels', 'agents', 'researchSessions', 'agentMemories', 'projectStates',
  'pinnedMessages', 'userReactions', 'agentMetrics', 'jsonFailCount', 'embeddingCache',
  'ralphActive', 'ralphGenerations', 'ralphGoals', 'ralphTimers', 'ralphCancel',
  'ralphStagnation', 'ralphNextAgentIdx', 'ralphLastBroadcast', 'loopHealth',
  'activeStackRepo', 'maintenanceCircuit', 'ollamaSemaphore', 'scrapeBlocklist', 'agentDegraded', 'proactiveThrottle', 'runtimeFlags'
]);
function createWorkspaceState(workspaceId) {
  if (typeof workspaceId !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(workspaceId) || workspaceId === '.' || workspaceId === '..') throw new IdentityError('invalid_workspace', 400);
  const state = {workspaceId};
  for (const name of workspaceMapNames) state[name] = new Map();
  state.close = () => {
    for (const timer of state.ralphTimers.values()) {clearTimeout(timer); clearInterval(timer);}
    for (const name of workspaceMapNames) state[name].clear();
  };
  return Object.freeze(state);
}
function createWorkspaceStateRegistry({identity, maxWorkspaces = 64}) {
  if (typeof identity?.requireMembership !== 'function' || !Number.isSafeInteger(maxWorkspaces) || maxWorkspaces < 1 || maxWorkspaces > 64) throw new IdentityError('invalid_state_config', 400);
  const states = new Map(); let closed = false;
  return Object.freeze({
    get() {
      if (closed) throw new IdentityError('state_closed', 503);
      const actor = requireWorkspaceContext();
      identity.requireMembership(actor.userId, actor.workspaceId);
      if (!states.has(actor.workspaceId)) {
        if (states.size >= maxWorkspaces) throw new IdentityError('workspace_capacity', 429);
        states.set(actor.workspaceId, createWorkspaceState(actor.workspaceId));
      }
      return states.get(actor.workspaceId);
    },
    close() {if (closed) return; closed = true; for (const state of states.values()) state.close(); states.clear();}
  });
}
function createScopedMap(name, {registry, mode = 'multi-user', legacyMap = new Map(), isPublic = false} = {}) {
  if (!workspaceMapNames.includes(name)) throw new IdentityError('invalid_state_map', 400);
  if (mode === 'legacy-local') {
    if (isPublic) throw new IdentityError('legacy_public_forbidden', 503);
    if (!(legacyMap instanceof Map)) throw new IdentityError('invalid_state_map', 400);
    return legacyMap;
  }
  if (mode !== 'multi-user' || typeof registry?.get !== 'function') throw new IdentityError('invalid_state_config', 400);
  let facade;
  facade = new Proxy(new Map(), {
    get(target, property) {
      const map = registry.get()[name];
      if (property === 'set') return (key, value) => {registry.get()[name].set(key, value); return facade;};
      if (property === 'forEach') return (callback, receiver) => registry.get()[name].forEach((value, key) => callback.call(receiver, value, key, facade));
      const value = Reflect.get(map, property, map);
      if (typeof value !== 'function') return value;
      return (...args) => Reflect.get(registry.get()[name], property, map).apply(registry.get()[name], args);
    },
    set() {throw new IdentityError('invalid_state_map', 400);}
  });
  return facade;
}
module.exports = {workspaceMapNames, createWorkspaceState, createWorkspaceStateRegistry, createScopedMap};
