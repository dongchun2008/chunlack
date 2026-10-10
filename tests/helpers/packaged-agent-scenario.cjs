'use strict';
// Actual packaged service + verified TLS. Models and idle nodes are synthetic.
const assert = require('node:assert/strict');
const http = require('node:http');
const {setTimeout: delay} = require('node:timers/promises');
const {createPackagedIngressFixture} = require('./packaged-ingress-fixture.cjs');
async function createPackagedAgentScenario({caddyBin, mockDelayMs = 20} = {}) {
  if (!Number.isInteger(mockDelayMs) || mockDelayMs < 0 || mockDelayMs > 500) throw new Error('invalid_mock_delay');
  const start = Date.now(), cpuStart = process.cpuUsage(), timers = new Set(), durations = [];
  const metrics = {completedRounds: 0, failedRounds: 0, privacyFailures: 0, mainModelRequests: 0, totalGenerationRequests: 0, maxActiveModelHTTP: 0};
  const state = {A: {next: 0, last: 0}, B: {next: 0, last: 0}};
  let fixture, closed = false, active = 0, peakRss = process.memoryUsage().rss;
  const mock = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const route = /^\/([ab])\/v1\/(models|chat\/completions)$/.exec(req.url || '');
    if (!route) {res.writeHead(404); res.end('{}'); return;}
    const key = route[1].toUpperCase();
    if (req.method === 'GET' && route[2] === 'models') {
      res.end(JSON.stringify({data: Array.from({length: 5}, (_, i) => ({id: `model-${route[1]}-${i}`}))})); return;
    }
    if (req.method !== 'POST' || route[2] !== 'chat/completions') {res.writeHead(405); res.end('{}'); return;}
    let body = '', bytes = 0;
    req.on('data', chunk => {bytes += chunk.length; if (bytes > 262144) req.destroy(); else body += chunk;});
    req.on('error', () => {});
    req.on('end', () => {
      try {
        const input = JSON.parse(body), text = JSON.stringify(input), index = Number(String(input.model).slice(-1));
        if (!Number.isInteger(index) || index < 0 || index > 4 || input.model !== `model-${route[1]}-${index}`) throw new Error('model_binding_denied');
        if (text.includes('SOAK_' + (key === 'A' ? 'B' : 'A') + '_') || text.includes('SOAK_RESULT_' + (key === 'A' ? 'B' : 'A') + '_')) {metrics.privacyFailures++; throw new Error('workspace_prompt_leak');}
        const last = input.messages?.at(-1)?.content;
        const main = typeof last === 'string' && /\nRespond as SOAK_([AB])_([0-4])\. Keep brief\.$/.exec(last);
        let content = 'Synthetic bounded auxiliary response.';
        if (main) {
          assert.equal(main[1], key); assert.equal(Number(main[2]), index);
          const round = state[key].current;
          if (!round || round.models.has(index)) throw new Error('unexpected_or_duplicate_main_call');
          round.models.add(index); round.requests++; metrics.mainModelRequests++;
          content = `SOAK_RESULT_${key}_r${round.index}_m${index}`;
        }
        metrics.totalGenerationRequests++; active++; metrics.maxActiveModelHTTP = Math.max(metrics.maxActiveModelHTTP, active);
        let settled = false;
        const settle = () => {if (!settled) {settled = true; active--;}};
        res.once('finish', settle); res.once('close', settle);
        const timer = setTimeout(() => {timers.delete(timer); if (!res.destroyed) res.end(JSON.stringify({choices: [{message: {content}}]}));}, mockDelayMs);
        timers.add(timer);
      } catch (error) {state[key].error = error; res.writeHead(400); res.end(JSON.stringify({error: 'synthetic_model_contract_rejected'}));}
    });
  });
  async function close() {
    if (closed) return; closed = true;
    const errors = [];
    try {if (fixture) await fixture.close();} catch (error) {errors.push(error);}
    for (const timer of timers) clearTimeout(timer);
    timers.clear(); mock.closeAllConnections();
    if (mock.listening) await new Promise(resolve => mock.close(resolve));
    if (errors.length) throw new AggregateError(errors, 'agent_scenario_cleanup_failed');
  }
  async function until(predicate, label, milliseconds = 45000) {
    const end = Date.now() + milliseconds;
    while (Date.now() < end) {
      for (const value of Object.values(state)) if (value.error) throw value.error;
      if (closed) throw new Error('scenario_closed');
      const result = await predicate(); if (result) return result;
      peakRss = Math.max(peakRss, process.memoryUsage().rss); await delay(25);
    }
    throw new Error('agent_acceptance_timeout:' + label);
  }
  try {
    await new Promise((resolve, reject) => {mock.once('error', reject); mock.listen(0, '127.0.0.1', resolve);});
    const models = key => Array.from({length: 5}, (_, i) => `model-${key.toLowerCase()}-${i}`);
    fixture = await createPackagedIngressFixture({caddyBin, threeHumans: true, configure: ({config, workspaceId, otherWorkspaceId}) => {
      config.llmProvider = 'soak-a'; config.defaultModel = 'model-a-0';
      config.llmProviders = ['A', 'B'].map(key => ({id: 'soak-' + key.toLowerCase(), local: true, requiresApiKey: false,
        baseUrl: `http://127.0.0.1:${mock.address().port}/${key.toLowerCase()}/v1`, models: models(key)}));
      config.workspaceModelGrants = {[workspaceId]: {'soak-a': {models: models('A')}}, [otherWorkspaceId]: {'soak-b': {models: models('B')}}};
    }});
    const owner = await fixture.login(), other = await fixture.login(fixture.accounts.other), viewer = await fixture.login(fixture.accounts.viewer);
    const ids = {A: fixture.workspaceId, B: fixture.otherWorkspaceId}, auths = {A: owner, B: other};
    async function request(key, route, options = {}) {
      const response = await fixture.request('web', route, {...options, headers: {Origin: fixture.webOrigin, Cookie: auths[key].cookie,
        'X-CSRF-Token': auths[key].csrfToken, 'X-Workspace-Id': ids[key], ...options.headers}});
      assert.equal(response.status, options.expected || 200, 'human HTTPS status ' + route); return JSON.parse(response.text);
    }
    async function peer(key, auth) {
      const socket = await fixture.connect({cookie: auth.cookie, workspaceId: ids[key]}), frames = [];
      socket.on('message', raw => {
        const frame = JSON.parse(raw), text = JSON.stringify(frame), foreign = key === 'A' ? 'B' : 'A';
        if (text.includes('SOAK_' + foreign + '_') || text.includes('SOAK_RESULT_' + foreign + '_')) metrics.privacyFailures++;
        frames.push(frame); if (frames.length > 128) frames.shift();
      });
      socket.send(JSON.stringify({type: 'join', channelId: 'general'}));
      await until(() => frames.find(frame => frame.type === 'history'), 'joined history'); return {socket, frames};
    }
    const peers = {A: await peer('A', owner), B: await peer('B', other)};
    await peer('B', viewer);
    for (const key of ['A', 'B']) {
      state[key].names = [];
      for (let i = 0; i < 5; i++) {
        const name = `SOAK_${key}_${i}`;
        peers[key].socket.send(JSON.stringify({type: 'spawn_agent', name, model: models(key)[i], provider: 'soak-' + key.toLowerCase(), systemPrompt: 'Synthetic bounded acceptance. No tools or follow-up tasks.', channels: ['general']}));
        const confirmation = await until(() => peers[key].frames.find(frame => frame.type === 'spawn_confirm' && frame.agent?.name === name), 'spawn ' + name);
        assert.equal(confirmation.agent.model, models(key)[i]); assert.equal(confirmation.agent.provider, 'soak-' + key.toLowerCase()); state[key].names.push(name);
      }
    }
    for (let i = 0; i < 5; i++) {
      const key = i < 4 ? 'A' : 'B';
      const created = await request(key, '/api/nodes', {method: 'POST', expected: 201, json: {name: 'Synthetic idle node ' + i, capabilities: ['browser.public_read'], scopes: ['public']}});
      const paired = await fixture.request('agents', `/v1/workspaces/${ids[key]}/pair`, {method: 'POST', json: {code: created.pairingCode}});
      assert.equal(paired.status, 200, 'actual node pairing');
      const credentials = JSON.parse(paired.text);
      const manifest = await fixture.request('agents', '/v1/manifest', {headers: {Authorization: 'Bearer ' + credentials.token, 'X-Workspace-Id': ids[key]}});
      assert.equal(manifest.status, 200, 'paired scoped manifest');
      assert.equal(JSON.parse(manifest.text).workspaceId, ids[key]);
    }
    async function round(key, index) {
      if (!state[key] || !Number.isInteger(index) || index !== state[key].next || state[key].current) throw new Error('round_replay_denied');
      const slot = state[key]; slot.current = {index, models: new Set(), requests: 0};
      try {
        if (slot.last) await delay(Math.max(0, slot.last + 2350 - Date.now()));
        const begin = Date.now(), before = new Set((await request(key, '/api/tasks')).localTasks.map(task => task.taskId));
        peers[key].socket.send(JSON.stringify({type: 'message', channelId: 'general', content: '/ground'}));
        await until(() => slot.names.every((name, i) => peers[key].frames.some(frame => frame.type === 'new_message' && JSON.stringify(frame).includes(name) && JSON.stringify(frame).includes(`SOAK_RESULT_${key}_r${index}_m${i}`))), 'five actual replies ' + key);
        assert.equal(slot.current.models.size, 5); assert.equal(slot.current.requests, 5);
        const completed = await until(async () => {
          const records = (await request(key, '/api/tasks')).localTasks.filter(task => !before.has(task.taskId));
          if (!records.length) return false;
          if (records.some(task => !['running', 'completed'].includes(task.state))) throw new Error('round_task_not_completed');
          return records.every(task => task.state === 'completed' && task.activeBranches === 0) && active === 0 ? records : false;
        }, 'actual task settlement ' + key);
        assert.equal(metrics.privacyFailures, 0, 'workspace isolation');
        const durationMs = Date.now() - begin; durations.push(durationMs); if (durations.length > 1000) durations.shift();
        metrics.completedRounds++; slot.next++; slot.last = Date.now();
        return {workspace: key, round: index, agentReplies: 5, mainModelRequests: 5, completedTaskRecords: completed.length, durationMs};
      } catch (error) {metrics.failedRounds++; throw error;} finally {slot.current = null;}
    }
    function report() {
      const cpu = process.cpuUsage(cpuStart), sorted = durations.slice().sort((a, b) => a - b);
      return {measurement: 'packaged-https-wss-synthetic-models-not-production', ...metrics, humanSessions: 3, workspaces: 2, registeredNodes: 5,
        agentsPerWorkspace: 5, nodesExecutedTasks: 0, roundsByWorkspace: {A: state.A.next, B: state.B.next}, durationMs: Date.now() - start,
        cpuMs: (cpu.user + cpu.system) / 1000, testProcessPeakRssMiB: peakRss / 1048576, roundP95Ms: sorted[Math.ceil(sorted.length * .95) - 1] || 0};
    }
    return {round, report, close};
  } catch (error) {try {await close();} catch (cleanup) {throw new AggregateError([error, cleanup], 'scenario_initialization_cleanup_failed');} throw error;}
}
module.exports = {createPackagedAgentScenario};
