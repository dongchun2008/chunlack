'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {createRequire} = require('node:module');
const {runWithWorkspace} = require('../collaboration/context.cjs');
const {createCapacityCoordinator} = require('../collaboration/capacity.cjs');
const {createWorkspaceTaskControl} = require('../collaboration/task-control.cjs');
const {createWorkspaceModelTransport} = require('../collaboration/model-transport.cjs');
const root = path.resolve(__dirname, '..');
const source = JSON.parse(execFileSync(process.env.PYTHON || 'python', ['-c', 'import json,runpy; print(json.dumps(runpy.run_path("scripts/materialize.py")["embedded_sources"]()))'], {cwd: root, encoding: 'utf8'})).SERVER_JS;
const functions = require('./helpers/embedded-server-ast.cjs').runtimeStatements(source).filter(node => node.type === 'FunctionDeclaration');
const actor = {workspaceId: 'workspace-a', userId: 'owner-a', role: 'owner', version: 1};
const strict = {maxRequests: 20, requestTimeoutMs: 20000, allowRetry: false, allowFallback: false, allowExternal: false, serial: true};
const turn = () => new Promise(resolve => setImmediate(resolve));
function fixture(t, options = {}) {
  const capacity = createCapacityCoordinator({maxActive: options.maxActive || 1});
  t.after(() => capacity.close());
  const identity = {requireMembership: (userId, workspaceId) => ({...actor, userId, workspaceId})};
  const tasks = createWorkspaceTaskControl({identity, capacity});
  t.after(() => tasks.close());
  const transport = createWorkspaceModelTransport({capacity, authorize() {}, transport: {post: options.post || (async () => ({data: 'synthetic'})), get: async () => ({data: []})}});
  const request = (kind = 'model.generate') => transport.request({providerId: 'fixture', modelId: 'fixture', kind, method: kind === 'model.discover' ? 'get' : 'post', url: 'https://fixture.invalid/model', data: {}, options: {timeout: 30000}});
  const run = (id, fn, policy = strict) => runWithWorkspace(actor, () => tasks.run(id, fn, {limits: {maxSteps: 100, timeoutMs: 300000, ...(policy ? {modelPolicy: policy} : {})}}));
  return {capacity, tasks, transport, request, run, services: {capacity, identity, taskControl: tasks}};
}
function embedded(names, globals) {
  const selected = functions.filter(node => names.includes(node.id.name));
  const context = vm.createContext({require: createRequire(path.join(root, 'server.js')), console: {log() {}, error() {}}, setTimeout, clearTimeout, AbortController, AbortSignal, process: {env: {LACK_MULTI_USER: '1'}}, ...globals});
  vm.runInContext(selected.map(node => source.slice(...node.range)).join('\n'), context);
  return context;
}

test('the twenty-first actual inference never reaches a provider; discovery does not spend inference quota', async t => {
  let calls = 0;
  const f = fixture(t, {post: async () => {calls++; return {data: 'synthetic'};}});
  await f.run('budget-twenty', async () => {
    await f.request('model.discover');
    for (let i = 0; i < 20; i++) await f.request(i % 2 ? 'model.embed' : 'model.generate');
    assert.equal(f.capacity.currentTask().modelRequests, 20);
    await assert.rejects(f.request(), error => error.code === 'task_model_budget');
  }).catch(error => {assert.equal(error.code, 'task_model_budget');});
  assert.equal(calls, 20);
});

test('nested policies only tighten and reuse the existing actual-start count', async t => {
  const f = fixture(t);
  await f.run('parent', async () => {
    await f.request();
    await f.tasks.run('child', async () => {
      const current = f.capacity.currentTask();
      assert.equal(current.modelRequests, 1);
      assert.equal(current.modelPolicy.maxRequests, 2);
      assert.equal(current.modelPolicy.requestTimeoutMs, 1000);
      assert.equal(current.modelPolicy.allowRetry, false);
      assert.equal(current.modelPolicy.allowFallback, false);
      assert.equal(current.modelPolicy.serial, true);
      await f.request();
    }, {delegate: true, limits: {modelPolicy: {...strict, maxRequests: 2, requestTimeoutMs: 1000}}});
    await f.tasks.run('broaden', async () => {
      assert.equal(f.capacity.currentTask().modelRequests, 2);
      assert.equal(f.capacity.currentTask().modelPolicy.maxRequests, 2);
      assert.equal(f.capacity.currentTask().modelPolicy.allowFallback, false);
    }, {limits: {modelPolicy: {...strict, maxRequests: 100, allowRetry: true, allowFallback: true, serial: false}}});
  });
});

