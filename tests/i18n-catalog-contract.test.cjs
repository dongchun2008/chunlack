'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const cheerio = require('cheerio');
const espree = require('espree');
const {createI18n} = require('../identity/i18n.js');
const root = path.resolve(__dirname, '..');
const workspace = require('../identity/messages.js');
const chat = require('../identity/chat-messages.js');
const help = require('../identity/help.js').catalogs;
const catalogs = Object.fromEntries(['zh-CN', 'en'].map(locale => [locale, Object.assign(Object.create(null), workspace[locale], chat[locale], help[locale])]));
const html = JSON.parse(execFileSync(process.env.PYTHON || 'python', ['-X', 'utf8', '-c', 'import ast,json; t=ast.parse(open("lack.py",encoding="utf-8").read()); print(json.dumps(next(ast.literal_eval(n.value) for n in t.body if isinstance(n,ast.Assign) and any(isinstance(x,ast.Name) and x.id=="INDEX_HTML" for x in n.targets))))'], {cwd: root, encoding: 'utf8', timeout: 10000}));
const $ = cheerio.load(html);
function requireTranslation(id, context) {
  assert.equal(typeof id, 'string', context);
  for (const locale of ['zh-CN', 'en']) {
    assert.equal(Object.hasOwn(catalogs[locale], id), true, context + ': missing ' + locale + ' translation for ' + id);
    assert.ok(catalogs[locale][id].trim(), context + ': empty ' + locale + ' translation');
  }
}
function walk(node, callback) {
  if (!node || typeof node !== 'object') return;
  if (node.type) callback(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'range' || key === 'loc') continue;
    if (Array.isArray(value)) value.forEach(child => walk(child, callback));
    else if (value && typeof value === 'object') walk(value, callback);
  }
}
test('every explicitly marked main UI caption and accessible attribute has both translations', () => {
  let count = 0;
  for (const attribute of ['data-i18n', 'data-i18n-title', 'data-i18n-placeholder', 'data-i18n-aria-label', 'data-i18n-alt']) {
    $('[' + attribute + ']').each((_, node) => {requireTranslation($(node).attr(attribute), node.name + '/' + attribute); count++;});
  }
  assert.ok(count >= 50, 'the actual delivered markup must be inspected, not an empty fixture');
});
test('mixed-content captions identify existing text nodes without replacing child controls', () => {
  let count = 0;
  $('[data-i18n-nodes]').each((_, node) => {
    const entries = JSON.parse($(node).attr('data-i18n-nodes'));
    assert.ok(Array.isArray(entries) && entries.length > 0);
    for (const [index, id] of entries) {
      assert.ok(Number.isInteger(index) && index >= 0);
      assert.equal(node.children[index]?.type, 'text', node.name + ' child ' + index + ' must remain a text node');
      requireTranslation(id, node.name + '/text-node'); count++;
    }
  });
  assert.ok(count >= 8);
});
test('static interpolation parameters match their marked template fields', () => {
  let count = 0;
  $('[data-i18n-params]').each((_, node) => {
    const id = $(node).attr('data-i18n'), params = JSON.parse($(node).attr('data-i18n-params'));
    requireTranslation(id, node.name + '/params');
    const names = [...id.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map(match => match[1]);
    assert.deepEqual(Object.keys(params).sort(), [...new Set(names)].sort()); count++;
  });
  assert.ok(count > 0);
});
test('starter draft templates are paired, while the help action stays an untranslated command', () => {
  const drafts = $('[data-draft]').toArray().map(node => $(node).attr('data-draft'));
  assert.equal(drafts.filter(value => value === '/help').length, 1);
  for (const value of drafts.filter(value => value !== '/help')) requireTranslation(value, 'starter draft');
  assert.equal(drafts.length, 4);
});
test('all literal displayLabel calls resolve in both languages instead of silently using missing ids', () => {
  const source = $('script').toArray().map(node => $(node).text()).find(value => value.includes('function initializeDisplay()'));
  assert.equal(typeof source, 'string');
  const ast = espree.parse(source, {ecmaVersion: 'latest'}); let literals = 0, drafts = 0;
  walk(ast, node => {
    if (node.type !== 'CallExpression' || node.callee.type !== 'Identifier' || node.callee.name !== 'displayLabel') return;
    const id = node.arguments[0];
    if (id.type === 'Literal') {requireTranslation(id.value, 'dynamic displayLabel'); literals++; return;}
    assert.equal(id.type, 'MemberExpression'); assert.equal(id.property.name, 'draft');
    assert.equal(id.object.type, 'MemberExpression'); assert.equal(id.object.property.name, 'dataset');
    assert.equal(id.object.object.name, 'button'); drafts++;
  });
  assert.ok(literals >= 30); assert.equal(drafts, 1);
});
test('combined catalogs preserve named fields and never translate a raw user value', () => {
  const controller = createI18n({catalogs, storage: null, events: null, navigator: {languages: ['zh-CN']}});
  const original = '发送 ↑'; const node = {textContent: '', parentNode: null}; const view = controller.createView();
  view.setText(node, original); controller.setLocale('en'); assert.equal(node.textContent, original);
  view.setText(node, controller.ui('发送 ↑')); assert.equal(node.textContent, 'Send ↑');
  view.setText(node, original); controller.setLocale('zh-CN'); controller.setLocale('en'); assert.equal(node.textContent, original);
  view.close(); controller.close();
});
