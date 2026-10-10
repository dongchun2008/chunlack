'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const {workspaceFixture} = require('./helpers/workspace-fixture.cjs');
const {hashPassword} = require('../identity/passwords.cjs');
const {createSessionService} = require('../identity/sessions.cjs');
const {createIdentityRouter} = require('../identity/http.cjs');
const origin = 'https://lack.fixture.invalid';
async function setup(t, {passwordHash} = {}) {
  const f = workspaceFixture(t, passwordHash ? {passwordHash} : {});
  const sessions = f.own(createSessionService({store: f.store, now: f.now}));
  const app = express(); app.use(createIdentityRouter({store: f.store, sessions, webOrigin: origin}));
  const server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => {server.closeAllConnections(); server.close(resolve);}));
  const request = (route, options = {}) => fetch('http://127.0.0.1:' + server.address().port + route, options);
  return {...f, sessions, request};
}
test('invalid session cookie is cleared by auth/me so an expired login cannot prevent a new invited account joining', async t => {
  const f = await setup(t);
  const response = await f.request('/auth/me', {headers: {Cookie: '__Host-chunlack_session=' + 'A'.repeat(43)}});
  assert.equal(response.status, 401); const cookie = response.headers.get('set-cookie');
  assert.ok(cookie?.startsWith('__Host-chunlack_session=;')); assert.match(cookie, /Expires=Thu, 01 Jan 1970/); assert.match(cookie, /HttpOnly; Secure/);
});
test('logout of an already invalid session clears its cookie, while valid-session missing-CSRF remains forbidden', async t => {
  const password = 'synthetic-expired-login-password'; const f = await setup(t, {passwordHash: await hashPassword(password)});
  const invalid = await f.request('/auth/logout', {method: 'POST', headers: {Origin: origin, 'Content-Type': 'application/json', Cookie: '__Host-chunlack_session=' + 'A'.repeat(43)}, body: '{}'});
  assert.equal(invalid.status, 401); assert.ok(invalid.headers.get('set-cookie')?.startsWith('__Host-chunlack_session=;'));
  const logged = await f.sessions.login({login: 'alice', password, source: 'recovery-fixture'});
  const denied = await f.request('/auth/logout', {method: 'POST', headers: {Origin: origin, 'Content-Type': 'application/json', Cookie: '__Host-chunlack_session=' + logged.token}, body: '{}'});
  assert.equal(denied.status, 403); assert.equal(denied.headers.get('set-cookie'), null); assert.equal(f.sessions.authenticate(logged.token).userId, f.users.alice.id);
});
test('successful account switch revokes only the replaced browser session; failed login does not revoke it', async t => {
  const password = 'synthetic-account-switch-password', f = await setup(t, {passwordHash: await hashPassword(password)});
  const alice = await f.sessions.login({login: 'alice', password, source: 'switch-alice'});
  const other = await f.sessions.login({login: 'alice', password, source: 'switch-other-device'});
  const headers = {Origin: origin, 'Content-Type': 'application/json', Cookie: '__Host-chunlack_session=' + alice.token};
  assert.equal((await f.request('/auth/login', {method: 'POST', headers, body: JSON.stringify({login: 'bob', password: 'wrong'})})).status, 401);
  assert.equal(f.sessions.authenticate(alice.token).userId, f.users.alice.id);
  const response = await f.request('/auth/login', {method: 'POST', headers, body: JSON.stringify({login: 'bob', password})}); assert.equal(response.status, 200);
  assert.throws(() => f.sessions.authenticate(alice.token), error => error.code === 'unauthorized');
  assert.equal(f.sessions.authenticate(other.token).userId, f.users.alice.id);
});
