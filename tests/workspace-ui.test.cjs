'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createWorkspaceClient, safeReturnPath} = require('../identity/workspace-ui.js');
const turn = () => new Promise(resolve => setImmediate(resolve));

test('binary response consumption rejects a workspace switch before and during blob delivery', async t => {
  const f = setup(); t.after(() => f.client.close()); await f.client.boot();
  f.respond(() => new Response(Buffer.from([1, 2]), {headers: {'Content-Type': 'image/png'}}));
  const response = await f.client.fetch('/api/tasks/pilot/artifact'); assert.equal(typeof response.blob, 'function');
  await f.client.selectWorkspace('workspace-b'); await assert.rejects(() => response.blob(), error => error.code === 'workspace_changed');
  let release;
  f.respond(() => ({ok: true, status: 200, headers: new Headers({'Content-Type': 'image/png'}), blob: () => new Promise(resolve => {release = resolve;})}));
  const next = await f.client.fetch('/api/tasks/pilot/artifact'), pending = next.blob();
  const rejected = assert.rejects(pending, error => error.code === 'workspace_changed');
  await turn(); await f.client.selectWorkspace('workspace-a'); release(new Blob([Buffer.from([1, 2])], {type: 'image/png'})); await rejected;
});
function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {get length() {return values.size;}, key: index => [...values.keys()][index], getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key), values};
}
class Socket {
  static sockets = [];
  constructor(url) {this.url = url; this.readyState = 0; this.sent = []; Socket.sockets.push(this);}
  send(data) {this.sent.push(data);}
  close(code = 1000) {this.readyState = 3; this.onclose?.({code});}
  open() {this.readyState = 1; this.onopen?.({});}
  frame(data) {this.onmessage?.({data: JSON.stringify(data)});}
}
function setup(options = {}) {
  const session = storage(options.saved), legacy = storage({lack_history: 'private-old-history', lack_username: 'root', unrelated: 'keep'});
  const calls = [], resets = [], identities = [], changes = [], errors = [];
  let loggedIn = options.loggedIn !== false;
  let workspaces = options.workspaces || [{id: 'workspace-a', name: 'A', role: 'member'}, {id: 'workspace-b', name: 'B', role: 'owner'}];
  let custom = null;
  const fetch = async (url, init) => {
    calls.push({url, init}); const pathname = new URL(url).pathname;
    if (custom) {const response = await custom(pathname, init); if (response) return response;}
    if (pathname === '/auth/login') {
      const input = JSON.parse(init.body); if (input.password !== 'synthetic-password') return Response.json({error: 'unauthorized'}, {status: 401});
      loggedIn = true; return Response.json({user: {id: 'user-fixture', login: 'bob'}, csrfToken: 'synthetic-csrf'});
    }
    if (pathname === '/auth/logout') {loggedIn = false; return Response.json({ok: true});}
    if (!loggedIn) return Response.json({error: 'unauthorized'}, {status: 401});
    if (pathname === '/auth/me') return Response.json({user: {id: 'user-fixture', login: options.login || 'bob'}, csrfToken: 'synthetic-csrf'});
    if (pathname === '/api/workspaces') return Response.json({workspaces});
    return Response.json({messages: ['selected-workspace-fixture']});
  };
  const client = createWorkspaceClient({fetch, storage: session, legacyStorage: legacy, WebSocket: Socket,
    location: {origin: 'https://lack.fixture.invalid', protocol: 'https:', host: 'lack.fixture.invalid'},
    onReset: reason => resets.push(reason), onIdentity: state => identities.push(state), onWorkspace: value => changes.push(value), onError: error => errors.push(error.code),
    ...(options.clock ? {clock: options.clock} : {}), onReconnect: () => client.createSocket()});
  return {client, session, legacy, calls, resets, identities, changes, errors,
    respond: fn => {custom = fn;}, revoke: id => {workspaces = workspaces.filter(workspace => workspace.id !== id);}};
}
test('failed login never selects a workspace, connects a socket or requests business data', async t => {
  const f = setup({loggedIn: false}); t.after(() => f.client.close());
  await f.client.boot(); assert.equal(f.client.snapshot().status, 'login');
  await assert.rejects(() => f.client.login('bob', 'wrong-password'), error => error.code === 'unauthorized');
  assert.equal(f.client.snapshot().workspace, null);
  assert.ok(f.calls.every(call => new URL(call.url).pathname.startsWith('/auth/')));
  assert.throws(() => f.client.createSocket(), error => error.code === 'workspace_required');
});
test('workspace HTTP selection and mutation CSRF come only from verified server state and stay out of storage', async t => {
  const f = setup(); t.after(() => f.client.close()); await f.client.boot();
  await f.client.fetch('/api/agent/fixture', {method: 'DELETE', headers: {'X-Workspace-Id': 'spoof', 'X-CSRF-Token': 'spoof'}});
  const last = f.calls.at(-1); const headers = new Headers(last.init.headers);
  assert.equal(headers.get('X-Workspace-Id'), 'workspace-a'); assert.equal(headers.get('X-CSRF-Token'), 'synthetic-csrf');
  assert.equal(last.init.credentials, 'same-origin'); assert.equal(last.init.redirect, 'error');
  assert.deepEqual([...f.session.values], [['chunlack.workspaceId', 'workspace-a']]);
  assert.deepEqual([...f.legacy.values], [['unrelated', 'keep']]);
  assert.ok(!JSON.stringify(f.client.snapshot()).includes('synthetic-csrf'));
});
test('switching clears previous workspace before publishing new selection and rejects late HTTP JSON', async t => {
  const f = setup(); t.after(() => f.client.close()); await f.client.boot();
  let resolve; f.respond(path => path === '/api/metrics' ? new Promise(done => {resolve = done;}) : null);
  const pending = f.client.fetch('/api/metrics'); const rejected = assert.rejects(pending, error => error.code === 'workspace_changed');
  await turn(); await f.client.selectWorkspace('workspace-b'); resolve(Response.json({private: 'workspace-a'})); await rejected;
  assert.ok(f.resets.includes('workspace_changed')); assert.equal(f.client.snapshot().workspace.id, 'workspace-b');
  f.respond(() => Response.json({private: 'old-json'})); const response = await f.client.fetch('/api/metrics');
  await f.client.selectWorkspace('workspace-a'); await assert.rejects(() => response.json(), error => error.code === 'workspace_changed');
});
test('two tabs independently select workspaces without storing identity or sharing selection state', async t => {
  const a = setup({saved: {'chunlack.workspaceId': 'workspace-a'}}), b = setup({saved: {'chunlack.workspaceId': 'workspace-b'}});
  t.after(() => {a.client.close(); b.client.close();}); await Promise.all([a.client.boot(), b.client.boot()]);
  assert.equal(a.client.snapshot().workspace.id, 'workspace-a'); assert.equal(b.client.snapshot().workspace.id, 'workspace-b');
  await a.client.selectWorkspace('workspace-b'); await a.client.selectWorkspace('workspace-a');
  assert.equal(b.client.snapshot().workspace.id, 'workspace-b');
  assert.ok(!JSON.stringify([...a.session.values]).includes('user-fixture'));
});
test('socket URL has workspace only; old socket frames and sends cannot cross a workspace switch', async t => {
  const f = setup(); t.after(() => f.client.close()); await f.client.boot(); const first = f.client.createSocket(); let frames = 0;
  first.onmessage = () => frames++; const raw = Socket.sockets.at(-1); raw.open(); raw.frame({type: 'history', messages: []}); assert.equal(frames, 1);
  assert.equal(raw.url, 'wss://lack.fixture.invalid/ws/workspaces/workspace-a');
  await f.client.selectWorkspace('workspace-b'); raw.frame({type: 'history', messages: ['old-private']}); assert.equal(frames, 1);
  assert.throws(() => first.send('{}'), error => error.code === 'workspace_changed');
});
test('logout first resets workspace and closes subscriptions, then requests server revocation', async t => {
  const f = setup(); t.after(() => f.client.close()); await f.client.boot(); f.client.createSocket(); const raw = Socket.sockets.at(-1);
  f.respond(path => {if (path === '/auth/logout') {assert.equal(raw.readyState, 3); assert.equal(f.client.snapshot().workspace, null); assert.ok(f.resets.includes('logout'));} return null;});
  await f.client.logout(); assert.equal(f.client.snapshot().status, 'login');
  assert.equal(f.session.getItem('chunlack.workspaceId'), null);
});
test('401 stops access without infinite retries, and 403 refreshes selectable workspaces without reconnecting', async t => {
  const f = setup(); t.after(() => f.client.close()); await f.client.boot(); f.client.createSocket();
  f.respond(path => path === '/api/metrics' ? Response.json({error: 'unauthorized'}, {status: 401}) : null);
  await assert.rejects(() => f.client.fetch('/api/metrics'), error => error.code === 'unauthorized');
  assert.equal(f.client.snapshot().status, 'login'); assert.equal(f.client.snapshot().workspace, null);
  f.respond(null); await f.client.boot(); f.revoke('workspace-a');
  f.respond(path => path === '/api/metrics' ? Response.json({error: 'forbidden'}, {status: 403}) : null);
  await assert.rejects(() => f.client.fetch('/api/metrics'), error => error.code === 'forbidden');
  assert.equal(f.client.snapshot().status, 'selection'); assert.equal(f.client.snapshot().workspace, null);
  assert.deepEqual(f.client.snapshot().workspaces.map(workspace => workspace.id), ['workspace-b']);
});
test('viewer UI capabilities never become execute/manage permissions; role is refreshed from workspace listing', async t => {
  const f = setup({workspaces: [{id: 'workspace-a', name: 'Read only', role: 'viewer'}]}); t.after(() => f.client.close()); await f.client.boot();
  assert.equal(f.client.can('read'), true); assert.equal(f.client.can('execute'), false); assert.equal(f.client.can('manage'), false);
});
test('cross-origin requests, credential-bearing URLs and unsafe login return paths fail closed', async t => {
  const f = setup(); t.after(() => f.client.close()); await f.client.boot(); const before = f.calls.length;
  for (const target of ['https://evil.invalid/api/models', '//evil.invalid/api/models', 'https://user:pass@lack.fixture.invalid/api/models', 'javascript:alert(1)'])
    await assert.rejects(() => f.client.fetch(target), error => error.code === 'unsafe_url');
  assert.equal(f.calls.length, before);
  for (const target of ['//evil.invalid/', 'https://evil.invalid/', 'javascript:alert(1)', '/api/models', '/login?token=secret']) assert.equal(safeReturnPath(target, 'https://lack.fixture.invalid'), '/');
  assert.equal(safeReturnPath('/login', 'https://lack.fixture.invalid'), '/login');
});
test('user display strings remain data and snapshots cannot mutate verified account or role state', async t => {
  const login = '<img src=x onerror=alert(1)>', f = setup({login}); t.after(() => f.client.close()); await f.client.boot();
  const state = f.client.snapshot(); assert.equal(state.user.login, login); assert.equal(Object.isFrozen(state.user), true);
  assert.equal(Object.isFrozen(state.workspace), true); assert.throws(() => {state.workspace.role = 'owner';});
  assert.equal(f.client.can('manage'), false);
});
test('page teardown preserves only non-sensitive workspace selection for a subsequent reload', async () => {
  const f = setup(); await f.client.boot(); await f.client.selectWorkspace('workspace-b'); f.client.close();
  assert.equal(f.session.getItem('chunlack.workspaceId'), 'workspace-b');
  assert.deepEqual([...f.session.values], [['chunlack.workspaceId', 'workspace-b']]);
});
test('a late login response cannot undo a later logout or restart subscriptions', async t => {
  const f = setup({loggedIn: false}); t.after(() => f.client.close()); await f.client.boot(); let respond;
  f.respond(path => path === '/auth/login' ? new Promise(resolve => {respond = resolve;}) : null);
  const login = f.client.login('bob', 'synthetic-password'); const rejected = assert.rejects(login, error => error.code === 'workspace_changed');
  await turn(); await f.client.logout(); respond(Response.json({user: {id: 'user-fixture', login: 'bob'}, csrfToken: 'synthetic-csrf'})); await rejected;
  assert.equal(f.client.snapshot().status, 'login'); assert.equal(f.client.snapshot().workspace, null);
});
test('unconfirmed logout cannot silently reauthenticate through boot or a new login', async t => {
  const f = setup(); t.after(() => f.client.close()); await f.client.boot();
  f.respond(path => {if (path === '/auth/logout') throw new Error('synthetic-network-unavailable'); return null;});
  await assert.rejects(() => f.client.logout(), error => error.code === 'logout_not_confirmed');
  assert.equal(f.client.snapshot().status, 'logout_pending'); assert.equal(f.client.snapshot().workspace, null);
  await assert.rejects(() => f.client.boot(), error => error.code === 'logout_not_confirmed');
  await assert.rejects(() => f.client.login('bob', 'synthetic-password'), error => error.code === 'logout_not_confirmed');
});
test('auth credentials in URL queries are rejected before traffic', async t => {
  const f = setup(); t.after(() => f.client.close()); await f.client.boot(); const before = f.calls.length;
  await assert.rejects(() => f.client.fetch('/auth/me?token=synthetic-secret'), error => error.code === 'unsafe_url'); assert.equal(f.calls.length, before);
});
test('network reconnection is bounded to three validated attempts in its time window', async t => {
  const timers = new Map(); let id = 0;
  const clock = {now: () => 0, setTimeout: fn => {timers.set(++id, fn); return id;}, clearTimeout: key => timers.delete(key)};
  const f = setup({clock}); t.after(() => f.client.close()); await f.client.boot(); f.client.createSocket();
  for (let attempt = 0; attempt < 4; attempt++) {
    Socket.sockets.at(-1).close(1006);
    if (attempt < 3) {assert.equal(timers.size, 1); const [key, fn] = [...timers][0]; timers.delete(key); await fn();}
  }
  assert.equal(timers.size, 0); assert.equal(f.client.snapshot().status, 'selection');
  assert.deepEqual(f.errors, ['connection_unavailable']); assert.equal(f.calls.length, 8);
});
test('permission-close recovers selectable workspaces but never enters the network retry loop', async t => {
  const timers = new Map(), clock = {now: () => 0, setTimeout: fn => {timers.set(1, fn); return 1;}, clearTimeout: key => timers.delete(key)};
  const f = setup({clock}); t.after(() => f.client.close()); await f.client.boot(); f.client.createSocket(); f.revoke('workspace-a');
  Socket.sockets.at(-1).close(1008); await turn();
  assert.equal(timers.size, 0); assert.equal(f.client.snapshot().status, 'selection');
  assert.deepEqual(f.client.snapshot().workspaces.map(item => item.id), ['workspace-b']);
});
