'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createI18n} = require('../identity/i18n.js');
const catalogs = {
  'zh-CN': {'Language': '语言', '成员': '成员', 'Hello {name}': '你好 {name}', 'Count {count}': '数量 {count}', 'Only fallback': '仅回退文案', 'Outer {value}': '外层 {value}'},
  en: {'Language': 'Language', '成员': 'Members', 'Hello {name}': 'Hello {name}', 'Count {count}': 'Count {count}', 'Outer {value}': 'Outer {value}'}
};
function storage() {
  const values = new Map(), writes = [];
  return {values, writes, getItem: key => values.get(key) ?? null, setItem(key, value) {values.set(key, value); writes.push([key, value]);}};
}
function events() {
  const handlers = new Set();
  return {handlers, addEventListener(name, fn) {assert.equal(name, 'storage'); handlers.add(fn);}, removeEventListener(name, fn) {assert.equal(name, 'storage'); handlers.delete(fn);}, emit(event) {for (const fn of [...handlers]) fn(event);}};
}
function make(options = {}) {return createI18n({catalogs, storage: null, navigator: {languages: []}, events: null, ...options});}
function element(parentNode = null) {
  const attributes = new Map();
  const value = {textContent: '', innerText: '', title: '', placeholder: '', parentNode,
    setAttribute(name, text) {attributes.set(name, text);}, getAttribute: name => attributes.get(name)};
  Object.defineProperty(value, 'innerHTML', {set() {throw new Error('HTML insertion is forbidden');}});
  return value;
}

test('browser preferences normalize English and Chinese variants with a Chinese fallback', () => {
  for (const [languages, expected] of [[['fr-FR', 'en-GB'], 'en'], [['zh-Hant'], 'zh-CN'], [[], 'zh-CN'], [[null, 3, 'xx'], 'zh-CN']]) {
    const i18n = make({navigator: {languages}});
    assert.equal(i18n.getLocale(), expected); i18n.close();
  }
});

test('explicit language choice updates the document and persists only a display preference', () => {
  const store = storage(), document = {documentElement: {lang: ''}}, i18n = make({storage: store, document});
  assert.equal(i18n.setLocale('en-US'), true);
  assert.equal(document.documentElement.lang, 'en');
  assert.deepEqual(store.writes, [['chunlack.ui.locale.v1.anonymous', 'en']]);
  assert.equal(i18n.setLocale('fr'), false); assert.equal(i18n.getLocale(), 'en');
  assert.equal(store.writes.length, 1); i18n.close();
});

test('anonymous, account A and account B keep separate preferences across workspace-independent reuse', () => {
  const store = storage(), i18n = make({storage: store});
  i18n.setLocale('en'); i18n.setUser('account-A'); assert.equal(i18n.getLocale(), 'zh-CN');
  i18n.setLocale('en'); i18n.setUser('account-B'); assert.equal(i18n.getLocale(), 'zh-CN');
  i18n.setLocale('zh-CN'); i18n.setUser('account-A'); assert.equal(i18n.getLocale(), 'en');
  i18n.setUser('account-A'); assert.equal(i18n.getLocale(), 'en');
  i18n.setUser(null); assert.equal(i18n.getLocale(), 'en');
  assert.deepEqual([...store.values.keys()].sort(), ['chunlack.ui.locale.v1.anonymous', 'chunlack.ui.locale.v1.user:account-A', 'chunlack.ui.locale.v1.user:account-B']);
  i18n.close();
});

test('a fresh controller restores a canonical account preference without using anonymous preference', () => {
  const store = storage(); store.values.set('chunlack.ui.locale.v1.anonymous', 'en');
  store.values.set('chunlack.ui.locale.v1.user:account-A', 'zh-CN');
  const i18n = make({storage: store}); assert.equal(i18n.getLocale(), 'en');
  i18n.setUser('account-A'); assert.equal(i18n.getLocale(), 'zh-CN'); i18n.close();
});

test('blocked storage retains in-page choices and never exposes storage error details', () => {
  const diagnostics = [], broken = {getItem() {throw new Error('PRIVATE_VALUE');}, setItem() {throw new Error('PRIVATE_VALUE');}};
  const i18n = make({storage: broken, onError: error => diagnostics.push(error)});
  i18n.setUser('account-A'); i18n.setLocale('en'); i18n.setUser('account-B'); i18n.setUser('account-A');
  assert.equal(i18n.getLocale(), 'en'); assert.ok(diagnostics.length);
  assert.ok(diagnostics.every(value => JSON.stringify(value) === '{"code":"locale_storage_unavailable"}')); i18n.close();
});

