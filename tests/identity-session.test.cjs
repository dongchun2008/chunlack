'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Database = require('better-sqlite3');
const {workspaceFixture, throwsCode} = require('./helpers/workspace-fixture.cjs');
const password = 'Public-fixture-password-42';
let encodedFixture;
async function fixture(t, options = {}) {
  const {hashPassword} = require('../identity/passwords.cjs');
  encodedFixture ||= hashPassword(password);
  const r = workspaceFixture(t, {passwordHash: await encodedFixture});
  const events = [];
  const {createSessionService} = require('../identity/sessions.cjs');
  const service = createSessionService({store: r.store, now: r.now, onRevoke: event => events.push(event), ...options});
  t.after(() => service.close());
  return {...r, service, events, login: (login = 'alice') => service.login({login, password, source: 'local-test'})};
}

test('real scrypt hashes have independent salts and verify without trimming or truncating Unicode', async () => {
  const {hashPassword, verifyPassword} = require('../identity/passwords.cjs');
  const text = '  私有工作区-password-🥑\0  ';
  const first = await hashPassword(text), second = await hashPassword(text);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword(text, first), true);
  assert.equal(await verifyPassword(text.trim(), first), false);
  assert.equal(await verifyPassword('different', first), false);
});

test('password creation rejects short, oversized and invalid Unicode without silent truncation', async () => {
  const {hashPassword, verifyPassword} = require('../identity/passwords.cjs');
  for (const input of ['', 'short', 'x'.repeat(129), '\ud800' + 'x'.repeat(16), null]) {
    await assert.rejects(hashPassword(input), error => error.code === 'invalid_password');
  }
  assert.equal(await verifyPassword(password, 'scrypt$1$999999999$8$3$bad$bad'), false);
});

test('authentication admission reserves one hash slot and release is idempotent', () => {
  const {createAdmission} = require('../identity/admission.cjs');
  const admission = createAdmission({now: () => 1000});
  const release = admission.enter({source: 'first', login: 'alice'});
  throwsCode(() => admission.enter({source: 'second', login: 'bob'}), 'rate_limited');
  release(); release();
  admission.enter({source: 'second', login: 'bob'})();
});

test('source and login rate limits are independent and reset after their bounded window', () => {
  const {createAdmission} = require('../identity/admission.cjs');
  let time = 0;
  const admission = createAdmission({now: () => time});
  for (let i = 0; i < 5; i++) admission.enter({source: 'source-' + i, login: 'alice'})();
  throwsCode(() => admission.enter({source: 'other', login: 'ALICE'}), 'rate_limited');
  for (let i = 0; i < 5; i++) admission.enter({source: 'fixed', login: 'user-' + i})();
  throwsCode(() => admission.enter({source: 'fixed', login: 'another'}), 'rate_limited');
  time = 60000;
  admission.enter({source: 'fixed', login: 'alice'})();
});

test('global authentication limit rejects the thirty-first request across different identities', () => {
  const {createAdmission} = require('../identity/admission.cjs');
  const admission = createAdmission({now: () => 0});
  for (let i = 0; i < 30; i++) admission.enter({source: 'ip-' + i, login: 'user-' + i})();
  throwsCode(() => admission.enter({source: 'different', login: 'different'}), 'rate_limited');
});

test('source cache fails closed at capacity instead of evicting active limits or growing', () => {
  const {createAdmission} = require('../identity/admission.cjs');
  let time = 0;
  const admission = createAdmission({now: () => time, maxEntries: 2});
  admission.enter({source: 'a', login: 'alice'})();
  throwsCode(() => admission.enter({source: 'b', login: 'bob'}), 'rate_limited');
  time = 60000;
  admission.enter({source: 'b', login: 'bob'})();
  throwsCode(() => createAdmission({maxEntries: 2049}), 'invalid_limits');
});

