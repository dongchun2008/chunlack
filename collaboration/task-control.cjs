'use strict';
const {requireWorkspaceContext} = require('./context.cjs');
const {authorize, IdentityError} = require('../identity/policy.cjs');

// Server-owned metadata only. Model payloads, credentials and results never enter
// this bounded view. Durable recovery and the external lease journal stay separate.
function createWorkspaceTaskControl({identity, capacity, now = Date.now, onState = () => {}, maxRecords = 100}) {
  if (!identity || !capacity || !Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > 1000) throw new IdentityError('task_control_configuration', 503);
  const records = new Map(); let closed = false;
  const fail = (code, status = 409) => {throw new IdentityError(code, status);};
  const key = (workspaceId, taskId) => workspaceId + ':' + taskId;
  function principal(action, owner = null) {
    const context = requireWorkspaceContext();
    const actor = identity.requireMembership(context.userId, context.workspaceId);
    authorize(actor, action, owner); return actor;
  }
  function snapshot(record) {
    return Object.freeze({taskId: record.taskId, workspaceId: record.workspaceId, createdBy: record.createdBy,
      state: record.state, createdAt: record.createdAt, updatedAt: record.updatedAt, deadlineAt: record.deadlineAt,
      activeBranches: record.activeBranches, delegations: record.delegations, maxDepthSeen: record.maxDepthSeen, errorCode: record.errorCode});
  }
  function change(record, state, errorCode = null) {
    record.state = state; record.errorCode = errorCode; record.updatedAt = now();
    try {onState(snapshot(record));} catch { /* observer cannot expand or interrupt authority */ }
  }
  function prune() {
    for (const [id, record] of records) if (!record.activeBranches && now() >= record.deadlineAt) records.delete(id);
    while (records.size >= maxRecords) {
      const oldest = [...records].find(([, record]) => !record.activeBranches && ['completed', 'failed', 'cancelled', 'needs_attention'].includes(record.state));
      if (!oldest) fail('task_history_capacity', 429);
      records.delete(oldest[0]);
    }
  }
  async function run(taskId, fn, {delegate = false, limits = {}} = {}) {
    if (closed) fail('task_control_closed', 503);
    if (typeof taskId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(taskId) || typeof fn !== 'function') fail('invalid_task', 400);
    const actor = principal('task.execute'), current = capacity.currentTask();
    if (current && (current.workspaceId !== actor.workspaceId || current.createdBy !== actor.userId)) fail('task_owner_mismatch', 403);
    current?.signal.throwIfAborted();
    let record, rootSignal;
    const timeoutMs = limits.timeoutMs ?? 300000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000) fail('invalid_execution_limits', 400);
    if (current) {
      record = records.get(key(actor.workspaceId, current.rootTaskId));
      if (!record || record.createdBy !== actor.userId) fail('task_owner_mismatch', 403);
      if (record.state === 'cancel_requested' || record.state === 'cancelled') fail('task_cancelled');
      if (record.state === 'failed' || record.state === 'needs_attention') fail('task_stopped');
      rootSignal = current.signal;
    } else {
      prune();
      const id = key(actor.workspaceId, taskId);
      if (records.has(id)) fail('duplicate_task');
      record = {taskId, workspaceId: actor.workspaceId, createdBy: actor.userId, state: 'running', createdAt: now(),
        updatedAt: now(), deadlineAt: now() + timeoutMs, activeBranches: 0, errorCode: null, cancelled: false,
        delegations: 0, maxDepthSeen: 0, maxDelegations: limits.maxSteps ?? 50};
      records.set(id, record);
    }
    record.activeBranches++; change(record, 'running');
    const invoke = async () => {
      const executing = capacity.currentTask(); rootSignal = executing.signal;
      rootSignal.throwIfAborted(); principal('task.execute');
      if (current && delegate) {
        if (record.delegations >= record.maxDelegations) fail('task_delegation_budget');
        record.delegations++; record.maxDepthSeen = Math.max(record.maxDepthSeen, executing.depth);
        change(record, 'running');
      }
      const value = await fn();
      rootSignal.throwIfAborted(); principal('task.execute'); return value;
    };
    try {
      return await (current && !delegate ? invoke() : capacity.withTaskScope({workspaceId: actor.workspaceId, taskId,
        createdBy: actor.userId, maxSteps: limits.maxSteps ?? 50, maxDepth: limits.maxDepth ?? 3,
        maxCost: limits.maxCost, deadlineAt: Math.min(record.deadlineAt, now() + timeoutMs)}, invoke));
    } catch (error) {
      const code = typeof error?.code === 'string' && /^[a-z_]{1,64}$/.test(error.code) ? error.code : 'task_failed';
      // A rejected delegate may be handled by its parent. Only the root's
      // unhandled failure finalizes the root; cancellation always cascades.
      if (record.cancelled || code === 'task_cancelled') change(record, 'cancelled', 'task_cancelled');
      else if (!current) change(record, code.includes('deadline') ? 'needs_attention' : 'failed', code);
      throw error;
    } finally {
      record.activeBranches--;
      if (record.cancelled && !record.activeBranches) change(record, 'cancelled', 'task_cancelled');
      else if (!record.activeBranches && record.state === 'running') change(record, 'completed');
    }
  }
  function getTask(taskId) {
    const actor = principal('task.read'), record = records.get(key(actor.workspaceId, taskId));
    if (!record) fail('task_not_found', 404); return snapshot(record);
  }
  function listTasks() {
    const actor = principal('task.read');
    return [...records.values()].filter(record => record.workspaceId === actor.workspaceId).map(snapshot);
  }
  function cancelTask(taskId) {
    const actor = principal('task.read'), record = records.get(key(actor.workspaceId, taskId));
    if (!record) fail('task_not_found', 404);
    principal('task.cancel', record.createdBy);
    if (['completed', 'failed', 'cancelled', 'needs_attention'].includes(record.state) && !record.activeBranches) return snapshot(record);
    record.cancelled = true; change(record, 'cancel_requested', 'task_cancelled');
    capacity.cancel(record.taskId); return snapshot(record);
  }
  function close() {
    if (closed) return; closed = true;
    for (const record of records.values()) if (record.activeBranches) {
      record.cancelled = true; change(record, 'cancel_requested', 'task_control_closed'); capacity.cancel(record.taskId);
    }
  }
  return Object.freeze({run, getTask, listTasks, cancelTask, close});
}
module.exports = {createWorkspaceTaskControl};
