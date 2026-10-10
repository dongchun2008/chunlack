'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const {workspaceFixture, throwsCode} = require('./helpers/workspace-fixture.cjs');
const {runWithWorkspace} = require('../collaboration/context.cjs');
const {createWorkspaceStateRegistry} = require('../collaboration/state.cjs');
const {createWorkspaceResources} = require('../collaboration/resources.cjs');
const source = JSON.parse(execFileSync(process.env.PYTHON || 'python', ['-c', 'import json,runpy; print(json.dumps(runpy.run_path("scripts/materialize.py")["embedded_sources"]()))'], {cwd: path.resolve(__dirname, '..'), encoding: 'utf8'})).SERVER_JS;
function section(start, end) {const a = source.indexOf(start), b = source.indexOf(end, a + start.length); assert.ok(a >= 0 && b > a, start); return source.slice(a, b);}
function setup(t) {
  const f = workspaceFixture(t);
  const providerCatalog = [
    {id: 'ollama', name: 'Ollama', local: true, models: ['local', 'backup'], credentialRef: '/private/config', grants: {[f.workspaces.a.id]: {models: ['local']}}},
    {id: 'cloud', name: 'Cloud', local: false, models: ['remote', 'backup'], apiKey: 'synthetic-private-key', grants: {[f.workspaces.a.id]: {models: ['remote']}, [f.workspaces.b.id]: {models: ['backup']}}}
  ];
  return {...f, providerCatalog, resources: createWorkspaceResources({dataRoot: f.dir, identity: f.store, providerCatalog})};
}

test('model catalog shows exact workspace grants without endpoint or credential references', t => {
  const f = setup(t);
  for (const [user, workspace, expected] of [['alice', 'a', ['ollama', 'cloud']], ['bob', 'b', ['cloud']]]) runWithWorkspace(f.actor(user, workspace), () => {
    const actor = f.actor(user, workspace), list = f.resources.listProviders(actor);
    assert.deepEqual(list.map(p => p.id), expected);
    const text = JSON.stringify(list);
    assert.ok(!text.includes('private') && !text.includes('credential') && !text.includes('apiKey'));
    assert.deepEqual(f.resources.filterModels(actor, 'cloud', ['remote', 'backup', 'other']), workspace === 'a' ? ['remote'] : ['backup']);
    throwsCode(() => f.resources.authorizeProvider(actor, 'cloud', 'other'), 'model_not_authorized');
    throwsCode(() => f.resources.authorizeProvider(actor, 'unknown', 'remote'), 'model_not_authorized');
  });
});

test('workspace owner is not platform model administrator and grants are immutable snapshots', t => {
  const f = setup(t);
  f.providerCatalog[0].grants[f.workspaces.b.id] = {models: ['local']};
  runWithWorkspace(f.actor('bob', 'b'), () => throwsCode(() => f.resources.authorizeProvider({...f.actor('bob', 'b'), platformAdmin: true}, 'ollama', 'local'), 'model_not_authorized'));
  runWithWorkspace(f.actor('alice', 'a'), () => {
    const summary = f.resources.authorizeProvider(f.actor('alice', 'a'), 'cloud', 'remote');
    assert.equal(Object.isFrozen(summary), true);
    assert.equal(summary.apiKey, undefined);
    throwsCode(() => f.resources.authorizeProvider(f.actor('alice', 'a'), 'cloud', 'remote', {localOnly: true}), 'model_not_authorized');
  });
});

