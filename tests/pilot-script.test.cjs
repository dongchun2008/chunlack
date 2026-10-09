'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path'),fs=require('node:fs');
const {execFileSync}=require('node:child_process');
test('foundation pilot proves local boundaries without claiming real cloud execution',()=>{
  const text=execFileSync(process.execPath,[path.join(__dirname,'../scripts/cloud-agent-foundation-pilot.cjs')],{encoding:'utf8',timeout:20000,windowsHide:true});const report=JSON.parse(text);
  assert.equal(report.mode,'synthetic_fixture');assert.equal(report.cloudConnected,false);assert.equal(report.acceptance,'evidence_checked');assert.equal(report.humanAccepted,false);assert.equal(report.missingEvidenceRejected,true);assert.equal(report.cancelledResultRejected,true);assert.equal(report.retryDenied,true);assert.equal(report.cleanup,true);assert.equal(fs.existsSync(report.temporaryDirectory),false);
});
