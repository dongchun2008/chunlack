'use strict';
const {randomUUID} = require('node:crypto');
const {requireWorkspaceContext} = require('./context.cjs');
function createWorkspaceModelTransport({capacity, authorize, transport, now = Date.now}) {
  if (!capacity?.submit || typeof authorize !== 'function' || typeof transport?.get !== 'function' && typeof transport?.post !== 'function') throw new Error('invalid_workspace_model_transport');
  async function request({providerId, modelId = null, kind, method, url, data, options = {}, estimatedCost = 0}) {
    const actor = requireWorkspaceContext();
    if (!['get', 'post'].includes(method) || typeof transport[method] !== 'function' || !['model.generate', 'model.embed', 'model.discover'].includes(kind) || typeof providerId !== 'string') throw new Error('invalid_model_transport_request');
    const timeout = options.timeout ?? 30000;
    if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > 300000) throw new Error('invalid_model_transport_timeout');
    authorize(providerId, modelId);
    return capacity.submit({workspaceId: actor.workspaceId, taskId: randomUUID(), deadlineAt: now() + timeout + 30000, kind, signal: options.signal, estimatedCost,
      run: async ({signal}) => {
        authorize(providerId, modelId);
        const signals = [signal, options.signal].filter(Boolean), settings = {...options, timeout, signal: AbortSignal.any(signals), maxRedirects: 0};
        const response = method === 'get' ? await transport.get(url, settings) : await transport.post(url, data, settings);
        authorize(providerId, modelId);
        return response;
      }});
  }
  return Object.freeze({request});
}
module.exports = {createWorkspaceModelTransport};
