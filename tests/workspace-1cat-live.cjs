'use strict';
// Explicitly enabled live verification, not a normal CI/network test.
// This extracts the same embedded Provider/workspace code used by the existing
// contract tests. It is not a full HTTP/Agent/browser acceptance test.
// The fixture transport caps outgoing generation to eight tokens; this does
// not assert that the product's default generation cap is eight tokens.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const {workspaceFixture} = require('./helpers/workspace-fixture.cjs');
const {runWithWorkspace} = require('../collaboration/context.cjs');
const {createWorkspaceStateRegistry} = require('../collaboration/state.cjs');
const {createWorkspaceResources} = require('../collaboration/resources.cjs');
const {createCapacityCoordinator} = require('../collaboration/capacity.cjs');

const enabled = process.env.CHUNLACK_REAL_1CAT_TEST === '1';
const expectedBase = 'http://100.72.70.102:8080/v1';
const model = 'qwen38-27b-nvfp4';

test('live 1Cat Provider honors workspace grants and viewer denial before real transport', {skip: !enabled}, async t => {
  assert.equal(process.env.CHUNLACK_REAL_1CAT_BASE_URL, expectedBase,
    'Explicitly confirm the already identified private model route');
  const root = path.resolve(__dirname, '..');
  const source = JSON.parse(execFileSync(process.env.PYTHON || 'python', ['-c',
    'import json,runpy; print(json.dumps(runpy.run_path("scripts/materialize.py")["embedded_sources"]()))'
  ], {cwd: root, encoding: 'utf8', timeout: 20000})).SERVER_JS;
  function section(start, end) {
    const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
    assert.ok(a >= 0 && b > a, 'Embedded source boundary: ' + start);
    return source.slice(a, b);
  }
  const f = workspaceFixture(t);
  f.store.setMembership(f.actor('alice', 'a'), {
    workspaceId: f.workspaces.a.id, userId: f.users.carol.id, role: 'viewer'
  });
  const registry = createWorkspaceStateRegistry({identity: f.store});
  const capacity = createCapacityCoordinator();
  t.after(() => registry.close());
  t.after(() => capacity.close());
  const resources = createWorkspaceResources({dataRoot: f.dir, identity: f.store,
    providerCatalog: [{id: 'onecat', name: '1Cat private router', local: true,
      models: [model], grants: {[f.workspaces.a.id]: {models: [model]}}}]});
  const services = {identity: f.store, registry, resources, capacity};
  t.after(() => services.taskControl?.close());
  const config = {llmProvider: 'onecat', embeddingProvider: 'none',
    fallbackModels: [], llmCloudProviders: [],
    llmProviders: [{id: 'onecat', local: true, requiresApiKey: false,
      baseUrl: expectedBase, models: [model], fallbackModels: [], timeoutMs: 15000}]};
  const actualAxios = require('axios');
  const calls = [], logs = [];
  let generation = null;
  function guard(url, options) {
    assert.ok(url === expectedBase + '/models' || url === expectedBase + '/chat/completions');
    assert.ok(calls.length < 2, 'No additional retry/fallback network requests');
    const headers = options?.headers || {};
    assert.ok(!Object.keys(headers).some(k => k.toLowerCase() === 'authorization'),
      'Do not reuse an unrelated credential');
    return {...options, proxy: false, maxRedirects: 0, timeout: 15000,
      maxContentLength: 65536, maxBodyLength: 16384};
  }
  const transport = {
    async get(url, options) {
      const bounded = guard(url, options);
      calls.push({method: 'GET', path: '/models'});
      return actualAxios.get(url, bounded);
    },
    async post(url, body, options) {
      const bounded = guard(url, options);
      assert.equal(body.model, model);
      assert.equal(body.stream, false);
      const outgoing = {...body, max_tokens: 8};
      calls.push({method: 'POST', path: '/chat/completions', model, maxTokens: 8});
      const started = Date.now();
      const response = await actualAxios.post(url, outgoing, bounded);
      generation = {httpStatus: response.status, elapsedMs: Date.now() - started,
        returnedModel: response.data.model, usage: response.data.usage};
      assert.equal(response.data.model, model);
      return response;
    }
  };
  const context = vm.createContext({config, process: {env: {LACK_MULTI_USER: '1'}},
    URL, path, fs, __dirname: f.dir, require, setTimeout, clearTimeout,
    workspaceRuntimeServices: services, axios: transport,
    console: {log: x => logs.push(String(x)), warn() {}, error() {}},
    logError: x => logs.push(JSON.stringify(x)), updateAgentMetrics() {},
    broadcastAgents() {}, JSPACE_ENABLED: false});
  context.require = name => require(name.startsWith('./') ? '../' + name.slice(2) : name);
  const api = vm.runInContext([
    section('const PORT =', 'const RESEARCH_DIR ='),
    section('var workspaceRuntimeServices;', "\nif (typeof process !== 'undefined' && process.env?.LACK_MULTI_USER === '1')"),
    "const agents = workspaceMap('agents'); const agentMemories = workspaceMap('agentMemories'); const maintenanceCircuit = workspaceMap('maintenanceCircuit');",
    section('const embeddingCache =', '// ==================== SEARCH PROVIDERS'),
    section('function simpleTfidfSimilarity', 'async function scanAndReindexTemplates'),
    section('const ollamaSemaphore =', 'async function agentRespond'),
    section('let ollamaCircuitOpen =', 'function extractCodeBlocks'),
    '({queryOllama, workspaceModelList, workspaceServices})'
  ].join('\n'), context);

  await runWithWorkspace(f.actor('alice', 'a'), async () => {
    assert.deepEqual(Array.from(await api.workspaceModelList('onecat')), [model]);
    vm.runInContext("agents.set('live-pilot', {id: 'live-pilot', provider: 'onecat'})", context);
    assert.equal((await api.queryOllama(model, 'Reply with exactly OK.', '', 0, 'live-pilot')).trim(), 'OK');
  });
  assert.equal(calls.length, 2);
  assert.equal(generation.httpStatus, 200);
  assert.ok(generation.usage.completion_tokens <= 8);

  await runWithWorkspace(f.actor('bob', 'b'), async () => {
    await assert.rejects(() => api.workspaceModelList('onecat'), e => e.code === 'model_not_authorized');
    vm.runInContext("agents.set('blocked-pilot', {id: 'blocked-pilot', provider: 'onecat'})", context);
    assert.match(await api.queryOllama(model, 'Must never reach the model.', '', 0, 'blocked-pilot'), /not authorized/);
  });
  await runWithWorkspace(f.actor('carol', 'a'), async () => {
    vm.runInContext("agents.set('viewer-pilot', {id: 'viewer-pilot', provider: 'onecat'})", context);
    assert.match(await api.queryOllama(model, 'Must never reach the model.', '', 0, 'viewer-pilot'), /not authorized/);
  });
  await runWithWorkspace(f.actor('alice', 'a'), async () => {
    assert.match(await api.queryOllama('not-granted-model', 'Must never reach the model.', '', 0, 'live-pilot'), /not authorized/);
  });
  assert.equal(calls.length, 2, 'All authorization denials precede HTTP transport');
  assert.ok(logs.every(x => !x.includes('Reply with exactly OK.') && !x.includes('Must never reach the model.')));
  t.diagnostic(JSON.stringify({baseUrl: expectedBase, model, calls, generation,
    workspaceDenial: true, viewerDenial: true, ungrantedModelDenial: true,
    promptNotLogged: true, fullAgentAcceptance: false}));
});
