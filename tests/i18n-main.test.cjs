'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const {createI18n} = require('../identity/i18n.js');
const {documentFixture} = require('./helpers/workspace-document.cjs');
const root = path.resolve(__dirname, '..');
const displayPath = path.join(root, 'identity/display.js');
const displayModule = fs.existsSync(displayPath) ? require(displayPath) : {};
const messagesPath = path.join(root, 'identity/chat-messages.js');
const messages = fs.existsSync(messagesPath) ? require(messagesPath) : {};
const embedded = JSON.parse(execFileSync(process.env.PYTHON || 'python', ['-X', 'utf8', '-c', 'import ast,json; t=ast.parse(open("lack.py",encoding="utf-8").read()); print(json.dumps({n.targets[0].id:ast.literal_eval(n.value) for n in t.body if isinstance(n,ast.Assign) and isinstance(n.targets[0],ast.Name) and n.targets[0].id in ("INDEX_HTML","SERVER_JS")}))'], {cwd: root, encoding: 'utf8', timeout: 10000}));
function fixture() {
  const base = documentFixture(), document = base.document, events = new Map(), sent = [], requests = [];
  document.documentElement = {lang: 'zh-CN'};
  document.querySelectorAll = () => [];
  document.addEventListener = () => {};
  document.removeEventListener = () => {};
  const originalCreate = document.createElement;
  document.createElement = tag => {
    const node = originalCreate(tag);
    node.getAttribute = name => node.attributes[name] ?? null;
    node.addEventListener = (name, fn) => {events.set(node, {...events.get(node), [name]: fn});};
    node.removeEventListener = (name, fn) => {if (events.get(node)?.[name] === fn) delete events.get(node)[name];};
    node.focus = () => {document.activeElement = node;};
    return node;
  };
  const window = {addEventListener() {}, removeEventListener() {}, navigator: {languages: ['zh-CN']}};
  Object.defineProperty(window, 'localStorage', {get() {throw new Error('blocked');}});
  const help = {catalogs: {'zh-CN': {}, en: {}}, createHelp(options) {return {open(value) {requests.push(value);}, close() {}, dispose() {}};}};
  const create = () => displayModule.createDisplay({document, window, engine: {createI18n}, messages: require('../identity/messages.js'), chatMessages: messages, help, fetch: (...args) => {sent.push(args); return Promise.reject(new Error('must not fetch'));}});
  return {...base, window, create, events, requests, sent};
}
function evaluate(elements = {}) {
  const context = vm.createContext({window: {addEventListener() {}}, document: {getElementById: id => elements[id]}, localStorage: {getItem: () => null}, console, setTimeout, clearTimeout, setInterval, clearInterval});
  for (const match of embedded.INDEX_HTML.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) if (match[1].trim()) vm.runInContext(match[1], context);
  return context;
}
test('main display controller and paired catalog are implemented', () => {
  assert.equal(typeof displayModule.createDisplay, 'function');
  assert.deepEqual(Object.keys(messages).sort(), ['en', 'zh-CN']);
  assert.deepEqual(Object.keys(messages.en).sort(), Object.keys(messages['zh-CN']).sort());
  const controller = createI18n({catalogs: messages, storage: null, events: null}); controller.close();
});
test('shared display binds only explicit labels and survives blocked browser storage', () => {
  const f = fixture(), display = f.create();
  const label = f.document.createElement('button'), raw = f.document.createElement('p');
  raw.textContent = '发送 ↑ <script>raw()</script>';
  display.set(label, 'textContent', display.ui('发送 ↑'));
  display.i18n.setLocale('en');
  assert.equal(label.textContent, 'Send ↑'); assert.equal(raw.textContent, '发送 ↑ <script>raw()</script>');
  assert.equal(f.document.documentElement.lang, 'en'); assert.equal(f.sent.length, 0);
  display.dispose();
});
test('display language switches do not replace form values or pending handlers', () => {
  const f = fixture(), display = f.create(); const node = f.document.createElement('textarea'), pending = () => {};
  node.value = 'my draft 原文'; node.onclick = pending;
  display.attribute(node, 'placeholder', display.ui('Reply...'));
  display.i18n.setLocale('en');
  assert.equal(node.attributes.placeholder, 'Reply...'); assert.equal(node.value, 'my draft 原文'); assert.equal(node.onclick, pending);
  display.i18n.setLocale('zh-CN'); assert.equal(node.attributes.placeholder, '回复……'); display.dispose();
});
test('explicit node binding preserves child controls and releases detached fragments', () => {
  const f = fixture(), display = f.create();
  const container = f.document.createElement('div'), caption = {nodeType: 3, textContent: '一起把想法，', parentNode: container}, input = f.document.createElement('input');
  container.childNodes = [caption, input]; input.value = 'unchanged';
  container.setAttribute('data-i18n-nodes', JSON.stringify([[0, '一起把想法，']]));
  container.querySelectorAll = () => [];
  display.bind(container); display.i18n.setLocale('en');
  assert.equal(caption.textContent, 'Together, turn ideas'); assert.equal(input.value, 'unchanged');
  display.release(container); display.i18n.setLocale('zh-CN'); assert.equal(caption.textContent, 'Together, turn ideas'); display.dispose();
});
test('private help uses the designated profile and closes without business requests', () => {
  const f = fixture(), display = f.create(); display.openHelp();
  assert.deepEqual(f.requests, [{profile: 'workspace'}]); assert.equal(f.sent.length, 0); display.closeHelp(); display.dispose();
});
test('main and login load display assets before their own bootstraps', () => {
  const login = fs.readFileSync(path.join(root, 'identity/login.html'), 'utf8');
  for (const html of [embedded.INDEX_HTML, login]) {
    for (const name of ['i18n.js', 'messages.js', 'chat-messages.js', 'help.js', 'display.js']) assert.ok(html.includes('/identity/' + name), name);
    assert.ok(html.indexOf('/identity/display.js') < html.indexOf('/identity/workspace-ui.js'));
  }
  assert.ok(embedded.SERVER_JS.includes('createDisplayAssetHandler'));
});
test('main help never broadcasts or consumes an attachment, even when helpers are unavailable', () => {
  const input = {value: '/help', style: {}, scrollHeight: 20}, preview = {innerHTML: 'attachment'};
  const context = evaluate({messageInput: input, filePreview: preview, toast: {classList: {add() {}, remove() {}}, innerText: ''}});
  vm.runInContext('var sent=[]; ws={send: value=>sent.push(value)}; pendingFile={name:"keep.txt",contentBase64:"eA=="}; sendMessage(); sendCommand("/help");', context);
  assert.equal(vm.runInContext('sent.length', context), 0); assert.equal(vm.runInContext('pendingFile.name', context), 'keep.txt');
  assert.equal(preview.innerHTML, 'attachment'); assert.equal(input.value, '/help');
});
test('main bootstrap accepts a shared controller without changing model and message protocol', () => {
  const context = evaluate();
  assert.match(context.init.toString(), /initializeDisplay/);
  assert.match(context.init.toString(), /i18n:\s*displayRoot\?\.i18n/);
  assert.match(context.sendMessage.toString(), /type:'message',content:finalMessage/);
  assert.match(context.createAgentForm.toString(), /systemPrompt: field\('Prompt'\)\.value/);
  assert.match(context.createMessageElement.toString(), /formatCode\(escapeHtml\(msg.content\)\)/);
});
