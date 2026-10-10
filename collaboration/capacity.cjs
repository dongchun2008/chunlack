'use strict';
const {AsyncLocalStorage} = require('node:async_hooks');
const {runWithWorkspace, requireWorkspaceContext} = require('./context.cjs');
function failure(code, statusCode = 409) {const error = new Error(code); error.code = code; error.statusCode = statusCode; return error;}
function id(value) {if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw failure('invalid_capacity_identity', 400); return value;}
function createCapacityCoordinator({maxActive = 1, maxQueued = 100, maxQueuedPerWorkspace = 20, now = Date.now, onTransition = () => {}} = {}) {
  if (![maxActive, maxQueued, maxQueuedPerWorkspace].every(Number.isSafeInteger) || maxActive < 1 || maxActive > 5 || maxQueued < 1 || maxQueued > 100 || maxQueuedPerWorkspace < 1 || maxQueuedPerWorkspace > 20 || typeof now !== 'function' || typeof onTransition !== 'function') throw failure('invalid_capacity_configuration', 400);
  const local = new Map(), external = new Map(), remoteQueue = new Map(), ready = new Map(), roots = new Map(), listeners = new Set();
  const scopes = new AsyncLocalStorage(), executing = new AsyncLocalStorage();
  let closed = false, source = null, sourceFailed = false, refreshing = false, pumping = false, notifying = false, sequence = 0, lastWorkspace = null, handoff = null;
  const activeCount = () => external.size + [...local.values()].filter(entry => entry.state === 'running').length;
  const waiting = workspaceId => [...local.values()].filter(entry => entry.state === 'queued' && (!workspaceId || entry.workspaceId === workspaceId)).length + [...remoteQueue.values()].filter(entry => !workspaceId || entry.workspaceId === workspaceId).length;
  function transition(entry, state, reason) {
    try {onTransition(Object.freeze({workspaceId: entry.workspaceId, taskId: entry.taskId, kind: entry.kind || 'node.external', state, ...(reason ? {reason} : {})}));} catch {}
  }
  function notify() {
    if (notifying || closed) return; notifying = true;
    queueMicrotask(() => {notifying = false; if (!closed) for (const listener of listeners) {try {listener();} catch {}}});
  }
  function remove(entry, error, value) {
    local.delete(entry.taskId); entry.signal?.removeEventListener('abort', entry.onAbort);
    if (entry.scope && entry.state === 'queued') entry.scope.root.reservedCost -= entry.cost;
    entry.state = error ? 'failed' : 'succeeded'; transition(entry, entry.state, error?.code);
    error ? entry.reject(error) : entry.resolve(value);
  }
  function cancelEntry(entry, error) {
    if (entry.error) return; entry.error = error;
    if (entry.state === 'queued') remove(entry, error); else {entry.controller.abort(error); transition(entry, 'cancellation_pending', error.code);}
  }
  function lease(value) {
    if (!value || !['leased', 'running', 'cancel_requested'].includes(value.status) || !Number.isSafeInteger(value.leaseExpiresAt)) throw failure('invalid_external_lease', 503);
    return {...value, workspaceId: id(value.workspaceId), taskId: id(value.taskId), leaseId: id(value.leaseId), kind: 'node.external'};
  }
  function restoreExternalLeases(values) {
    if (closed) throw failure('capacity_closed', 503);
    if (!Array.isArray(values) || values.length > maxActive) throw failure('external_capacity_recovery_conflict', 503);
    const next = new Map();
    for (const raw of values) {const value = lease(raw); if (value.leaseExpiresAt <= now()) continue; if (next.has(value.taskId) || local.has(value.taskId)) throw failure('external_lease_identity_conflict', 503); next.set(value.taskId, {...value, sourceObserved: true});}
    if ([...local.values()].filter(entry => entry.state === 'running').length + next.size > maxActive) throw failure('external_capacity_recovery_conflict', 503);
    external.clear(); for (const [taskId, value] of next) external.set(taskId, value);
    if (next.size) lastWorkspace = [...next.values()].at(-1).workspaceId;
  }
  function readSource() {
    if (!source || refreshing) return;
    refreshing = true;
    try {
      const snapshot = source();
      if (!snapshot || !Array.isArray(snapshot.active) || !Array.isArray(snapshot.queued) || snapshot.active.length > maxActive || snapshot.queued.length > maxQueued) throw failure('invalid_capacity_recovery', 503);
      const next = new Map(), queued = new Map();
      for (const raw of snapshot.active) {const value = lease(raw); if (value.leaseExpiresAt <= now()) continue; if (next.has(value.taskId) || local.has(value.taskId)) throw failure('external_lease_identity_conflict', 503); next.set(value.taskId, {...value, sourceObserved: true});}
      for (const raw of snapshot.queued) {
        const workspaceId = id(raw.workspaceId), taskId = id(raw.taskId);
        if (!Number.isSafeInteger(raw.deadlineAt) || !Number.isSafeInteger(raw.createdAt) || queued.has(taskId) || local.has(taskId) || next.has(taskId)) throw failure('invalid_capacity_recovery', 503);
        if (raw.deadlineAt <= now()) continue;
        queued.set(taskId, {...raw, workspaceId, taskId, kind: 'node.external', sequence: remoteQueue.get(taskId)?.sequence || ++sequence});
      }
      // A just-issued claim is not executable until the synchronous DB commit finishes.
      // Keep it occupied if a write fails; the caller must explicitly confirm no dispatch.
      for (const [taskId, value] of external) if (!value.sourceObserved && !next.has(taskId) && value.leaseExpiresAt > now()) next.set(taskId, value);
      if ([...local.values()].filter(entry => entry.state === 'running').length + next.size > maxActive) throw failure('external_capacity_recovery_conflict', 503);
      const perWorkspace = new Map();
      for (const entry of queued.values()) perWorkspace.set(entry.workspaceId, (perWorkspace.get(entry.workspaceId) || 0) + 1);
      if (waiting() - remoteQueue.size + queued.size > maxQueued || [...perWorkspace].some(([workspaceId, count]) => count + [...local.values()].filter(entry => entry.state === 'queued' && entry.workspaceId === workspaceId).length > maxQueuedPerWorkspace)) throw failure('capacity_recovery_queue_limit', 503);
      external.clear(); for (const [taskId, entry] of next) external.set(taskId, entry);
      remoteQueue.clear(); for (const [taskId, entry] of queued) remoteQueue.set(taskId, entry);
      sourceFailed = false;
    } catch (error) {sourceFailed = true; throw error;} finally {refreshing = false;}
  }
  function expire() {
    for (const entry of [...local.values()]) if (!entry.error && entry.deadlineAt <= now()) cancelEntry(entry, failure('task_deadline'));
    for (const [taskId, entry] of external) if (entry.leaseExpiresAt <= now()) {external.delete(taskId); transition(entry, 'lease_expired');}
    for (const [taskId, entry] of remoteQueue) if (entry.deadlineAt <= now()) {remoteQueue.delete(taskId); ready.delete(taskId);}
    for (const [taskId, until] of ready) if (until <= now() || !remoteQueue.has(taskId)) ready.delete(taskId);
    if (handoff && (handoff.until <= now() || !remoteQueue.has(handoff.taskId))) {ready.delete(handoff.taskId); handoff = null;}
    for (const [taskId, root] of roots) if (root.deadlineAt <= now()) {root.controller.abort(failure('task_deadline')); roots.delete(taskId);}
  }
  function select() {
    const entries = [...local.values()].filter(entry => entry.state === 'queued').concat([...remoteQueue.values()].filter(entry => ready.has(entry.taskId))).sort((a, b) => a.sequence - b.sequence);
    if (!entries.length) return null;
    const workspaces = [...new Set(entries.map(entry => entry.workspaceId))], previous = workspaces.indexOf(lastWorkspace);
    const workspaceId = workspaces[(previous + 1) % workspaces.length];
    return entries.find(entry => entry.workspaceId === workspaceId);
  }
  function start(entry) {
    entry.state = 'running'; lastWorkspace = entry.workspaceId;
    if (entry.scope) {entry.scope.root.reservedCost -= entry.cost; entry.scope.root.spentCost += entry.cost;}
    transition(entry, 'running');
    Promise.resolve().then(() => entry.capture(() => executing.run(entry, () => entry.run({workspaceId: entry.workspaceId, taskId: entry.taskId, signal: entry.controller.signal})))).then(
      value => {remove(entry, entry.error, value); pump(); notify();},
      error => {remove(entry, entry.error || error); pump(); notify();}
    );
  }
  function pump() {
    if (closed || pumping || refreshing || sourceFailed) return; pumping = true;
    try {
      expire();
      while (activeCount() < maxActive) {
        if (handoff) break;
        const entry = select(); if (!entry) break;
        if (remoteQueue.has(entry.taskId)) {handoff = {taskId: entry.taskId, until: now() + 1500}; notify(); break;}
        start(entry);
      }
    } finally {pumping = false;}
  }
  function refresh({pump: shouldPump = true} = {}) {if (closed) return; readSource(); expire(); if (shouldPump) pump();}
  function assertCanQueue(workspaceId) {
    id(workspaceId); if (closed) throw failure('capacity_closed', 503); refresh({pump: false});
    if (waiting(workspaceId) >= maxQueuedPerWorkspace) throw failure('workspace_queue_full', 429);
    if (waiting() >= maxQueued) throw failure('global_queue_full', 429);
  }
  function submit(spec) {
    try {
      if (closed) throw failure('capacity_closed', 503);
      const {workspaceId, taskId, deadlineAt, kind, run, signal, estimatedCost = 0} = spec || {};
      id(workspaceId); id(taskId);
      if (typeof run !== 'function' || !['model.generate', 'model.embed', 'model.discover', 'external'].includes(kind) || !Number.isSafeInteger(deadlineAt) || deadlineAt <= now() || deadlineAt > now() + 1800000 || !Number.isFinite(estimatedCost) || estimatedCost < 0) throw failure('invalid_execution_request', 400);
      const scope = scopes.getStore(), running = executing.getStore();
      if (scope && scope.workspaceId !== workspaceId) throw failure('workspace_context_mismatch', 403);
      if (running?.state === 'running') throw failure('recursive_execution_slot', 409);
      let actor; try {actor = requireWorkspaceContext();} catch (error) {if (error.code !== 'workspace_context_required') throw error;}
      if (actor && actor.workspaceId !== workspaceId) throw failure('workspace_context_mismatch', 403);
      if (scope?.root.controller.signal.aborted) throw scope.root.controller.signal.reason;
      if (signal?.aborted) throw failure('task_aborted');
      if (local.has(taskId) || external.has(taskId) || remoteQueue.has(taskId)) throw failure('duplicate_capacity_task');
      assertCanQueue(workspaceId);
      if (scope && scope.root.steps >= scope.root.maxSteps) throw failure('task_step_budget');
      if (scope && scope.root.maxCost !== undefined && scope.root.spentCost + scope.root.reservedCost + estimatedCost > scope.root.maxCost) throw failure('task_cost_budget');
      const signals = [signal, scope?.root.controller.signal].filter(Boolean), combined = signals.length ? AbortSignal.any(signals) : undefined;
      return new Promise((resolve, reject) => {
        const entry = {workspaceId, taskId, deadlineAt: Math.min(deadlineAt, scope?.deadlineAt || deadlineAt), kind, run, signal: combined, controller: new AbortController(), state: 'queued', sequence: ++sequence, scope, cost: estimatedCost, capture: AsyncLocalStorage.snapshot(), resolve, reject};
        if (scope) {scope.root.steps++; scope.root.reservedCost += estimatedCost;}
        entry.onAbort = () => {cancelEntry(entry, scope?.root.controller.signal.aborted ? scope.root.controller.signal.reason : failure('task_aborted')); pump();};
        combined?.addEventListener('abort', entry.onAbort, {once: true});
        local.set(taskId, entry); transition(entry, 'queued'); pump();
      });
    } catch (error) {return Promise.reject(error);}
  }
  function cancel(taskId) {
    id(taskId); const entry = local.get(taskId);
    if (entry) {cancelEntry(entry, failure('task_cancelled')); pump(); return true;}
    const root = roots.get(taskId); if (root) {root.controller.abort(failure('task_cancelled')); return true;}
    const remote = external.get(taskId); if (remote) {remote.status = 'cancel_requested'; transition(remote, 'remote_cancellation_unconfirmed'); return true;}
    return false;
  }
  function releaseExternal(taskId, leaseId, {confirmed = false} = {}) {
    const entry = external.get(id(taskId)); if (!entry || entry.leaseId !== id(leaseId)) return false;
    if (!confirmed) {entry.status = 'cancel_requested'; transition(entry, 'remote_cancellation_unconfirmed'); return false;}
    external.delete(taskId); transition(entry, 'terminal_confirmed'); refresh(); notify(); return true;
  }
  function claimExternal(raw) {
    if (closed) throw failure('capacity_closed', 503); refresh({pump: false});
    const value = lease(raw), queued = remoteQueue.get(value.taskId);
    if (!queued || queued.workspaceId !== value.workspaceId || value.leaseExpiresAt <= now() || value.leaseExpiresAt > queued.deadlineAt) throw failure('invalid_external_claim', 409);
    ready.set(value.taskId, Math.min(queued.deadlineAt, now() + 40000));
    if (activeCount() >= maxActive) return false;
    const selected = handoff ? remoteQueue.get(handoff.taskId) : select();
    if (selected?.taskId !== value.taskId) {pump(); return false;}
    handoff = null; ready.delete(value.taskId); remoteQueue.delete(value.taskId); external.set(value.taskId, {...value, sourceObserved: false}); lastWorkspace = value.workspaceId; transition(value, 'leased'); return true;
  }
  function bindLeaseSource(fn) {
    if (closed || source || typeof fn !== 'function') throw failure('invalid_lease_source', 503); source = fn;
    try {refresh();} catch (error) {source = null; throw error;}
    return () => {if (source === fn) {source = null; sourceFailed = false;}};
  }
  async function withTaskScope(spec, fn) {
    if (closed) throw failure('capacity_closed', 503);
    if (!spec || typeof fn !== 'function') throw failure('invalid_task_scope', 400);
    const workspaceId = id(spec.workspaceId), taskId = id(spec.taskId), parent = scopes.getStore();
    if (parent && parent.workspaceId !== workspaceId) throw failure('workspace_context_mismatch', 403);
    if (spec.approvalRequired === true) throw failure('approval_required', 403);
    const depth = parent ? parent.depth + 1 : 0;
    const maxDepth = parent?.root.maxDepth ?? spec.maxDepth ?? 3;
    if (!Number.isSafeInteger(maxDepth) || maxDepth < 0 || maxDepth > 5 || depth > maxDepth) throw failure('delegation_depth');
    const deadlineAt = Math.min(spec.deadlineAt ?? now() + 300000, parent?.deadlineAt ?? Infinity);
    if (!Number.isSafeInteger(deadlineAt) || deadlineAt <= now() || deadlineAt > now() + 1800000) throw failure('invalid_task_scope', 400);
    let root = parent?.root;
    if (!root) {
      const createdBy = id(spec.createdBy), maxSteps = spec.maxSteps ?? 20, maxCost = spec.maxCost;
      if (!Number.isSafeInteger(maxSteps) || maxSteps < 1 || maxSteps > 100 || maxCost !== undefined && (!Number.isFinite(maxCost) || maxCost < 0)) throw failure('invalid_task_scope', 400);
      expire(); if (roots.size >= maxQueued || roots.has(taskId)) throw failure('task_scope_capacity', 429);
      root = {workspaceId, taskId, createdBy, maxSteps, maxDepth, maxCost, steps: 0, spentCost: 0, reservedCost: 0, deadlineAt, controller: new AbortController()}; roots.set(taskId, root);
    } else if (spec.createdBy !== undefined && spec.createdBy !== root.createdBy) throw failure('task_owner_mismatch', 403);
    const scope = Object.freeze({workspaceId, taskId, depth, deadlineAt, root});
    return scopes.run(scope, () => fn(Object.freeze({workspaceId, taskId, rootTaskId: root.taskId, createdBy: root.createdBy, depth, signal: root.controller.signal})));
  }
  function status(workspaceId) {
    id(workspaceId); refresh(); const remote = [...external.values()].filter(entry => entry.workspaceId === workspaceId);
    return Object.freeze({workspaceId, active: remote.length + [...local.values()].filter(entry => entry.workspaceId === workspaceId && entry.state === 'running').length, queued: waiting(workspaceId), remoteCancellationUnconfirmed: remote.filter(entry => entry.status === 'cancel_requested').length, maxActive, maxQueued, maxQueuedPerWorkspace});
  }
  function close() {
    if (closed) return; closed = true; clearInterval(timer); source = null; listeners.clear(); ready.clear(); remoteQueue.clear(); handoff = null;
    for (const root of roots.values()) root.controller.abort(failure('capacity_closed', 503)); roots.clear();
    for (const entry of [...local.values()]) cancelEntry(entry, failure('capacity_closed', 503));
  }
  const timer = setInterval(() => {try {refresh();} catch {}}, 250); timer.unref();
  async function drain({timeoutMs = 8000} = {}) {
    if (!closed || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw failure('capacity_drain_requires_closed', 503);
    const deadline = Date.now() + timeoutMs;
    while ([...local.values()].some(entry => entry.state === 'running')) {
      if (Date.now() >= deadline) throw failure('capacity_shutdown_incomplete', 503);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  return Object.freeze({submit, cancel, status, refresh, close, drain, restoreExternalLeases, bindLeaseSource, releaseExternal, claimExternal, assertCanQueue, withTaskScope,
    currentTask() {const scope=scopes.getStore();return scope?Object.freeze({workspaceId:scope.workspaceId,taskId:scope.taskId,rootTaskId:scope.root.taskId,createdBy:scope.root.createdBy,depth:scope.depth,deadlineAt:scope.deadlineAt,signal:scope.root.controller.signal}):null;},
    onAvailable(fn) {if (closed || typeof fn !== 'function' || listeners.size >= 8) throw failure('invalid_capacity_listener', 503); listeners.add(fn); return () => listeners.delete(fn);}});
}
module.exports = {createCapacityCoordinator};
