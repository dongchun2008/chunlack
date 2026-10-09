'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {execFileSync}=require('node:child_process');
test('Muse local pilot reports actual proxy flow but not actual Muse execution',()=>{const out=JSON.parse(execFileSync(process.execPath,[path.join(__dirname,'../scripts/muse-transport-local-pilot.cjs')],{encoding:'utf8',timeout:20000,windowsHide:true}));assert.equal(out.proxyVerified,true);assert.equal(out.museAgentVerified,false);assert.equal(out.acceptance,'evidence_checked');assert.equal(out.cancelledUploadRejected,true);assert.equal(out.adminRejected,true);assert.equal(out.cleanup,true);});
