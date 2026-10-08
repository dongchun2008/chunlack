'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {once}=require('node:events');
const {AgentClient,validateBaseUrl}=require('../sdk/agent-client.cjs');const {createGatewayStore}=require('../gateway/store.cjs');const {createAgentGateway}=require('../gateway/server.cjs');
async function setup(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lack-client-'));const store=createGatewayStore({dbPath:path.join(dir,'db.sqlite')});
 const created=store.createNode({name:'Fixture',capabilities:['research.verify'],scopes:['public']});const paired=store.pair(created.pairingCode);
 const gateway=createAgentGateway({store,adminToken:'a'.repeat(43),pollMs:40});gateway.server.listen(0,'127.0.0.1');await once(gateway.server,'listening');
 t.after(async()=>{await gateway.close();store.close();fs.rmSync(dir,{recursive:true,force:true});});
 return {store,gateway,paired,dir,url:`http://127.0.0.1:${gateway.server.address().port}`};
}
test('SDK rejects unsafe origins and credential URLs',()=>{
 assert.equal(validateBaseUrl('http://127.0.0.1:1234'),'http://127.0.0.1:1234');
 for(const value of ['http://192.168.1.2:1234','https://user:pass@example.org','https://example.org/path','https://example.org/?token=x'])assert.throws(()=>validateBaseUrl(value));
});
test('SDK result retries reuse the event identity when the acknowledgement is lost',async t=>{
 const r=await setup(t);let lost=true;const client=new AgentClient({baseUrl:r.url,token:r.paired.token,sleep:async()=>{},fetch:async(...args)=>{const response=await fetch(...args);if(args[0].endsWith('/result')&&lost){lost=false;await response.text();throw new Error('acknowledgement lost');}return response;}});
 const task=r.store.enqueueTask({targetNodeId:r.paired.nodeId,scopeId:'public',taskType:'research.verify',input:{question:'fixture'},deadlineAt:Date.now()+120000});const claim=await client.claim();
 await client.execute(claim,async()=>({decisions:[]}));assert.equal(r.store.getTask(task.taskId).status,'succeeded');
 assert.equal(r.store.nodeEvents(r.paired.nodeId).events.filter(e=>e.type==='result').length,1);
});
test('front-end SDK worker exits cleanly on cancellation and handles a task',async t=>{
 const r=await setup(t),controller=new AbortController(),client=new AgentClient({baseUrl:r.url,token:r.paired.token,sleep:async()=>{}});
 const work=client.run(async()=>({decisions:[]}),{signal:controller.signal});
 const task=r.store.enqueueTask({targetNodeId:r.paired.nodeId,scopeId:'public',taskType:'research.verify',input:{question:'fixture'},deadlineAt:Date.now()+120000});
 for(let i=0;i<100&&r.store.getTask(task.taskId).status!=='succeeded';i++)await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(r.store.getTask(task.taskId).status,'succeeded');controller.abort();await work;
});
test('credentials are protected using actual platform permissions and unsafe files are rejected',t=>{
 const {saveCredentials,loadCredentials}=require('../sdk/credentials.cjs');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lack-credentials-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'connector.json'),value={baseUrl:'http://127.0.0.1:1234',token:'n'.repeat(43),nodeId:'fixture'};
 saveCredentials(file,value);assert.deepEqual(loadCredentials(file),value);
 if(process.platform!=='win32'){fs.chmodSync(file,0o644);assert.throws(()=>loadCredentials(file),/permissions/);}
 const directory=path.join(dir,'not-a-file');fs.mkdirSync(directory);assert.throws(()=>loadCredentials(directory),/Unsafe/);
});
test('SDK backoff starts at one second and stops for a revoked identity',async()=>{
 const waits=[];let calls=0;const client=new AgentClient({baseUrl:'http://127.0.0.1:1234',token:'n'.repeat(43),sleep:async(ms)=>{waits.push(ms);},fetch:async()=>{calls++;if(calls<3)throw new Error('disconnected');return new Response('{"error":"unauthorized"}',{status:401});}});
 await assert.rejects(()=>client.run(async()=>({})),/unauthorized/);assert.deepEqual(waits,[1000,2000]);
});
