'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events');
const {createOpenWebUIHandler,validateModelOrigin,validateOutput,readApiKey}=require('../sdk/adapters/open-webui.cjs');
const task=()=>({scopeId:'public',taskType:'research.verify',deadlineAt:Date.now()+60000,input:{question:'When?',claims:[{claimId:'C1',sourceId:'S1',text:'It launched in 2020.'}],sources:[{sourceId:'S1',excerpt:'It launched in 2020.'}]}});
const output=()=>({decisions:[{claimId:'C1',status:'supported',reason:'Exact excerpt.',evidence:[{sourceId:'S1',quote:'It launched in 2020.'}]}]});
test('model HTTP needs explicit LAN consent, forbids credentials in URLs and public plaintext',()=>{
 assert.throws(()=>validateModelOrigin('http://192.168.10.88:3000'),/transport/);assert.equal(validateModelOrigin('http://192.168.10.88:3000',true),'http://192.168.10.88:3000');
 assert.throws(()=>validateModelOrigin('http://example.com',true),/transport/);assert.throws(()=>validateModelOrigin('https://user:secret@example.com'),/origin/);
});
test('verification rejects invented quotes, incomplete decisions and untrusted external sources',()=>{
 assert.deepEqual(validateOutput(task(),output()),output());
 const fake=output();fake.decisions[0].evidence[0].quote='Invented.';assert.throws(()=>validateOutput(task(),fake),/trusted_source/);
 assert.throws(()=>validateOutput(task(),{decisions:[]}),/incomplete/);const external=task();external.input.sources[0].external=true;assert.throws(()=>validateOutput(external,output()),/trusted_source/);
});
test('summary only accepts an exact known claim-ID permutation',()=>{
 const t=task();t.taskType='research.summarize';assert.deepEqual(validateOutput(t,{claimIds:['C1']}),{claimIds:['C1']});assert.throws(()=>validateOutput(t,{claimIds:['unknown']}),/summary/);
});
test('real HTTP handler reads a local credential and returns validated structured output',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lack-webui-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'key.txt'),key='sk-'+'f'.repeat(32);fs.writeFileSync(file,'\uFEFF'+key,{encoding:'utf16le',mode:0o600});assert.equal(readApiKey(file),key);
 let received;const server=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;received={route:req.url,authorization:req.headers.authorization,body:JSON.parse(body)};res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(output())}}]}));});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const handler=createOpenWebUIHandler({baseUrl:'http://127.0.0.1:'+server.address().port,model:'test-model',apiKeyFile:file});assert.deepEqual(await handler({task:task()}),output());
 assert.equal(received.route,'/api/chat/completions');assert.equal(received.authorization,'Bearer '+key);assert.equal(received.body.model,'test-model');assert.equal(received.body.tools,undefined);assert.equal(received.body.tool_choice,'none');assert.deepEqual(received.body.response_format,{type:'json_object'});assert.equal(received.body.files,undefined);
 await assert.rejects(()=>handler({task:{...task(),scopeId:'private'}}),/private/);
 await assert.rejects(()=>handler({task:{...task(),taskType:'research.retrieve'}}),/private/);
 await assert.rejects(()=>handler({task:{...task(),input:{...task().input,command:'shell'}}}),/unsupported_field/);
 const cancelled=new AbortController();cancelled.abort();await assert.rejects(()=>handler({task:task(),signal:cancelled.signal}));
});

test('unsolicited tool calls are rejected even when accompanied by valid verification JSON',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lack-webui-tools-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'key.txt');fs.writeFileSync(file,'sk-'+'f'.repeat(32),{mode:0o600});
 for(const finish of ['tool_calls','stop']){
  const handler=createOpenWebUIHandler({baseUrl:'http://127.0.0.1:3000',model:'test-model',apiKeyFile:file,fetch:async()=>new Response(JSON.stringify({choices:[{finish_reason:finish,message:{content:JSON.stringify(output()),tool_calls:[{id:'fixture',type:'function',function:{name:'never_execute',arguments:'{}'}}]}}]}),{status:200})});
  await assert.rejects(()=>handler({task:task()}),/model_requested_tools/);
 }
});
