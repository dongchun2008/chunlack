'use strict';
const path = require('node:path');
const {createPilotEvents} = require('./events.cjs');
const {createWebhookTransport} = require('./webhook-transport.cjs');

function failure(code) {return Object.assign(new Error(code), {code});}
function validatePublicEventsOptions(options, env, webhook = {}, authorize) {
  if (options?.enabled !== true) throw failure('events_runtime_disabled');
  const name = options.encryptionKeyEnv;
  if (typeof name !== 'string' || !/^[A-Z][A-Z0-9_]{1,100}$/.test(name) || typeof env?.[name] !== 'string' || !/^[a-fA-F0-9]{64}$/.test(env[name])) throw failure('events_encryption_key_required');
  const deliveryIntervalMs = options.deliveryIntervalMs ?? 1000;
  if (!Number.isInteger(deliveryIntervalMs) || deliveryIntervalMs < 500 || deliveryIntervalMs > 10000) throw failure('invalid_events_delivery_interval');
  // Test dependencies may replace DNS/HTTPS, never the configured host grants.
  const transport = createWebhookTransport({lookup: webhook.lookup, post: webhook.post, ca: webhook.ca,
    timeoutMs: options.callbackTimeoutMs ?? 10000, allowedHosts: options.allowedHosts,
    workspaceCallbackHosts: options.workspaceCallbackHosts, multiUser: true, authorize});
  return {encryptionKey: Buffer.from(env[name], 'hex'), transport, deliveryIntervalMs};
}
function createPublicEventsRuntime({gateway, dataRoot, options, env = process.env, webhook, now = Date.now, ready = () => true}) {
  if (!gateway?.store?.multiUser || !gateway.workspaceAccess || typeof dataRoot !== 'string' || !path.isAbsolute(dataRoot) || typeof ready !== 'function') throw failure('invalid_events_runtime');
  const {encryptionKey, transport, deliveryIntervalMs} = validatePublicEventsOptions(options, env, webhook,
    binding => gateway.workspaceAccess.authorizeStoredNode({nodeId: binding?.nodeId, workspaceId: binding?.workspaceId}, binding?.taskId));
  const {store, workspaceAccess} = gateway;
  let events;
  try {events = createPilotEvents({dbPath: path.join(dataRoot, 'db', 'mcp-events.db'), encryptionKey, transport, now, multiUser: true,
    authorize: (principal, taskId) => workspaceAccess.authorizeStoredNode(principal, taskId),
    authorizeCleanup: principal => workspaceAccess.authorizeStoredNode(principal, undefined, {cleanup: true})});}
  finally {encryptionKey.fill(0);}
  let closed = false, pumping, closing;
  async function pump() {
    if (closed || !ready()) return {delivered: 0};
    events.cleanup();
    for (const {taskId, ...principal} of events.pendingTargets()) {
      if (closed) return {delivered: 0};
      if (!workspaceAccess.authorizeStoredNode(principal, taskId)) continue;
      store.withWorkspace({workspaceId: principal.workspaceId}, () => {
        const node = store.getNode(principal.nodeId), task = store.authorizePilotTask(principal.nodeId, taskId);
        if (node.paused || task.status !== 'queued' || task.deadline_at <= now() || task.deadline_at > now() + 300000) return;
        events.publish(principal, {eventId: 'ready_' + task.id, taskId: task.id, taskType: task.task_type, deadlineAt: task.deadline_at});
      });
    }
    if (closed) return {delivered: 0};
    return events.deliverDue({limit: 1});
  }
  async function flush() {
    if (closed) throw failure('events_runtime_closed');
    if (!pumping) pumping = Promise.resolve().then(pump).finally(() => {pumping = undefined;});
    return pumping;
  }
  const onChange = () => {if (!closed) void flush().catch(() => {});};
  const subscribe = events.subscribe;
  events.subscribe = async (...args) => {const reply = await subscribe(...args); onChange(); return reply;};
  store.changes.on('change', onChange);
  const timer = setInterval(onChange, deliveryIntervalMs); timer.unref();
  function close() {
    if (closing) return closing;
    closed = true; clearInterval(timer); store.changes.off('change', onChange);
    events.close();
    closing = (async () => {await pumping;})();
    return closing;
  }
  return Object.freeze({events, flush, close, onChange});
}
module.exports = {createPublicEventsRuntime, validatePublicEventsOptions};
