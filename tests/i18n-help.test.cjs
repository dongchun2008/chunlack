'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {createI18n} = require('../identity/i18n.js');
const {documentFixture} = require('./helpers/workspace-document.cjs');
const modulePath = require.resolve('../identity/i18n.js').replace(/i18n\.js$/, 'help.js');
const helpModule = fs.existsSync(modulePath) ? require(modulePath) : {};
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};}
function response(text, options = {}) {
  return new Response(text, {status: options.status || 200, headers: {'content-type': options.type || 'text/markdown', ...options.headers}});
}
function fixture(options = {}) {
  const base = documentFixture(), doc = base.document, listeners = new Map(), calls = [];
  const counts = {subscriptions: 0, views: 0, releases: 0, ownerCloses: 0, mutations: 0};
  function events(target) {
    target.addEventListener = (name, callback) => {if (!listeners.has(target)) listeners.set(target, new Map()); const map = listeners.get(target); if (!map.has(name)) map.set(name, new Set()); map.get(name).add(callback);};
    target.removeEventListener = (name, callback) => listeners.get(target)?.get(name)?.delete(callback);
    target.emit = (name, event = {}) => {for (const callback of Array.from(listeners.get(target)?.get(name) || [])) callback(event);};
    return target;
  }
  const originalCreate = doc.createElement;
  doc.createElement = tag => decorate(originalCreate(tag));
  function decorate(node) {
    events(node);
    node.focus = () => {doc.activeElement = node;};
    node.getAttribute = name => node.attributes[name] ?? null;
    node.contains = child => {while (child) {if (child === node) return true; child = child.parentNode;} return false;};
    Object.defineProperty(node, 'isConnected', {get: () => base.walk().includes(node) || doc.head.children.includes(node)});
    return node;
  }
  events(doc); base.walk().forEach(decorate); decorate(doc.head);
  doc.activeElement = doc.body;
  const draft = doc.getElementById('messageInput'); draft.value = 'private draft <script>never()</script>'; draft.focus();
  const real = createI18n({catalogs: {'zh-CN': {...helpModule.catalogs?.['zh-CN'], 'Evidence': '证据'}, en: {...helpModule.catalogs?.en, 'Evidence': 'Evidence'}}, document: doc, storage: null, events: null, navigator: {languages: ['zh-CN']}});
  const controller = {...real,
    subscribe(fn) {counts.subscriptions++; const off = real.subscribe(fn); let active = true; return () => {if (active) {active = false; counts.subscriptions--; off();}};},
    createView() {counts.views++; const view = real.createView(); let active = true; return {...view, release(node) {counts.releases++; view.release(node);}, close() {if (active) {active = false; counts.views--; view.close();}}};},
    close() {counts.ownerCloses++; real.close();}
  };
  const fetch = (url, init) => {calls.push({url, init}); return options.fetch ? options.fetch(url, init, calls.length) : Promise.resolve(response('Original guide 成员'));};
  const help = helpModule.createHelp({document: doc, i18n: controller, fetch, ...options.bounds,
    send() {counts.mutations++;}, dispatch() {counts.mutations++;}, grant() {counts.mutations++;}});
  const nodes = () => base.walk();
  const find = predicate => nodes().find(predicate);
  const allText = () => nodes().map(node => node.textContent).join('\n');
  const guide = () => find(node => node.tagName === 'pre');
  const title = () => find(node => node.tagName === 'h2');
  const button = () => find(node => node.tagName === 'button' && node.textContent === (real.getLocale() === 'en' ? 'Close help' : '关闭帮助'));
  const listenerCount = () => Array.from(listeners.values()).reduce((sum, map) => sum + Array.from(map.values()).reduce((n, set) => n + set.size, 0), 0);
  return {doc, real, controller, help, calls, counts, draft, nodes, find, allText, guide, title, button, listenerCount,
    cleanup() {help.dispose(); real.close();}};
}

test('help factory exists and has a paired catalog', () => {
  assert.equal(typeof helpModule.createHelp, 'function', 'private help factory must be implemented');
  assert.deepEqual(Object.keys(helpModule.catalogs).sort(), ['en', 'zh-CN']);
  assert.deepEqual(Object.keys(helpModule.catalogs.en).sort(), Object.keys(helpModule.catalogs['zh-CN']).sort());
  const controller = createI18n({catalogs: helpModule.catalogs, storage: null, events: null}); controller.close();
});

