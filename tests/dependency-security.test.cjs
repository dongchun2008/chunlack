const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {simpleGit} = require('simple-git');

function installedVersion(name) {
  let directory = path.dirname(require.resolve(name));
  while (directory !== path.dirname(directory)) {
    const file = path.join(directory, 'package.json');
    if (fs.existsSync(file)) {
      const metadata = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (metadata.name === name) return metadata.version;
    }
    directory = path.dirname(directory);
  }
  throw new Error('Package metadata not found: ' + name);
}

function fixture(t) {
  const parent = path.resolve(os.tmpdir());
  const root = fs.mkdtempSync(path.join(parent, 'chunlack-git-security-'));
  t.after(() => {
    assert.equal(path.dirname(root), parent);
    assert.ok(path.basename(root).startsWith('chunlack-git-security-'));
    fs.rmSync(root, {recursive: true, force: true});
  });
  const home = path.join(root, '.isolated-home');
  const xdg = path.join(home, '.config');
  fs.mkdirSync(xdg, {recursive: true});
  const env = {...process.env};
  for (const name of Object.keys(env)) {
    if (/^GIT_/i.test(name) || /^(VISUAL|EDITOR|PAGER)$/i.test(name)) delete env[name];
  }
  Object.assign(env, {HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: xdg,
    GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0'});
  const git = simpleGit({baseDir: root, maxConcurrentProcesses: 1, timeout: {block: 5000},
    allowEnvironment: ['GIT_CONFIG_NOSYSTEM', 'GIT_TERMINAL_PROMPT']}).env(env);
  return {root, env, git};
}

test('security dependency versions match the reviewed lock entries', () => {
  const expected = {'simple-git': '4.0.2', '@simple-git/argv-parser': '2.0.1',
    'proxy-addr': '2.0.8', 'brace-expansion': '1.1.21'};
  const lock = require('../package-lock.json');
  for (const [name, version] of Object.entries(expected)) {
    assert.equal(installedVersion(name), version, name + ' installed');
    assert.equal(lock.packages['node_modules/' + name].version, version, name + ' locked');
  }
});

test('Git research workflow retains init, local identity, empty commit, add, status and commit', {timeout: 20000}, async t => {
  const {root, git} = fixture(t);
  await git.cwd(root).init();
  await git.cwd(root).addConfig('user.name', 'ChunLACK Test');
  await git.cwd(root).addConfig('user.email', 'chunlack-test@localhost');
  await git.cwd(root).commit('Initial research repo', {'--allow-empty': null});
  fs.writeFileSync(path.join(root, 'evidence.txt'), 'Synthetic source evidence\n');
  await git.cwd(root).add('.');
  assert.ok((await git.cwd(root).status()).files.some(file => file.path === 'evidence.txt'));
  const message = 'Research: preserve source "quotes" and --literal arguments';
  await git.cwd(root).commit(message);
  assert.equal((await git.status()).isClean(), true);
  assert.equal((await git.log()).latest.message, message);
});

test('Git rejects VISUAL editor overrides even for a harmless status command', {timeout: 15000}, async t => {
  const {git, env} = fixture(t);
  await git.init();
  git.env({...env, VISUAL: 'chunlack-fixture-never-executed'});
  await assert.rejects(git.raw(['status', '--porcelain']), /unsafe|editor/i);
});

for (const key of ['trailer.audit.cmd', 'trailer.audit.command', 'include.path']) {
  test('Git rejects executable configuration ' + key + ' before harmless status', {timeout: 15000}, async t => {
    const {git} = fixture(t);
    await git.init();
    await assert.rejects(git.raw(['-c', key + '=chunlack-fixture-never-executed', 'status', '--porcelain']), /unsafe|configuration|config/i);
  });
}

test('proxy trust and brace expansion preserve benign legacy behavior', () => {
  const trust = require('proxy-addr').compile(['loopback']);
  assert.equal(trust('127.0.0.1'), true);
  assert.equal(trust('::1'), true);
  assert.equal(trust('192.0.2.1'), false);
  assert.deepEqual(require('brace-expansion')('source-{a,b}-{1..2}.md'),
    ['source-a-1.md', 'source-a-2.md', 'source-b-1.md', 'source-b-2.md']);
});