function runtime(t, f, overrides = {}, failPrimary = false) {
  const calls = [], logs = [], registry = createWorkspaceStateRegistry({identity: f.store}); t.after(() => registry.close());
  const capacity = require('../collaboration/capacity.cjs').createCapacityCoordinator();
  t.after(() => capacity.close());
  const config = {llmProvider: 'ollama', fallbackModels: ['backup'], embeddingProvider: 'none', llmCloudProviders: [{id: 'cloud', baseUrl: 'https://models.example/v1', apiKeyEnv: 'TEST_KEY', fallbackModels: ['backup']}], ...overrides};
  const context = vm.createContext({
    config, process: {env: {TEST_KEY: 'synthetic-private-key', LACK_MULTI_USER: '1'}}, URL, path, fs, __dirname: f.dir,
    require, workspaceRuntimeServices: {identity: f.store, registry, resources: f.resources, capacity},
    console: {log: x => logs.push(x), warn() {}, error() {}}, setTimeout, clearTimeout,
    axios: {async get(...a) {calls.push(['GET', ...a]); return {data: {models: [{name: 'local'}, {name: 'backup'}], data: [{id: 'remote'}, {id: 'backup'}]}};}, async post(...a) {calls.push(['POST', ...a]); if (failPrimary && a[1].model === 'local') throw {retryable: false}; return {data: {response: 'local reply', choices: [{message: {content: 'cloud reply'}}], embedding: [1, 0]}};}},
    logError: x => logs.push(JSON.stringify(x)), updateAgentMetrics() {}, broadcastAgents() {}, JSPACE_ENABLED: false
  });
  // Resolve embedded relative modules against the repository, not this test's directory.
  context.require = name => require(name.startsWith('./') ? '../' + name.slice(2) : name);
  const api = vm.runInContext([
    section('const PORT =', 'const RESEARCH_DIR ='),
    section('var workspaceRuntimeServices;', "\nif (typeof process !== 'undefined' && process.env?.LACK_MULTI_USER === '1')"),
    "const agents = workspaceMap('agents'); const agentMemories = workspaceMap('agentMemories'); const maintenanceCircuit = workspaceMap('maintenanceCircuit');",
    section('const embeddingCache =', '// ==================== SEARCH PROVIDERS'),
    section('function simpleTfidfSimilarity', 'async function scanAndReindexTemplates'),
    section('const ollamaSemaphore =', 'async function agentRespond'),
    section('let ollamaCircuitOpen =', 'function extractCodeBlocks'),
    section('function securePath(', 'const SKILLS_DIR'),
    "const summary = workspaceSummary({enabled: true, summary: 'legacy-only'}); const PUBLIC_MEMORY_SUMMARY = summary;",
    section('async function updatePublicMemorySummary(', 'function getPublicMemorySummary('),
    section('async function runMaintenanceTask(', 'async function scheduleMemoryMaintenance('),
    section('async function executeAction(', 'async function agentPlanAndAct('),
    '({queryOllama, getEmbedding, getCachedEmbedding, setCachedEmbedding, workspaceModelList, workspaceProviderList, workspaceSetting, workspaceLazyMap, summary, executeTool, executeAction, persistWorkspaceResearch, scheduleWorkspaceMaintenance, workspaceServices})'
  ].join('\n'), context);
  return {api, calls, logs, context};
}

test('embedded primary and every fallback check workspace model grants before transport', async t => {
  const f = setup(t);
  const r = runtime(t, f, {workspaceSettings: {[f.workspaces.a.id]: {agentRouting: {a: {allowCloudFallback: true, fallback: {provider: 'cloud', model: 'remote'}}}}}}, true);
  await runWithWorkspace(f.actor('alice', 'a'), async () => {
    vm.runInContext("agents.set('a', {id: 'a', provider: 'ollama'})", r.context);
    assert.equal(await r.api.queryOllama('local', 'private task', '', .7, 'a'), 'cloud reply');
    assert.deepEqual(r.calls.filter(c => c[0] === 'POST').map(c => c[2].model), ['local', 'remote']);
    assert.ok(r.logs.every(x => !String(x).includes('private task') && !String(x).includes('synthetic-private-key')));
  });
  const before = r.calls.length;
  await runWithWorkspace(f.actor('bob', 'b'), async () => {
    vm.runInContext("agents.set('a', {id: 'a', provider: 'ollama'})", r.context);
    // An unauthorized primary cannot leak its prompt via a permitted fallback.
    assert.match(await r.api.queryOllama('local', 'private task', '', .7, 'a'), /not authorized/);
  });
  assert.equal(r.calls.length, before);
});
test('root step exhaustion propagates through provider fallback instead of becoming a successful agent error-string reply', async t => {
  const f = setup(t);
  const r = runtime(t, f, {workspaceSettings: {[f.workspaces.a.id]: {agentRouting: {a: {allowCloudFallback: true, fallback: {provider: 'cloud', model: 'remote'}}}}}}, true);
  await runWithWorkspace(f.actor('alice', 'a'), async () => {
    vm.runInContext("agents.set('a', {id: 'a', provider: 'ollama'})", r.context);
    await assert.rejects(() => r.api.workspaceServices().capacity.withTaskScope({workspaceId: f.workspaces.a.id, taskId: 'bounded-fallback', createdBy: f.users.alice.id, maxSteps: 1, deadlineAt: Date.now() + 10000}, () => r.api.queryOllama('local', 'synthetic-private-task', '', .7, 'a')), error => error.code === 'task_step_budget');
    assert.deepEqual(r.calls.filter(call => call[0] === 'POST').map(call => call[2].model), ['local']);
  });
});
test('cloud response authorization loss remains a task failure and cannot be swallowed by retry or fallback', async t => {
  const f = setup(t), r = runtime(t, f);
  f.store.setMembership(f.actor('alice', 'a'), {workspaceId: f.workspaces.a.id, userId: f.users.bob.id, role: 'owner'});
  r.context.axios.post = async (...args) => {
    r.calls.push(['POST', ...args]);
    f.store.setMembership(f.actor('bob', 'a'), {workspaceId: f.workspaces.a.id, userId: f.users.alice.id, role: 'viewer'});
    return {data: {choices: [{message: {content: 'must-not-be-returned'}}]}};
  };
  await runWithWorkspace(f.actor('alice', 'a'), async () => {
    vm.runInContext("agents.set('a', {id: 'a', provider: 'cloud'})", r.context);
    await assert.rejects(() => r.api.queryOllama('remote', 'private cloud fixture', '', .7, 'a'), error => error.code === 'forbidden');
  });
  assert.equal(r.calls.filter(call => call[0] === 'POST').length, 1);
});

