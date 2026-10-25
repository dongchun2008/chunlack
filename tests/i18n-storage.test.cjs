'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createWorkspaceClient} = require('../identity/workspace-ui.js');
const {createI18n} = require('../identity/i18n.js');
function storage(entries = []) {
  const values = new Map(entries), removed = [];
  return {values, removed, get length() {return values.size;}, key: i => [...values.keys()][i],
    getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value),
    removeItem(key) {removed.push(key); values.delete(key);}};
}
function client(local, session = null) {
  return createWorkspaceClient({fetch: async () => {throw new Error('No network permitted');}, storage: session,
    legacyStorage: local, WebSocket: function() {throw new Error('No socket permitted');}, location: {origin: 'https://fixture.invalid'}});
}

test('client construction retains only canonical language preferences in the dedicated display namespace', () => {
  const values = [
    ['chunlack.ui.locale.v1.anonymous', 'en'],
    ['chunlack.ui.locale.v1.user:account-A', 'zh-CN'],
    ['chunlack.ui.locale.v1.user:account-B', 'en']
  ];
  const store = storage(values), c = client(store);
  try {assert.deepEqual([...store.values], values); assert.deepEqual(store.removed, []);} finally {c.close();}
});

test('legacy session, token, CSRF and other owned caches are still removed while unrelated data and the existing explicit preferences remain', () => {
  const store = storage([
    ['lack_session', 'SYNTHETIC_SESSION_ONLY'], ['lack_token', 'SYNTHETIC_TOKEN_ONLY'],
    ['chunlack.csrf', 'SYNTHETIC_CSRF_ONLY'], ['lack_username', 'old display name'],
    ['chunlack.workspaceId', 'workspace-A'], ['lack_theme', 'dark'], ['other.application', 'untouched'],
    ['chunlack.ui.locale.v1.user:account-A', 'en']
  ]), c = client(store);
  try {
    assert.deepEqual(store.removed.sort(), ['chunlack.csrf', 'lack_session', 'lack_token', 'lack_username']);
    assert.deepEqual([...store.values], [['chunlack.workspaceId', 'workspace-A'], ['lack_theme', 'dark'], ['other.application', 'untouched'], ['chunlack.ui.locale.v1.user:account-A', 'en']]);
  } finally {c.close();}
});

test('locale-looking keys cannot retain token-shaped, noncanonical or malformed data', () => {
  const entries = [
    ['chunlack.ui.locale.v1.user:account-A', 'SYNTHETIC_SESSION_VALUE_TOO_LONG_FOR_A_LANGUAGE'],
    ['chunlack.ui.locale.v1.user:account-B', 'en-us'],
    ['chunlack.ui.locale.v1.user:account-C', '<script>bad()</script>'],
    ['chunlack.ui.locale.v1.user:account-D', 'Bearer token.value'],
    ['chunlack.ui.locale.v1.anonymous.extra', 'en'],
    ['chunlack.ui.locale.v1.user:', 'en'],
    ['chunlack.ui.locale.v1.user:bad%GG', 'en'],
    ['chunlack.ui.locale.v1.user:bad\nkey', 'en']
  ];
  const store = storage(entries), c = client(store);
  try {assert.equal(store.values.size, 0); assert.equal(store.removed.length, entries.length);} finally {c.close();}
});

test('additional canonical locale packs remain compatible without hard-coding only the first two languages into cleanup', () => {
  const entries = [['chunlack.ui.locale.v1.user:account-A', 'de'], ['chunlack.ui.locale.v1.user:account-B', 'pt-BR'], ['chunlack.ui.locale.v1.user:account-C', 'sr-Latn-RS']];
  const store = storage(entries), c = client(store);
  try {assert.deepEqual([...store.values], entries);} finally {c.close();}
});

test('the same narrow cleanup applies to both supplied browser stores', () => {
  const local = storage([['chunlack.ui.locale.v1.user:account-A', 'en'], ['lack_token', 'LOCAL_SYNTHETIC']]);
  const session = storage([['chunlack.ui.locale.v1.anonymous', 'zh-CN'], ['chunlack.csrf', 'SESSION_SYNTHETIC']]);
  const c = client(local, session);
  try {
    assert.deepEqual([...local.values], [['chunlack.ui.locale.v1.user:account-A', 'en']]);
    assert.deepEqual([...session.values], [['chunlack.ui.locale.v1.anonymous', 'zh-CN']]);
  } finally {c.close();}
});

test('blocked preference reads do not interrupt client construction or disclose the exception', () => {
  const store = {length: 1, key: () => 'chunlack.ui.locale.v1.anonymous', getItem() {throw new Error('PRIVATE_STORAGE_ERROR');}, removeItem() {}};
  const c = client(store); c.close();
});

test('a language selected for a human survives real client construction and a fresh locale controller', () => {
  const store = storage(), options = {storage: store, navigator: {languages: []}, events: null};
  const first = createI18n(options); first.setUser('account-A'); first.setLocale('en'); first.close();
  const c = client(store); c.close();
  const second = createI18n(options); second.setUser('account-A');
  try {assert.equal(second.getLocale(), 'en'); second.setUser('account-B'); assert.equal(second.getLocale(), 'zh-CN');} finally {second.close();}
});
