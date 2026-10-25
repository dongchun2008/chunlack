'use strict';
const {randomUUID} = require('node:crypto');
const {requireWorkspaceContext} = require('./context.cjs');
function createWorkspaceModelTransport({capacity, authorize, transport, now = Date.now}) {
  if (!capacity?.submit || typeof authorize !== 'function' || typeof transport?.get !== 'function' && typeof transport?.post !== 'function') throw new Error('invalid_workspace_model_transport');
  async function request({providerId, modelId = null, kind, method, url, data, options = {}, estimatedCost = 0}) {
    const actor = requireWorkspaceContext();
    if (!['get', 'post'].includes(method) || typeof transport[method] !== 'function' || !['model.generate', 'model.embed', 'model.discover'].includes(kind) || typeof providerId !== 'string') throw new Error('invalid_model_transport_request');
    const requestedTimeout = options.timeout ?? 30000;
    if (!Number.isSafeInteger(requestedTimeout) || requestedTimeout < 100 || requestedTimeout > 300000) throw new Error('invalid_model_transport_timeout');
    authorize(providerId, modelId);
    const task = capacity.currentTask(), createdAt = now();
    let policy = task?.modelPolicy, timer, rejectStopped, unsubscribe = () => {};
    const stopped = task ? new Promise((_resolve, reject) => {rejectStopped = reject;}) : null;
    const onAbort = () => {if (policy) rejectStopped(task.signal.reason);};
    function applyPolicy(next) {
      policy = next;
      if (timer) {clearTimeout(timer); timer = null;}
      if (!policy) return;
      if (task.signal.aborted) {onAbort(); return;}
      const deadlineAt = Math.min(task.deadlineAt, createdAt + requestedTimeout, createdAt + policy.requestTimeoutMs);
      const remaining = deadlineAt - now();
      const stop = () => rejectStopped(capacity.stopCurrentTask(now() >= task.deadlineAt ? 'task_deadline' : 'task_model_timeout'));
      if (remaining <= 0) stop();
      else {timer = setTimeout(stop, remaining); timer.unref();}
    }
    try {
      if (task) {
        task.signal.addEventListener('abort', onAbort, {once: true});
        unsubscribe = capacity.onModelPolicyChange(applyPolicy);
        applyPolicy(policy);
      }
      const admissionTimeout = policy ? Math.min(requestedTimeout, policy.requestTimeoutMs, task.deadlineAt - now()) : requestedTimeout;
      if (admissionTimeout <= 0) throw capacity.stopCurrentTask('task_deadline');
      const operation = capacity.submit({workspaceId: actor.workspaceId, taskId: randomUUID(), deadlineAt: now() + admissionTimeout + (policy ? 0 : 30000), kind, signal: options.signal, estimatedCost,
        run: async ({signal}) => {
          authorize(providerId, modelId);
          applyPolicy(capacity.currentTask()?.modelPolicy);
          if (kind !== 'model.discover') capacity.beginModelRequest();
          signal.throwIfAborted();
          const timeout = policy ? Math.min(requestedTimeout, policy.requestTimeoutMs, task.deadlineAt - now()) : requestedTimeout;
          if (timeout <= 0) throw capacity.stopCurrentTask('task_deadline');
          const signals = [signal, options.signal].filter(Boolean), settings = {...options, timeout, signal: AbortSignal.any(signals), maxRedirects: 0};
          const response = method === 'get' ? await transport.get(url, settings) : await transport.post(url, data, settings);
          authorize(providerId, modelId);
          return response;
        }});
      return await (stopped ? Promise.race([operation, stopped]) : operation);
    } catch (error) {
      if (policy && policy.allowRetry === false && policy.allowFallback === false && !task.signal.aborted) capacity.stopCurrentTask(error?.code === 'task_deadline' ? 'task_deadline' : 'task_model_failed');
      throw task?.signal.aborted ? task.signal.reason : error;
    } finally {
      if (timer) clearTimeout(timer);
      unsubscribe();
      task?.signal.removeEventListener('abort', onAbort);
    }
  }
  return Object.freeze({request});
}
module.exports = {createWorkspaceModelTransport};
