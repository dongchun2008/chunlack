'use strict';
const {ChildProcess} = require('node:child_process');

// Test-only cleanup. Never select a process by name or by an external PID.
async function stopOwnedChild(child, exited, {graceMs = 5000, forceMs = 3000} = {}) {
  if (!(child instanceof ChildProcess)) throw new TypeError('Expected owned ChildProcess');
  const running = () => child.exitCode === null && child.signalCode === null;
  if (!running()) return;
  const wait = async ms => {
    let timer;
    try {
      return await Promise.race([
        exited.then(() => true),
        new Promise(resolve => {timer = setTimeout(() => resolve(false), ms);})
      ]);
    } finally {clearTimeout(timer);}
  };
  // A concurrently closing stdin must not become an uncaught EPIPE.
  child.stdin?.on('error', () => {});
  if (child.stdin?.writable && !child.stdin.destroyed) child.stdin.write('STOP\n');
  if (await wait(graceMs)) return;
  if (!running()) return;
  child.kill('SIGKILL');
  const reaped = await wait(forceMs);
  if (!reaped) {
    child.stdin?.destroy(); child.stdout?.destroy(); child.stderr?.destroy();
    child.unref();
  }
  // Forced cleanup is a test failure, never a substitute for graceful shutdown.
  throw Object.assign(new Error(reaped ? 'Owned test child required forced cleanup' : 'Owned test child exit deadline exceeded'),
    {code: reaped ? 'TEST_CHILD_FORCED_CLEANUP' : 'TEST_CHILD_EXIT_TIMEOUT'});
}
module.exports = {stopOwnedChild};
