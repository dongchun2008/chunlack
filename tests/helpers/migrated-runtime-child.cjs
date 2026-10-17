'use strict';
// Disposable migration fixture only. Do not use this diagnostic entry in production.
const fs = require('node:fs'), path = require('node:path');
const { performance } = require('node:perf_hooks');
const began = performance.now();
function phase(name) {
  console.log('MIGRATED_RUNTIME_PHASE=' + JSON.stringify({ phase: name, elapsedMs: Math.round(performance.now() - began) }));
}
const entry = process.argv[2], root = process.argv[3];
const legacy = process.argv[4] === 'legacy';
let runtime, starting, stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  phase('stop_start');
  try { runtime = runtime || await starting; await runtime?.close(); phase('stop_complete'); console.log('PUBLIC_RUNTIME_CLOSED'); }
  catch { phase('stop_failed'); process.exitCode = 1; }
  process.stdin.destroy();
}
process.once('SIGTERM', stop); process.once('SIGINT', stop);
process.stdin.on('data', value => { if (value.toString().trim() === 'STOP') void stop(); });
starting = Promise.resolve().then(() => {
  phase('config_read_start');
  const options = { config: JSON.parse(fs.readFileSync(path.join(root, 'config', 'lack.config.json'), 'utf8')), dataRoot: root };
  phase('config_read_complete');
  if (legacy) options.env = { ...process.env, LACK_MULTI_USER: '0', LACK_PUBLIC_MODE: '0', LACK_BIND_HOST: '127.0.0.1' };
  phase('entry_load_start');
  const application = require(entry);
  phase('entry_load_complete');
  phase('runtime_start');
  return legacy ? application.startLackRuntime(options) : application.startPublicRuntime(options);
}).then(value => { runtime = value; phase('runtime_ready'); console.log(legacy ? 'LEGACY_READY' : 'PUBLIC_RUNTIME_READY'); return value; });
starting.catch(error => {
  phase('runtime_failed');
  // Error stacks here concern only generated test databases and synthetic config.
  const diagnostic = String(error.stack || error.code || 'runtime_start_failed').split('\n').slice(0, 5).join('\n').replace(/synthetic-[\w-]*password|Bearer\s+\S+|\bsk-[\w-]{20,}/g, '[redacted]');
  console.error('MIGRATED_RUNTIME_FAILURE=' + diagnostic); process.exitCode = 1; process.stdin.destroy();
});
