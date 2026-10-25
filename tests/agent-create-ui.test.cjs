'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const html = JSON.parse(execFileSync(process.env.PYTHON || 'python', ['-c', 'import json,runpy; print(json.dumps(runpy.run_path("scripts/materialize.py")["embedded_sources"]()["INDEX_HTML"]))'], {cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024}));
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
const ast = require('espree').parse(script, {ecmaVersion: 'latest', range: true});
const names = new Set(['handleSpawn', 'createAgentForm', 'displayLabel', 'setDisplay']);
const source = ast.body.filter(n => n.type === 'FunctionDeclaration' && names.has(n.id.name)).map(n => script.slice(...n.range)).join('\n');
const ids = ['createAgentModal', 'createAgentForm', 'createAgentFields', 'createAgentName', 'createAgentProvider', 'createAgentModel', 'createAgentPrompt', 'createAgentChannels', 'createAgentStrictChannel', 'createAgentStatus', 'createAgentSubmit', 'createAgentCancel', 'createAgentRetry', 'studioSpawnBtn'];
function deferred() {let resolve; const promise = new Promise(r => {resolve = r;}); return {promise, resolve};}
function response(body, status = 200) {return {ok: status >= 200 && status < 300, status, json: async () => body};}
function fixture(t, fetcher, options = {}) {
  const elements = new Map(), sent = [], requests = [], notices = [];
  const document = {activeElement: null, getElementById: id => elements.get(id), createElement: () => element()};
  function element(id = '') {return {id, value: '', disabled: false, hidden: false, textContent: '', style: {display: 'none'}, children: [],
    appendChild(child) {this.children.push(child);}, replaceChildren(...children) {this.children = children; this.value = '';},
    setAttribute() {}, focus() {document.activeElement = this;}};}
  for (const id of ids) elements.set(id, element(id));
  document.documentElement = {lang: 'zh-CN'};
  const displayRoot = options.i18n ? require('../identity/display.js').createDisplay({
    document, window: {navigator: {languages: ['zh-CN']}, addEventListener() {}, removeEventListener() {}},
    engine: require('../identity/i18n.js'), messages: require('../identity/messages.js'),
    chatMessages: require('../identity/chat-messages.js'), help: {catalogs: {'zh-CN': {}, en: {}}}, storage: null
  }) : null;
  let generation = 1;
  const socket = {readyState: 1, send: value => sent.push(JSON.parse(value))};
  const context = vm.createContext({document, WebSocket: {OPEN: 1}, ws: socket, activeWorkspaceScope: 'alice:workspace-a',
    workspaceClient: {snapshot: () => ({generation})}, displayRoot, agentCreateForm: null, AbortController, setTimeout, clearTimeout,
    availableLlmProviders: [{id: 'ollama', configured: true}, {id: 'direct-test', configured: true}],
    showToast: (message, type) => notices.push({message, type}),
    prompt() {throw new Error('native_dialog_unavailable');}, alert() {throw new Error('native_dialog_unavailable');},
    fetch: async (url, options) => {requests.push({url, options}); return fetcher ? fetcher(url, options) : response(url === '/api/llm-providers' ? {providers: [{id: 'ollama', configured: true}, {id: 'direct-test', configured: true}, {id: 'hidden', configured: false}], defaultProvider: 'direct-test'} : {models: ['model-a']});}});
  vm.runInContext(source, context);
  t.after(() => {try {context.agentCreateForm?.reset();} finally {displayRoot?.dispose();}});
  return {context, elements, sent, requests, notices, socket, document, displayRoot,
    open: () => context.handleSpawn(), cancel: () => elements.get('createAgentCancel').onclick(),
    submit: () => {elements.get('createAgentName').value ||= 'Research'; return elements.get('createAgentForm').onsubmit({preventDefault() {}});},
    switchWorkspace() {generation++; context.activeWorkspaceScope = 'bob:workspace-b'; context.agentCreateForm?.reset();}};
}

test('opens an in-page form without native dialogs and selects the authorized default provider', async t => {
  const f = fixture(t); await f.open();
  assert.equal(f.elements.get('createAgentModal').style.display, 'flex');
  assert.equal(f.elements.get('createAgentProvider').value, 'direct-test');
  assert.deepEqual(f.elements.get('createAgentProvider').children.map(x => x.value), ['ollama', 'direct-test']);
  assert.equal(f.elements.get('createAgentModel').value, 'model-a');
  assert.equal(f.requests[1].url, '/api/models?provider=direct-test');
  assert.equal(f.sent.length, 0);
});

