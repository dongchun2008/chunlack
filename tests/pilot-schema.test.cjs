'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {validatePilotInput,validatePilotOutput}=require('../gateway/pilot-schema.cjs');
const {input,output}=require('./helpers/pilot-fixture.cjs');
test('pilot schema accepts fixed public page and matched structured output',()=>{assert.deepEqual(validatePilotInput({...input}),input);assert.equal(validatePilotOutput(output(randomUUID()),input).title,'Example Domain');});
test('pilot input denies arbitrary targets, scope expansion and unsafe challenges',()=>{for(const bad of [{...input,url:'http://127.0.0.1/'},{...input,url:'https://example.com/?key=x'},{...input,command:'ls'},{...input,challenge:'x'},{...input,challenge:'A'.repeat(42)+'B'}])assert.throws(()=>validatePilotInput(bad));});
test('pilot output denies missing evidence, extra fields and malformed values',()=>{const good=output(randomUUID());for(const bad of [{...good,artifactId:undefined},{...good,challenge:'B'.repeat(43)},{...good,url:'https://other.example/'},{...good,title:'x'.repeat(501)},{...good,executedAt:'2026-02-30T00:00:00.000Z'},{...good,activityEvidence:''},{...good,accepted:true}])assert.throws(()=>validatePilotOutput(bad,input));});
