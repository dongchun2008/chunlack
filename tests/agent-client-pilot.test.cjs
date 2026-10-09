'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {AgentClient}=require('../sdk/agent-client.cjs');
const {createPilotArtifacts}=require('../gateway/pilot-artifacts.cjs');
const {createPilotNodeFacade}=require('../gateway/node-facade.cjs');
const {createMuseProxyTransport}=require('../sdk/transports/muse-proxy.cjs');
const {setup,png,input,output}=require('./helpers/pilot-fixture.cjs');
const {tls,listen,proxy}=require('./helpers/pilot-network.cjs');
async function fixture(t){
  let cleanup;
  const f=setup({after:fn=>{cleanup=fn;}});
  const artifacts=createPilotArtifacts({store:f.store,root:f.root,now:f.now});
  const facade=createPilotNodeFacade({store:f.store,artifacts,tls,allowedNodeIds:[f.nodeId]});
  t.after(async()=>{try{await facade.close();}finally{cleanup();}});
  const origin='https://127.0.0.1:'+await listen(facade.server);
  const p=await proxy(t);
  const transport=createMuseProxyTransport({proxyUrl:p.url,targetOrigin:origin,ca:tls.cert});
  const client=new AgentClient({baseUrl:origin,token:f.token,fetch:transport,sleep:async()=>{}});
  const enqueue=()=>f.store.enqueueTask({targetNodeId:f.nodeId,scopeId:'public',taskType:'browser.public_read',input:{...input},deadlineAt:f.now()+300000});
  return {...f,client,transport,origin,enqueue,p};
}
test('SDK reads without claiming and claims only the selected task over TLS CONNECT',async t=>{
  const f=await fixture(t),first=f.enqueue(),second=f.enqueue();
  const read=await f.client.readTask(second.taskId);
  assert.equal(read.status,'queued');assert.equal(read.leaseId,undefined);
  const selected=await f.client.claimTask(second.taskId);
  assert.equal(selected.taskId,second.taskId);
  assert.equal((await f.client.readTask(first.taskId)).status,'queued');
  assert.equal(await f.client.claimTask(second.taskId),null);
});
test('SDK uploads a real PNG fixture and submits the matching result over TLS CONNECT',async t=>{
  const f=await fixture(t),q=f.enqueue(),task=await f.client.claimTask(q.taskId);
  await f.client.event(task,{type:'started'});
  assert.equal((await f.client.heartbeat(task)).status,'running');
  const artifact=await f.client.uploadArtifact(task,{bytes:png()});
  assert.ok(artifact.artifactId);
  await f.client.result(task,{status:'succeeded',output:output(artifact.artifactId)});
  assert.equal((await f.client.readTask(q.taskId)).status,'succeeded');
  assert.equal(f.p.leaked,false);
});
test('SDK preserves upload identity and byte snapshot after losing an acknowledgment',async t=>{
  const f=await fixture(t),task=await f.client.claimTask(f.enqueue().taskId),bytes=png();
  let lost=true;const ids=[],pauses=[];
  const client=new AgentClient({baseUrl:f.origin,token:f.token,sleep:async ms=>pauses.push(ms),fetch:async(url,options)=>{
    ids.push(options.headers['X-Pilot-Event-Id']);
    const response=await f.transport(url,options);
    if(lost){lost=false;await response.text();bytes.fill(0);throw new Error('Lost acknowledgment');}
    return response;
  }});
  const artifact=await client.uploadArtifact(task,{bytes});
  assert.ok(artifact.artifactId);assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);assert.deepEqual(pauses,[1000]);
  assert.equal(f.store.listPilotArtifacts(task.taskId).length,1);
});
test('SDK stops uploads after cancellation without retrying the rejection',async t=>{
  const f=await fixture(t),task=await f.client.claimTask(f.enqueue().taskId);
  f.store.cancelTask(task.taskId);
  assert.equal((await f.client.heartbeat(task)).status,'cancel_requested');
  let calls=0;
  const client=new AgentClient({baseUrl:f.origin,token:f.token,fetch:async(...args)=>{calls++;return f.transport(...args);},sleep:async()=>assert.fail('must not retry')});
  await assert.rejects(client.uploadArtifact(task,{bytes:png()}),e=>e.status===409);
  assert.equal(calls,1);assert.equal(f.store.listPilotArtifacts(task.taskId).length,0);
});
test('SDK rejects unsafe selectors and invalid upload envelopes before transport',async()=>{
  const client=new AgentClient({baseUrl:'http://127.0.0.1:1234',fetch:async()=>assert.fail('must not send')});
  const task={taskId:'task',leaseId:'lease',attempt:1};
  for(const id of ['../x','x?token=secret','',null]){
    assert.throws(()=>client.readTask(id));assert.throws(()=>client.claimTask(id));
  }
  for(const options of [{bytes:'text'},{bytes:Buffer.alloc(0)},{bytes:Buffer.alloc(2097153)},{bytes:png(),contentType:'text/plain'},{bytes:png(),eventId:'../bad'}])
    await assert.rejects(client.uploadArtifact(task,options));
  await assert.rejects(client.uploadArtifact({...task,attempt:4},{bytes:png()}));
  const c=new AbortController();c.abort(new Error('Stopped'));
  await assert.rejects(client.uploadArtifact(task,{bytes:png()},c.signal),/Stopped/);
});
test('SDK upload retries are bounded when every acknowledgment is lost',async t=>{
  const f=await fixture(t),task=await f.client.claimTask(f.enqueue().taskId),pauses=[];let calls=0;
  const client=new AgentClient({baseUrl:f.origin,token:f.token,sleep:async ms=>pauses.push(ms),fetch:async(...args)=>{calls++;const response=await f.transport(...args);await response.text();throw new Error('Lost acknowledgment');}});
  await assert.rejects(client.uploadArtifact(task,{bytes:png()}),/Lost acknowledgment/);
  assert.equal(calls,3);assert.deepEqual(pauses,[1000,2000]);assert.equal(f.store.listPilotArtifacts(task.taskId).length,1);
});
