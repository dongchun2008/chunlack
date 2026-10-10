'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {once} = require('node:events');
test('loopback browser adapter preserves JSON DELETE framing and the unchanged production identity checks', {timeout: 20000}, async t => {
  const root = path.resolve(__dirname, '..');
  const child = spawn(process.execPath, ['tests/helpers/workspace-browser-fixture.cjs'], {cwd: root, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true});
  t.after(async () => {
    if (child.exitCode !== null) return;
    const exit = once(child, 'exit'); child.stdin.write('STOP\n');
    let deadline; try {await Promise.race([exit, new Promise((_, reject) => {deadline = setTimeout(() => reject(new Error('Owned fixture shutdown timed out')), 5000);})]);}
    finally {clearTimeout(deadline); if (child.exitCode === null) child.kill();}
  });
  let stdout = '', stderr = '', deadline;
  child.stderr.on('data', value => {stderr = (stderr + value).slice(-8000);});
  const ready = new Promise((resolve, reject) => {
    child.stdout.on('data', value => {stdout += value; const line = stdout.split('\n').find(value => value.startsWith('{')); if (line) {try {resolve(JSON.parse(line));} catch { /* wait for the complete JSON line */ }}});
    child.once('exit', code => reject(new Error('Owned fixture exited before readiness (' + code + '): ' + stderr)));
    deadline = setTimeout(() => reject(new Error('Owned fixture readiness timed out')), 10000);
  });
  let fixture; try {fixture = await ready;} finally {clearTimeout(deadline);}
  const login = await fetch(fixture.urls.alice + 'auth/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({login: 'alice', password: 'public-browser-fixture-password'}), signal: AbortSignal.timeout(3000)});
  assert.equal(login.status, 200); const auth = await login.json();
  const headers = {Cookie: login.headers.getSetCookie()[0].split(';')[0], 'X-Workspace-Id': fixture.workspaceIds.a, 'X-CSRF-Token': auth.csrfToken, 'Content-Type': 'application/json'};
  const endpoint = fixture.urls.alice + 'api/workspaces/' + fixture.workspaceIds.a + '/members';
  const before = await (await fetch(endpoint, {headers, signal: AbortSignal.timeout(3000)})).json();
  const bob = before.members.find(member => member.login === 'bob'); assert.ok(bob);
  const removed = await fetch(endpoint + '/' + bob.userId, {method: 'DELETE', headers, body: '{}', signal: AbortSignal.timeout(3000)});
  assert.equal(removed.status, 200); assert.deepEqual(await removed.json(), {ok: true});
  const after = await (await fetch(endpoint, {headers, signal: AbortSignal.timeout(3000)})).json(); assert.ok(!after.members.some(member => member.login === 'bob'));
});
