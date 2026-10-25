'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const espree = require('espree');
const {documentFixture} = require('./helpers/workspace-document.cjs');
const engine = require('../identity/i18n.js');
const {createDisplay} = require('../identity/display.js');
const messages = require('../identity/messages.js');
const chatMessages = require('../identity/chat-messages.js');
const root = path.resolve(__dirname, '..');
const html = JSON.parse(execFileSync(process.env.PYTHON || 'python', ['-X', 'utf8', '-c', 'import ast,json; t=ast.parse(open("lack.py",encoding="utf-8").read()); print(json.dumps(next(ast.literal_eval(n.value) for n in t.body if isinstance(n,ast.Assign) and any(isinstance(x,ast.Name) and x.id=="INDEX_HTML" for x in n.targets))))'], {cwd: root, encoding: 'utf8', timeout: 10000}));
const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]).find(value => value.includes('function clearWorkspacePresentation()'));
const ast = espree.parse(script, {ecmaVersion: 'latest', range: true});
const names = new Set(['clearWorkspacePresentation', 'setDisplay', 'displayLabel']);
const source = ast.body.filter(node => node.type === 'FunctionDeclaration' && names.has(node.id.name)).map(node => script.slice(...node.range)).join('\n');
test('workspace reset permanently retires the previous account Ralph goal binding', t => {
  const {document} = documentFixture();
  document.documentElement = {lang: 'zh-CN'}; document.querySelectorAll = () => [];
  document.body.classList = {remove() {}};
  const preferences = new Map([['chunlack.ui.locale.v1.user:account-B', 'en']]);
  const window = {navigator: {languages: ['zh-CN']}, addEventListener() {}, removeEventListener() {}};
  const displayRoot = createDisplay({document, window, engine, messages, chatMessages, help: {catalogs: {'zh-CN': {}, en: {}}}, storage: {getItem: key => preferences.get(key) ?? null, setItem: (key, value) => preferences.set(key, value)}});
  t.after(() => displayRoot.dispose());
  const badge = document.createElement('span'); badge.id = 'ralphStatusBadge'; badge.style.display = 'inline-block'; document.body.append(badge);
  displayRoot.setUser('account-A');
  displayRoot.set(badge, 'textContent', displayRoot.ui('Ralph gen {p0} · {p1}', {p0: 4, p1: 'PRIVATE-ACCOUNT-A-GOAL'}));
  assert.match(badge.textContent, /PRIVATE-ACCOUNT-A-GOAL/);
  const context = vm.createContext({document, window, displayRoot, agentCreateForm: null, displayGraphSnapshot: null,
    releaseDisplay: node => displayRoot.release(node),
    researchInterval: null, thinkingInterval: null, graphInterval: null, legacyReconnectTimer: null,
    resizeListener: false, graphWorker: null, graphWorkerUrl: null, fileReaders: new Set(),
    agents: [], channels: [], researchSessions: [], availableLlmProviders: [], pendingFile: null,
    currentThreadId: null, currentStoreId: 'general', username: 'account A', userId: 'account-A',
    moderatorState: false, activeWorkspaceScope: 'A:workspace', graphCtx: null, graphCanvas: null,
    workspaceView: null, clearInterval, clearTimeout});
  vm.runInContext(source + '\nclearWorkspacePresentation();', context, {timeout: 2000});
  assert.equal(badge.textContent, ''); assert.equal(badge.style.display, 'none');
  displayRoot.setUser('account-B'); assert.equal(displayRoot.i18n.getLocale(), 'en');
  assert.equal(badge.textContent, '', 'the previous account goal must not be written back into even a hidden element');
  displayRoot.i18n.setLocale('zh-CN'); displayRoot.i18n.setLocale('en');
  assert.equal(badge.textContent, ''); assert.equal(badge.style.display, 'none');
});
