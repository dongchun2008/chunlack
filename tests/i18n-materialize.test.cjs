'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
function run(output) {return spawnSync(process.env.PYTHON || 'python', ['-X', 'utf8', 'scripts/materialize.py', '--output', output], {cwd: root, encoding: 'utf8', timeout: 10000});}
test('materialized bilingual help and display modules match their exact source bytes', t => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'chunlack-i18n-package-')); t.after(() => fs.rmSync(output, {recursive: true, force: true}));
  const result = run(output); assert.equal(result.status, 0, result.stderr);
  for (const [from, to] of [['docs/USER_GUIDE.zh-CN.md', 'identity/help/zh-CN.md'], ['docs/USER_GUIDE.en.md', 'identity/help/en.md'], ...['i18n.js', 'messages.js', 'chat-messages.js', 'display.js', 'help.js', 'help-assets.cjs'].map(name => ['identity/' + name, 'identity/' + name])]) assert.deepEqual(fs.readFileSync(path.join(output, to)), fs.readFileSync(path.join(root, from)));
  const config = path.join(output, 'config/lack.config.json'); fs.writeFileSync(config, '{"privateFixture":true}\n');
  const second = run(output); assert.equal(second.status, 0, second.stderr); assert.equal(fs.readFileSync(config, 'utf8'), '{"privateFixture":true}\n');
  assert.equal(fs.existsSync(path.join(output, 'identity/fixtures')), false); assert.equal(fs.existsSync(path.join(output, 'docs')), false);
});
test('linked guide output is rejected before writing any runtime files', t => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'chunlack-i18n-linked-')); const external = fs.mkdtempSync(path.join(os.tmpdir(), 'chunlack-i18n-external-'));
  t.after(() => fs.rmSync(output, {recursive: true, force: true})); t.after(() => fs.rmSync(external, {recursive: true, force: true}));
  fs.mkdirSync(path.join(output, 'identity')); fs.symlinkSync(external, path.join(output, 'identity/help'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = run(output); assert.notEqual(result.status, 0); assert.match(result.stderr, /Linked runtime output/);
  assert.equal(fs.existsSync(path.join(output, 'server.js')), false); assert.deepEqual(fs.readdirSync(external), []);
});
