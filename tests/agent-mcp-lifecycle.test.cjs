'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {once} = require('node:events');
const {agentAuthorityFixture} = require('./helpers/agent-authority-fixture.cjs');
const {input} = require('./helpers/pilot-fixture.cjs');
const {createPilotMcp} = require('../integrations/mcp/pilot-server.cjs');

// Contract: MCP 2025-11-25 lifecycle and Streamable HTTP, not vendor acceptance.
// Real JWT verifier, authority, gateway and HTTP handler; only JWKS is synthetic.
async function fixture(t, {beforeDiscover} = {}) {
  const cleanups = []; let mcp;
  t.after(async () => {
    await mcp?.close();
    for (const cleanup of cleanups) await cleanup();
  });
  const r = await agentAuthorityFixture({after: fn => cleanups.push(fn)});
  const browser = r.human('alice', 'a', h => h.createNode({name: 'lifecycle-browser',
    capabilities: ['browser.public_read'], scopes: ['public']}));
  const task = r.human('alice', 'a', h => h.enqueueTask({targetNodeId: browser.id,
    scopeId: 'public', taskType: 'browser.public_read', input, deadlineAt: r.now() + 120000}));
  const grant = r.authority.grant(r.actor('alice', 'a'), {
    subject: '11111111-1111-4111-8111-111111111111', clientId: 'native-client',
    workspaceId: r.workspaces.a.id, nodeId: browser.id, scopes: ['task.read'], expiresAt: r.now() + 600000});
  mcp = createPilotMcp({store: r.gateway, workspaceAccess: r.access,
    resolvePrincipal: token => r.gateway.authenticate(token),
    resolveAgentConnections: async token => { if (beforeDiscover) await beforeDiscover(); return r.authority.discover(token); },
    resolveAgentPrincipal: async (token, selection) =>
      r.gateway.authenticateAgent(await r.authority.authenticate(token, selection), selection)});
  mcp.server.listen(0, '127.0.0.1'); await once(mcp.server, 'listening');
  const url = `http://127.0.0.1:${mcp.server.address().port}/mcp`;
  async function request(body, {method = 'POST', version = '2025-11-25', token = r.token(['task.read']), headers = {}} = {}) {
    const response = await fetch(url, {method, headers: {
      Authorization: 'Bearer ' + token, 'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream', ...(version === null ? {} : {'MCP-Protocol-Version': version}), ...headers},
    ...(method === 'POST' ? {body: JSON.stringify(body)} : {}), signal: AbortSignal.timeout(5000)});
    const text = await response.text();
    return {status: response.status, text, json: text ? JSON.parse(text) : null, headers: response.headers};
  }
  return {...r, browser, task, grant, request, mcp};
}

const initialize = {jsonrpc: '2.0', id: 1, method: 'initialize', params: {
  protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {name: 'local-contract-test', version: '1.0.0'}}};
const initialized = {jsonrpc: '2.0', method: 'notifications/initialized'};

test('standard initialization notification allows subsequent scoped discovery and task read', {timeout: 15000}, async t => {
  const f = await fixture(t);
  const first = await f.request(initialize);
  assert.equal(first.status, 200); assert.equal(first.json.result.protocolVersion, '2025-11-25');
  const notification = await f.request(initialized);
  assert.equal(notification.status, 202, 'accepted notification must use HTTP 202');
  assert.equal(notification.text, '', 'notifications must not receive a JSON-RPC response');
  const list = await f.request({jsonrpc: '2.0', id: 2, method: 'tools/list', params: {}});
  assert.equal(list.status, 200);
  const tool = list.json.result.tools.find(tool => tool.name === 'pilot.read_task');
  assert.ok(tool.inputSchema.required.includes('grantId'));
  const read = await f.request({jsonrpc: '2.0', id: 3, method: 'tools/call', params: {
    name: 'pilot.read_task', arguments: {grantId: f.grant.id, taskId: f.task.taskId}}});
  assert.equal(read.status, 200);
  assert.equal(read.json.result.structuredContent.taskId, f.task.taskId);
  assert.equal(read.json.result.structuredContent.workspaceId, f.workspaces.a.id);
  assert.equal(read.json.result.structuredContent.status, 'queued');
});

test('standard notification authenticates its token instead of returning HTTP success for an invalid token', {timeout: 15000}, async t => {
  const f = await fixture(t);
  const response = await f.request(initialized, {token: 'invalid.signature.token'});
  assert.equal(response.status, 401);
});

test('stateless MCP endpoint declines an optional SSE stream with 405 rather than nonexistent-path 404', {timeout: 15000}, async t => {
  const f = await fixture(t);
  const response = await f.request(undefined, {method: 'GET'});
  assert.equal(response.status, 405);
});

test('unsupported MCP protocol header is rejected before serving protected tools', {timeout: 15000}, async t => {
  const f = await fixture(t);
  const response = await f.request({jsonrpc: '2.0', id: 1, method: 'tools/list', params: {}}, {version: '2099-01-01'});
  assert.equal(response.status, 400);
  assert.equal(response.json?.result, undefined);
});

