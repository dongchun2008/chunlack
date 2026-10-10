'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
test('materialized runtime includes workspace auth/UI/control and MCP dependencies while preserving existing private config and state', t => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-materialize-workspaces-'));
  t.after(() => fs.rmSync(output, {recursive: true, force: true}));
  fs.mkdirSync(path.join(output, 'config')); fs.mkdirSync(path.join(output, 'db'));
  const config = '{"operatorPrivateFixture":"KEEP_EXISTING_CONFIG"}\n', state = Buffer.from('KEEP_EXISTING_DATABASE');
  fs.writeFileSync(path.join(output, 'config', 'lack.config.json'), config); fs.writeFileSync(path.join(output, 'db', 'operator.sqlite'), state);
  execFileSync(process.env.PYTHON || 'python', ['scripts/materialize.py', '--output', output], {cwd: root, timeout: 10000});
  for (const relative of ['package.json', 'package-lock.json', 'identity/store.cjs', 'identity/http.cjs', 'identity/workspace-ui.js', 'identity/workspace-shell.js', 'identity/login.html', 'collaboration/transport.cjs', 'collaboration/capacity.cjs', 'collaboration/controls-http.cjs', 'gateway/runtime.cjs', 'sdk/agent-client.cjs', 'sdk/transports/muse-proxy.cjs', 'integrations/mcp/pilot-server.cjs', 'integrations/mcp/events.cjs', 'scripts/accounts.cjs']) {
    assert.ok(fs.existsSync(path.join(output, relative)), 'Missing runtime file: ' + relative);
    assert.deepEqual(fs.readFileSync(path.join(output, relative)), fs.readFileSync(path.join(root, relative)));
  }
  assert.equal(fs.readFileSync(path.join(output, 'config', 'lack.config.json'), 'utf8'), config);
  assert.deepEqual(fs.readFileSync(path.join(output, 'db', 'operator.sqlite')), state);
  execFileSync(process.execPath, ['-e', 'require(process.argv[1]); require(process.argv[2]);', path.join(output, 'integrations/mcp/pilot-server.cjs'), path.join(output, 'sdk/agent-client.cjs')], {env: {...process.env, NODE_PATH: path.join(root, 'node_modules')}, timeout: 10000, stdio: 'pipe'});
});
test('materialization does not publish SDK test workers or private runtime directories as application dependencies', t => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-materialize-filter-'));
  t.after(() => fs.rmSync(output, {recursive: true, force: true}));
  execFileSync(process.env.PYTHON || 'python', ['scripts/materialize.py', '--output', output], {cwd: root, timeout: 10000});
  assert.equal(fs.existsSync(path.join(output, 'sdk', 'fixtures')), false);
  assert.equal(fs.existsSync(path.join(output, 'tests')), false);
  assert.equal(fs.existsSync(path.join(output, '.env')), false);
});
test('materialization rejects a linked output component before writing runtime files outside the requested tree', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-materialize-link-'));
  const output = path.join(directory, 'output'), elsewhere = path.join(directory, 'elsewhere'); fs.mkdirSync(output); fs.mkdirSync(elsewhere);
  const link = path.join(output, 'identity'); fs.symlinkSync(elsewhere, link, process.platform === 'win32' ? 'junction' : 'dir');
  t.after(() => {fs.unlinkSync(link); fs.rmSync(directory, {recursive: true, force: true});});
  assert.throws(() => execFileSync(process.env.PYTHON || 'python', ['scripts/materialize.py', '--output', output], {cwd: root, timeout: 10000, stdio: 'pipe'}));
  assert.deepEqual(fs.readdirSync(elsewhere), []); assert.equal(fs.existsSync(path.join(output, 'server.js')), false);
});
