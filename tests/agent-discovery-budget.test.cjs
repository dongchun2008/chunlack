'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {agentAuthorityFixture} = require('./helpers/agent-authority-fixture.cjs');
const {createPilotMcp} = require('../integrations/mcp/pilot-server.cjs');

test('generic OAuth discovery shares the real verifier 120-per-minute budget', async t => {
  const cleanup = []; let mcp;
  t.after(async () => {await mcp?.close(); for (const fn of cleanup) await fn();});
  const f = await agentAuthorityFixture({after: fn => cleanup.push(fn)});
  await f.agent(); // One real verification already consumed this minute.
  mcp = createPilotMcp({store: f.gateway, workspaceAccess: f.access,
    resolvePrincipal: token => f.gateway.authenticate(token),
    resolveAgentConnections: token => f.authority.discover(token),
    resolveAgentPrincipal: async (token, options) => f.gateway.authenticateAgent(await f.authority.authenticate(token, options), options)});
  const requests = [
    {method: 'server/discover', params: {}},
    {method: 'tools/list', params: {}},
    {method: 'initialize', params: {protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {name: 'test', version: '1'}}},
    {method: 'tools/call', params: {name: 'chunlack_connections_list', arguments: {}}}
  ];
  const token = f.token();
  for (let i = 0; i < 119; i++) {
    const reply = await mcp.handleRpc({jsonrpc: '2.0', id: i, ...requests[i % requests.length]}, token);
    assert.ok(reply.result, `request ${i + 1} must fit the remaining verification budget`);
  }
  for (const request of requests) {
    const reply = await mcp.handleRpc({jsonrpc: '2.0', id: 120, ...request}, token);
    assert.equal(reply.error.code, -32001);
  }
  f.advance(60000);
  const recovered = await mcp.handleRpc({jsonrpc: '2.0', id: 121, ...requests[0]}, token);
  assert.ok(recovered.result);
});