test('viewer may see granted model metadata but cannot generate; cached J-space and agent tool actions remain scoped', async t => {
  const f = setup(t), r = runtime(t, f), cache = r.api.workspaceLazyMap('jspace');
  await runWithWorkspace(f.actor('carol', 'b'), async () => {
    assert.deepEqual(Array.from(f.resources.authorizeProvider(f.actor('carol', 'b'), 'cloud').models), ['backup']);
    vm.runInContext("agents.set('viewer-agent', {id: 'viewer-agent', provider: 'cloud'})", r.context);
    assert.match(await r.api.queryOllama('backup', 'must not be sent', '', .7, 'viewer-agent'), /not authorized/);
  });
  assert.equal(r.calls.length, 0);
  await runWithWorkspace(f.actor('alice', 'a'), async () => {
    cache.set('identical text', {a: 1}); assert.deepEqual(cache.get('identical text'), {a: 1});
    assert.equal((await r.api.executeAction({id: 'moderator'}, 'general', {type: 'tool', payload: {command: 'must never run'}})).error, 'public_tools_disabled');
  });
  runWithWorkspace(f.actor('bob', 'a'), () => assert.equal(cache.get('identical text'), undefined));
  runWithWorkspace(f.actor('bob', 'b'), () => assert.equal(cache.get('identical text'), undefined));
});

test('research roles and routing defaults never inherit another workspace or legacy global config', t => {
  const f = setup(t), r = runtime(t, f, {researchAgentId: 'global-agent', researchRoles: {retriever: 'global'}, agentRouting: {a: {localOnly: true}}, workspaceSettings: {[f.workspaces.a.id]: {researchAgentId: 'a-retriever'}}});
  runWithWorkspace(f.actor('alice', 'a'), () => {
    assert.equal(r.api.workspaceSetting('researchAgentId', 'legacy'), 'a-retriever');
    assert.equal(r.api.workspaceSetting('researchRoles', {retriever: 'global'}), undefined);
  });
  runWithWorkspace(f.actor('bob', 'b'), () => {
    assert.equal(r.api.workspaceSetting('researchAgentId', 'legacy'), undefined);
    assert.equal(r.api.workspaceSetting('agentRouting', {a: {localOnly: true}}), undefined);
  });
});

