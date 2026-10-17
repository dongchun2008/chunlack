'use strict';
// Disposable accounts/data and real configured inference; no vendor-Agent claim.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const crypto = require('node:crypto');
const {setTimeout: delay} = require('node:timers/promises');
const {createPackagedIngressFixture} = require('../../../tests/helpers/packaged-ingress-fixture.cjs');
const base = process.env.CHUNLACK_REAL_PROBE_BASE;
const model = process.env.CHUNLACK_REAL_PROBE_MODEL;
const reportFile = process.env.CHUNLACK_REAL_PROBE_REPORT;
assert.ok(base && model && reportFile && process.env.CADDY_TEST_BIN);
const parsed = new URL(base);
assert.ok(['http:', 'https:'].includes(parsed.protocol));
assert.ok(!parsed.username && !parsed.password && !parsed.search && !parsed.hash);
const abort = new AbortController();
const deadline = setTimeout(() => abort.abort(new Error('acceptance_total_deadline')), 180000);
const controllers = new Set();
const metrics = {inferenceAttempts: 0, successfulInference: 0, failedInference: 0, activeInference: 0, maxActiveInference: 0};
const report = {scope: 'isolated-current-package-real-inference-not-production-or-Muse-dots',
  humans: 3, workspaces: 2, agentsInTestWorkspace: 5, maxTokensPerRequest: 64,
  maxInferenceAttempts: 32, rounds: [], productionChanged: false, openWebuiUsed: false,
  vendorAgentsVerified: false, realPocketIdLoginVerified: false, sustainedAcceptance: false};