test('strict scope is serial even when global capacity admits two unrelated requests', async t => {
  let active = 0, peak = 0;
  const f = fixture(t, {maxActive: 2, post: async () => {active++; peak = Math.max(peak, active); await turn(); active--; return {data: 'synthetic'};}});
  await f.run('serial-root', () => Promise.all([f.request(), f.request(), f.request()]));
  assert.equal(peak, 1);
});

test('request timeout stops waiting but retains an unsettled capacity slot', async t => {
  let finish, aborted = false, nextStarted = false;
  const f = fixture(t, {post: (_url, _data, options) => {assert.equal(options.timeout, 100); options.signal.addEventListener('abort', () => {aborted = true;}, {once: true}); return new Promise(resolve => {finish = resolve;});}});
  const keepAlive = setInterval(() => {}, 1000); t.after(() => clearInterval(keepAlive));
  const pending = f.run('timeout-root', f.request, {...strict, requestTimeoutMs: 100});
  await assert.rejects(pending, error => error.code === 'task_model_timeout');
  assert.equal(aborted, true);
  assert.equal(f.capacity.status(actor.workspaceId).active, 1);
  runWithWorkspace(actor, () => assert.equal(f.tasks.getTask('timeout-root').state, 'needs_attention'));
  const next = f.capacity.submit({workspaceId: 'workspace-b', taskId: 'next', kind: 'model.generate', deadlineAt: Date.now() + 5000, run: () => {nextStarted = true; return 'next';}});
  await turn(); assert.equal(nextStarted, false);
  finish({data: 'late output'});
  assert.equal(await next, 'next');
});

test('malformed model policy is rejected before a task can send traffic', async t => {
  const f = fixture(t);
  for (const modelPolicy of [{...strict, maxRequests: 0}, {...strict, allowRetry: 0}, {...strict, requestTimeoutMs: 0}, {...strict, ignored: true}]) {
    await assert.rejects(f.run('invalid-' + Math.random().toString(16).slice(2), f.request, modelPolicy), /invalid_model_policy/);
  }
});

test('model retry and fallback are disabled only inside the restricted task', async t => {
  const calls = [];
  const f = fixture(t);
  const box = embedded(['queryOllamaWithRetry', 'workspaceExecutionStopped'], {
    workspaceServices: () => f.services,
    workspaceSetting: () => ({researcher: {fallback: {provider: 'backup', model: 'backup-model'}}}),
    config: {}, resolveLlmProviderForAgent: () => ({name: 'primary', fallbackModels: ['secondary']}),
    workspaceAuthorizeModel() {},
    llmProviders: {
      primary: {name: 'primary', local: true, configured: true, async generate({model}) {calls.push(model); throw new Error('synthetic failure');}},
      backup: {name: 'backup', local: true, configured: true, async generate({model}) {calls.push(model); return 'ordinary fallback result';}}
    },
    setTimeout: callback => setImmediate(callback)
  });
  await f.run('strict-route', async () => {
    const value = await box.queryOllamaWithRetry('primary-model', 'fixture', '', 0, 'researcher');
    assert.match(value, /^\[OLLAMA_ERROR\]/);
  });
  assert.deepEqual(calls, ['primary-model']);
  calls.length = 0;
  await f.run('ordinary-route', async () => {
    assert.equal(await box.queryOllamaWithRetry('primary-model', 'fixture', '', 0, 'researcher'), 'ordinary fallback result');
  }, null);
  assert.deepEqual(calls, ['primary-model', 'primary-model', 'primary-model', 'secondary', 'secondary', 'secondary', 'backup-model']);
});

for (const entry of ['human', 'agent']) test(entry + ' research entry waits until the complete research promise settles', async () => {
  let finish, settled = false;
  const box = embedded(['onHumanMessageBody', 'executeAction'], {
    process: {env: {}}, workspaceServices: () => null, channels: new Map([['general', {name: 'general'}]]), researchSessions: new Map(),
    uuidv4: () => 'research-entry', runResearch: () => new Promise(resolve => {finish = resolve;}),
    addMessage: () => null, broadcastToStore() {}
  });
  const pending = (entry === 'human' ? box.onHumanMessageBody('general', {content: '/siphon public fixture'}, {}) : box.executeAction({id: 'retriever', name: 'Fixture'}, 'general', {type: 'research', payload: {topic: 'public fixture'}})).then(() => {settled = true;});
  await turn(); assert.equal(settled, false);
  finish(); await pending; assert.equal(settled, true);
});