test('malformed stored preferences are ignored rather than evaluated or normalized into consent', () => {
  for (const text of ['en-US', '{}', '<script>bad()</script>', 'fr', '', 'null']) {
    const store = storage(); store.values.set('chunlack.ui.locale.v1.anonymous', text);
    const i18n = make({storage: store}); assert.equal(i18n.getLocale(), 'zh-CN'); assert.equal(store.writes.length, 0); i18n.close();
  }
});

test('invalid identity labels cannot alter the active preference or storage', () => {
  const store = storage(), i18n = make({storage: store}); i18n.setUser('valid');
  for (const id of ['', {}, 1, 'a\nb', 'x'.repeat(257)]) assert.throws(() => i18n.setUser(id), /invalid_locale_user/);
  i18n.setLocale('en'); assert.equal(store.writes[0][0], 'chunlack.ui.locale.v1.user:valid'); i18n.close();
});

test('storage events apply only to the current account and correct storage area', () => {
  const store = storage(), target = events(), i18n = make({storage: store, events: target});
  i18n.setUser('account-A');
  target.emit({key: 'chunlack.ui.locale.v1.user:account-B', newValue: 'en'}); assert.equal(i18n.getLocale(), 'zh-CN');
  target.emit({key: 'chunlack.ui.locale.v1.user:account-A', newValue: 'en', storageArea: {}}); assert.equal(i18n.getLocale(), 'zh-CN');
  target.emit({key: 'chunlack.ui.locale.v1.user:account-A', newValue: 'en', storageArea: store}); assert.equal(i18n.getLocale(), 'en');
  target.emit({key: 'chunlack.ui.locale.v1.user:account-A', newValue: 'unsupported'}); assert.equal(i18n.getLocale(), 'en');
  target.emit({key: 'chunlack.ui.locale.v1.user:account-A', newValue: null}); assert.equal(i18n.getLocale(), 'zh-CN'); i18n.close();
});

test('closing removes the storage listener and prevents later writes or locale changes', () => {
  const store = storage(), target = events(), i18n = make({storage: store, events: target});
  assert.equal(target.handlers.size, 1); i18n.close(); i18n.close();
  assert.equal(target.handlers.size, 0); assert.equal(i18n.setLocale('en'), false); assert.equal(i18n.setUser('other'), false);
  assert.equal(store.writes.length, 0); assert.throws(() => i18n.createView(), /locale_controller_closed/);
});

test('controller instances do not share users, language state or listeners', () => {
  const one = make(), two = make(); one.setLocale('en'); one.setUser('one'); one.setLocale('en');
  assert.equal(two.getLocale(), 'zh-CN'); one.close(); two.setLocale('en'); assert.equal(two.getLocale(), 'en'); two.close();
});

test('missing translations fall back to Chinese then the literal message ID', () => {
  const i18n = make(); i18n.setLocale('en');
  assert.equal(i18n.text(i18n.ui('Only fallback')), '仅回退文案');
  assert.equal(i18n.text(i18n.ui('Uncatalogued text')), 'Uncatalogued text'); i18n.close();
});

test('named parameters preserve zero, false and source text without HTML insertion', () => {
  const i18n = make(), view = i18n.createView(), output = element(), quote = '<img src=x onerror=bad()>成员';
  view.setText(output, i18n.ui('Hello {name}', {name: quote}));
  assert.equal(output.textContent, '你好 ' + quote);
  assert.equal(i18n.text(i18n.ui('Count {count}', {count: 0})), '数量 0');
  assert.equal(i18n.text(i18n.ui('Count {count}', {count: false})), '数量 false');
  i18n.setLocale('en'); assert.equal(output.textContent, 'Hello ' + quote); i18n.close();
});

test('only branded labels update; identical user content and forged label-shaped objects remain raw data', () => {
  const i18n = make(), view = i18n.createView(), label = element(), message = element(), forged = element();
  view.setText(label, i18n.ui('成员')); view.setText(message, '成员'); view.setText(forged, {id: '成员', params: {}});
  i18n.setLocale('en'); assert.equal(label.textContent, 'Members'); assert.equal(message.textContent, '成员');
  assert.equal(forged.textContent, '[object Object]'); i18n.close();
});

test('replacing a branded binding with API data unregisters the stale translation', () => {
  const i18n = make(), view = i18n.createView(), output = element();
  view.setText(output, i18n.ui('成员')); view.setText(output, 'original evidence');
  i18n.setLocale('en'); assert.equal(output.textContent, 'original evidence'); i18n.close();
});

