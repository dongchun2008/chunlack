'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const filename = path.resolve(__dirname, '../identity/help-assets.cjs');
const assets = fs.existsSync(filename) ? require(filename) : {};
const cases = [
  ['/identity/i18n.js', 'identity/i18n.js', 'application/javascript; charset=utf-8', '/* locale 中文 */'],
  ['/identity/display.js', 'identity/display.js', 'application/javascript; charset=utf-8', '/* shared display */'],
  ['/identity/messages.js', 'identity/messages.js', 'application/javascript; charset=utf-8', '/* messages */'],
  ['/identity/chat-messages.js', 'identity/chat-messages.js', 'application/javascript; charset=utf-8', '/* chat */'],
  ['/identity/help.js', 'identity/help.js', 'application/javascript; charset=utf-8', '/* private help */'],
  ['/identity/help/zh-CN.md', 'identity/help/zh-CN.md', 'text/plain; charset=utf-8', '# 中文手册\n<script>text only</script>'],
  ['/identity/help/en.md', 'identity/help/en.md', 'text/plain; charset=utf-8', '# Complete English guide']
];
function fixture(t) {
  const parent = path.resolve(os.tmpdir());
  const temp = fs.mkdtempSync(path.join(parent, 'chunlack-display-assets-'));
  const root = path.join(temp, 'code'), outside = path.join(temp, 'outside');
  fs.mkdirSync(path.join(root, 'identity', 'help'), {recursive: true}); fs.mkdirSync(outside);
  for (const [, relative, , text] of cases) fs.writeFileSync(path.join(root, relative), text);
  fs.writeFileSync(path.join(outside, 'en.md'), 'SECRET_OUTSIDE_GUIDE');
  fs.writeFileSync(path.join(root, '.env'), 'SECRET_ROOT_ENV');
  fs.writeFileSync(path.join(root, 'identity', 'help', '.env'), 'SECRET_HELP_ENV');
  fs.writeFileSync(path.join(root, 'identity', 'help', 'credentials.json'), 'SECRET_CREDENTIALS');
  t.after(() => {
    // Only remove the exact synthetic fixture directory, never a computed ancestor.
    assert.equal(path.dirname(temp), parent); assert.ok(path.basename(temp).startsWith('chunlack-display-assets-'));
    fs.rmSync(temp, {recursive: true, force: true});
  });
  return {root, outside, temp, handler: assets.createDisplayAssetHandler({codeRoot: root})};
}
function invoke(handler, url, method = 'GET') {
  const result = {status: 200, headers: {}, body: Buffer.alloc(0), next: 0, ended: false};
  const res = {
    statusCode: 200,
    setHeader(name, value) {result.headers[name.toLowerCase()] = String(value);},
    end(value) {result.status = this.statusCode; result.ended = true; if (value !== undefined) result.body = Buffer.from(value);}
  };
  handler({url, method}, res, () => {result.next++;}); return result;
}
function security(result) {
  assert.equal(result.headers['x-content-type-options'], 'nosniff');
  assert.equal(result.headers['cache-control'], 'no-store');
  assert.equal(result.headers['referrer-policy'], 'no-referrer');
}
function refused(result, method = 'GET') {
  assert.equal(result.status, 404); assert.equal(result.next, 0); assert.equal(result.ended, true); security(result);
  assert.equal(result.body.toString(), method === 'HEAD' ? '' : 'Not found\n');
}

test('display asset factory is available', () => {
  assert.equal(typeof assets.createDisplayAssetHandler, 'function', 'fixed display asset factory must be implemented');
});

test('GET serves all seven fixed UTF-8 assets with exact MIME, bytes and security headers', t => {
  const f = fixture(t);
  for (const [url, , mime, text] of cases) {
    const result = invoke(f.handler, url);
    assert.equal(result.status, 200); assert.equal(result.next, 0); assert.equal(result.ended, true);
    assert.equal(result.headers['content-type'], mime); assert.equal(result.headers['content-length'], String(Buffer.byteLength(text)));
    assert.deepEqual(result.body, Buffer.from(text)); security(result);
  }
});

test('HEAD returns GET metadata without a body for each asset', t => {
  const f = fixture(t);
  for (const [url, , mime, text] of cases) {
    const result = invoke(f.handler, url, 'HEAD');
    assert.equal(result.status, 200); assert.equal(result.next, 0); assert.equal(result.ended, true);
    assert.equal(result.headers['content-type'], mime); assert.equal(result.headers['content-length'], String(Buffer.byteLength(text)));
    assert.equal(result.body.length, 0); security(result);
  }
});

test('non-GET/HEAD methods cannot read or mutate any display asset', t => {
  const f = fixture(t);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'get']) {
    const result = invoke(f.handler, '/identity/help/en.md', method);
    assert.equal(result.status, 405); assert.equal(result.headers.allow, 'GET, HEAD'); assert.equal(result.next, 0);
    assert.equal(result.body.toString(), 'Method not allowed\n'); security(result);
  }
  assert.equal(fs.readFileSync(path.join(f.root, 'identity/help/en.md'), 'utf8'), '# Complete English guide');
});

