'use strict';

class IdentityError extends Error {
  constructor(code, statusCode = 403) {
    super(code);
    this.name = 'IdentityError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const roles = Object.freeze(['owner', 'member', 'viewer']);
const readActions = Object.freeze([
  'workspace.read', 'message.read', 'task.read', 'artifact.read',
  'memory.read', 'agent.read', 'model.read', 'node.read', 'member.read'
]);
const memberActions = Object.freeze(['message.send', 'task.create', 'task.execute', 'artifact.upload']);
const ownerActions = Object.freeze([
  'workspace.manage', 'member.manage', 'invite.create', 'agent.manage',
  'node.manage', 'model.configure', 'task.approve', 'audit.read'
]);
const ownTaskActions = Object.freeze(['task.cancel', 'task.retry']);

// Pure policy for a server-verified context. Store mutations revalidate it.
function authorize(actor, action, resourceOwnerId = null) {
  if (!actor || typeof actor.userId !== 'string' || !actor.userId ||
      typeof actor.workspaceId !== 'string' || !actor.workspaceId) {
    throw new IdentityError('unauthorized', 401);
  }
  if (!roles.includes(actor.role)) throw new IdentityError('forbidden');
  if (readActions.includes(action)) return true;
  if (memberActions.includes(action) && actor.role !== 'viewer') return true;
  if (ownerActions.includes(action) && actor.role === 'owner') return true;
  if (ownTaskActions.includes(action) && (actor.role === 'owner' ||
      (actor.role === 'member' && resourceOwnerId === actor.userId))) return true;
  throw new IdentityError('forbidden');
}

module.exports = {IdentityError, roles, authorize};
