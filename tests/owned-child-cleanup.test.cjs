'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {once} = require('node:events');
const {stopOwnedChild} = require('./helpers/owned-child-cleanup.cjs');

async function launch(t, stubborn = false) {
  const script = stubborn
    ? "process.on('SIGTERM',()=>{}); process.stdin.resume(); process.stdout.write('READY\\n');"
    : "process.stdin.on('data',c=>{if(c.toString().trim()==='STOP'){process.stdin.destroy();}}); process.stdout.write('READY\\n');";
  const child = spawn(process.execPath, ['-e', script], {stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true});
  const exited = once(child, 'exit'); exited.catch(() => {});
  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGKILL');
    let timer;
    try {
      await Promise.race([exited, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Fixture child could not be reaped')), 3000);
      })]);
    } finally {
      clearTimeout(timer);
      child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); child.unref();
    }
  });
  const [chunk] = await once(child.stdout, 'data', {signal: AbortSignal.timeout(10000)});
  assert.equal(chunk.toString(), 'READY\n');
  return {child, exited};
}

test('owned cleanup lets a cooperative child exit normally', {timeout: 15000}, async t => {
  const {child, exited} = await launch(t);
  await stopOwnedChild(child, exited);
  assert.deepEqual(await exited, [0, null]);
});

test('owned cleanup reports forced termination without stopping another child', {timeout: 20000}, async t => {
  const owned = await launch(t, true), other = await launch(t);
  await assert.rejects(stopOwnedChild(owned.child, owned.exited, {graceMs: 100, forceMs: 3000}),
    {code: 'TEST_CHILD_FORCED_CLEANUP'});
  assert.ok(owned.child.exitCode !== null || owned.child.signalCode !== null);
  assert.equal(other.child.exitCode, null); assert.equal(other.child.signalCode, null);
  await stopOwnedChild(other.child, other.exited);
  assert.deepEqual(await other.exited, [0, null]);
});

test('owned cleanup is safe after a child already exited', {timeout: 15000}, async t => {
  const {child, exited} = await launch(t);
  child.stdin.write('STOP\n');
  assert.deepEqual(await exited, [0, null]);
  await stopOwnedChild(child, exited);
  assert.deepEqual(await exited, [0, null]);
});