test('login creates opaque credentials while SQLite stores only hashes', async t => {
  const r = await fixture(t);
  const login = await r.login();
  assert.match(login.token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(login.csrfToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(r.service.authenticate(login.token).user.id, r.users.alice.id);
  assert.equal(r.service.authenticate(login.token).csrfToken, login.csrfToken);
  assert.equal(r.service.validateCsrf(login.token, login.csrfToken), true);
  throwsCode(() => r.service.validateCsrf(login.token, 'b'.repeat(43)), 'forbidden');
  const db = new Database(r.dbPath, {readonly: true});
  try {
    const row = db.prepare('SELECT * FROM sessions').get();
    assert.notEqual(row.token_hash, login.token);
    assert.notEqual(row.csrf_hash, login.csrfToken);
    assert.match(row.token_hash, /^[a-f0-9]{64}$/);
  } finally {db.close();}
  const files = [r.dbPath, r.dbPath + '-wal'].filter(file => fs.existsSync(file));
  for (const file of files) for (const value of [password, login.token, login.csrfToken]) {
    assert.equal(fs.readFileSync(file).includes(Buffer.from(value)), false);
  }
});

test('unknown account, wrong password and malformed credentials have generic errors', async t => {
  const r = await fixture(t);
  for (const input of [{login: 'absent', password}, {login: 'alice', password: 'incorrect'}, {login: 'alice', password: 'x'.repeat(129)}]) {
    await assert.rejects(r.service.login({...input, source: 'local-test'}), error => error.code === 'unauthorized' && error.statusCode === 401);
  }
  throwsCode(() => r.service.authenticate(null), 'unauthorized');
  throwsCode(() => r.service.authenticate('missing'), 'unauthorized');
});

test('duplicate session cookies and ambiguous cookie values are rejected', async t => {
  const r = await fixture(t);
  const {readSessionCookie} = require('../identity/sessions.cjs');
  const login = await r.login();
  const cookie = '__Host-chunlack_session=' + login.token;
  assert.equal(readSessionCookie('other=value; ' + cookie), login.token);
  assert.equal(readSessionCookie(undefined), null);
  for (const value of [cookie + '; ' + cookie, '__Host-chunlack_session=%bad', ['one', 'two'], 'x'.repeat(8193)]) {
    throwsCode(() => readSessionCookie(value), 'unauthorized');
  }
});

test('idle session expires at exactly thirty minutes and notifies connection revocation', async t => {
  const r = await fixture(t);
  const login = await r.login();
  r.advance(30 * 60 * 1000);
  throwsCode(() => r.service.authenticate(login.token), 'unauthorized');
  assert.ok(r.events.some(event => event.sessionId === login.sessionId && event.reason === 'expired'));
});

test('session absolute expiry cannot be extended by continuous authentication', async t => {
  const r = await fixture(t);
  const login = await r.login();
  for (let i = 0; i < 35; i++) {
    r.advance(20 * 60 * 1000);
    assert.equal(r.service.authenticate(login.token).user.id, r.users.alice.id);
  }
  r.advance(20 * 60 * 1000);
  throwsCode(() => r.service.authenticate(login.token), 'unauthorized');
});

test('logout and logout-all revoke persisted credentials without affecting other accounts', async t => {
  const r = await fixture(t);
  const a = await r.login(), another = await r.login(), b = await r.login('bob');
  r.service.logout(a.token);
  throwsCode(() => r.service.authenticate(a.token), 'unauthorized');
  assert.equal(r.service.authenticate(another.token).user.id, r.users.alice.id);
  r.service.logoutAll(r.users.alice.id);
  throwsCode(() => r.service.authenticate(another.token), 'unauthorized');
  assert.equal(r.service.authenticate(b.token).user.id, r.users.bob.id);
  assert.ok(r.events.some(e => e.sessionId === a.sessionId));
  assert.ok(r.events.some(e => e.sessionId === another.sessionId));
});

test('membership removal closes workspace connections but preserves a session for other memberships', async t => {
  const r = await fixture(t);
  const login = await r.login('bob');
  r.store.removeMembership(r.actor('alice', 'a'), {workspaceId: r.workspaces.a.id, userId: r.users.bob.id});
  assert.equal(r.service.authenticate(login.token).user.id, r.users.bob.id);
  assert.equal(r.actor('bob', 'b').role, 'owner');
  assert.ok(r.events.some(e => e.type === 'membership' && e.workspaceId === r.workspaces.a.id && e.userId === r.users.bob.id));
});

test('account disable revokes active sessions and notifies existing connections', async t => {
  const r = await fixture(t);
  const login = await r.login('carol');
  r.store.disableUser(r.users.carol.id);
  throwsCode(() => r.service.authenticate(login.token), 'unauthorized');
  assert.ok(r.events.some(e => e.userId === r.users.carol.id && e.sessionId === login.sessionId));
});

test('account disable while password verification is running cannot produce a new valid session', async t => {
  const r = await fixture(t);
  const pending = r.login('carol');
  r.store.disableUser(r.users.carol.id);
  await assert.rejects(pending, error => error.code === 'unauthorized');
});

test('sessions persist across service restart without retaining plaintext in the store', async t => {
  const r = await fixture(t);
  const login = await r.login();
  r.service.close();
  const {createSessionService} = require('../identity/sessions.cjs');
  const other = createSessionService({store: r.open(), now: r.now});
  t.after(() => other.close());
  assert.equal(other.authenticate(login.token).user.id, r.users.alice.id);
  assert.equal(other.authenticate(login.token).csrfToken, login.csrfToken);
});

test('password reset is single-use, changes the password and invalidates all old sessions', async t => {
  const r = await fixture(t);
  const login = await r.login();
  const reset = r.service.issuePasswordReset(r.users.alice.id);
  const newPassword = 'New-public-fixture-password-43';
  await r.service.resetPassword({token: reset.token, password: newPassword, source: 'local-test'});
  throwsCode(() => r.service.authenticate(login.token), 'unauthorized');
  await assert.rejects(r.login(), error => error.code === 'unauthorized');
  const next = await r.service.login({login: 'alice', password: newPassword, source: 'local-test'});
  assert.equal(r.service.authenticate(next.token).user.id, r.users.alice.id);
  await assert.rejects(r.service.resetPassword({token: reset.token, password: newPassword, source: 'local-test'}), error => error.code === 'unauthorized');
  assert.ok(r.events.some(e => e.sessionId === login.sessionId && e.reason === 'password_reset'));
});

test('new reset tokens invalidate earlier ones and expire after thirty minutes', async t => {
  const r = await fixture(t);
  const first = r.service.issuePasswordReset(r.users.alice.id);
  const next = r.service.issuePasswordReset(r.users.alice.id);
  await assert.rejects(r.service.resetPassword({token: first.token, password, source: 'local-test'}), error => error.code === 'unauthorized');
  r.advance(30 * 60 * 1000);
  await assert.rejects(r.service.resetPassword({token: next.token, password, source: 'local-test'}), error => error.code === 'unauthorized');
});

test('sweep expires inactive sessions and reclaims old records with bounded batches', async t => {
  const r = await fixture(t);
  const login = await r.login();
  r.advance(30 * 60 * 1000);
  r.service.sweep();
  throwsCode(() => r.service.authenticate(login.token), 'unauthorized');
  assert.ok(r.events.some(e => e.sessionId === login.sessionId));
  r.advance(7 * 24 * 60 * 60 * 1000 + 1);
  r.service.sweep();
  const db = new Database(r.dbPath, {readonly: true});
  try {assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);} finally {db.close();}
});

test('the eleventh active session signs out the oldest while preserving the other ten', async t => {
  const r = await fixture(t);
  let first, last;
  for (let i = 0; i < 11; i++) {
    last = await r.login();
    first ||= last;
    r.advance(61000);
  }
  throwsCode(() => r.service.authenticate(first.token), 'unauthorized');
  assert.equal(r.service.authenticate(last.token).user.id, r.users.alice.id);
  const db = new Database(r.dbPath, {readonly: true});
  try {assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE revoked_at IS NULL').get().n, 10);} finally {db.close();}
});

test('simultaneous password operations reject excess work and release the slot after failure', async t => {
  const r = await fixture(t);
  const pending = r.login();
  await assert.rejects(r.login('bob'), error => error.code === 'rate_limited' && error.statusCode === 429 && error.retryable);
  await assert.rejects(r.service.hashNewPassword({password, login: 'new-user', source: 'other'}), error => error.code === 'rate_limited');
  await pending;
  await assert.rejects(r.service.login({login: 'carol', password: 'wrong', source: 'local-test'}), error => error.code === 'unauthorized');
  assert.equal((await r.login('carol')).user.id, r.users.carol.id);
});

test('service close is idempotent and blocks further authentication', async t => {
  const r = await fixture(t);
  const login = await r.login();
  r.service.close(); r.service.close();
  throwsCode(() => r.service.authenticate(login.token), 'service_closed');
  await assert.rejects(r.login(), error => error.code === 'service_closed');
});