test('real bilingual modal labels preserve ordinary evidence, drafts and handlers', async () => {
  const f = fixture(); const handler = () => {}; f.draft.onclick = handler;
  const plain = f.doc.createElement('p'); plain.textContent = 'Evidence'; f.doc.body.append(plain);
  f.help.open(); await tick();
  const modal = f.find(node => node.getAttribute?.('role') === 'dialog');
  assert.ok(modal); assert.equal(modal.getAttribute('aria-modal'), 'true');
  assert.equal(f.doc.getElementById(modal.getAttribute('aria-labelledby')), f.title());
  assert.equal(f.title().textContent, '工作区帮助'); assert.equal(f.button().getAttribute('aria-label'), '关闭帮助');
  const title = f.title(); f.real.setLocale('en'); await tick();
  assert.equal(f.title(), title); assert.equal(title.textContent, 'Workspace help'); assert.equal(f.button().getAttribute('aria-label'), 'Close help');
  assert.equal(plain.textContent, 'Evidence'); assert.equal(f.guide().textContent, 'Original guide 成员');
  assert.equal(f.draft.value, 'private draft <script>never()</script>'); assert.equal(f.draft.onclick, handler); f.cleanup();
});

test('guide requests use only fixed local assets, GET, omitted credentials and no redirects', async () => {
  const f = fixture(); f.help.open(); await tick(); f.real.setLocale('en'); await tick();
  assert.deepEqual(f.calls.map(call => call.url), ['/identity/help/zh-CN.md', '/identity/help/en.md']);
  for (const {init} of f.calls) {assert.equal(init.method, 'GET'); assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error'); assert.ok(init.signal instanceof AbortSignal); assert.equal(init.body, undefined);}
  f.help.dispose(); assert.equal(f.counts.mutations, 0); assert.equal(f.counts.ownerCloses, 0); assert.equal(f.real.setLocale('zh-CN'), true); f.real.close();
});

test('raw scripts and Markdown HTML are displayed exclusively as text', async () => {
  const raw = '# Guide\n<script>steal()</script>\n<img src=x onerror=steal()>\n**成员**';
  const f = fixture({fetch: async () => response(raw)}); f.help.open(); await tick();
  assert.equal(f.guide().textContent, raw); assert.equal(f.nodes().some(node => ['script', 'img', 'iframe'].includes(node.tagName)), false); f.cleanup();
});

test('invalid profiles reject before DOM, focus, requests or subscriptions change', () => {
  const f = fixture();
  for (const profile of ['admin', '../en.md', '', null, {}, false]) assert.throws(() => f.help.open({profile}), /invalid_help_profile/);
  assert.equal(f.calls.length, 0); assert.equal(f.counts.views, 0); assert.equal(f.counts.subscriptions, 0); assert.equal(f.listenerCount(), 0); assert.equal(f.doc.activeElement, f.draft);
  f.help.open(); const title = f.title(); const request = f.calls[0];
  assert.throws(() => f.help.open({profile: 'https://bad.invalid'}), /invalid_help_profile/);
  assert.equal(f.title(), title); assert.equal(request.init.signal.aborted, false); f.cleanup();
});

test('login offers only Pocket ID onboarding without loading workspace guides or commands', () => {
  const f = fixture(); f.help.open({profile: 'login'});
  assert.equal(f.title().textContent, '登录帮助'); assert.match(f.allText(), /Pocket ID/);
  assert.doesNotMatch(f.allText(), /\/help|\/spawn|\/bash|@Agent/); assert.equal(f.calls.length, 0);
  f.real.setLocale('en'); assert.equal(f.title().textContent, 'Sign-in help'); assert.match(f.allText(), /membership/); assert.equal(f.calls.length, 0); f.cleanup();
});

test('workspace describes local commands and policy without exposing legacy host actions', async () => {
  const f = fixture(); f.help.open(); await tick(); f.real.setLocale('en'); await tick();
  const text = f.allText();
  for (const spelling of ['@Agent', '/help', '/spawn', '/ground', '/siphon <topic>', '/stop']) assert.ok(text.includes(spelling), spelling);
  assert.match(text, /existing form/); assert.match(text, /cost/); assert.match(text, /not a global emergency stop/); assert.match(text, /membership and permissions/);
  assert.match(text, /does not expose \/bash, \/pull, host files, cron, or reset paths/);
  assert.doesNotMatch(text, /\/tree|\/graph/); assert.match(text, /does not grant Events or Agent permissions/);
  assert.match(text, /does not translate user messages, model output, or evidence/); assert.equal(f.counts.mutations, 0); f.cleanup();
});

test('legacy preserves command spelling in both languages and still requires server policy', async () => {
  const f = fixture(); f.help.open({profile: 'legacy'}); await tick();
  for (const locale of ['zh-CN', 'en']) {
    f.real.setLocale(locale); await tick();
    for (const spelling of ['/help', '/spawn', '/ground', '/siphon <topic>', '/stop', '/tree', '/graph']) assert.ok(f.allText().includes(spelling), spelling);
  }
  assert.equal(f.title().textContent, 'Legacy help'); assert.match(f.allText(), /server policy/); assert.match(f.allText(), /never executes commands/); assert.equal(f.counts.mutations, 0); f.cleanup();
});

test('reader enforces byte limits without relying on content-length or calling text()', async () => {
  let canceled = 0, reads = 0, textCalls = 0;
  const f = fixture({bounds: {maxBytes: 8}, fetch: async () => ({ok: true, headers: new Headers({'content-type': 'text/markdown'}), body: {getReader: () => ({read: async () => (++reads === 1 ? {done: false, value: new Uint8Array(9)} : {done: true}), cancel() {canceled++;}, releaseLock() {}})}, text() {textCalls++; throw new Error('unbounded');}})});
  f.help.open(); await tick(); assert.equal(reads, 1); assert.ok(canceled >= 1); assert.equal(textCalls, 0); assert.equal(f.guide().textContent, ''); assert.match(f.allText(), /无法加载使用手册，请稍后重试。/); f.cleanup();
});

test('UTF-8 split across chunks is decoded intact at the exact byte limit', async () => {
  const bytes = new TextEncoder().encode('中英文');
  const f = fixture({bounds: {maxBytes: 9}, fetch: async () => response(new ReadableStream({start(controller) {controller.enqueue(bytes.slice(0, 1)); controller.enqueue(bytes.slice(1, 4)); controller.enqueue(bytes.slice(4)); controller.close();}}))});
  f.help.open(); await tick(); assert.equal(f.guide().textContent, '中英文'); f.cleanup();
});

test('failed, HTML, empty, oversized and malformed responses yield only localized generic errors', async () => {
  const cases = [() => response('PRIVATE_URL_TOKEN', {status: 403}), () => response('<html>PRIVATE_URL_TOKEN</html>', {type: 'text/html'}), () => response(' \n'), () => response('ok', {headers: {'content-length': '262145'}}), () => response(new Uint8Array([0xff])), () => ({ok: true, headers: new Headers({'content-type': 'text/markdown'}), text: async () => 'PRIVATE_URL_TOKEN'}), () => {throw new Error('https://PRIVATE_URL_TOKEN');}];
  for (const fetch of cases) {
    const f = fixture({fetch}); f.help.open(); await tick(); assert.match(f.allText(), /无法加载使用手册，请稍后重试。/); assert.doesNotMatch(f.allText(), /PRIVATE_URL_TOKEN/);
    f.real.setLocale('en'); await tick(); assert.match(f.allText(), /Unable to load the guide\. Please try again later\./); assert.equal(f.guide().textContent, ''); f.cleanup();
  }
});

test('language changes abort pending fetches and discard prior-language late responses', async () => {
  const pending = deferred(); const f = fixture({fetch: (url, init, number) => number === 1 ? pending.promise : Promise.resolve(response('English current guide'))});
  f.help.open(); f.real.setLocale('en'); await tick();
  assert.equal(f.calls[0].init.signal.aborted, true); assert.equal(f.guide().textContent, 'English current guide');
  pending.resolve(response('迟到旧中文')); await tick(); assert.equal(f.guide().textContent, 'English current guide'); assert.equal(f.title().textContent, 'Workspace help'); f.cleanup();
});

test('language changes during pending reader cancel it and cannot overwrite newer text', async () => {
  const pending = deferred(); let canceled = 0;
  const f = fixture({fetch: (url, init, number) => number === 1 ? Promise.resolve({ok: true, headers: new Headers({'content-type': 'text/plain'}), body: {getReader: () => ({read: () => pending.promise, cancel() {canceled++;}, releaseLock() {}})}}) : Promise.resolve(response('Current English'))});
  f.help.open(); await tick(); f.real.setLocale('en'); await tick(); assert.ok(canceled >= 1); assert.equal(f.guide().textContent, 'Current English');
  pending.resolve({done: false, value: new TextEncoder().encode('old Chinese')}); await tick(); assert.equal(f.guide().textContent, 'Current English'); f.cleanup();
});

test('close aborts pending readers, releases labels, restores focus and ignores late callbacks', async () => {
  const pending = deferred(); let canceled = 0;
  const f = fixture({fetch: async () => ({ok: true, headers: new Headers({'content-type': 'text/plain'}), body: {getReader: () => ({read: () => pending.promise, cancel() {canceled++;}, releaseLock() {}})}})});
  f.help.open(); await tick(); const oldTitle = f.title(), oldGuide = f.guide();
  f.help.close(); assert.equal(f.calls[0].init.signal.aborted, true); assert.ok(canceled >= 1); assert.equal(f.doc.activeElement, f.draft); assert.equal(f.counts.releases, 1); assert.equal(f.counts.views, 0); assert.equal(f.listenerCount(), 0);
  f.real.setLocale('en'); pending.resolve({done: true}); await tick(); assert.equal(oldTitle.textContent, '工作区帮助'); assert.equal(oldGuide.textContent, ''); assert.equal(f.title(), undefined); assert.equal(f.calls.length, 1); f.cleanup();
});

test('timeout aborts a fetch that ignores signals and cannot display its late success', async () => {
  const pending = deferred(); const f = fixture({bounds: {timeoutMs: 15}, fetch: () => pending.promise});
  f.help.open(); await new Promise(resolve => f.calls[0].init.signal.addEventListener('abort', resolve, {once: true})); await tick();
  assert.equal(f.calls[0].init.signal.aborted, true); assert.match(f.allText(), /无法加载使用手册，请稍后重试。/);
  pending.resolve(response('too late')); await tick(); assert.equal(f.guide().textContent, ''); f.cleanup();
});

test('reopening invalidates old generations and installs one close and keyboard listener', async () => {
  const pending = deferred(); const f = fixture({fetch: (url, init, n) => n === 1 ? pending.promise : Promise.resolve(response('new generation'))});
  f.help.open(); f.help.open({profile: 'legacy'}); await tick(); assert.equal(f.calls[0].init.signal.aborted, true); assert.equal(f.counts.views, 1); assert.equal(f.counts.subscriptions, 1); assert.equal(f.listenerCount(), 2);
  pending.resolve(response('old generation')); await tick(); assert.equal(f.guide().textContent, 'new generation');
  f.button().emit('click'); assert.equal(f.title(), undefined); assert.equal(f.listenerCount(), 0);
  f.real.setLocale('en'); assert.equal(f.calls.length, 2); f.help.open(); await tick(); assert.equal(f.calls[2].url, '/identity/help/en.md'); f.cleanup();
});

test('Escape closes and Tab retains modal focus without changing business controls', () => {
  const f = fixture(); let prevented = 0; f.help.open(); const button = f.button(); assert.equal(f.doc.activeElement, button);
  f.doc.emit('keydown', {key: 'Tab', preventDefault() {prevented++;}}); assert.equal(f.doc.activeElement, button);
  f.doc.emit('keydown', {key: 'Escape', preventDefault() {prevented++;}}); assert.equal(prevented, 2); assert.equal(f.title(), undefined); assert.equal(f.doc.activeElement, f.draft); f.cleanup();
});

test('dispose is idempotent, removes owned styles/listeners and never closes its controller', async () => {
  const pending = deferred(); const f = fixture({fetch: () => pending.promise}); f.help.open(); const old = f.title();
  f.help.dispose(); f.help.dispose(); f.help.close();
  assert.equal(f.calls[0].init.signal.aborted, true); assert.equal(f.doc.head.children.length, 0); assert.equal(f.listenerCount(), 0); assert.equal(f.counts.views, 0); assert.equal(f.counts.subscriptions, 0); assert.equal(f.counts.ownerCloses, 0); assert.equal(f.counts.mutations, 0);
  f.real.setLocale('en'); pending.resolve(response('late')); await tick(); assert.equal(old.textContent, '工作区帮助'); assert.equal(f.help.open(), false); assert.equal(f.title(), undefined); assert.equal(f.calls.length, 1); f.real.close();
});

test('unsafe or unbounded options are rejected before creating UI or making requests', () => {
  const f = fixture();
  assert.throws(() => helpModule.createHelp({document: f.doc, fetch: async () => response('no')}), /help_controller_required/);
  for (const bounds of [{maxBytes: 0}, {maxBytes: 262145}, {maxBytes: Infinity}, {timeoutMs: 0}, {timeoutMs: 10001}]) assert.throws(() => helpModule.createHelp({document: f.doc, i18n: f.controller, fetch: async () => response('no'), ...bounds}), /invalid_help_bounds/);
  assert.equal(f.calls.length, 0); assert.equal(f.doc.head.children.length, 0); f.cleanup();
});