test('cancel discards input and ignores late model loading', async t => {
  const models = deferred();
  const f = fixture(t, url => url === '/api/llm-providers' ? response({providers: [{id: 'local', configured: true}], defaultProvider: 'local'}) : models.promise);
  const opening = f.open(); await new Promise(setImmediate);
  f.elements.get('createAgentName').value = 'discard me'; f.cancel();
  models.resolve(response({models: ['late']})); await opening;
  assert.equal(f.elements.get('createAgentModal').style.display, 'none');
  assert.equal(f.elements.get('createAgentName').value, '');
  assert.equal(f.elements.get('createAgentModel').children.length, 0);
  assert.equal(f.requests[1].options.signal.aborted, true);
  assert.equal(f.sent.length, 0);
});

test('failed model load is visible and cannot submit; retry can recover', async t => {
  let fail = true;
  const f = fixture(t, url => url === '/api/llm-providers' ? response({providers: [{id: 'local', configured: true}]}) : fail ? response({error: 'private upstream details'}, 503) : response({models: ['recovered']}));
  await f.open(); await f.submit();
  assert.equal(f.sent.length, 0); assert.equal(f.elements.get('createAgentSubmit').disabled, true);
  assert.match(f.elements.get('createAgentStatus').textContent, /模型/);
  assert.doesNotMatch(f.elements.get('createAgentStatus').textContent, /private upstream/);
  fail = false; await f.elements.get('createAgentRetry').onclick(); await f.submit();
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0].model, 'recovered');
});

test('duplicate submission stays locked until a matching server acknowledgement', async t => {
  const f = fixture(t); await f.open(); await f.submit(); await f.submit(); await f.open(); await f.submit();
  assert.equal(f.sent.length, 1); assert.equal(f.elements.get('createAgentSubmit').disabled, true);
  assert.equal(f.elements.get('createAgentModal').style.display, 'flex');
  f.context.agentCreateForm.receive({type: 'spawn_confirm', agent: {name: 'unrelated', provider: 'direct-test', model: 'model-a'}});
  assert.equal(f.elements.get('createAgentModal').style.display, 'flex');
  f.context.agentCreateForm.receive({type: 'spawn_confirm', agent: {name: 'Research', provider: 'direct-test', model: 'model-a'}});
  assert.equal(f.elements.get('createAgentModal').style.display, 'none');
  assert.deepEqual(f.sent[0], {type: 'spawn_agent', name: 'Research', provider: 'direct-test', model: 'model-a', systemPrompt: 'You are helpful.', channels: ['general', 'siphon', 'code'], strictChannel: null});
});

test('workspace reset suppresses stale provider responses and clears all form state', async t => {
  const catalog = deferred(), f = fixture(t, () => catalog.promise);
  const opening = f.open(); f.elements.get('createAgentPrompt').value = 'private workspace draft'; f.switchWorkspace();
  catalog.resolve(response({providers: [{id: 'old-workspace', configured: true}]})); await opening;
  assert.equal(f.elements.get('createAgentModal').style.display, 'none');
  assert.equal(f.elements.get('createAgentPrompt').value, '');
  assert.equal(f.elements.get('createAgentProvider').children.length, 0);
  assert.equal(f.requests.length, 1); assert.equal(f.sent.length, 0);
});

test('generation changes fail closed even before presentation reset runs', async t => {
  const f = fixture(t); await f.open(); f.context.activeWorkspaceScope = 'other'; await f.submit();
  assert.equal(f.sent.length, 0);
});

test('provider changes ignore an earlier provider model response', async t => {
  const old = deferred();
  const f = fixture(t, url => url === '/api/llm-providers' ? response({providers: [{id: 'old', configured: true}, {id: 'new', configured: true}]}) : url.endsWith('old') ? old.promise : response({models: ['new-model']}));
  const opening = f.open(); await new Promise(setImmediate);
  f.elements.get('createAgentProvider').value = 'new'; await f.elements.get('createAgentProvider').onchange();
  old.resolve(response({models: ['old-model']})); await opening;
  assert.equal(f.elements.get('createAgentModel').value, 'new-model');
  await f.submit(); assert.equal(f.sent[0].provider, 'new'); assert.equal(f.sent[0].model, 'new-model');
});

