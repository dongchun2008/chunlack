'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const html = JSON.parse(execFileSync(process.env.PYTHON || 'python', ['-c', 'import ast,json; t=ast.parse(open("lack.py",encoding="utf-8").read()); print(json.dumps(next(ast.literal_eval(n.value) for n in t.body if isinstance(n,ast.Assign) and any(isinstance(x,ast.Name) and x.id=="INDEX_HTML" for x in n.targets))))'], {cwd: root, encoding: 'utf8', timeout: 10000}));
function evaluate(elements = {}) {
  const context = vm.createContext({window: {addEventListener() {}}, document: {getElementById: id => elements[id]}, localStorage: {getItem: () => null}, console, setTimeout, clearTimeout, setInterval, clearInterval});
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) if (match[1].trim()) vm.runInContext(match[1], context);
  return context;
}
test('embedded UI loads identity modules and public bootstrap without removing the private-mode initializer', () => {
  assert.ok(html.includes('/identity/runtime-mode.js')); assert.ok(html.includes('/identity/workspace-ui.js')); assert.ok(html.includes('/identity/workspace-shell.js'));
  const context = evaluate(); assert.equal(typeof context.init, 'function'); assert.equal(typeof context.initializeChatUi, 'function');
});
test('legacy message HTML helper escapes attribute delimiters and handles null content', () => {
  const context = evaluate();
  assert.equal(context.escapeHtml('"\'<img src=x onerror=alert(1)>&'), '&quot;&#39;&lt;img src=x onerror=alert(1)&gt;&amp;');
  assert.equal(context.escapeHtml(null), '');
});
test('frontend owns its research and thinking timers so logout can stop all periodic private-data refreshes', () => {
  const context = evaluate();
  assert.match(context.initializeChatUi.toString(), /researchInterval = setInterval/);
  assert.match(context.initializeChatUi.toString(), /thinkingInterval = setInterval/);
});
test('agent detail fields use escaped text and attach an edit handler without inline JavaScript', () => {
  const content = {innerHTML: '', querySelector: () => ({disabled: false})}, popup = {classList: {add() {}}};
  const context = evaluate({agentDetailContent: content, agentDetailPopup: popup});
  vm.runInContext('agents = [{id: "agent-fixture", name: "Safe", model: "model", strictChannel: "<img src=x onerror=alert(1)>", status: "<script>alert(1)</script>"}]; showAgentDetails("agent-fixture");', context);
  assert.ok(!content.innerHTML.includes('<img')); assert.ok(!content.innerHTML.includes('<script>')); assert.ok(!content.innerHTML.includes('onclick='));
});