test('switching language updates text and accessible attributes without changing inputs, handlers or message data', () => {
  const i18n = make(), view = i18n.createView(), output = element(), handler = () => {};
  output.value = 'unsent private draft'; output.onclick = handler;
  view.setText(output, i18n.ui('成员')); view.setAttribute(output, 'aria-label', i18n.ui('Language'));
  view.setProperty(output, 'placeholder', i18n.ui('Language'));
  i18n.setLocale('en'); assert.equal(output.textContent, 'Members'); assert.equal(output.getAttribute('aria-label'), 'Language');
  assert.equal(output.placeholder, 'Language'); assert.equal(output.value, 'unsent private draft'); assert.equal(output.onclick, handler); i18n.close();
});

test('a released subtree cannot be changed by later language events', () => {
  const i18n = make(), view = i18n.createView(), panel = element(), old = element(panel), active = element();
  view.setText(old, i18n.ui('成员')); view.setText(active, i18n.ui('成员')); view.release(panel);
  i18n.setLocale('en'); assert.equal(old.textContent, '成员'); assert.equal(active.textContent, 'Members'); i18n.close();
});

test('closed views ignore late rendering and unsubscribe without affecting other views', () => {
  const i18n = make(), first = i18n.createView(), second = i18n.createView(), a = element(), b = element();
  first.setText(a, i18n.ui('成员')); second.setText(b, i18n.ui('成员')); first.close();
  assert.equal(first.setText(a, 'late callback'), false); i18n.setLocale('en');
  assert.equal(a.textContent, '成员'); assert.equal(b.textContent, 'Members'); i18n.close();
});

test('controller close also retires every owned view', () => {
  const i18n = make(), view = i18n.createView(), value = element(); view.setText(value, i18n.ui('成员'));
  i18n.close(); assert.equal(view.setText(value, 'late'), false); assert.equal(value.textContent, '成员');
});

test('unsafe HTML, URL and input-value bindings are rejected before mutation', () => {
  const i18n = make(), view = i18n.createView(), output = element();
  for (const name of ['innerHTML', 'value', 'src', 'onclick', '__proto__']) assert.throws(() => view.setProperty(output, name, i18n.ui('成员')), /unsafe_locale_property/);
  for (const name of ['href', 'src', 'style', 'onclick', 'value']) assert.throws(() => view.setAttribute(output, name, i18n.ui('成员')), /unsafe_locale_attribute/);
  assert.equal(output.textContent, ''); i18n.close();
});

test('catalog placeholder mismatches fail before a partial controller can be created', () => {
  for (const text of ['Hello', 'Hello {other}', 'Hello {name} {extra}']) {
    assert.throws(() => make({catalogs: {'zh-CN': {'Hello {name}': '你好 {name}'}, en: {'Hello {name}': text}}}), /translation_placeholder_mismatch/);
  }
});

test('catalogs and label parameters are copied without mutating caller-owned values', () => {
  const custom = structuredClone(catalogs), params = {name: 'original'}, i18n = make({catalogs: custom});
  const label = i18n.ui('Hello {name}', params); custom['zh-CN']['Hello {name}'] = 'changed {name}'; params.name = 'changed';
  assert.equal(i18n.text(label), '你好 original'); assert.equal(String(label), '你好 original');
  assert.equal(JSON.stringify(label), '"你好 original"'); i18n.close();
});

test('nested labels resolve under the current language while arbitrary parameter objects are rejected', () => {
  const i18n = make(), value = i18n.ui('Outer {value}', {value: i18n.ui('成员')});
  assert.equal(i18n.text(value), '外层 成员'); i18n.setLocale('en'); assert.equal(i18n.text(value), 'Outer Members');
  assert.throws(() => i18n.ui('Hello {name}', {name: {toString() {throw new Error('must not execute');}}}), /invalid_locale_parameter/); i18n.close();
});

test('a faulty observer cannot suppress other views or reveal its exception details', () => {
  const diagnostics = [], i18n = make({onError: value => diagnostics.push(value)}), view = i18n.createView(), output = element();
  i18n.subscribe(() => {throw new Error('PRIVATE_OBSERVER_VALUE');}); view.setText(output, i18n.ui('成员')); i18n.setLocale('en');
  assert.equal(output.textContent, 'Members'); assert.deepEqual(diagnostics, [{code: 'locale_listener_failed'}]); i18n.close();
});

test('additional static locale packs can be selected without changing controller logic', () => {
  const i18n = make({catalogs: {...catalogs, de: {'Language': 'Sprache'}}});
  assert.deepEqual(i18n.supportedLocales(), ['zh-CN', 'en', 'de']); assert.equal(i18n.setLocale('de-DE'), true);
  assert.equal(i18n.text(i18n.ui('Language')), 'Sprache'); assert.equal(i18n.text(i18n.ui('成员')), '成员'); i18n.close();
});