let fixture, guard, stage = 'setup';
async function until(predicate, label, milliseconds = 40000) {
  const end = Date.now() + milliseconds;
  while (Date.now() < end) {
    abort.signal.throwIfAborted();
    const value = await predicate();
    if (value) return value;
    await delay(50, undefined, {signal: abort.signal});
  }
  throw new Error('acceptance_wait_failed:' + label);
}
async function main() {
  try {
    guard = http.createServer((request, response) => {
      if (!['/v1/models', '/v1/chat/completions'].includes(request.url)) {response.writeHead(404); response.end(); return;}
      const chunks = []; let size = 0;
      request.on('error', () => {});
      request.on('data', chunk => {size += chunk.length; if (size > 262144) request.destroy(); else chunks.push(chunk);});
      request.on('end', async () => {
        const controller = new AbortController(); controllers.add(controller);
        const timer = setTimeout(() => controller.abort(), 20000);
        let inference = false;
        try {
          let body;
          if (request.url === '/v1/chat/completions') {
            assert.equal(request.method, 'POST');
            assert.ok(metrics.inferenceAttempts < 32, 'inference_budget_exhausted');
            const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            assert.equal(input.model, model);
            body = JSON.stringify({...input, max_tokens: 64, stream: false});
            inference = true; metrics.inferenceAttempts++; metrics.activeInference++;
            metrics.maxActiveInference = Math.max(metrics.maxActiveInference, metrics.activeInference);
          } else assert.equal(request.method, 'GET');
          const upstream = await fetch(base.replace(/\/$/, '') + request.url.slice(3), {
            method: request.method, headers: {'Content-Type': 'application/json'}, body,
            signal: controller.signal, redirect: 'error'});
          assert.equal(upstream.status, 200);
          const parts = []; let bytes = 0;
          for await (const chunk of upstream.body) {bytes += chunk.length; assert.ok(bytes <= 262144); parts.push(chunk);}
          const raw = Buffer.concat(parts);
          if (inference) {
            const output = JSON.parse(raw).choices?.[0]?.message?.content;
            assert.ok(typeof output === 'string' && output.trim(), 'real_inference_content_missing');
            metrics.successfulInference++;
          }
          response.writeHead(200, {'Content-Type': 'application/json'}); response.end(raw);
        } catch {
          if (inference) metrics.failedInference++;
          if (!response.headersSent) response.writeHead(502);
          if (!response.destroyed) response.end('{"error":"bounded_real_probe_failed"}');
        } finally {
          if (inference) metrics.activeInference--;
          clearTimeout(timer); controllers.delete(controller);
        }
      });
    });
    await new Promise((resolve, reject) => {guard.once('error', reject); guard.listen(0, '127.0.0.1', resolve);});
    stage = 'packaged-TLS-startup';
    fixture = await createPackagedIngressFixture({signal: abort.signal, caddyBin: process.env.CADDY_TEST_BIN, threeHumans: true,
      configure: ({config, workspaceId}) => {
        config.llmProvider = 'real-acceptance'; config.defaultModel = model;
        config.llmProviders = [{id: 'real-acceptance', local: true, requiresApiKey: false,
          baseUrl: 'http://127.0.0.1:' + guard.address().port + '/v1', models: [model], maxTokens: 64, timeoutMs: 25000, fallbackModels: []}];
        config.workspaceModelGrants = {[workspaceId]: {'real-acceptance': {models: [model]}}};
      }});
    const owner = await fixture.login(), member = await fixture.login(fixture.accounts.other), viewer = await fixture.login(fixture.accounts.viewer);
    const headers = auth => ({Cookie: auth.cookie, Origin: fixture.webOrigin,
      'X-CSRF-Token': auth.csrfToken, 'X-Workspace-Id': fixture.workspaceId});
    for (const auth of [owner, member]) assert.equal((await fixture.request('web', '/api/llm-providers', {headers: headers(auth)})).status, 200);
    assert.equal((await fixture.request('web', '/api/llm-providers', {headers: headers(viewer)})).status, 404);
    report.crossWorkspaceViewerDenied = true;
    const socket = await fixture.connect({cookie: owner.cookie, workspaceId: fixture.workspaceId});
    const frames = [];
    socket.on('message', raw => {frames.push(JSON.parse(raw)); if (frames.length > 300) frames.shift();});
    socket.send(JSON.stringify({type: 'join', channelId: 'general'}));
    await fixture.frame(socket, item => item.type === 'history');
    const nonce = crypto.randomBytes(5).toString('hex');
    const names = Array.from({length: 5}, (_, i) => 'REAL_' + nonce + '_' + i);
    stage = 'spawn-five-agents';
    for (const name of names) {
      socket.send(JSON.stringify({type: 'spawn_agent', name, provider: 'real-acceptance', model,
        systemPrompt: 'Connectivity acceptance only. Respond briefly with your name. No tools, delegation, reflection or follow-up.', channels: ['general']}));
      await until(() => frames.find(item => item.type === 'spawn_confirm' && item.agent?.name === name), 'spawn');
    }
    for (let index = 0; index < 2; index++) {
      stage = 'five-agent-round-' + index;
      if (index) await delay(2500, undefined, {signal: abort.signal});
      const roundStart = Date.now(), frameStart = frames.length;
      const beforeResponse = await fixture.request('web', '/api/tasks', {headers: headers(owner)});
      assert.equal(beforeResponse.status, 200);
      const before = new Set(JSON.parse(beforeResponse.text).localTasks.map(item => item.taskId));
      socket.send(JSON.stringify({type: 'message', channelId: 'general', content: '/ground'}));
      const replies = await until(() => {
        const candidates = frames.slice(frameStart).filter(item => item.type === 'new_message').map(item => item.message || item.data || item);
        const matched = names.map(name => candidates.find(item => item.sender === name && item.senderType === 'agent' && typeof item.id === 'string' && typeof item.content === 'string' && item.content.trim()));
        return matched.every(Boolean) ? matched : false;
      }, 'five-real-replies');
      await until(async () => {
        const response = await fixture.request('web', '/api/tasks', {headers: headers(owner)});
        assert.equal(response.status, 200);
        const tasks = JSON.parse(response.text).localTasks.filter(item => !before.has(item.taskId));
        if (tasks.some(item => !['running', 'completed'].includes(item.state))) throw new Error('actual_task_failed');
        return tasks.length && tasks.every(item => item.state === 'completed' && item.activeBranches === 0) && metrics.activeInference === 0;
      }, 'task-settlement');
      report.rounds.push({index, agentReplies: replies.length, elapsedMs: Date.now() - roundStart,
        messages: replies.map(item => ({id: item.id, contentSha256: crypto.createHash('sha256').update(item.content).digest('hex')}))});
    }
    stage = 'isolated-runtime-restart';
    await fixture.restart();
    assert.equal((await fixture.request('web', '/api/llm-providers', {headers: headers(viewer)})).status, 404);
    const resumed = await fixture.connect({cookie: owner.cookie, workspaceId: fixture.workspaceId});
    resumed.send(JSON.stringify({type: 'join', channelId: 'general'}));
    const history = await fixture.frame(resumed, item => item.type === 'history');
    for (const round of report.rounds) for (const message of round.messages) {
      assert.ok(history.messages.some(item => item.id === message.id && crypto.createHash('sha256').update(item.content).digest('hex') === message.contentSha256));
    }
    assert.equal(metrics.failedInference, 0); assert.equal(metrics.activeInference, 0);
    assert.equal(metrics.maxActiveInference, 1);
    report.exactRepliesPersistedAfterRestart = true; report.accepted = true;
  } catch (error) {
    report.accepted = false; report.failedStage = stage; report.errorCode = error.code || error.name;
    report.errorLabel = String(error.message).split('\n')[0].slice(0, 160); process.exitCode = 1;
  } finally {
    clearTimeout(deadline);
    try {if (fixture) await fixture.close(); report.fixtureClosed = true;} catch {report.cleanupFailed = true; report.accepted = false; process.exitCode = 1;}
    for (const controller of controllers) controller.abort();
    if (guard) {guard.closeAllConnections(); if (guard.listening) await new Promise(resolve => guard.close(resolve));}
    report.metrics = metrics;
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), {flag: 'wx', mode: 0o600});
    console.log('REAL_FIVE_AGENT_REPORT=' + JSON.stringify(report));
  }
}
main().catch(() => {process.exitCode = 1;});
