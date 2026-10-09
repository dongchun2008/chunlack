'use strict';
const {AsyncLocalStorage} = require('node:async_hooks');
const {IdentityError} = require('../identity/policy.cjs');
const contexts = new AsyncLocalStorage();
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(value);
function runWithWorkspace(actor, fn) {
  if (!actor || !validId(actor.userId) || !validId(actor.workspaceId) || !['owner', 'member', 'viewer'].includes(actor.role) || !Number.isSafeInteger(actor.version) || actor.version < 1 || typeof fn !== 'function') throw new IdentityError('invalid_context', 400);
  const context = Object.freeze({userId: actor.userId, workspaceId: actor.workspaceId, role: actor.role, version: actor.version});
  return contexts.run(context, fn);
}
function requireWorkspaceContext() {
  const context = contexts.getStore();
  if (!context) throw new IdentityError('workspace_context_required', 503);
  return context;
}
module.exports = {runWithWorkspace, requireWorkspaceContext};
