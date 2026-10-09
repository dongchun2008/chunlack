'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {transportFixture} = require('./helpers/workspace-transport-fixture.cjs');
test('real HTTPS workspace requests require a session and explicit authorized workspace', async t => {
  const f = await transportFixture(t); const alice = await f.login();
  assert.equal((await f.request('/api/channels')).status, 401);
  assert.equal((await f.request('/api/channels', {auth: alice, workspaceId: null})).status, 400);
  const b = await f.request('/api/channels', {auth: alice, workspaceId: f.workspaces.b.id});
  const missing = await f.request('/api/channels', {auth: alice, workspaceId: 'missing'});
  assert.equal(b.status, 404); assert.deepEqual(b.json, missing.json);
  const a = await f.request('/api/channels', {auth: alice});
  assert.equal(a.status, 200); assert.equal(a.json.userId, f.users.alice.id);
});
test('HTTPS mutations reject invalid Origin and missing CSRF and ignore forged caller privilege', async t => {
  const f = await transportFixture(t); const bob = await f.login('bob'); const alice = await f.login();
  const route = '/api/agent/moderator';
  assert.equal((await f.request(route, {auth: alice, method: 'DELETE', csrf: false})).status, 403);
  assert.equal((await f.request(route, {auth: alice, method: 'DELETE', requestOrigin: 'https://evil.example'})).status, 403);
  assert.equal((await f.request(route, {auth: bob, method: 'DELETE', headers: {'X-Role': 'owner', 'X-User-ID': f.users.alice.id}})).status, 403);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.request(route, {auth: alice, method: 'DELETE'})).status, 200);
  assert.equal(f.calls[0].userId, f.users.alice.id);
});
test('unknown HTTP routes and platform maintenance cannot execute through human workspace cookies', async t => {
  const f = await transportFixture(t); const alice = await f.login();
  assert.equal((await f.request('/api/unknown', {auth: alice})).status, 404);
  assert.equal((await f.request('/api/cron/wipe', {auth: alice, method: 'POST', body: {}})).status, 403);
  assert.equal((await f.request('/api/jspace?text=private', {auth: alice})).status, 405);
  assert.equal(f.calls.length, 0);
});
test('simultaneous HTTPS requests retain separate workspace contexts and refreshed viewer roles', async t => {
  const f = await transportFixture(t); const bob = await f.login('bob'); const carol = await f.login('carol');
  const results = await Promise.all([f.request('/api/channels', {auth: bob}), f.request('/api/channels', {auth: bob, workspaceId: f.workspaces.b.id}), f.request('/api/channels', {auth: carol, workspaceId: f.workspaces.b.id})]);
  assert.deepEqual(results.map(result => result.json.role), ['member', 'owner', 'viewer']);
  assert.ok(results[1].json.channels.includes('general'));
  assert.equal((await f.request('/api/channels', {auth: bob, headers: {Authorization: 'Bearer not-a-human-session'}})).status, 200);
  f.store.removeMembership(f.actor('alice', 'a'), {workspaceId: f.workspaces.a.id, userId: f.users.bob.id});
  assert.equal((await f.request('/api/channels', {auth: bob})).status, 404);
});