test('disconnected sockets, unknown providers/models and blank names cannot create', async t => {
  const f = fixture(t); await f.open();
  f.elements.get('createAgentForm').onsubmit({preventDefault() {}}); assert.equal(f.sent.length, 0);
  f.elements.get('createAgentModel').value = 'not-granted'; await f.submit(); assert.equal(f.sent.length, 0);
  f.elements.get('createAgentModel').value = 'model-a'; f.socket.readyState = 3; await f.submit(); assert.equal(f.sent.length, 0);
});

test('ambiguous server error never enables an automatic duplicate submission', async t => {
  const f = fixture(t); await f.open(); await f.submit();
  f.context.agentCreateForm.receive({type: 'error', message: 'unsafe diagnostic'});
  f.cancel(); await f.open(); await f.submit();
  assert.equal(f.sent.length, 1); assert.equal(f.elements.get('createAgentSubmit').disabled, true);
  assert.doesNotMatch(f.elements.get('createAgentStatus').textContent, /unsafe diagnostic/);
});

test('no configured provider fails closed and every form control is in the delivered HTML', async t => {
  const f = fixture(t, () => response({providers: [{id: 'missing-key', configured: false}]})); await f.open(); await f.submit();
  assert.equal(f.sent.length, 0); assert.match(f.elements.get('createAgentStatus').textContent, /供应商/);
  for (const id of ids) assert.ok(html.includes('id="' + id + '"'), id + ' is materialized');
  assert.match(script, /agentCreateForm\?\.reset\(\)/);
});

test('same-workspace reconnect preserves an unacknowledged creation lock', async t => {
  const f = fixture(t); await f.open(); await f.submit();
  f.socket.readyState = 3; f.context.agentCreateForm.disconnected();
  f.context.ws = {readyState: 1, send: value => f.sent.push(JSON.parse(value))};
  await f.open(); await f.submit();
  assert.equal(f.sent.length, 1, 'reconnection must not permit a second possibly duplicate creation');
  assert.equal(f.elements.get('createAgentSubmit').disabled, true);
});

test('reconnected pending creation cannot be resent by cancel, retry or a matching-looking new-socket frame', async t => {
  const f = fixture(t); await f.open(); await f.submit();
  const requests = f.requests.length;
  f.socket.readyState = 3; f.context.agentCreateForm.disconnected();
  f.context.ws = {readyState: 1, send: value => f.sent.push(JSON.parse(value))};
  f.cancel(); await f.open();
  await f.elements.get('createAgentRetry').onclick();
  await f.elements.get('createAgentProvider').onchange();
  f.context.agentCreateForm.receive({type: 'spawn_confirm', agent: {name: 'Research', provider: 'direct-test', model: 'model-a'}});
  await f.submit(); f.cancel(); await f.open(); await f.submit();
  assert.equal(f.sent.length, 1);
  assert.equal(f.requests.length, requests);
  assert.equal(f.elements.get('createAgentFields').disabled, true);
  assert.equal(f.elements.get('createAgentSubmit').disabled, true);
  assert.equal(f.document.activeElement.id, 'createAgentCancel');
  assert.match(f.elements.get('createAgentStatus').textContent, /尚未确认/);
});

test('a reconnect without pending creation can load a fresh authorized form', async t => {
  const f = fixture(t); await f.open();
  f.elements.get('createAgentName').value = 'unsent draft';
  f.socket.readyState = 3; f.context.agentCreateForm.disconnected();
  f.context.ws = {readyState: 1, send: value => f.sent.push(JSON.parse(value))};
  await f.open();
  assert.equal(f.elements.get('createAgentName').value, '');
  assert.equal(f.requests.length, 4);
  assert.equal(f.elements.get('createAgentSubmit').disabled, false);
  await f.submit(); assert.equal(f.sent.length, 1);
});

