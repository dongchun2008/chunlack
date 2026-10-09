'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path'),{spawnSync}=require('node:child_process');
test('dots local pilot exercises signed event, MCP task and artifact round trip',()=>{
  const run=spawnSync(process.execPath,[path.join(__dirname,'../scripts/dots-mcp-local-pilot.cjs')],{encoding:'utf8',timeout:20000});
  assert.equal(run.status,0,run.stderr);
  const report=JSON.parse(run.stdout);
  assert.equal(report.mode,'mock_dot');
  assert.equal(report.dotsAgentVerified,false);
  for(const field of ['eventReceived','receiptDoesNotExecuteTask','taskClaimed','artifactSaved','resultRecorded','duplicateNotReexecuted','unsubscribeStopsDelivery','cleanup'])assert.equal(report[field],true,field);
  assert.match(JSON.stringify(report.acceptance),/evidence_checked/);
});