test('research cancellation during search persists the stopped session and sends no later model request', async t => {
  const f = fixture(t); const saved = [], modelCalls = [];
  const session = {id: 'research-stop', topic: 'Public fixture', logs: [], notes: [], sources: [], evidence: [], metric: 0};
  let startedSearch, observedAbort = false;
  const searching = new Promise(resolve => {startedSearch = resolve;});
  const box = embedded(['workspaceTaskScope', 'runResearch', 'runResearchBody', 'updateResearchSession', 'researchTaskContext', 'researchCheckpoint', 'resolveResearchRole', 'reviewResearchEvidence', 'dispatchResearchStage'], {
    workspaceServices: () => f.services, workspaceSetting: key => key === 'researchAgentId' ? 'retriever' : null,
    config: {}, researchSessions: new Map([[session.id, session]]), agents: new Map([['retriever', {id: 'retriever', model: 'synthetic-model'}]]),
    workspaceClients: () => new Map(), addMessage: () => null, broadcastToStore() {},
    persistWorkspaceResearch: value => {saved.push(JSON.parse(JSON.stringify(value))); return true;},
    queryOllamaWithRetry: async (...args) => {modelCalls.push(args); return 'What does the public fixture state?';},
    ddgSearch: async (_q, _n, options) => {startedSearch(); return new Promise((_resolve, reject) => {options.signal.addEventListener('abort', () => {observedAbort = true; reject(options.signal.reason);}, {once: true});});}
  });
  const pending = runWithWorkspace(actor, () => box.runResearch(session.id, session.topic, 'general'));
  const rejected = assert.rejects(pending, error => error.code === 'task_cancelled');
  await searching;
  runWithWorkspace(actor, () => {assert.equal(f.tasks.getTask(session.id).state, 'running'); f.tasks.cancelTask(session.id);});
  await rejected;
  assert.equal(observedAbort, true); assert.equal(modelCalls.length, 1);
  assert.equal(session.execution.state, 'cancelled');
  assert.equal(saved.at(-1).execution.state, 'cancelled');
  assert.equal(session.evidence.length, 0);
});

test('strict research never dispatches an external Agent', async t => {
  const f = fixture(t); let dispatched = false;
  const box = embedded(['dispatchResearchStage', 'researchTaskContext', 'researchCheckpoint'], {
    workspaceServices: () => f.services, workspaceSetting: () => true, config: {},
    agentGateway: {dispatchResearchStage: () => {dispatched = true; return {output: {}};}}
  });
  await f.run('no-external', () => assert.rejects(box.dispatchResearchStage({sessionId: 'fixture', stage: 'retrieve', role: {kind: 'external'}, input: {}}), error => error.code === 'task_external_forbidden'));
  assert.equal(dispatched, false);
});

test('a queued ordinary request adopts a policy tightened before provider admission', async t => {
  let release, timeout;
  const f = fixture(t, {post: async (_u, _d, options) => {timeout = options.timeout; return {data: 'synthetic'};}});
  const blocker = f.capacity.submit({workspaceId: 'workspace-b', taskId: 'policy-blocker', kind: 'model.generate', deadlineAt: Date.now() + 5000, run: () => new Promise(resolve => {release = resolve;})});
  t.after(() => release?.());
  await turn();
  await f.run('tighten-queued', async () => {
    const pending = f.request();
    f.capacity.restrictModelPolicy(strict);
    release(); await blocker; await pending;
    assert.ok(timeout <= 20000, 'Provider must not receive the old 30000 ms timeout');
  }, null);
});

test('a running ordinary request receives a subsequently tightened cancellation deadline', async t => {
  let finish, signal;
  const f = fixture(t, {post: (_u, _d, options) => {signal = options.signal; return new Promise(resolve => {finish = resolve;});}});
  t.after(() => finish?.({data: 'cleanup'}));
  await assert.rejects(f.run('tighten-running', async () => {
    const pending = f.request();
    await turn();
    f.capacity.restrictModelPolicy({...strict, requestTimeoutMs: 100});
    let watchdog;
    const outcome = await Promise.race([
      pending.then(() => ({kind: 'success'}), error => ({kind: 'error', code: error.code})),
      new Promise(resolve => {watchdog = setTimeout(() => resolve({kind: 'still-waiting'}), 700);})
    ]);
    clearTimeout(watchdog);
    assert.deepEqual(outcome, {kind: 'error', code: 'task_model_timeout'});
  }, null), error => error.code === 'task_model_timeout');
  assert.equal(signal.aborted, true);
  assert.equal(f.capacity.status(actor.workspaceId).active, 1, 'Abort is not proof of transport settlement');
  finish({data: 'late output'}); await turn();
  assert.equal(f.capacity.status(actor.workspaceId).active, 0);
});

