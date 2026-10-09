'use strict';
const express = require('express');
const {randomBytes, createHash} = require('node:crypto');
const {IdentityError, authorize} = require('./policy.cjs');
const {readSessionCookie} = require('./sessions.cjs');
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const digest = value => createHash('sha256').update(value).digest('hex');
const cookieName = '__Host-chunlack_session';
const cookieOptions = Object.freeze({secure: true, httpOnly: true, sameSite: 'lax', path: '/'});

function createIdentityRouter({store, sessions, webOrigin}) {
  const url = new URL(webOrigin);
  if (url.protocol !== 'https:' || url.origin !== webOrigin || url.username || url.password || typeof store?.requireMembership !== 'function' || typeof sessions?.authenticate !== 'function') throw new IdentityError('invalid_config', 400);
  const router = express.Router();
  const wrap = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next);
  const origin = req => {if (req.headers.origin !== webOrigin) throw new IdentityError('forbidden_origin', 403);};
  const json = express.json({limit: '16kb', strict: true, type: 'application/json'});
  const mutation = (req, res, next) => {
    try {
      origin(req);
      if (!req.is('application/json')) throw new IdentityError('json_required', 415);
      next();
    } catch (error) {next(error);}
  };
  const body = req => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw new IdentityError('invalid_request', 400);
    return req.body;
  };
  const source = req => req.socket.remoteAddress || 'unknown-local-source';
  const principal = req => sessions.authenticate(readSessionCookie(req.headers.cookie));
  const authenticatedMutation = req => {
    const token = readSessionCookie(req.headers.cookie);
    const authenticated = sessions.authenticate(token);
    sessions.validateCsrf(token, req.headers['x-csrf-token']);
    return authenticated;
  };
  const workspaceActor = (req, authenticated, action) => {
    const actor = store.requireMembership(authenticated.userId, req.params.workspaceId);
    authorize(actor, action);
    return actor;
  };
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (req.path.startsWith('/auth/') && req.url.includes('?')) return res.status(404).json({error: 'not_found'});
    next();
  });
  router.post('/auth/login', mutation, json, wrap(async (req, res) => {
    const input = body(req);
    if (typeof input.login !== 'string' || input.login.length > 256 || typeof input.password !== 'string' || input.password.length > 256) throw new IdentityError('invalid_request', 400);
    const authenticated = await sessions.login({login: input.login, password: input.password, source: source(req)});
    res.cookie(cookieName, authenticated.token, {...cookieOptions, maxAge: 12 * 60 * 60 * 1000});
    res.json({user: authenticated.user, csrfToken: authenticated.csrfToken});
  }));
  router.get('/auth/me', wrap((req, res) => {
    const authenticated = principal(req);
    res.json({user: authenticated.user, csrfToken: authenticated.csrfToken});
  }));
  router.post('/auth/logout', mutation, json, wrap((req, res) => {
    body(req); authenticatedMutation(req);
    sessions.logout(readSessionCookie(req.headers.cookie));
    res.clearCookie(cookieName, cookieOptions).json({ok: true});
  }));
  router.post('/auth/logout-all', mutation, json, wrap((req, res) => {
    body(req); const authenticated = authenticatedMutation(req);
    sessions.logoutAll(authenticated.userId);
    res.clearCookie(cookieName, cookieOptions).json({ok: true});
  }));
  router.get('/api/workspaces', wrap((req, res) => {
    const authenticated = principal(req);
    res.json({workspaces: store.listWorkspaces(authenticated.userId)});
  }));
  router.get('/api/workspaces/:workspaceId/members', wrap((req, res) => {
    const authenticated = principal(req);
    const actor = workspaceActor(req, authenticated, 'member.read');
    res.json({members: store.listMembers(actor, {workspaceId: actor.workspaceId})});
  }));
  router.patch('/api/workspaces/:workspaceId/members/:userId', mutation, json, wrap((req, res) => {
    const input = body(req); const authenticated = authenticatedMutation(req);
    const actor = workspaceActor(req, authenticated, 'member.manage');
    const membership = store.setMembership(actor, {workspaceId: actor.workspaceId, userId: req.params.userId, role: input.role});
    res.json({membership});
  }));
  router.delete('/api/workspaces/:workspaceId/members/:userId', mutation, json, wrap((req, res) => {
    body(req); const authenticated = authenticatedMutation(req);
    const actor = workspaceActor(req, authenticated, 'member.manage');
    store.removeMembership(actor, {workspaceId: actor.workspaceId, userId: req.params.userId});
    res.json({ok: true});
  }));
  router.post('/api/workspaces/:workspaceId/invites', mutation, json, wrap((req, res) => {
    const input = body(req); const authenticated = authenticatedMutation(req);
    const actor = workspaceActor(req, authenticated, 'invite.create');
    const token = randomBytes(32).toString('base64url');
    const record = store.createInviteRecord(actor, {workspaceId: actor.workspaceId, login: input.login, role: input.role, tokenHash: digest(token)});
    res.status(201).json({token, expiresAt: record.expiresAt});
  }));
  router.post('/auth/invites/accept', mutation, json, wrap(async (req, res) => {
    const input = body(req);
    if (typeof input.token !== 'string' || !tokenPattern.test(input.token)) throw new IdentityError('not_found', 404);
    const tokenHash = digest(input.token);
    const invite = store.findInviteRecord(tokenHash);
    if (!invite) throw new IdentityError('not_found', 404);
    const existing = store.findUserForLogin(invite.login);
    let result;
    if (existing) {
      const authenticated = authenticatedMutation(req);
      result = store.acceptInvite({tokenHash, userId: authenticated.userId});
    } else {
      if (readSessionCookie(req.headers.cookie)) {
        principal(req);
        throw new IdentityError('invite_account_mismatch', 403);
      }
      const passwordHash = await sessions.hashNewPassword({password: input.password, source: source(req), login: invite.login});
      result = store.acceptInvite({tokenHash, passwordHash});
    }
    res.status(result.created ? 201 : 200).json({user: result.user, membership: result.membership});
  }));
  router.post('/auth/password/reset', mutation, json, wrap(async (req, res) => {
    const input = body(req);
    try {
      await sessions.resetPassword({token: input.token, password: input.password, source: source(req)});
    } catch (error) {
      if (error instanceof IdentityError && error.code === 'unauthorized') throw new IdentityError('not_found', 404);
      throw error;
    }
    res.clearCookie(cookieName, cookieOptions).json({ok: true});
  }));
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error instanceof IdentityError ? error.statusCode : error.type === 'entity.too.large' ? 413 : error.type === 'entity.parse.failed' ? 400 : 503;
    const code = error instanceof IdentityError ? error.code : status === 413 ? 'request_too_large' : status === 400 ? 'invalid_request' : 'service_unavailable';
    if (status === 429) res.setHeader('Retry-After', String(error.retryAfter || 60));
    res.status(status).json({error: code});
  });
  return router;
}
module.exports = {createIdentityRouter};
