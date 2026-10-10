'use strict';
const P = require('./protocol.cjs');
const {authorize} = require('../identity/policy.cjs');
const {requireWorkspaceContext} = require('../collaboration/context.cjs');

function createWorkspaceGatewayAccess({store, identity} = {}) {
  if (!store?.multiUser || !store.withWorkspace || !store.assertAuthenticatedNode || !identity?.requireMembership) P.fail('workspace_gateway_configuration', 503);
  function translate(fn) {
    try {return fn();} catch (error) {
      if (error.statusCode) P.fail(error.code, error.statusCode);
      throw error;
    }
  }
  function human(actor, action) {
    return translate(() => {
      const context = requireWorkspaceContext();
      if (!actor || actor.userId !== context.userId || actor.workspaceId !== context.workspaceId) P.fail('workspace_context_mismatch', 403);
      const current = identity.requireMembership(actor.userId, actor.workspaceId);
      if (action) authorize(current, action);
      return current;
    });
  }
  function grant(node, {cleanup = false} = {}) {
    return translate(() => {
      if (!node?.workspaceId || !node.createdBy || (!cleanup && node.revoked)) P.fail('unauthorized', 401);
      const owner = identity.requireMembership(node.createdBy, node.workspaceId);
      authorize(owner, 'node.manage');
      return node;
    });
  }
  function selector(value, workspaceId) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) P.fail('invalid_object');
    if (value.workspaceId !== undefined && value.workspaceId !== workspaceId) P.fail('workspace_mismatch', 403);
    const {workspaceId: ignored, ...clean} = value;
    return clean;
  }
  const stamp = (value, workspaceId) => value === null || value === undefined ? value : {...value, workspaceId};
  function forHuman(actor) {
    human(actor);
    function run(action, fn) {
      const current = human(actor, action);
      return store.withWorkspace({workspaceId: current.workspaceId, userId: current.userId}, () => fn(current));
    }
    function ownTask(action, id, fn) {
      return run('task.read', current => {const task = store.getTask(id); translate(() => authorize(current, action, task.createdBy)); return fn(task);});
    }
    return Object.freeze({
      createNode: spec => run('node.manage', current => store.createNode(selector(spec, current.workspaceId))),
      getNode: id => run('node.read', () => store.getNode(id)),
      listNodes: () => run('node.read', () => store.listNodes()),
      rePair: id => run('node.manage', () => store.rePair(id)),
      revokeNode: id => run('node.manage', () => store.revokeNode(id)),
      setNodePaused: (id, paused) => run('node.manage', () => store.setNodePaused(id, paused)),
      enqueueTask: spec => run('task.create', current => store.enqueueTask(selector(spec, current.workspaceId))),
      getTask: id => run('task.read', () => store.getTask(id)),
      listTasks: offset => run('task.read', () => store.listTasks(offset)),
      cancelTask: id => ownTask('task.cancel', id, () => store.cancelTask(id)),
      retryTask: id => ownTask('task.retry', id, () => store.retryTask(id)),
      getPilotAcceptance: id => run('task.read', () => store.getPilotAcceptance(id)),
      acceptPilotTask: id => run('task.approve', () => store.acceptPilotTask(id)),
      // The reader is trusted service code, never a client-supplied callback.
      // Human history access is separate from a currently valid node token.
      readPilotArtifact: (taskId, reader) => run('artifact.read', () => {
        if (typeof reader !== 'function') P.fail('artifact_service_unavailable', 503);
        const task = store.getTask(taskId), acceptance = store.getPilotAcceptance(taskId);
        if (!acceptance.artifactId) P.fail('artifact_unavailable', 409);
        const meta = store.getPilotArtifact(acceptance.artifactId);
        if (!meta || meta.taskId !== task.id || meta.nodeId !== task.node_id) P.fail('artifact_unavailable', 409);
        return reader(meta);
      }),
      getPilotArtifact: id => run('artifact.read', () => store.getPilotArtifact(id))
    });
  }
  function forNode(authenticatedNode) {
    function current() {return grant(store.assertAuthenticatedNode(authenticatedNode));}
    const initial = current();
    function run(fn) {const node = current(); return store.withWorkspace({workspaceId: node.workspaceId, userId: node.createdBy}, () => fn(node));}
    function task(node, id) {const value = store.getTask(id); if (value.node_id !== node.id) P.fail('unknown_task', 404); return value;}
    return Object.freeze({
      principal: Object.freeze({nodeId: initial.id, workspaceId: initial.workspaceId}),
      run,
      getTask: id => run(node => task(node, id)),
      claimTask: () => run(node => store.claimTask(node.id)),
      claimPilotTask: id => run(node => {task(node, id); return store.claimPilotTask(node.id, id);}),
      authorizePilotTask: id => run(node => store.authorizePilotTask(node.id, id)),
      renewLease: (id, leaseId, attempt) => run(node => stamp(store.renewLease(node.id, id, leaseId, attempt), node.workspaceId)),
      appendEvent: body => run(node => stamp(store.appendEvent(node.id, selector(body, node.workspaceId)), node.workspaceId)),
      submitResult: body => run(node => stamp(store.submitResult(node.id, selector(body, node.workspaceId)), node.workspaceId)),
      heartbeat: capabilities => run(node => store.heartbeat(node.id, capabilities || [])),
      nodeEvents: cursor => run(node => stamp(store.nodeEvents(node.id, cursor), node.workspaceId)),
      getPilotAcceptance: id => run(node => {task(node, id); return stamp(store.getPilotAcceptance(id), node.workspaceId);}),
      assertPilotLease: lease => run(node => store.assertPilotLease(node.id, lease))
    });
  }
  // Trusted background delivery uses attribution already persisted by an authenticated subscription.
  // Never use this entry point as an HTTP/MCP principal resolver.
  function authorizeStoredNode(principal, taskId, options = {}) {
    try {
      P.fields(principal, ['nodeId', 'workspaceId']); P.id(principal.nodeId); P.id(principal.workspaceId);
      return store.withWorkspace({workspaceId: principal.workspaceId}, () => {
        const node = grant(store.getNode(principal.nodeId), options);
        if (taskId !== undefined) store.authorizePilotTask(node.id, taskId);
        return true;
      });
    } catch {return false;}
  }
  function pair(workspaceId, code) {
    P.id(workspaceId);
    return store.pair(code, {workspaceId, authorize: node => grant(node)});
  }
  return Object.freeze({forHuman, forNode, authorizeStoredNode, pair});
}
module.exports = {createWorkspaceGatewayAccess};
