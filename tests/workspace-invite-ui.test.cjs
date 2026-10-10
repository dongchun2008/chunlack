'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createWorkspaceClient} = require('../identity/workspace-ui.js');
test('invite acceptance uses a same-origin POST with no URL or storage secret and signs in a newly created invited account', async t => {
  const requests = [], stored = new Map();
  let loggedIn = false;
  const response = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
  const client = createWorkspaceClient({location: {origin: 'https://lack.fixture.invalid'}, WebSocket: class {}, storage: {length: 0, getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key)},
    fetch: async (url, options) => {
      const path = new URL(url).pathname, body = options.body ? JSON.parse(options.body) : null; requests.push({url, options, body});
      if (path === '/auth/invites/accept') return response({user: {id: 'user-fixture', login: 'invited-user'}, membership: {workspaceId: 'workspace-fixture', role: 'member'}}, 201);
      if (path === '/auth/login') {loggedIn = true; return response({user: {id: 'user-fixture', login: 'invited-user'}, csrfToken: 'synthetic-csrf'});}
      if (path === '/auth/me') return loggedIn ? response({user: {id: 'user-fixture', login: 'invited-user'}, csrfToken: 'synthetic-csrf'}) : response({error: 'unauthorized'}, 401);
      if (path === '/api/workspaces') return response({workspaces: [{id: 'workspace-fixture', name: 'Private', role: 'member'}]});
      throw new Error('Unexpected route');
    }});
  t.after(() => client.close()); await client.boot();
  await client.acceptInvite('synthetic-invite-token', 'synthetic-invite-password');
  const invite = requests.find(item => item.url.endsWith('/auth/invites/accept'));
  assert.equal(invite.options.method, 'POST'); assert.equal(new URL(invite.url).search, '');
  assert.deepEqual(invite.body, {token: 'synthetic-invite-token', password: 'synthetic-invite-password'});
  assert.equal(client.snapshot().workspace.id, 'workspace-fixture');
  assert.ok([...stored.values()].every(value => !value.includes('synthetic-')));
});
test('an existing invited account sends its verified CSRF and no replacement password, then refreshes workspace membership', async t => {
  const requests = []; let accepted = false;
  const response = body => new Response(JSON.stringify(body), {headers: {'Content-Type': 'application/json'}});
  const user = {id: 'existing-user', login: 'existing'};
  const client = createWorkspaceClient({location: {origin: 'https://lack.fixture.invalid'}, WebSocket: class {}, fetch: async (url, options) => {
    const path = new URL(url).pathname; requests.push({path, options});
    if (path === '/auth/me') return response({user, csrfToken: 'verified-fixture-csrf'});
    if (path === '/api/workspaces') return response({workspaces: accepted ? [{id: 'invited-workspace', name: 'Invited', role: 'viewer'}] : []});
    if (path === '/auth/invites/accept') {accepted = true; assert.equal(options.headers.get('X-CSRF-Token'), 'verified-fixture-csrf'); assert.deepEqual(JSON.parse(options.body), {token: 'synthetic-invite'}); return response({user, membership: {role: 'viewer'}});}
    throw new Error('Unexpected route');
  }});
  t.after(() => client.close()); await client.boot(); await client.acceptInvite('synthetic-invite', 'MUST_NOT_REPLACE_PASSWORD');
  assert.equal(client.snapshot().workspace.role, 'viewer'); assert.ok(!requests.some(item => item.path === '/auth/login'));
});
test('a delayed invite acceptance cannot sign in after a later logout', async t => {
  let resolveInvite, loginRequests = 0;
  const response = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
  const client = createWorkspaceClient({location: {origin: 'https://lack.fixture.invalid'}, WebSocket: class {}, fetch: async url => {
    const path = new URL(url).pathname;
    if (path === '/auth/invites/accept') return new Promise(resolve => {resolveInvite = resolve;});
    if (path === '/auth/me' || path === '/auth/logout') return response({error: 'unauthorized'}, 401);
    if (path === '/auth/login') loginRequests++;
    throw new Error('Unexpected route');
  }});
  t.after(() => client.close()); await client.boot();
  const pending = client.acceptInvite('synthetic-invite', 'synthetic-password'); await client.logout();
  resolveInvite(response({user: {id: 'invited-user', login: 'invited'}}));
  await assert.rejects(pending, {code: 'workspace_changed'}); assert.equal(loginRequests, 0); assert.equal(client.snapshot().status, 'login');
});
