'use strict';
const express = require('express');
const {randomBytes} = require('node:crypto');
const {requireWorkspaceContext} = require('./context.cjs');
const {IdentityError} = require('../identity/policy.cjs');

function createWorkspaceControlsRouter({taskControl, getGateway, now = Date.now}) {
  if (!taskControl || typeof getGateway !== 'function' || typeof now !== 'function') throw new IdentityError('controls_configuration', 503);
  const router = express.Router();
  const wrap = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next);
  function human() {
    const gateway = getGateway();
    if (!gateway?.workspaceAccess) throw new IdentityError('gateway_unavailable', 503);
    return gateway.workspaceAccess.forHuman(requireWorkspaceContext());
  }
  function body(req, fields) {
    if (!req.is('application/json')) throw new IdentityError('json_required', 415);
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).some(key => !fields.includes(key))) throw new IdentityError('invalid_request', 400);
    return req.body;
  }
  function externalTask(task) {
    return {taskId: task.id, workspaceId: task.workspace_id, createdBy: task.created_by,
      targetNodeId: task.node_id, taskType: task.task_type, state: task.status, attempt: task.attempt,
      createdAt: task.created_at, updatedAt: task.updated_at, deadlineAt: task.deadline_at,
      researchSessionId: task.research_session_id || null, traceId: task.trace_id};
  }
  router.use(express.json({limit: '16kb', strict: true}));
  router.get('/api/nodes', wrap((req, res) => res.json({nodes: human().listNodes()})));
  router.post('/api/nodes', wrap((req, res) => {
    const input = body(req, ['name', 'capabilities', 'scopes']);
    const created = human().createNode(input);
    const {pairingCode, expiresInSeconds, ...node} = created;
    res.status(201).json({node, pairingCode, expiresInSeconds});
  }));
  router.post('/api/nodes/:nodeId/pause', wrap((req, res) => {
    const input = body(req, ['paused']); if (typeof input.paused !== 'boolean') throw new IdentityError('invalid_request', 400);
    human().setNodePaused(req.params.nodeId, input.paused); res.json({ok: true});
  }));
  router.delete('/api/nodes/:nodeId', wrap((req, res) => {body(req, []); human().revokeNode(req.params.nodeId); res.json({ok: true});}));
  router.get('/api/tasks', wrap((req, res) => {
    // No input_json/result_json/lease token/prompt/credentials enter this view.
    res.json({localTasks: taskControl.listTasks(), externalTasks: getGateway()?.workspaceAccess ? human().listTasks().map(externalTask) : []});
  }));
  router.post('/api/tasks', wrap((req, res) => {
    // First external-computer pilot: the requester cannot supply a URL, command,
    // execution challenge, permission scope, deadline or model credentials.
    const input = body(req, ['targetNodeId']);
    const access = human();
    // This entry point uses the restricted screenshot facade, not the generic
    // research queue. Reject nodes the facade cannot serve before enqueueing.
    const node = access.getNode(input.targetNodeId);
    if (!node.capabilities.includes('browser.public_read')) throw new IdentityError('capability_denied', 403);
    if (!node.scopes.includes('public')) throw new IdentityError('scope_denied', 403);
    if (node.capabilities.length !== 1 || node.scopes.length !== 1) throw new IdentityError('facade_scope_denied', 403);
    const task = access.enqueueTask({targetNodeId: input.targetNodeId, scopeId: 'public', taskType: 'browser.public_read',
      input: {url: 'https://example.com/', challenge: randomBytes(32).toString('base64url')}, deadlineAt: now() + 300000});
    res.status(201).json({task: externalTask(access.getTask(task.taskId))});
  }));
  router.get('/api/tasks/:taskId/evidence', wrap((req, res) => {
    const access = human(), task = access.getTask(req.params.taskId), acceptance = access.getPilotAcceptance(task.id);
    const output = task.result?.output;
    const meta = acceptance.artifactId ? access.getPilotArtifact(acceptance.artifactId) : null;
    if (meta && (meta.taskId !== task.id || meta.nodeId !== task.node_id)) throw new IdentityError('artifact_unavailable', 409);
    // Never return the raw result/input, challenge, lease or node credentials.
    res.json({task: externalTask(task), acceptance, nodeRevoked: access.getNode(task.node_id).revoked,
      output: output ? Object.fromEntries(['url', 'title', 'executedAt', 'activityEvidence'].filter(key => typeof output[key] === 'string').map(key => [key, output[key]])) : null,
      artifact: meta ? {artifactId: meta.artifactId, sha256: meta.sha256, sizeBytes: meta.sizeBytes, width: meta.width, height: meta.height, contentType: meta.contentType, createdAt: meta.createdAt} : null});
  }));
  router.get('/api/tasks/:taskId/artifact', wrap((req, res) => {
    const gateway = getGateway();
    if (typeof gateway?.artifacts?.readForHuman !== 'function') throw new IdentityError('artifact_service_unavailable', 503);
    const artifact = human().readPilotArtifact(req.params.taskId, meta => gateway.artifacts.readForHuman(meta));
    res.setHeader('Content-Type', artifact.contentType);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline; filename="task-evidence.' + (artifact.contentType === 'image/png' ? 'png' : 'jpg') + '"');
    res.send(artifact.bytes);
  }));
  router.post('/api/tasks/:taskId/acceptance', wrap((req, res) => {
    const input = body(req, ['confirm']);
    if (input.confirm !== true) throw new IdentityError('invalid_request', 400);
    const access = human(), task = access.getTask(req.params.taskId);
    // Revoked execution authority is not an expired human session. Keep the
    // evidence readable, but do not log its viewer out on a node-specific 401.
    if (access.getNode(task.node_id).revoked) throw new IdentityError('pilot_acceptance_denied', 409);
    res.json({acceptance: access.acceptPilotTask(task.id)});
  }));
  router.post('/api/tasks/:taskId/cancel', wrap((req, res) => {
    const input = body(req, ['kind']);
    if (input.kind === 'local') res.json({task: taskControl.cancelTask(req.params.taskId)});
    else if (input.kind === 'external') {human().cancelTask(req.params.taskId); res.json({ok: true});}
    else throw new IdentityError('invalid_request', 400);
  }));
  router.use((failure, req, res, next) => {
    if (res.headersSent) return next(failure);
    const status = failure.statusCode || failure.status || (failure.type === 'entity.too.large' ? 413 : failure.type === 'entity.parse.failed' ? 400 : 503);
    const code = typeof failure.code === 'string' && /^[a-z_]{1,64}$/.test(failure.code) ? failure.code : status === 413 ? 'request_too_large' : status === 400 ? 'invalid_request' : 'service_unavailable';
    res.status(status).json({error: code});
  });
  return router;
}
module.exports = {createWorkspaceControlsRouter};
