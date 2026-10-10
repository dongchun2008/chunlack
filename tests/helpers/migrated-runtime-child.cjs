'use strict';
// Disposable migration fixture only. Do not use this diagnostic entry in production.
const fs = require('node:fs'), path = require('node:path');
const entry = process.argv[2], root = process.argv[3];
const legacy = process.argv[4] === 'legacy';
let runtime, starting, stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  try { runtime = runtime || await starting; await runtime?.close(); console.log('PUBLIC_RUNTIME_CLOSED'); }
  catch { process.exitCode = 1; }
  process.stdin.destroy();
}
process.once('SIGTERM', stop); process.once('SIGINT', stop);
process.stdin.on('data', value => { if (value.toString().trim() === 'STOP') void stop(); });
starting = Promise.resolve().then(() => {
  const options = { config: JSON.parse(fs.readFileSync(path.join(root, 'config', 'lack.config.json'), 'utf8')), dataRoot: root };
  if (legacy) { options.env = { ...process.env, LACK_MULTI_USER: '0', LACK_PUBLIC_MODE: '0', LACK_BIND_HOST: '127.0.0.1' }; return require(entry).startLackRuntime(options); }
  return require(entry).startPublicRuntime(options);
}).then(value => { runtime = value; console.log(legacy ? 'LEGACY_READY' : 'PUBLIC_RUNTIME_READY'); return value; });
starting.catch(error => {
  // Error stacks here concern only generated test databases and synthetic config.
  const diagnostic = String(error.stack || error.code || 'runtime_start_failed').split('\n').slice(0, 5).join('\n').replace(/synthetic-[\w-]*password|Bearer\s+\S+|\bsk-[\w-]{20,}/g, '[redacted]');
  console.error('MIGRATED_RUNTIME_FAILURE=' + diagnostic); process.exitCode = 1; process.stdin.destroy();
});
