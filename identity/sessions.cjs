'use strict';
const {randomBytes, createHash, createHmac, timingSafeEqual} = require('node:crypto');
const {IdentityError} = require('./policy.cjs');
const {hashPassword, verifyPassword, isPasswordHash, validInput, dummyHash} = require('./passwords.cjs');
const {createAdmission} = require('./admission.cjs');
const idleMs = 30 * 60 * 1000, absoluteMs = 12 * 60 * 60 * 1000;
const validToken = token => typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);
const digest = value => createHash('sha256').update(value).digest('hex');
const csrf = token => createHmac('sha256', token).update('chunlack-csrf-v1').digest('base64url');

function readSessionCookie(header) {
  if (header === undefined || header === null) return null;
  if (typeof header !== 'string' || header.length > 8192) throw new IdentityError('unauthorized', 401);
  const pairs = header.split(';');
  if (pairs.length > 64) throw new IdentityError('unauthorized', 401);
  let token = null, found = false;
  for (const pair of pairs) {
    const index = pair.indexOf('=');
    if (index < 0 || pair.slice(0, index).trim() !== '__Host-chunlack_session') continue;
    if (found) throw new IdentityError('unauthorized', 401);
    found = true;
    token = pair.slice(index + 1).trim();
    if (!validToken(token)) throw new IdentityError('unauthorized', 401);
  }
  return token;
}

function createSessionService({store, now = Date.now, onRevoke = () => {}, admission = createAdmission({now})}) {
  if (!store || typeof onRevoke !== 'function' || typeof now !== 'function') throw new IdentityError('invalid_service', 500);
  let closed = false, failed = false;
  function ensureOpen() {
    if (closed) throw new IdentityError('service_closed', 503);
    if (failed) throw new IdentityError('revocation_failed', 503);
  }
  function clock() {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0) throw new IdentityError('invalid_clock', 500);
    return value;
  }
  function notify(event) {
    try {
      const result = onRevoke(Object.freeze(event));
      if (result && typeof result.then === 'function') {
        Promise.resolve(result).catch(() => {});
        throw new Error('Synchronous revocation required');
      }
    } catch {
      failed = true;
      throw new IdentityError('revocation_failed', 503);
    }
  }
  function notifySessions(rows, reason) {
    for (const row of rows) notify({type: 'session', ...row, reason});
  }
  function find(token) {
    if (!validToken(token)) throw new IdentityError('unauthorized', 401);
    const row = store.findSessionRecord(digest(token));
    if (!row || row.revoked_at !== null) throw new IdentityError('unauthorized', 401);
    return row;
  }
  const unsubscribe = store.onIdentityChange(event => {
    if (closed) return;
    if (event.type === 'account_disabled') notifySessions(store.revokeUserSessions(event.userId), 'account_disabled');
    else notify({...event, reason: 'membership_changed'});
  });
  const service = {
    async login({login, password, source}) {
      ensureOpen();
      if (!validInput(password) || typeof login !== 'string' || !login.trim() || login.length > 128) {
        throw new IdentityError('unauthorized', 401);
      }
      const release = admission.enter({source, login});
      try {
        const account = store.findUserForLogin(login);
        const encoded = account && isPasswordHash(account.passwordHash) ? account.passwordHash : dummyHash;
        const verified = await verifyPassword(password, encoded);
        ensureOpen();
        if (!account || account.disabled || !isPasswordHash(account.passwordHash) || !verified) {
          throw new IdentityError('unauthorized', 401);
        }
        const token = randomBytes(32).toString('base64url'), csrfToken = csrf(token);
        const record = store.createSessionRecord({userId: account.id, tokenHash: digest(token), csrfHash: digest(csrfToken),
          expectedPasswordHash: account.passwordHash, expiresAt: clock() + absoluteMs});
        notifySessions(record.revoked, 'session_limit');
        return {token, csrfToken, sessionId: record.sessionId, user: store.getUser(account.id)};
      } finally {release();}
    },
    authenticate(token) {
      ensureOpen();
      const row = find(token), time = clock();
      if (row.user_disabled_at !== null || row.expires_at <= time || row.last_seen_at + idleMs <= time || row.last_seen_at > time) {
        notifySessions(store.revokeSessionRecord(row.id), 'expired');
        throw new IdentityError('unauthorized', 401);
      }
      if (!store.touchSessionRecord(row.id)) throw new IdentityError('unauthorized', 401);
      return Object.freeze({sessionId: row.id, userId: row.user_id, user: store.getUser(row.user_id), csrfToken: csrf(token)});
    },
    validateCsrf(token, supplied) {
      const principal = service.authenticate(token);
      if (!validToken(supplied) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(principal.csrfToken))) {
        throw new IdentityError('forbidden');
      }
      return true;
    },
    logout(token) {
      ensureOpen();
      if (!validToken(token)) return;
      const row = store.findSessionRecord(digest(token));
      if (row) notifySessions(store.revokeSessionRecord(row.id), 'logout');
    },
    logoutAll(userId) {
      ensureOpen();
      notifySessions(store.revokeUserSessions(userId), 'logout_all');
    },
    issuePasswordReset(userId) {
      ensureOpen();
      const token = randomBytes(32).toString('base64url'), expiresAt = clock() + idleMs;
      store.issueResetRecord({userId, tokenHash: digest(token), expiresAt});
      return {token, expiresAt};
    },
    async resetPassword({token, password, source = 'local-maintenance'}) {
      ensureOpen();
      if (!validToken(token)) throw new IdentityError('unauthorized', 401);
      const tokenHash = digest(token), account = store.findResetRecord(tokenHash);
      if (!account) throw new IdentityError('unauthorized', 401);
      const release = admission.enter({source, login: account.login});
      try {
        const passwordHash = await hashPassword(password);
        ensureOpen();
        const result = store.consumePasswordReset({tokenHash, passwordHash});
        notifySessions(result.revoked, 'password_reset');
      } finally {release();}
    },
    async hashNewPassword({password, source, login}) {
      ensureOpen();
      const release = admission.enter({source, login});
      try {
        const encoded = await hashPassword(password);
        ensureOpen();
        return encoded;
      } finally {release();}
    },
    sweep() {
      ensureOpen();
      notifySessions(store.sweepAuthRecords(), 'expired');
    },
    close() {
      if (!closed) {closed = true; clearInterval(timer); unsubscribe();}
    }
  };
  const timer = setInterval(() => {
    if (closed || failed) return;
    try {service.sweep();} catch {failed = true;}
  }, 30000);
  timer.unref();
  return Object.freeze(service);
}
module.exports = {createSessionService, readSessionCookie};
