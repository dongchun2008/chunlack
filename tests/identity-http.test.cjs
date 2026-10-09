'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {Readable, Writable} = require('node:stream');
const {createHash} = require('node:crypto');
const {workspaceFixture, throwsCode} = require('./helpers/workspace-fixture.cjs');
const {hashPassword, verifyPassword} = require('../identity/passwords.cjs');
const {createSessionService} = require('../identity/sessions.cjs');
const {createIdentityRouter} = require('../identity/http.cjs');
const {runAccounts} = require('../scripts/accounts.cjs');
const {createIdentityStore} = require('../identity/store.cjs');
const {Worker} = require('node:worker_threads');
const Database = require('better-sqlite3');
const webOrigin = 'https://lack.example.test';
const password = 'public-http-fixture-password';
const newPassword = 'public-http-new-user-password';
let hashPromise;
const digest = value => createHash('sha256').update(value).digest('hex');

async function httpFixture(t) {
  hashPromise ||= hashPassword(password);
  const f = workspaceFixture(t, {passwordHash: await hashPromise});
  const sessions = createSessionService({store: f.store, now: f.now});
  const app = express();
  app.use(createIdentityRouter({store: f.store, sessions, webOrigin}));
  const server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(async () => {sessions.close(); await new Promise(resolve => server.close(resolve));});
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(route, {method = 'GET', body, auth, origin = webOrigin, csrf = true, headers = {}} = {}) {
    const allHeaders = {...headers};
    if (origin !== null) allHeaders.Origin = origin;
    if (body !== undefined) allHeaders['Content-Type'] = 'application/json';
    if (auth) {
      allHeaders.Cookie = auth.cookie;
      if (csrf) allHeaders['X-CSRF-Token'] = auth.csrfToken;
    }
    const res = await fetch(base + route, {method, headers: allHeaders, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual'});
    const text = await res.text();
    let json;
    try {json = JSON.parse(text);} catch {}
    return {status: res.status, headers: res.headers, json, text};
  }
  async function login(loginName = 'alice', extra = {}) {
    const r = await request('/auth/login', {method: 'POST', body: {login: loginName, password}, ...extra});
    assert.equal(r.status, 200, r.text);
    return {...r.json, cookie: r.headers.get('set-cookie').split(';')[0], response: r};
  }
  async function invite(auth, workspaceId, loginName, role = 'member') {
    const r = await request(`/api/workspaces/${workspaceId}/invites`, {method: 'POST', auth, body: {login: loginName, role}});
    assert.equal(r.status, 201, r.text);
    return r.json.token;
  }
  return {...f, sessions, request, login, invite};
}

test('identity HTTP rejects unauthenticated workspace and member reads', async t => {
  const f = await httpFixture(t);
  for (const route of ['/auth/me', '/api/workspaces', `/api/workspaces/${f.workspaces.a.id}/members`]) {
    const r = await f.request(route);
    assert.equal(r.status, 401); assert.equal(r.json.error, 'unauthorized');
  }
});

test('login requires exact configured origin, JSON POST and bounded input', async t => {
  const f = await httpFixture(t);
  for (const origin of [null, 'null', 'https://evil.example', webOrigin + '/', webOrigin + '.evil']) {
    assert.equal((await f.request('/auth/login', {method: 'POST', origin, body: {login: 'alice', password}})).status, 403);
  }
  assert.equal((await f.request('/auth/login')).status, 404);
  assert.equal((await f.request('/auth/login', {method: 'POST'})).status, 415);
  assert.equal((await f.request('/auth/login', {method: 'POST', body: {login: 'a'.repeat(300), password}})).status, 400);
  assert.equal((await f.request('/auth/login', {method: 'POST', body: {login: 'alice', password: 'a'.repeat(17000)}})).status, 413);
  assert.throws(() => createIdentityRouter({store: f.store, sessions: f.sessions, webOrigin: 'http://lack.example.test'}));
});

test('login rotates a supplied session and exposes only a secure host cookie and CSRF value', async t => {
  const f = await httpFixture(t);
  const first = await f.login();
  const next = await f.login('alice', {auth: first, body: {login: 'alice', password, userId: f.users.bob.id, role: 'owner', token: first.cookie.split('=')[1]}});
  assert.notEqual(first.cookie, next.cookie);
  assert.equal(next.user.id, f.users.alice.id);
  assert.equal(next.token, undefined);
  const cookie = next.response.headers.get('set-cookie');
  for (const flag of ['__Host-chunlack_session=', 'Path=/', 'Secure', 'HttpOnly', 'SameSite=Lax']) assert.ok(cookie.includes(flag));
  assert.ok(!cookie.includes('Domain='));
  assert.ok(!next.response.text.includes(password));
  assert.ok(!next.response.text.includes(next.cookie.split('=')[1]));
  const me = await f.request('/auth/me', {auth: next});
  assert.equal(me.json.user.id, f.users.alice.id);
  assert.equal(me.json.csrfToken, next.csrfToken);
});

test('authenticated mutations require CSRF and exact origin before changing state', async t => {
  const f = await httpFixture(t); const alice = await f.login();
  const route = `/api/workspaces/${f.workspaces.a.id}/invites`;
  const body = {login: 'dave', role: 'member'};
  assert.equal((await f.request(route, {method: 'POST', auth: alice, csrf: false, body})).status, 403);
  assert.equal((await f.request(route, {method: 'POST', auth: alice, origin: 'https://evil.example', body})).status, 403);
  assert.equal((await f.request('/auth/logout', {method: 'POST', auth: alice, csrf: false, body: {}})).status, 403);
  assert.equal((await f.request('/auth/me', {auth: alice})).status, 200);
});

test('workspace membership uses server identity and hides unauthorized workspace existence', async t => {
  const f = await httpFixture(t); const alice = await f.login();
  const workspaces = await f.request('/api/workspaces', {auth: alice});
  assert.deepEqual(workspaces.json.workspaces.map(w => w.id), [f.workspaces.a.id]);
  const forbidden = await f.request(`/api/workspaces/${f.workspaces.b.id}/members`, {auth: alice, headers: {'X-User-ID': f.users.bob.id, 'X-Role': 'owner'}});
  const missing = await f.request('/api/workspaces/does-not-exist/members', {auth: alice});
  assert.equal(forbidden.status, 404); assert.deepEqual(forbidden.json, missing.json);
  const members = await f.request(`/api/workspaces/${f.workspaces.a.id}/members`, {auth: alice});
  assert.deepEqual(members.json.members.map(m => m.login).sort(), ['alice', 'bob']);
  assert.ok(!members.text.includes('passwordHash'));
});

test('member and viewer cannot create invitations or forge owner privilege', async t => {
  const f = await httpFixture(t); const bob = await f.login('bob'); const carol = await f.login('carol');
  for (const [auth, workspaceId] of [[bob, f.workspaces.a.id], [carol, f.workspaces.b.id]]) {
    const r = await f.request(`/api/workspaces/${workspaceId}/invites`, {method: 'POST', auth, body: {login: 'dave', role: 'owner', userId: f.users.alice.id}});
    assert.equal(r.status, 403);
  }
});

test('new user signup requires a legal bound invite and cannot inject another workspace or role', async t => {
  const f = await httpFixture(t); const alice = await f.login();
  assert.equal((await f.request('/auth/register', {method: 'POST', body: {login: 'dave', password: newPassword}})).status, 404);
  assert.equal((await f.request('/auth/invites/accept', {method: 'POST', body: {token: 'x'.repeat(43), password: newPassword}})).status, 404);
  assert.equal(f.store.findUserForLogin('dave'), null);
  const token = await f.invite(alice, f.workspaces.a.id, 'dave');
  const r = await f.request('/auth/invites/accept', {method: 'POST', body: {token, password: newPassword, login: 'bob', workspaceId: f.workspaces.b.id, role: 'owner'}});
  assert.equal(r.status, 201, r.text);
  const dave = f.store.findUserForLogin('dave');
  assert.equal(await verifyPassword(newPassword, dave.passwordHash), true);
  assert.equal(f.store.requireMembership(dave.id, f.workspaces.a.id).role, 'member');
  assert.equal(f.store.listWorkspaces(dave.id).length, 1);
  assert.equal(r.headers.get('set-cookie'), null);
  assert.equal((await f.request('/auth/invites/accept', {method: 'POST', body: {token, password: newPassword}})).status, 404);
  assert.ok(!r.text.includes(token));
});

test('existing account invite requires matching authenticated account and CSRF and never resets its password', async t => {
  const f = await httpFixture(t); const alice = await f.login();
  const token = await f.invite(alice, f.workspaces.a.id, 'carol', 'viewer');
  const body = {token, password: newPassword};
  assert.equal((await f.request('/auth/invites/accept', {method: 'POST', body})).status, 401);
  assert.equal((await f.request('/auth/invites/accept', {method: 'POST', auth: alice, body})).status, 403);
  const carol = await f.login('carol');
  assert.equal((await f.request('/auth/invites/accept', {method: 'POST', auth: carol, csrf: false, body})).status, 403);
  assert.equal((await f.request('/auth/invites/accept', {method: 'POST', auth: carol, body})).status, 200);
  assert.equal(f.store.requireMembership(f.users.carol.id, f.workspaces.a.id).role, 'viewer');
  assert.equal(await verifyPassword(password, f.store.findUserForLogin('carol').passwordHash), true);
});

test('invites expire at twenty-four hours and stale owners cannot grant access', async t => {
  const f = await httpFixture(t); const alice = await f.login();
  const expired = await f.invite(alice, f.workspaces.a.id, 'dave');
  f.advance(24 * 60 * 60 * 1000);
  assert.equal((await f.request('/auth/invites/accept', {method: 'POST', body: {token: expired, password: newPassword}})).status, 404);
  const freshAlice = await f.login();
  const revoked = await f.invite(freshAlice, f.workspaces.a.id, 'eric');
  f.store.setMembership(f.actor('alice', 'a'), {workspaceId: f.workspaces.a.id, userId: f.users.bob.id, role: 'owner'});
  f.store.setMembership(f.actor('alice', 'a'), {workspaceId: f.workspaces.a.id, userId: f.users.alice.id, role: 'member'});
  assert.equal((await f.request('/auth/invites/accept', {method: 'POST', body: {token: revoked, password: newPassword}})).status, 404);
  assert.equal(f.store.findUserForLogin('eric'), null);
});

test('invite acceptance transaction creates no orphan user and duplicate acceptance cannot succeed twice', async t => {
  const f = await httpFixture(t); const alice = await f.login();
  const token = await f.invite(alice, f.workspaces.a.id, 'dave');
  const args = {tokenHash: digest(token), passwordHash: await hashPromise};
  const other = f.open();
  const results = await Promise.all([Promise.resolve().then(() => f.store.acceptInvite(args)), Promise.resolve().then(() => other.acceptInvite(args)).catch(error => error)]);
  assert.equal(results.filter(r => !(r instanceof Error)).length, 1);
  assert.equal(results.find(r => r instanceof Error).code, 'not_found');
  const badToken = await f.invite(alice, f.workspaces.a.id, 'eric');
  throwsCode(() => f.store.acceptInvite({tokenHash: digest(badToken), passwordHash: 'bad'}), 'invalid_password_hash');
  assert.equal(f.store.findUserForLogin('eric'), null);
  assert.ok(f.store.findInviteRecord(digest(badToken)));
});

test('owner membership changes revalidate privilege and protect the final owner', async t => {
  const f = await httpFixture(t); const alice = await f.login(); const bob = await f.login('bob');
  const route = `/api/workspaces/${f.workspaces.a.id}/members/`;
  assert.equal((await f.request(route + f.users.alice.id, {method: 'PATCH', auth: bob, body: {role: 'viewer', actorId: f.users.alice.id}})).status, 403);
  assert.equal((await f.request(route + f.users.alice.id, {method: 'DELETE', auth: alice, body: {}})).status, 409);
  assert.equal((await f.request(route + f.users.bob.id, {method: 'PATCH', auth: alice, body: {role: 'owner'}})).status, 200);
  assert.equal((await f.request(route + f.users.alice.id, {method: 'PATCH', auth: bob, body: {role: 'member'}})).status, 200);
  assert.equal((await f.request(route + f.users.bob.id, {method: 'DELETE', auth: alice, body: {}})).status, 403);
});

test('two real worker threads serialize single-use invite consumption across independent SQLite connections', {timeout: 15000}, async t => {
  const f = await httpFixture(t); const alice = await f.login();
  const token = await f.invite(alice, f.workspaces.a.id, 'frank');
  const barrier = new SharedArrayBuffer(8);
  const preparedHash = await hashPromise;
  const workers = [0, 1].map(() => {
    const worker = new Worker(`
      const {parentPort,workerData} = require('node:worker_threads');
      const {createIdentityStore} = require(workerData.modulePath);
      const store = createIdentityStore({dbPath:workerData.dbPath,now:()=>workerData.now});
      const barrier = new Int32Array(workerData.barrier);
      parentPort.postMessage({ready:true});
      Atomics.wait(barrier,1,0);
      try {parentPort.postMessage({ok:true,userId:store.acceptInvite(workerData.args).user.id});}
      catch(error) {parentPort.postMessage({ok:false,code:error.code});}
      finally {store.close();}
    `, {eval: true, workerData: {modulePath: require.resolve('../identity/store.cjs'), dbPath: f.dbPath, now: f.now(), barrier, args: {tokenHash: digest(token), passwordHash: preparedHash}}});
    let markReady; let markResult; let rejectReady; let rejectResult;
    const ready = new Promise((resolve, reject) => {markReady = resolve; rejectReady = reject;});
    const result = new Promise((resolve, reject) => {markResult = resolve; rejectResult = reject;});
    worker.on('message', message => message.ready ? markReady() : markResult(message));
    worker.on('error', error => {rejectReady(error); rejectResult(error);});
    t.after(() => worker.terminate());
    return {ready, result};
  });
  await Promise.all(workers.map(worker => worker.ready));
  Atomics.store(new Int32Array(barrier), 1, 1); Atomics.notify(new Int32Array(barrier), 1, 2);
  const results = await Promise.all(workers.map(worker => worker.result));
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.equal(results.find(result => !result.ok).code, 'not_found');
  assert.equal(f.store.listMembers(f.actor('alice', 'a')).filter(user => user.login === 'frank').length, 1);
});

test('failed membership insertion rolls back newly created account and leaves invitation unused', async t => {
  const f = await httpFixture(t); const alice = await f.login();
  const token = await f.invite(alice, f.workspaces.a.id, 'frank');
  const db = new Database(f.dbPath);
  try {
    db.exec(`CREATE TRIGGER test_invite_failure BEFORE INSERT ON memberships
      WHEN NEW.user_id=(SELECT id FROM users WHERE login='frank')
      BEGIN SELECT RAISE(ABORT,'test-membership-failure'); END;`);
    const preparedHash = await hashPromise;
    assert.throws(() => f.store.acceptInvite({tokenHash: digest(token), passwordHash: preparedHash}), /test-membership-failure/);
    assert.equal(f.store.findUserForLogin('frank'), null);
    assert.ok(f.store.findInviteRecord(digest(token)));
  } finally {db.close();}
});

test('logout and reset endpoints revoke sessions without returning raw credentials', async t => {
  const f = await httpFixture(t); const alice = await f.login();
  assert.equal((await f.request('/auth/logout', {method: 'POST', auth: alice, body: {}})).status, 200);
  assert.equal((await f.request('/auth/me', {auth: alice})).status, 401);
  const next = await f.login();
  const reset = f.sessions.issuePasswordReset(f.users.alice.id);
  const r = await f.request('/auth/password/reset', {method: 'POST', body: {token: reset.token, password: newPassword}});
  assert.equal(r.status, 200, r.text);
  assert.ok(!r.text.includes(reset.token)); assert.ok(!r.text.includes(newPassword));
  assert.equal((await f.request('/auth/me', {auth: next})).status, 401);
  assert.equal((await f.request('/auth/password/reset', {method: 'POST', body: {token: reset.token, password: newPassword}})).status, 404);
});

test('human cookies do not provide node routes and credential-bearing URLs are refused', async t => {
  const f = await httpFixture(t); const alice = await f.login();
  for (const route of ['/api/nodes', '/mcp', '/v1/tasks', '/auth/invites/accept?token=public-secret-in-url']) {
    const r = await f.request(route, {auth: alice});
    assert.equal(r.status, 404);
    assert.ok(!r.text.includes('public-secret-in-url'));
  }
  const audit = JSON.stringify(f.store.listAudit(f.actor('alice', 'a')));
  assert.ok(!audit.includes(password)); assert.ok(!audit.includes(alice.cookie.split('=')[1]));
});

test('HTTP admission ignores caller-forwarded source and rejects excess password work with Retry-After', async t => {
  const f = await httpFixture(t);
  for (let i = 0; i < 5; i++) {
    const r = await f.request('/auth/login', {method: 'POST', headers: {'X-Forwarded-For': `198.51.100.${i + 1}`}, body: {login: `missing${i}`, password}});
    assert.equal(r.status, 401);
  }
  const r = await f.request('/auth/login', {method: 'POST', body: {login: 'alice', password}});
  assert.equal(r.status, 429); assert.equal(r.headers.get('retry-after'), '60');
});

function outputCollector() {
  let content = '';
  const stream = new Writable({write(chunk, encoding, done) {content += chunk.toString(); done();}});
  return {stream, text: () => content};
}

async function cli(t, args, input = '') {
  const stdout = outputCollector(); const stderr = outputCollector();
  const result = await runAccounts(args, {stdin: Readable.from([input]), stdout: stdout.stream, stderr: stderr.stream});
  return {result, stdout: stdout.text(), stderr: stderr.text()};
}

test('maintenance CLI initializes once, accepts only protected stdin and never logs passwords', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-accounts-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const args = ['bootstrap', '--data-root', dir, '--login', 'admin', '--workspace', 'Private', '--password-stdin'];
  let r = await cli(t, [...args, '--password', password], JSON.stringify({password}));
  assert.notEqual(r.result, 0);
  assert.ok(!r.stderr.includes(password));
  r = await cli(t, args, JSON.stringify({password}));
  assert.equal(r.result, 0, r.stderr); assert.ok(!r.stdout.includes(password));
  const store = createIdentityStore({dbPath: path.join(dir, 'identity.sqlite')});
  const admin = store.findUserForLogin('admin');
  assert.equal(await verifyPassword(password, admin.passwordHash), true);
  assert.equal(store.listWorkspaces(admin.id).length, 1);
  store.close();
  r = await cli(t, args, JSON.stringify({password}));
  assert.equal(r.result, 1); assert.ok(r.stderr.includes('already_initialized'));
});

test('maintenance reset writes a new private file, refuses overwrite and disable protects ownership', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-accounts-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const seed = createIdentityStore({dbPath: path.join(dir, 'identity.sqlite')});
  const admin = seed.createUser({login: 'admin', passwordHash: await (hashPromise ||= hashPassword(password))});
  seed.createWorkspace({name: 'Private', ownerId: admin.id}); seed.close();
  const file = path.join(dir, 'reset-private.json');
  const args = ['issue-reset', '--data-root', dir, '--user-id', admin.id, '--output', file];
  const r = await cli(t, args);
  assert.equal(r.result, 0, r.stderr);
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.match(record.token, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(!r.stdout.includes(record.token)); assert.ok(!r.stderr.includes(record.token));
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal((await cli(t, args)).result, 1);
  const disable = await cli(t, ['disable-user', '--data-root', dir, '--user-id', admin.id]);
  assert.equal(disable.result, 1); assert.ok(disable.stderr.includes('last_owner'));
  assert.equal((await cli(t, ['create-workspace', '--data-root', dir, '--owner-id', admin.id, '--workspace', 'Second'])).result, 0);
  assert.equal((await cli(t, ['issue-reset', '--data-root', dir, '--user-id', admin.id, '--output', path.join(os.tmpdir(), 'outside-reset.json')])).result, 1);
});
