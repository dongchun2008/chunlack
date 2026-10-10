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
  if(process.env.PUBLIC_EVENTS_FIXTURE_WORKSPACE){
    const assert=require('node:assert/strict'),store=runtime.gateway.store;
    const workspaceId=process.env.PUBLIC_EVENTS_FIXTURE_WORKSPACE,userId=process.env.PUBLIC_EVENTS_FIXTURE_USER;
    const node=store.withWorkspace({workspaceId,userId},()=>store.createNode({name:'Synthetic event fixture',capabilities:['browser.public_read'],scopes:['public']}));
    const credentials=runtime.gateway.workspaceAccess.pair(workspaceId,node.pairingCode);
    const response=await fetch(`http://127.0.0.1:${config.publicRuntime.mcpPort}/mcp`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+credentials.token},
      body:JSON.stringify({jsonrpc:'2.0',id:1,method:'events/list'})});
    assert.equal(response.status,200); const value=await response.json();
    assert.equal(value.result.events[0].name,'pilot.task_ready'); assert.ok(value.result.events[0].payloadSchema.required.includes('workspaceId'));
    process.stdout.write('PUBLIC_EVENTS_SCHEMA_OK\n');
  }
  process.stdout.write('PUBLIC_RUNTIME_READY\n');
})();
starting.catch(error => {process.stderr.write(`PUBLIC_START_FAILURE=${error.code || 'runtime_start_failed'}\n`); process.exitCode = 1; process.stdin.destroy();});
