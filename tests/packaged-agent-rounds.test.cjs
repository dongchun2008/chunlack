'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const caddyBin = process.env.CADDY_TEST_BIN;

test('actual packaged HTTPS/WSS completes four distinct five-agent rounds with three humans, two workspaces and five registered nodes', {skip: !caddyBin, timeout: 60000}, async t => {
  const {createPackagedAgentScenario} = require('./helpers/packaged-agent-scenario.cjs');
  const scenario = await createPackagedAgentScenario({caddyBin, mockDelayMs: 10}); t.after(() => scenario.close());
  for (let round = 0; round < 2; round++) {
    const results = await Promise.all([scenario.round('A', round), scenario.round('B', round)]);
    for (const result of results) {
      assert.equal(result.agentReplies, 5); assert.equal(result.mainModelRequests, 5);
      assert.ok(result.completedTaskRecords > 0);
    }
  }
  const report = scenario.report();
  assert.equal(report.completedRounds, 4); assert.equal(report.mainModelRequests, 20);
  assert.equal(report.humanSessions, 3); assert.equal(report.workspaces, 2); assert.equal(report.registeredNodes, 5);
  assert.equal(report.maxActiveModelHTTP, 1); assert.equal(report.privacyFailures, 0); assert.equal(report.failedRounds, 0);
  assert.equal(report.measurement, 'packaged-https-wss-synthetic-models-not-production');
  await assert.rejects(scenario.round('A', 1), /round_replay_denied/);
  t.diagnostic(JSON.stringify(report));
});

test('scenario rejects invalid model delay before opening its own services', async () => {
  const {createPackagedAgentScenario} = require('./helpers/packaged-agent-scenario.cjs');
  await assert.rejects(createPackagedAgentScenario({mockDelayMs: -1}), /invalid_mock_delay/);
  await assert.rejects(createPackagedAgentScenario({mockDelayMs: 501}), /invalid_mock_delay/);
});

test('standalone agent soak refuses oversized duration before opening listeners', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'workspace-agent-soak.cjs'), '--duration-ms', '1800001'], {encoding: 'utf8', timeout: 5000, windowsHide: true});
  assert.equal(result.status, 1); assert.match(result.stderr, /soak_invalid_duration/);
});
