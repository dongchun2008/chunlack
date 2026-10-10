'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {performance} = require('node:perf_hooks');
const axios = require('axios');
const {workspaceFixture} = require('./helpers/workspace-fixture.cjs');
const {runWithWorkspace, requireWorkspaceContext} = require('../collaboration/context.cjs');
const {createCapacityCoordinator} = require('../collaboration/capacity.cjs');
const {createWorkspaceTaskControl} = require('../collaboration/task-control.cjs');
const {createWorkspaceModelTransport} = require('../collaboration/model-transport.cjs');
const {createWorkspaceResources} = require('../collaboration/resources.cjs');

test('two workspaces finish twenty-four complete five-agent rounds through real HTTP with one shared slot', {timeout: 20000}, async t => {
  const f = workspaceFixture(t), capacity = f.own(createCapacityCoordinator({now: f.now}));
  const tasks = f.own(createWorkspaceTaskControl({identity: f.store, capacity, now: f.now}));
  const resources = createWorkspaceResources({dataRoot: f.dir, identity: f.store, providerCatalog: [{id: 'fixture', local: true,
    grants: {[f.workspaces.a.id]: {models: ['model-a']}, [f.workspaces.b.id]: {models: ['model-b']}}}]});
  let active = 0, maxActive = 0, requestCount = 0;
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); active++; requestCount++; maxActive = Math.max(maxActive, active);
    setTimeout(() => {active--; res.writeHead(200, {'Content-Type': 'application/json'}); res.end(JSON.stringify({model: body.model, round: body.round, agent: body.agent}));}, 2);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = 'http://127.0.0.1:' + server.address().port + '/v1/chat/completions';
  const transport = createWorkspaceModelTransport({capacity, now: f.now, transport: axios,
    authorize: (provider, model) => resources.authorizeProvider(requireWorkspaceContext(), provider, model)});
  const initial = process.memoryUsage(), cpu = process.cpuUsage(), started = performance.now();
  const roundTimes = [], completions = []; let maxWorkspaceQueued = 0;
  async function rounds(user, workspace) {
    for (let round = 0; round < 12; round++) {
      const actor = f.actor(user, workspace), begin = performance.now();
      const outputs = await runWithWorkspace(actor, () => tasks.run(workspace + '-round-' + round, () => Promise.all(
        Array.from({length: 5}, (_, agent) => transport.request({providerId: 'fixture', modelId: 'model-' + workspace,
          kind: 'model.generate', method: 'post', url, data: {model: 'model-' + workspace, round, agent}, options: {timeout: 2500}}
        ).then(response => {
          maxWorkspaceQueued = Math.max(maxWorkspaceQueued, capacity.status(actor.workspaceId).queued);
          return response.data;
        }))
      ), {limits: {maxSteps: 5, maxDepth: 1, timeoutMs: 60000}}));
      // Count a round only after all five distinct agents returned matching data.
      assert.equal(outputs.length, 5);
      assert.deepEqual(outputs.map(output => output.agent).sort((a, b) => a - b), [0, 1, 2, 3, 4]);
      assert.ok(outputs.every(output => output.round === round && output.model === 'model-' + workspace));
      completions.push({workspace, round}); roundTimes.push(performance.now() - begin);
    }
  }
  await Promise.all([rounds('alice', 'a'), rounds('bob', 'b')]);
  assert.equal(completions.length, 24); assert.equal(requestCount, 120); assert.equal(maxActive, 1);
  assert.equal(new Set(completions.map(item => item.workspace + ':' + item.round)).size, 24);
  for (const workspace of ['a', 'b']) {
    assert.equal(completions.filter(item => item.workspace === workspace).length, 12);
    assert.equal(capacity.status(f.workspaces[workspace].id).active, 0); assert.equal(capacity.status(f.workspaces[workspace].id).queued, 0);
  }
  assert.ok(maxWorkspaceQueued <= 20);
  roundTimes.sort((a, b) => a - b);
  const usage = process.cpuUsage(cpu), final = process.memoryUsage();
  t.diagnostic(JSON.stringify({measurement: 'local-mock-http-not-vps-real-model', humanConnections: 0, workspaces: 2,
    agentsPerRound: 5, completedRounds: completions.length, modelRequests: requestCount, failedRounds: 0,
    maxActiveModelHTTP: maxActive, maxWorkspaceQueued, durationMs: Math.round(performance.now() - started),
    roundP95Ms: Math.round(roundTimes[Math.ceil(roundTimes.length * .95) - 1]), cpuMs: Math.round((usage.user + usage.system) / 1000),
    rssMiB: Math.round(final.rss / 1048576), rssDeltaMiB: Math.round((final.rss - initial.rss) / 1048576)}));
});