test('unknown help paths, directories and alternate spellings return generic 404', t => {
  const f = fixture(t);
  for (const url of ['/identity/help', '/identity/help/', '/identity/help/fr.md', '/identity/help/EN.md', '/identity/help/en.md/', '/identity/help/en.md#fragment', '/identity/help.js/private', '/identity/i18n.js/private']) refused(invoke(f.handler, url));
  refused(invoke(f.handler, '/identity/help/missing.md', 'HEAD'), 'HEAD');
});

test('encoded, double-encoded and traversal paths never select an asset or escape the root', t => {
  const f = fixture(t);
  for (const url of ['/identity/help/../en.md', '/identity/help/../../.env', '/identity/help/%2e%2e/%2e%2e/.env', '/identity/help/%252e%252e/.env', '/identity/help/%65n.md', '/%69dentity/help/en.md', '/identity/%69%31%38%6e.js', '/identity/../identity/i18n.js', '/identity/help\\..\\.env', '/identity/help/%00en.md', '/identity/help/%ZZ']) refused(invoke(f.handler, url));
});

test('queries are rejected for every asset, including empty queries', t => {
  const f = fixture(t);
  for (const [url] of cases) for (const suffix of ['?', '?v=1', '?file=../../.env']) refused(invoke(f.handler, url + suffix));
});

test('business and existing workspace-ui routes pass through untouched, including queries and methods', t => {
  const f = fixture(t);
  for (const url of ['/identity/workspace-ui.js', '/identity/workspace-ui.js?v=1', '/identity/login', '/identity/session?view=1', '/api/messages', '/health', '/']) {
    for (const method of ['GET', 'HEAD', 'POST']) {
      const result = invoke(f.handler, url, method);
      assert.equal(result.next, 1); assert.equal(result.ended, false); assert.deepEqual(result.headers, {}); assert.equal(result.body.length, 0);
    }
  }
});

test('sensitive files are never served, even when they exist beside or inside help assets', t => {
  const f = fixture(t);
  for (const url of ['/identity/help/.env', '/identity/help/credentials.json', '/identity/help/../../../outside/en.md']) refused(invoke(f.handler, url));
  for (const url of ['/.env', '/identity/credentials.json', '/identity/help-assets.cjs', '/identity/i18n.js.map']) {
    const result = invoke(f.handler, url); assert.equal(result.next, 1); assert.equal(result.ended, false); assert.equal(result.body.length, 0);
  }
});

test('missing assets and directory replacements fail closed without filesystem details', t => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.root, 'identity/help/en.md'));
  refused(invoke(f.handler, '/identity/help/en.md')); refused(invoke(f.handler, '/identity/help/en.md', 'HEAD'), 'HEAD');
  fs.mkdirSync(path.join(f.root, 'identity/help/en.md'));
  refused(invoke(f.handler, '/identity/help/en.md'));
  assert.equal(invoke(f.handler, '/identity/i18n.js').status, 200);
});

test('invalid or nonexistent roots are rejected without disclosing input paths', t => {
  const f = fixture(t);
  for (const codeRoot of [undefined, null, '', '.', '../code', {}, path.join(f.root, 'missing'), path.join(f.root, '.env')]) {
    assert.throws(() => assets.createDisplayAssetHandler({codeRoot}), error => error instanceof TypeError && error.message === 'invalid_display_asset_root');
  }
  assert.throws(() => assets.createDisplayAssetHandler(), /invalid_display_asset_root/);
});

test('deleted roots fail closed on subsequent requests', t => {
  const f = fixture(t), renamed = path.join(f.temp, 'renamed-code');
  fs.renameSync(f.root, renamed);
  refused(invoke(f.handler, '/identity/help/en.md'));
});

test('symlink directory escapes, including replacement after factory creation, are refused', t => {
  const f = fixture(t), saved = path.join(f.root, 'identity', 'original-help');
  fs.renameSync(path.join(f.root, 'identity', 'help'), saved);
  try {fs.symlinkSync(f.outside, path.join(f.root, 'identity', 'help'), process.platform === 'win32' ? 'junction' : 'dir');}
  catch (error) {if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {t.skip('directory symlink unavailable on this host'); return;} throw error;}
  refused(invoke(f.handler, '/identity/help/en.md'));
  const linkedRoot = path.join(f.temp, 'linked-root');
  fs.symlinkSync(f.root, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => assets.createDisplayAssetHandler({codeRoot: linkedRoot}), /invalid_display_asset_root/);
});

test('symlink leaf assets are refused, even when their target remains inside the root', t => {
  const f = fixture(t), leaf = path.join(f.root, 'identity', 'messages.js');
  fs.unlinkSync(leaf);
  try {fs.symlinkSync(path.join(f.root, 'identity', 'i18n.js'), leaf, 'file');}
  catch (error) {if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {t.skip('file symlink unavailable on this host'); return;} throw error;}
  refused(invoke(f.handler, '/identity/messages.js'));
});
