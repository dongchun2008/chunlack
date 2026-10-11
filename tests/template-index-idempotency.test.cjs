'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const source = JSON.parse(execFileSync(process.env.PYTHON || 'python', ['-c', 'import json,runpy; print(json.dumps(runpy.run_path("scripts/materialize.py")["embedded_sources"]()))'], {cwd: root, encoding: 'utf8'})).SERVER_JS;
const node = require(path.join(root, 'tests/helpers/embedded-server-ast.cjs')).runtimeStatements(source)
  .find(item => item.type === 'FunctionDeclaration' && item.id.name === 'scanAndReindexTemplates');
assert.ok(node, 'actual embedded template scanner is present');
function setup(t) {
  const parent = path.resolve(os.tmpdir()), dir = fs.mkdtempSync(path.join(parent, 'chunlack-template-index-'));
  t.after(() => {
    assert.equal(path.dirname(dir), parent);
    assert.ok(path.basename(dir).startsWith('chunlack-template-index-'));
    assert.equal(fs.lstatSync(dir).isSymbolicLink(), false);
    fs.rmSync(dir, {recursive: true, force: true});
  });
  const manifest = path.join(dir, 'manifest.json');
  const context = vm.createContext({fs, path, TEMPLATES_DIR: dir, MANIFEST_PATH: manifest,
    stackManifest: {}, getEmbedding: async () => null, console: {log() {}}});
  vm.runInContext(source.slice(...node.range), context);
  return {dir, manifest, context, scan: () => context.scanAndReindexTemplates()};
}
function ageAndStat(file) {
  const old = new Date('2001-01-01T00:00:00Z');
  fs.utimesSync(file, old, old);
  return fs.statSync(file, {bigint: true});
}
function assertSameMetadata(file, before) {
  const after = fs.statSync(file, {bigint: true});
  assert.equal(after.ino, before.ino);
  assert.equal(after.mtimeNs, before.mtimeNs, 'unchanged manifest must not be rewritten');
  assert.equal(after.ctimeNs, before.ctimeNs, 'unchanged manifest must retain change time');
}
test('unchanged empty template manifest preserves bytes and filesystem metadata', async t => {
  const f = setup(t);
  await f.scan();
  assert.equal(fs.readFileSync(f.manifest, 'utf8'), '{}');
  const before = ageAndStat(f.manifest);
  await f.scan(); await f.scan();
  assert.equal(fs.readFileSync(f.manifest, 'utf8'), '{}');
  assertSameMetadata(f.manifest, before);
});
test('unchanged populated template manifest does not rewrite its file', async t => {
  const f = setup(t), template = path.join(f.dir, 'sample');
  fs.mkdirSync(template); fs.writeFileSync(path.join(template, 'README.md'), 'example');
  await f.scan();
  const expected = {sample: {text: 'example\n', files: {'README.md': 'example'}}};
  assert.deepEqual(JSON.parse(fs.readFileSync(f.manifest, 'utf8')), expected);
  const before = ageAndStat(f.manifest);
  await f.scan();
  assert.deepEqual(JSON.parse(fs.readFileSync(f.manifest, 'utf8')), expected);
  assertSameMetadata(f.manifest, before);
});
test('changed and removed templates still update disk and in-memory index', async t => {
  const f = setup(t), template = path.join(f.dir, 'sample'), content = path.join(template, 'README.md');
  fs.mkdirSync(template); fs.writeFileSync(content, 'first');
  await f.scan();
  fs.writeFileSync(content, 'second');
  await f.scan();
  assert.deepEqual(JSON.parse(fs.readFileSync(f.manifest, 'utf8')), {sample: {text: 'second\n', files: {'README.md': 'second'}}});
  assert.equal(f.context.stackManifest.sample.files['README.md'], 'second');
  fs.unlinkSync(content);
  await f.scan();
  assert.equal(fs.readFileSync(f.manifest, 'utf8'), '{}');
  assert.equal(Object.keys(f.context.stackManifest).length, 0);
});
test('missing manifest is recreated even when in-memory templates have not changed', async t => {
  const f = setup(t);
  await f.scan();
  fs.unlinkSync(f.manifest);
  await f.scan();
  assert.equal(fs.readFileSync(f.manifest, 'utf8'), '{}');
});
