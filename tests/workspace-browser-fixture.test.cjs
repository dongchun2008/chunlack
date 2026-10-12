'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {spawn, execFileSync} = require('node:child_process');
const {once} = require('node:events');
const budget = require('./helpers/workspace-browser-budget.cjs');

function launchFixture(t) {
  const root = path.resolve(__dirname, '..');
  const child = spawn(process.execPath, ['tests/helpers/workspace-browser-fixture.cjs'], {cwd: root, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32'});
  const exit = once(child, 'exit'); exit.catch(() => {});
  const running = () => child.exitCode === null && child.signalCode === null;
  const stages = [];
  child.stdin.on('error', () => {}); // A child may close stdin before STOP is written.
  t.after(async () => {
    if (!running()) return;
    child.stdin.write('STOP\n');
    let deadline;
    try {await Promise.race([exit, new Promise((_, reject) => {deadline = setTimeout(() => reject(new Error('Owned fixture shutdown timed out; stage=' + (stages.at(-1) || 'loading'))), budget.shutdownMs);})]);}
    finally {
      clearTimeout(deadline);
      if (running()) {
        // This child owns a dedicated POSIX process group, or a Windows process
        // tree. Never enumerate or terminate unrelated Node processes.
        if (process.platform === 'win32') execFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], {windowsHide: true, timeout: 5000, stdio: 'ignore'});
        else {try {process.kill(-child.pid, 'SIGKILL');} catch (error) {if (error.code !== 'ESRCH') throw error;}}
      }
    }
  });
  let stdout = '', stderr = '', stageBuffer = '', deadline;
  child.stderr.on('data', value => {
    stderr = (stderr + value).slice(-8000); stageBuffer += value;
    const lines = stageBuffer.split('\n'); stageBuffer = lines.pop();
    for (const line of lines) {const match = /^BROWSER_FIXTURE_STAGE=([a-z-]+)$/.exec(line.trim()); if (match) stages.push(match[1]);}
  });
  const ready = new Promise((resolve, reject) => {
    child.stdout.on('data', value => {stdout += value; const line = stdout.split('\n').find(value => value.startsWith('{')); if (line) {try {resolve(JSON.parse(line));} catch { /* wait for the complete JSON line */ }}});
    child.once('exit', code => reject(new Error('Owned fixture exited before readiness (' + code + '): ' + stderr)));
    child.once('error', reject);
    deadline = setTimeout(() => reject(new Error('Owned fixture readiness timed out; stage=' + (stages.at(-1) || 'loading'))), budget.readinessMs);
  });
  ready.then(() => clearTimeout(deadline), () => clearTimeout(deadline));
  return {child, ready, exit, stages};
}

test('loopback browser adapter preserves JSON DELETE framing and the unchanged production identity checks', {timeout: budget.testMs}, async t => {
  const fixture = await launchFixture(t).ready;
  const login = await fetch(fixture.urls.alice + 'auth/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({login: 'alice', password: 'public-browser-fixture-password'}), signal: AbortSignal.timeout(budget.loginMs)});
  assert.equal(login.status, 200); const auth = await login.json();
  const headers = {Cookie: login.headers.getSetCookie()[0].split(';')[0], 'X-Workspace-Id': fixture.workspaceIds.a, 'X-CSRF-Token': auth.csrfToken, 'Content-Type': 'application/json'};
  const endpoint = fixture.urls.alice + 'api/workspaces/' + fixture.workspaceIds.a + '/members';
  const before = await (await fetch(endpoint, {headers, signal: AbortSignal.timeout(3000)})).json();
  const bob = before.members.find(member => member.login === 'bob'); assert.ok(bob);
  const removed = await fetch(endpoint + '/' + bob.userId, {method: 'DELETE', headers, body: '{}', signal: AbortSignal.timeout(3000)});
  assert.equal(removed.status, 200); assert.deepEqual(await removed.json(), {ok: true});
  const after = await (await fetch(endpoint, {headers, signal: AbortSignal.timeout(3000)})).json(); assert.ok(!after.members.some(member => member.login === 'bob'));
});

test('browser fixture accepts STOP before readiness and exits cleanly without publishing an endpoint', {timeout: budget.testMs}, async t => {
  const fixture = launchFixture(t);
  fixture.child.stdin.write('STOP\n');
  const [code, signal] = await fixture.exit;
  assert.equal(code, 0);
  assert.equal(signal, null);
  assert.ok(!fixture.stages.includes('ready'));
  await assert.rejects(fixture.ready, /exited before readiness/);
});
