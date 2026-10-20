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

test('request metadata is accepted across lifecycle, discovery and scoped reads without changing the request', {timeout: 15000}, async t => {
  const f = await fixture(t);
  const metadata = [{}, {progressToken: 'local-progress'}, {progressToken: 0},
    {'com.example/correlation': {label: 'local-only'}},
    {'io.modelcontextprotocol/protocolVersion': '2026-07-28'}];
  for (const _meta of metadata) {
    const init = await f.request({...initialize, params: {...initialize.params, _meta}});
    assert.equal(init.json.result?.protocolVersion, '2025-11-25');
    const listed = await f.request({jsonrpc: '2.0', id: 21, method: 'tools/list', params: {_meta}});
    assert.ok(listed.json.result?.tools.some(tool => tool.name === 'chunlack_connections_list'));
    const discover = await f.request({jsonrpc: '2.0', id: 22, method: 'server/discover', params: {_meta}});
    assert.equal(discover.json.result?.resultType, 'complete');
    const connection = await f.request({jsonrpc: '2.0', id: 23, method: 'tools/call', params: {
      name: 'chunlack_connections_list', arguments: {}, _meta}});
    assert.ok(connection.json.result?.structuredContent.connections.some(item => item.grantId === f.grant.id));
    const body = {jsonrpc: '2.0', id: 24, method: 'tools/call', params: {
      name: 'pilot.read_task', arguments: {grantId: f.grant.id, taskId: f.task.taskId}, _meta}};
    const original = structuredClone(body);
    const read = await f.mcp.handleRpc(body, f.token(['task.read']));
    assert.equal(read.result?.structuredContent.taskId, f.task.taskId);
    assert.deepEqual(body, original, 'normalization must not mutate the caller request');
  }
});

test('request metadata cannot choose a grant, cross a workspace or restore revoked authorization', {timeout: 15000}, async t => {
  const f = await fixture(t);
  const _meta = {grantId: f.grant.id, workspaceId: f.workspaces.b.id, scope: 'task.claim'};
  const request = {jsonrpc: '2.0', id: 25, method: 'tools/call', params: {
    name: 'pilot.read_task', arguments: {taskId: f.task.taskId}, _meta}};
  assert.equal((await f.request(request)).json.error?.data.reason, 'invalid_id');
  request.params.arguments.grantId = f.grant.id;
  assert.equal((await f.request(request)).json.result?.structuredContent.workspaceId, f.workspaces.a.id);
  const other = f.enqueue('b');
  assert.equal((await f.request({...request, params: {...request.params,
    arguments: {grantId: f.grant.id, taskId: other.taskId}}})).json.error?.data.reason, 'unknown_task');
  assert.equal((await f.request(request, {token: 'invalid.signature.token'})).status, 401);
  const claim = {...request, params: {...request.params, name: 'pilot.claim_task'}};
  assert.equal((await f.request(claim)).status, 403, 'metadata cannot upgrade a read-only token');
  assert.equal(f.human('alice', 'a', h => h.getTask(f.task.taskId)).status, 'queued');
  f.authority.revoke(f.actor('alice', 'a'), {workspaceId: f.workspaces.a.id, grantId: f.grant.id});
  const revoked = await f.request(request);
  assert.equal(revoked.status, 401);
  assert.equal(revoked.json.error?.data.reason, 'unauthorized');
  assert.equal(f.human('alice', 'a', h => h.getTask(f.task.taskId)).status, 'queued');
});

test('metadata normalization preserves envelope and tool argument allowlists', {timeout: 15000}, async t => {
  const f = await fixture(t);
  const valid = {jsonrpc: '2.0', id: 26, method: 'tools/call', params: {
    name: 'chunlack_connections_list', arguments: {}, _meta: {progressToken: 'local'}}};
  for (const body of [
    {...valid, unexpected: true},
    {...valid, params: {...valid.params, unexpected: true}},
    {...valid, params: {...valid.params, arguments: {unexpected: true}}},
    {...valid, params: {...valid.params, arguments: {_meta: {}}}}
  ]) {
    const reply = await f.request(body);
    assert.equal(reply.json.error?.code, -32602);
    assert.equal(reply.json.error?.data.reason, 'unsupported_field');
  }
  assert.ok((await f.request(valid)).json.result?.structuredContent.connections.length);
});

test('malformed metadata and progress tokens are rejected consistently for requests and notifications', {timeout: 15000}, async t => {
  const f = await fixture(t);
  for (const _meta of [null, [], true, 'text', 1, {progressToken: null}, {progressToken: true},
    {progressToken: []}, {progressToken: {}}, {progressToken: 1.5}]) {
    for (const body of [
      {jsonrpc: '2.0', id: 27, method: 'tools/list', params: {_meta}},
      {jsonrpc: '2.0', id: 28, method: 'ping', params: {_meta}},
      {...initialized, params: {_meta}}
    ]) {
      const reply = await f.request(body);
      assert.equal(reply.json.error?.code, -32602);
      if (!Object.hasOwn(body, 'id')) assert.equal(reply.status, 400);
    }
  }
});

test('metadata retains request size, depth and unsafe-field limits', {timeout: 15000}, async t => {
  const f = await fixture(t);
  const body = _meta => ({jsonrpc: '2.0', id: 29, method: 'tools/list', params: {_meta}});
  assert.equal((await f.request(body({'com.example/padding': 'x'.repeat(262144)}))).status, 413);
  let nested = {};
  for (let i = 0; i < 14; i++) nested = {child: nested};
  assert.equal((await f.request(body({'com.example/depth': nested}))).json.error?.data.reason, 'payload_too_deep');
  const unsafe = await f.request(body(JSON.parse('{"__proto__":{"safe":true}}')));
  assert.equal(unsafe.json.error?.data.reason, 'sensitive_or_unsafe_field');
});

test('opaque paired nodes also accept metadata without gaining scoped-tool arguments', {timeout: 15000}, async t => {
  const f = await fixture(t), options = {token: f.gateway.pair(f.browser.pairingCode).token};
  const _meta = {progressToken: 'paired-local', grantId: 'not-an-authority-selector'};
  assert.equal((await f.request({...initialize, params: {...initialize.params, _meta}}, options)).json.result?.protocolVersion, '2025-11-25');
  assert.ok((await f.request({jsonrpc: '2.0', id: 30, method: 'tools/list', params: {_meta}}, options)).json.result?.tools.length);
  const read = {jsonrpc: '2.0', id: 31, method: 'tools/call', params: {
    name: 'pilot.read_task', arguments: {taskId: f.task.taskId}, _meta}};
  assert.equal((await f.request(read, options)).json.result?.structuredContent.taskId, f.task.taskId);
  assert.equal((await f.request({...read, params: {...read.params,
    arguments: {...read.params.arguments, unexpected: true}}}, options)).json.error?.data.reason, 'unsupported_field');
});

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