test('pending creation does not retain private draft or lock across identity generation or workspace changes', async t => {
  const f = fixture(t); await f.open(); await f.submit();
  f.elements.get('createAgentPrompt').value = 'old identity private draft';
  f.context.workspaceClient = {snapshot: () => ({generation: 2})};
  await f.open();
  assert.equal(f.elements.get('createAgentName').value, '');
  assert.equal(f.elements.get('createAgentPrompt').value, 'You are helpful.');
  assert.equal(f.elements.get('createAgentSubmit').disabled, false);
  await f.submit(); assert.equal(f.sent.length, 2);
  f.switchWorkspace(); await f.open();
  assert.equal(f.elements.get('createAgentName').value, '');
  assert.equal(f.elements.get('createAgentFields').disabled, false);
  await f.submit(); assert.equal(f.sent.length, 3);
});

test('real language controller updates loading labels without fetching again or replacing form input', async t => {
  const providers = deferred();
  const f = fixture(t, url => url === '/api/llm-providers' ? providers.promise : response({models: ['model-original']}), {i18n: true});
  const opening = f.open(); await new Promise(setImmediate);
  f.elements.get('createAgentName').value = '原始 Agent / original';
  f.elements.get('createAgentPrompt').value = 'Do not translate this prompt 原文';
  assert.equal(f.elements.get('createAgentStatus').textContent, '正在加载可用供应商…');
  f.displayRoot.i18n.setLocale('en');
  assert.equal(f.elements.get('createAgentStatus').textContent, 'Loading available providers…');
  assert.equal(f.requests.length, 1); assert.equal(f.sent.length, 0);
  providers.resolve(response({providers: [{id: 'provider-original', configured: true}], defaultProvider: 'provider-original'}));
  await opening;
  assert.equal(f.elements.get('createAgentName').value, '原始 Agent / original');
  assert.equal(f.elements.get('createAgentPrompt').value, 'Do not translate this prompt 原文');
  assert.equal(f.elements.get('createAgentProvider').value, 'provider-original');
  assert.equal(f.elements.get('createAgentModel').value, 'model-original');
  assert.equal(f.elements.get('createAgentStatus').textContent, 'Select a model and enter an Agent name.');
  f.displayRoot.i18n.setLocale('zh-CN'); assert.equal(f.requests.length, 2); assert.equal(f.sent.length, 0);
  await f.submit(); assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].systemPrompt, 'Do not translate this prompt 原文');
  assert.equal(f.sent[0].name, '原始 Agent / original');
});

test('cancel retires real localized status bindings and ignores late model results', async t => {
  const models = deferred();
  const f = fixture(t, url => url === '/api/llm-providers' ? response({providers: [{id: 'local', configured: true}]}) : models.promise, {i18n: true});
  const opening = f.open(); await new Promise(setImmediate);
  f.displayRoot.i18n.setLocale('en');
  assert.equal(f.elements.get('createAgentStatus').textContent, 'Loading models…');
  f.cancel();
  f.displayRoot.i18n.setLocale('zh-CN'); f.displayRoot.i18n.setLocale('en');
  assert.equal(f.elements.get('createAgentStatus').textContent, '');
  models.resolve(response({models: ['late-unrelated']})); await opening;
  assert.equal(f.elements.get('createAgentModel').children.length, 0);
  assert.equal(f.elements.get('createAgentModal').style.display, 'none'); assert.equal(f.sent.length, 0);
});

test('real language changes preserve duplicate submission lock and retire acknowledged status', async t => {
  const f = fixture(t, undefined, {i18n: true}); await f.open(); await f.submit();
  const requestCount = f.requests.length;
  f.displayRoot.i18n.setLocale('en');
  assert.equal(f.elements.get('createAgentStatus').textContent, 'Submitted. Waiting for server confirmation…');
  await f.submit(); f.cancel(); await f.open(); await f.submit();
  assert.equal(f.sent.length, 1); assert.equal(f.requests.length, requestCount);
  assert.equal(f.elements.get('createAgentSubmit').disabled, true);
  f.context.agentCreateForm.receive({type: 'spawn_confirm', agent: {name: 'Research', provider: 'direct-test', model: 'model-a'}});
  f.displayRoot.i18n.setLocale('zh-CN'); f.displayRoot.i18n.setLocale('en');
  assert.equal(f.elements.get('createAgentStatus').textContent, '');
  assert.equal(f.elements.get('createAgentModal').style.display, 'none'); assert.equal(f.sent.length, 1);
});
