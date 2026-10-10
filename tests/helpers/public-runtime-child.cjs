'use strict';
const fs = require('node:fs');
const path = require('node:path');
const entry = process.argv[2], root = process.argv[3];
let runtime, starting, stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  try {runtime = runtime || await starting; await runtime?.close(); process.stdout.write('PUBLIC_RUNTIME_CLOSED\n');}
  catch {process.stderr.write('PUBLIC_RUNTIME_CLOSE_FAILED\n'); process.exitCode = 1;}
  process.stdin.destroy();
}
process.once('SIGTERM', stop); process.once('SIGINT', stop);
process.stdin.on('data', chunk => {if (chunk.toString().trim() === 'STOP') process.emit('SIGTERM');});
starting = (async () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'config', 'lack.config.json'), 'utf8'));
  runtime = await require(entry).startPublicRuntime({config, dataRoot: root});
  process.stdout.write('PUBLIC_RUNTIME_READY\n');
})();
starting.catch(error => {process.stderr.write(`PUBLIC_START_FAILURE=${error.code || 'runtime_start_failed'}\n`); process.exitCode = 1; process.stdin.destroy();});
