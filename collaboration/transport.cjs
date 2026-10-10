'use strict';
const {IdentityError, authorize} = require('../identity/policy.cjs');
const {readSessionCookie} = require('../identity/sessions.cjs');
const {runWithWorkspace, requireWorkspaceContext} = require('./context.cjs');
const websocketActions = Object.freeze({join: 'message.read', set_username: 'message.read', message: 'message.send', reply_in_thread: 'message.send', spawn_agent: 'agent.manage', update_agent: 'agent.manage', get_models: 'model.read', add_reaction: 'message.send', open_thread: 'message.read', close_thread: 'message.read'});
const slashActions = Object.freeze({
  help: 'message.read', list: 'agent.read', thread: 'message.read', pin: 'message.send', graph: 'agent.read',
  tools: 'agent.read', memory: 'memory.read', public_memory: null,
  ground: 'task.execute', research: 'task.execute', siphon: 'task.execute', abstract: 'task.execute',
  plan: 'task.execute', ralph: 'task.execute', reconcile: 'task.execute', convergence: 'task.execute',
  jspace: 'task.execute', jspace_agent: 'task.execute', spawn: 'agent.manage', moderate: 'agent.manage',
  stop: 'task.cancel', approve: 'task.approve',
  bash: null, stack: null, repo: null, lint: null, eval: null, skill: null, tree: null, cicd: null,
  pull: null, errorlog: null, toggle_public_memory: null
});
const httpRules = Object.freeze([
  ['GET', /^\/api\/nodes$/, 'node.read'], ['POST', /^\/api\/nodes$/, 'node.manage'],
  ['POST', /^\/api\/nodes\/[^/]+\/pause$/, 'node.manage'], ['DELETE', /^\/api\/nodes\/[^/]+$/, 'node.manage'],
  ['GET', /^\/api\/tasks$/, 'task.read'], ['POST', /^\/api\/tasks$/, 'task.create'], ['POST', /^\/api\/tasks\/[^/]+\/cancel$/, 'task.execute'],
  ['GET', /^\/api\/tasks\/[^/]+\/evidence$/, 'task.read'], ['GET', /^\/api\/tasks\/[^/]+\/artifact$/, 'artifact.read'],
  ['POST', /^\/api\/tasks\/[^/]+\/acceptance$/, 'task.approve'],
  ['GET', /^\/api\/channels$/, 'workspace.read'], ['GET', /^\/api\/(models|llm-providers)$/, 'model.read'],
  ['GET', /^\/api\/research\/(sessions|session\/[^/]+)$/, 'task.read'],
  ['GET', /^\/api\/metrics$/, 'agent.read'], ['GET', /^\/api\/agent\/memory\/[^/]+$/, 'memory.read'],
  ['DELETE', /^\/api\/agent\/[^/]+$/, 'agent.manage'], ['POST', /^\/api\/jspace$/, 'task.execute'],
  ['GET', /^\/api\/jspace$/, null, 405],
  ['GET', /^\/api\/(tree|errorlog|public_memory)$/, null],
  ['POST', /^\/api\/(cron\/wipe|heartbeat|toggle_public_memory)$/, null]
]);
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(value);
const text = (value, maximum = 32768) => typeof value === 'string' && Buffer.byteLength(value) <= maximum;
function createWorkspaceTransport({identity, sessions, state, webOrigin, maxConnections = 128}) {
  const url = new URL(webOrigin);
  if (url.protocol !== 'https:' || url.origin !== webOrigin || typeof identity?.requireMembership !== 'function' || typeof sessions?.authenticate !== 'function' || typeof state?.get !== 'function' || !Number.isSafeInteger(maxConnections) || maxConnections < 1 || maxConnections > 128) throw new IdentityError('invalid_transport_config', 400);
  const connections = new Map(); const pending = new WeakMap(); let closed = false;
  const origin = req => {if (req.headers.origin !== webOrigin) throw new IdentityError('forbidden_origin', 403);};
  const ensureOpen = () => {if (closed) throw new IdentityError('transport_closed', 503);};
  function authenticated(token, workspaceId, touch) {
    ensureOpen();
    const principal = sessions.authenticate(token, {touch});
    const actor = identity.requireMembership(principal.userId, workspaceId);
    return {principal, actor};
  }
  function detach(ws) {
    connections.delete(ws);
    try {ws.close(1008, 'Access revoked');} catch {try {ws.terminate();} catch {}}
    const timer = setTimeout(() => {if (ws.readyState !== 3) {try {ws.terminate();} catch {}}}, 1000); timer.unref();
    ws.once?.('close', () => clearTimeout(timer));
  }
  function current(ws, touch = false) {
    const entry = connections.get(ws);
    if (!entry) throw new IdentityError('unauthorized', 401);
    try {
      const verified = authenticated(entry.token, entry.client.workspaceId, touch);
      if (verified.actor.version !== entry.version) throw new IdentityError('unauthorized', 401);
      return {...verified, entry};
    }
    catch (error) {detach(ws); throw error;}
  }
  function allowedChannel(actor, channelId) {
    if (!identifier(channelId)) throw new IdentityError('invalid_channel', 400);
    return runWithWorkspace(actor, () => {
      const channel = state.get().channels.get(channelId);
      if (!channel || (Array.isArray(channel.allowedUsers) && !channel.allowedUsers.includes(actor.userId))) throw new IdentityError('not_found', 404);
      return channel;
    });
  }
  function checkCommand(actor, content) {
    if (!text(content)) throw new IdentityError('invalid_message', 400);
    const trimmed = content.trim();
    if (!trimmed.startsWith('/')) {authorize(actor, 'task.execute'); return;}
    const command = trimmed.slice(1).split(/\s+/, 1)[0].toLowerCase();
    if (!Object.hasOwn(slashActions, command) || !slashActions[command]) throw new IdentityError('forbidden', 403);
    authorize(actor, slashActions[command]);
  }
  const transport = {
    httpContext(req, res, next) {
      try {
        ensureOpen();
        const token = readSessionCookie(req.headers.cookie);
        const principal = sessions.authenticate(token);
        const selector = req.params?.workspaceId || req.headers['x-workspace-id'];
        if (!identifier(selector) || (req.params?.workspaceId && req.headers['x-workspace-id'] && req.params.workspaceId !== req.headers['x-workspace-id'])) throw new IdentityError('workspace_selector_required', 400);
        const actor = identity.requireMembership(principal.userId, selector);
        const path = (req.originalUrl || req.url).split('?')[0];
        const rule = httpRules.find(entry => entry[0] === req.method && entry[1].test(path));
        if (!rule) {
          if (httpRules.some(entry => entry[1].test(path))) throw new IdentityError('method_not_allowed', 405);
          throw new IdentityError('not_found', 404);
        }
        if (!rule[2]) throw new IdentityError(rule[3] === 405 ? 'method_not_allowed' : 'forbidden', rule[3] || 403);
        if (req.headers.origin !== undefined || !['GET', 'HEAD'].includes(req.method)) origin(req);
        if (!['GET', 'HEAD'].includes(req.method)) sessions.validateCsrf(token, req.headers['x-csrf-token']);
        authorize(actor, rule[2]);
        Object.defineProperty(req, 'workspace', {value: actor, enumerable: false});
        Object.defineProperty(req, 'human', {value: Object.freeze({userId: principal.userId, sessionId: principal.sessionId}), enumerable: false});
        res.setHeader('Cache-Control', 'no-store');
        runWithWorkspace(actor, () => {state.get(); next();});
      } catch (error) {
        const known = error instanceof IdentityError;
        res.status(known ? error.statusCode : 503).json({error: known ? error.code : 'service_unavailable'});
      }
    },
    authorizeUpgrade(req) {
      ensureOpen(); origin(req);
      if (typeof req.url !== 'string' || req.url.length > 512) throw new IdentityError('not_found', 404);
      const match = req.url.match(/^\/ws\/workspaces\/([A-Za-z0-9_.-]{1,128})$/);
      if (!match) throw new IdentityError('not_found', 404);
      const token = readSessionCookie(req.headers.cookie);
      const {principal, actor} = authenticated(token, match[1], true);
      if (connections.size >= maxConnections || [...connections.values()].filter(entry => entry.client.sessionId === principal.sessionId).length >= 8) throw new IdentityError('connection_limit', 429);
      const verified = Object.freeze({userId: actor.userId, workspaceId: actor.workspaceId, sessionId: principal.sessionId, username: principal.user.login});
      pending.set(verified, {token});
      return verified;
    },
    attach(ws, verified) {
      ensureOpen(); const secret = verified && pending.get(verified);
      if (!secret) throw new IdentityError('unauthorized', 401);
      pending.delete(verified);
      if (typeof ws?.send !== 'function' || typeof ws?.close !== 'function' || connections.has(ws)) throw new IdentityError('invalid_socket', 400);
      const {principal, actor} = authenticated(secret.token, verified.workspaceId, false);
      if (principal.userId !== verified.userId || connections.size >= maxConnections || [...connections.values()].filter(entry => entry.client.sessionId === principal.sessionId).length >= 8) throw new IdentityError('connection_limit', 429);
      const client = {channelId: null, openThreadId: null};
      for (const key of ['userId', 'workspaceId', 'sessionId', 'username']) Object.defineProperty(client, key, {value: verified[key], enumerable: true});
      Object.seal(client);
      connections.set(ws, {token: secret.token, client, version: actor.version, window: Date.now(), frames: 0});
      ws.once('close', () => connections.delete(ws)); ws.on('error', () => detach(ws));
      return client;
    },
    actor(ws, {touch = false} = {}) {return current(ws, touch).actor;},
    authorizeMessage(ws, input) {
      const {actor, entry} = current(ws, true);
      let encoded; try {encoded = JSON.stringify(input);} catch {throw new IdentityError('invalid_message', 400);}
      if (!input || Array.isArray(input) || typeof input !== 'object' || !text(encoded, 65536)) throw new IdentityError('invalid_message', 400);
      const time = Date.now(); if (time >= entry.window + 60000) {entry.window = time; entry.frames = 0;}
      if (++entry.frames > 60) throw new IdentityError('rate_limited', 429);
      if (!Object.hasOwn(websocketActions, input.type)) throw new IdentityError('forbidden', 403);
      authorize(actor, websocketActions[input.type]);
      if (input.workspaceId !== undefined && input.workspaceId !== actor.workspaceId) throw new IdentityError('not_found', 404);
      const data = {...input, userId: actor.userId, username: entry.client.username}; delete data.role; delete data.token;
      const client = entry.client;
      if (data.type === 'join') {allowedChannel(actor, data.channelId); client.channelId = data.channelId; client.openThreadId = null;}
      if (['message', 'reply_in_thread', 'open_thread', 'add_reaction'].includes(data.type)) {
        const channel = allowedChannel(actor, client.channelId);
        if (data.storeId !== undefined && data.storeId !== client.channelId) throw new IdentityError('not_found', 404);
        const referenced = data.type === 'open_thread' ? data.threadId : data.type === 'reply_in_thread' ? data.parentId : data.type === 'add_reaction' ? data.messageId : null;
        if (referenced !== null && (!identifier(referenced) || !channel.messages.some(message => message.id === referenced))) throw new IdentityError('not_found', 404);
        if (data.type === 'message' || data.type === 'reply_in_thread') checkCommand(actor, data.content);
        if (data.type === 'open_thread') client.openThreadId = data.threadId;
        if (data.type === 'add_reaction' && !text(data.emoji, 64)) throw new IdentityError('invalid_message', 400);
      }
      if (data.type === 'close_thread') client.openThreadId = null;
      if (data.type === 'spawn_agent' || data.type === 'update_agent') {
        if (!text(data.name, 128) || !data.name || !text(data.model, 256) || !data.model || !Array.isArray(data.channels) || data.channels.length < 1 || data.channels.length > 20 || (data.systemPrompt !== undefined && !text(data.systemPrompt))) throw new IdentityError('invalid_message', 400);
        for (const channelId of data.channels) allowedChannel(actor, channelId);
        if (data.type === 'update_agent') runWithWorkspace(actor, () => {if (!identifier(data.id) || !state.get().agents.has(data.id)) throw new IdentityError('not_found', 404);});
      }
      return Object.freeze({actor, client, message: Object.freeze(data)});
    },
    authorizeCommand(actor, content) {const fresh = identity.requireMembership(actor.userId, actor.workspaceId); checkCommand(fresh, content); return fresh;},
    scopedClients() {
      const actor = requireWorkspaceContext(); identity.requireMembership(actor.userId, actor.workspaceId);
      const scoped = new Map();
      for (const [ws, entry] of connections) {
        if (entry.client.workspaceId !== actor.workspaceId) continue;
        try {const {actor: subscriber} = current(ws); if (entry.client.channelId !== null) allowedChannel(subscriber, entry.client.channelId); scoped.set(ws, entry.client);} catch {detach(ws);}
      }
      return scoped;
    },
    broadcast({workspaceId, channelId = null, threadId = null, payload, excludeWs = null}) {
      ensureOpen(); if (!identifier(workspaceId)) throw new IdentityError('invalid_workspace', 400);
      const encoded = JSON.stringify(payload); if (!text(encoded, 65536)) throw new IdentityError('payload_limit', 413);
      for (const [ws, entry] of connections) {
        if (ws === excludeWs || ws.readyState !== 1 || entry.client.workspaceId !== workspaceId || (channelId !== null && entry.client.channelId !== channelId) || (threadId !== null && entry.client.openThreadId !== threadId)) continue;
        try {const {actor} = current(ws); if (channelId !== null) allowedChannel(actor, channelId); ws.send(encoded);} catch {detach(ws);}
      }
    },
    revoke({userId, sessionId, workspaceId}) {
      if (!userId && !sessionId && !workspaceId) throw new IdentityError('invalid_revocation', 400);
      for (const [ws, entry] of connections) if ((!userId || entry.client.userId === userId) && (!sessionId || entry.client.sessionId === sessionId) && (!workspaceId || entry.client.workspaceId === workspaceId)) detach(ws);
    },
    sweep() {ensureOpen(); for (const [ws] of connections) {try {current(ws);} catch {}}},
    close() {if (closed) return; closed = true; clearInterval(timer); for (const [ws] of connections) detach(ws); connections.clear();}
  };
  const timer = setInterval(() => {if (!closed) transport.sweep();}, 30000); timer.unref();
  return Object.freeze(transport);
}
module.exports = {createWorkspaceTransport, websocketActions, slashActions, httpRules};