for (const retries of [1, 3]) test('routing rechecks mid-flight restrictions with initial attempt budget ' + retries, async t => {
  const f = fixture(t), calls = [];
  const box = embedded(['queryOllamaWithRetry', 'workspaceExecutionStopped'], {
    workspaceServices: () => f.services, workspaceSetting: () => ({researcher: {fallback: {provider: 'backup', model: 'backup-model'}}}),
    config: {}, workspaceAuthorizeModel() {}, resolveLlmProviderForAgent: () => ({name: 'primary', fallbackModels: []}),
    llmProviders: {
      primary: {name: 'primary', local: true, configured: true, async generate({model}) {calls.push(model); await turn(); f.capacity.restrictModelPolicy(strict); throw new Error('synthetic rejection');}},
      backup: {name: 'backup', local: true, configured: true, async generate({model}) {calls.push(model); return 'must not run';}}
    }, setTimeout: callback => setImmediate(callback)
  });
  await f.run('mid-flight-route-' + retries, async () => {
    assert.match(await box.queryOllamaWithRetry('primary-model', 'synthetic', '', 0, 'researcher', retries), /^\[OLLAMA_ERROR\]/);
  }, null);
  assert.deepEqual(calls, ['primary-model']);
});

test('routing rechecks permissions after backoff rather than only before waiting', async t => {
  const f = fixture(t), calls = [];
  const box = embedded(['queryOllamaWithRetry', 'workspaceExecutionStopped'], {
    workspaceServices: () => f.services, workspaceSetting: () => ({researcher: {fallback: {provider: 'backup', model: 'backup-model'}}}),
    config: {}, workspaceAuthorizeModel() {}, resolveLlmProviderForAgent: () => ({name: 'primary', fallbackModels: []}),
    llmProviders: {
      primary: {name: 'primary', local: true, configured: true, async generate({model}) {calls.push(model); throw new Error('synthetic rejection');}},
      backup: {name: 'backup', local: true, configured: true, async generate({model}) {calls.push(model); return 'must not run';}}
    }, setTimeout(callback) {f.capacity.restrictModelPolicy(strict); return setImmediate(callback);}
  });
  await f.run('backoff-policy', async () => {
    assert.match(await box.queryOllamaWithRetry('primary-model', 'synthetic', '', 0, 'researcher'), /^\[OLLAMA_ERROR\]/);
  }, null);
  assert.deepEqual(calls, ['primary-model']);
});

for (const policy of [null, strict]) test('completed root rejects its retained callback with ' + (policy ? 'strict' : 'ordinary') + ' policy', async t => {
  let calls = 0, openGate, finishLate;
  const f = fixture(t, {post: async () => {calls++; return {data: 'must not run'};}});
  const gate = new Promise(resolve => {openGate = resolve;}), late = new Promise(resolve => {finishLate = resolve;});
  await f.run('completed-root', async () => {
    setImmediate(async () => {
      await gate;
      try {await f.request(); finishLate('provider-was-called');} catch (error) {finishLate(error.code);}
    });
    return 42;
  }, policy);
  assert.equal(runWithWorkspace(actor, () => f.tasks.cancelTask('completed-root').state), 'completed');
  openGate();
  assert.equal(await late, 'task_completed');
  assert.equal(calls, 0);
});

test('root retirement waits for every tracked branch rather than the parent callback alone', async t => {
  const f = fixture(t); let finish, child;
  await f.run('parent-retirement', async () => {
    child = f.tasks.run('held-child', () => new Promise(resolve => {finish = resolve;}), {delegate: true});
    return 'parent-returned';
  });
  runWithWorkspace(actor, () => assert.equal(f.tasks.getTask('parent-retirement').state, 'running'));
  finish('child-returned'); assert.equal(await child, 'child-returned');
  runWithWorkspace(actor, () => assert.equal(f.tasks.getTask('parent-retirement').state, 'completed'));
});

test('retiring a root aborts abandoned work without freeing its occupied slot early', async t => {
  let finish, signal, abandoned;
  const f = fixture(t, {post: (_u, _d, options) => {signal = options.signal; return new Promise(resolve => {finish = resolve;});}});
  t.after(() => finish?.({data: 'cleanup'}));
  await f.run('abandoned-root', async () => {
    abandoned = f.request().then(() => 'unexpected-success', error => error.code);
    await turn();
    return 'orchestration-returned';
  });
  assert.equal(signal.aborted, true);
  assert.equal(await abandoned, 'task_completed');
  assert.equal(f.capacity.status(actor.workspaceId).active, 1);
  finish({data: 'late transport settlement'}); await turn();
  assert.equal(f.capacity.status(actor.workspaceId).active, 0);
});

test('a retained scope cannot create another branch after its root completes', async t => {
  const f = fixture(t); let resume, entered = false;
  await f.run('retained-parent', async () => {
    resume = require('node:async_hooks').AsyncLocalStorage.snapshot();
  });
  await assert.rejects(resume(() => f.capacity.withTaskScope({workspaceId: actor.workspaceId, taskId: 'too-late-child', createdBy: actor.userId}, () => {entered = true;})), error => error.code === 'task_completed');
  assert.equal(entered, false);
});