test('generic MCP ping checks current authorization without choosing a workspace grant', {timeout: 15000}, async t => {
  const f = await fixture(t);
  const ping = {jsonrpc: '2.0', id: 5, method: 'ping', params: {}};
  const response = await f.request(ping);
  assert.equal(response.status, 200);
  assert.deepEqual(response.json, {jsonrpc: '2.0', id: 5, result: {}});
  f.authority.revoke(f.actor('alice', 'a'), {workspaceId: f.workspaces.a.id, grantId: f.grant.id});
  assert.equal((await f.request(ping)).status, 403);
});

test('GET authenticates and rechecks grants while preserving cross-origin denial', {timeout: 15000}, async t => {
  const f = await fixture(t);
  const allowed = await f.request(undefined, {method: 'GET'});
  assert.equal(allowed.status, 405); assert.equal(allowed.headers.get('allow'), 'POST');
  assert.equal((await f.request(undefined, {method: 'GET', token: 'invalid.signature.token'})).status, 401);
  assert.equal((await f.request(undefined, {method: 'GET', headers: {Origin: 'https://foreign.invalid'}})).status, 403);
  f.authority.revoke(f.actor('alice', 'a'), {workspaceId: f.workspaces.a.id, grantId: f.grant.id});
  assert.equal((await f.request(undefined, {method: 'GET'})).status, 403);
});

test('initialized notification rechecks revocation and rejects malformed envelopes without a false acknowledgement', {timeout: 15000}, async t => {
  const f = await fixture(t);
  assert.equal((await f.request({...initialized, params: {_meta: {}}})).status, 202);
  for (const body of [{...initialized, id: 7}, {...initialized, params: {_meta: []}},
    {...initialized, params: null}, {...initialized, params: {grantId: f.grant.id}},
    {jsonrpc: '2.0', method: 'notifications/unknown'}]) {
    const response = await f.request(body);
    assert.equal(response.status, 400); assert.ok(response.json.error);
    if (!Object.hasOwn(body, 'id')) assert.equal(Object.hasOwn(response.json, 'id'), false);
  }
  const denied = await f.request(initialized, {token: 'invalid.signature.token'});
  assert.equal(denied.status, 401); assert.equal(Object.hasOwn(denied.json, 'id'), false);
  f.authority.revoke(f.actor('alice', 'a'), {workspaceId: f.workspaces.a.id, grantId: f.grant.id});
  assert.equal((await f.request(initialized)).status, 403);
});

test('declared protocol versions and omitted legacy header work but malformed version values fail closed', {timeout: 15000}, async t => {
  const f = await fixture(t), list = {jsonrpc: '2.0', id: 3, method: 'tools/list', params: {}};
  for (const version of ['2025-11-25', '2026-07-28', null]) {
    const response = await f.request(list, {version});
    assert.equal(response.status, 200); assert.ok(response.json.result.tools.length);
  }
  for (const version of ['', '2025-11-25, 2025-11-25', 'unsupported']) {
    const response = await f.request(list, {version});
    assert.equal(response.status, 400); assert.equal(response.json.error, 'unsupported_protocol_version');
  }
  const fallback = await f.request({...initialize, params: {...initialize.params, protocolVersion: '2099-01-01'}});
  assert.equal(fallback.json.result.protocolVersion, '2025-11-25');
});

test('ping accepts common metadata but cannot use parameters to select a grant or claim a task', {timeout: 15000}, async t => {
  const f = await fixture(t), ping = {jsonrpc: '2.0', id: 8, method: 'ping'};
  assert.deepEqual((await f.request({...ping, params: {_meta: {}}})).json.result, {});
  const invalid = await f.request({...ping, params: {grantId: f.grant.id, taskId: f.task.taskId}});
  assert.equal(invalid.json.error.code, -32602);
  assert.equal((await f.request(ping, {token: 'invalid.signature.token'})).status, 401);
  assert.equal(f.human('alice', 'a', h => h.getTask(f.task.taskId)).status, 'queued');
});

test('opaque paired nodes retain scoped task access across the standard lifecycle', {timeout: 15000}, async t => {
  const f = await fixture(t), paired = f.gateway.pair(f.browser.pairingCode), options = {token: paired.token};
  assert.equal((await f.request(initialize, options)).json.result.protocolVersion, '2025-11-25');
  const notification = await f.request(initialized, options);
  assert.equal(notification.status, 202); assert.equal(notification.text, '');
  assert.deepEqual((await f.request({jsonrpc: '2.0', id: 9, method: 'ping'}, options)).json.result, {});
  const read = await f.request({jsonrpc: '2.0', id: 10, method: 'tools/call', params: {
    name: 'pilot.read_task', arguments: {taskId: f.task.taskId}}}, options);
  assert.equal(read.status, 200); assert.equal(read.json.result.structuredContent.taskId, f.task.taskId);
  assert.equal(read.json.result.structuredContent.workspaceId, f.workspaces.a.id);
});

test('closing during notification authentication cannot issue a late successful acknowledgement', {timeout: 15000}, async t => {
  let entered, release;
  const started = new Promise(resolve => {entered = resolve;});
  const gate = new Promise(resolve => {release = resolve;});
  const f = await fixture(t, {beforeDiscover: () => {entered(); return gate;}});
  const pending = f.mcp.handleRpc(initialized, f.token(['task.read']));
  try {
    await started; await f.mcp.close(); release();
    const reply = await pending;
    assert.equal(reply.error.data.reason, 'mcp_closed');
    assert.equal(f.human('alice', 'a', h => h.getTask(f.task.taskId)).status, 'queued');
  } finally {release(); await pending;}
});