test('actual summary, public tools and workspace maintenance never use global memory or shell permission', async t => {
  const f = setup(t), r = runtime(t, f, {multiUser: {maintenanceEnabled: true}});
  const intervals = [], pruned = [];
  r.context.setInterval = fn => {intervals.push(fn); return {unref() {}};};
  r.context.pruneAgentMemory = async id => {pruned.push(id);};
  await runWithWorkspace(f.actor('alice', 'a'), async () => {
    assert.equal(r.api.summary.enabled, false);
    r.api.summary.summary = 'a-private-memory'; r.api.summary.enabled = true;
    vm.runInContext("agents.set('moderator', {id: 'moderator'})", r.context);
    vm.runInContext("agentMemories.set('moderator', {ePool: [{trajectory: 'A acquired evidence', score: 1}]})", r.context);
    assert.match(await r.api.executeTool('read_file', {path: '../config/key'}, 'moderator'), /disabled/);
    r.context.process.env.LACK_ALLOW_SHELL = 'true';
    assert.match(await r.api.executeTool('execute_command', {command: 'must never run'}, 'moderator'), /disabled/);
    r.api.scheduleWorkspaceMaintenance(f.actor('alice', 'a'));
  });
  runWithWorkspace(f.actor('bob', 'b'), () => {assert.equal(r.api.summary.summary, ''); assert.equal(r.api.summary.enabled, false);});
  // Invoking the captured callback outside ALS must still prune only workspace A.
  await intervals[0](); assert.deepEqual(pruned, ['moderator']);
  runWithWorkspace(f.actor('alice', 'a'), () => assert.match(r.api.summary.summary, /A acquired evidence/));
  runWithWorkspace(f.actor('bob', 'b'), () => assert.equal(r.api.summary.summary, ''));
  assert.equal(r.calls.length, 0);
});

test('actual research persistence retains URL and excerpt, reloads sessions and refuses source substitution', t => {
  const f = setup(t), r = runtime(t, f);
  const db = new (require('better-sqlite3'))(':memory:');
  const store = require('../collaboration/store.cjs').createCollaborationStore({db, identity: f.store});
  t.after(() => {store.close(); db.close();});
  r.api.workspaceServices().store = store;
  const session = {id: 'same-session', topic: 'Original research', sources: [{sourceId: 'S1', url: 'https://example.com/original', excerpt: ''}], evidence: [], evidenceStatus: 'insufficient_evidence'};
  runWithWorkspace(f.actor('alice', 'a'), () => {
    r.api.persistWorkspaceResearch(session);
    session.sources[0].excerpt = 'The original acquired excerpt';
    r.api.persistWorkspaceResearch(session);
    const scoped = store.forWorkspace(f.actor('alice', 'a'));
    assert.equal(scoped.getResearchSources(session.id)[0].excerpt, 'The original acquired excerpt');
    assert.equal(scoped.loadResearchSessions()[0].sources[0].url, 'https://example.com/original');
    throwsCode(() => scoped.saveResearchSource({id: 'same-session-S1', researchId: session.id, url: 'https://example.com/substituted', title: '', excerpt: 'fake'}), 'invalid_source');
    assert.equal(scoped.getResearchSources(session.id)[0].url, 'https://example.com/original');
  });
  runWithWorkspace(f.actor('bob', 'b'), () => {
    assert.equal(store.forWorkspace(f.actor('bob', 'b')).loadResearchSessions().length, 0);
    assert.equal(f.resources.readJson(f.actor('bob', 'b'), 'research/same-session.json'), null);
  });
});

test('embedded model discovery, embeddings and identical cache text are workspace/user scoped', async t => {
  const f = setup(t), r = runtime(t, f, {embeddingProvider: 'ollama', embeddingModel: 'local'});
  await runWithWorkspace(f.actor('alice', 'a'), async () => {
    assert.deepEqual(Array.from(await r.api.workspaceModelList('ollama')), ['local']);
    r.api.setCachedEmbedding('same text', [9]);
    assert.deepEqual(Array.from(r.api.getCachedEmbedding('same text')), [9]);
  });
  await runWithWorkspace(f.actor('bob', 'a'), async () => {assert.equal(r.api.getCachedEmbedding('same text'), null);});
  const before = r.calls.length;
  await runWithWorkspace(f.actor('bob', 'b'), async () => {
    assert.equal(r.api.getCachedEmbedding('same text'), null);
    assert.equal(await r.api.getEmbedding('same text'), null);
    await assert.rejects(() => r.api.workspaceModelList('ollama'), e => e.code === 'model_not_authorized');
  });
  assert.equal(r.calls.length, before);
});
