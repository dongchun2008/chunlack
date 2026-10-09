'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setup,input}=require('./helpers/pilot-fixture.cjs');
const {tls,listen,proxy}=require('./helpers/pilot-network.cjs');
const {createPilotArtifacts}=require('../gateway/pilot-artifacts.cjs');
const {createPilotNodeFacade}=require('../gateway/node-facade.cjs');
const {createMuseProxyTransport}=require('../sdk/transports/muse-proxy.cjs');
async function env(t){
  let releaseFixture;const f=setup({after:fn=>{releaseFixture=fn;}});
  const artifacts=createPilotArtifacts({store:f.store,root:f.root,now:f.now});
  const facade=createPilotNodeFacade({store:f.store,artifacts,tls,allowedNodeIds:[f.nodeId]});
  t.after(async()=>{try{await facade.close();}finally{releaseFixture();}});
  const origin='https://127.0.0.1:'+await listen(facade.server),p=await proxy(t);
  const fetch=createMuseProxyTransport({proxyUrl:p.url,targetOrigin:origin,ca:tls.cert});
  const call=(route,body,token=f.token)=>fetch(origin+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const enqueue=(nodeId=f.nodeId)=>f.store.enqueueTask({targetNodeId:nodeId,scopeId:'public',taskType:'browser.public_read',input:{...input},deadlineAt:f.now()+300000});
  return {f,facade,call,enqueue};
}
test('facade reads an owned task without claiming it or disclosing leases',async t=>{
  const e=await env(t),task=e.enqueue(),response=await e.call('/v1/tasks/'+task.taskId);
  assert.equal(response.status,200);const body=await response.json();
  assert.equal(body.taskId,task.taskId);assert.deepEqual(body.input,input);assert.equal(body.status,'queued');
  assert.equal(body.acceptance.state,'received');assert.equal(body.leaseId,undefined);assert.equal(body.nodeId,undefined);
  assert.equal(e.f.store.getTask(task.taskId).status,'queued');
});
test('facade exact claim never consumes another task and duplicates do not reexecute',async t=>{
  const e=await env(t),first=e.enqueue(),second=e.enqueue();
  const response=await e.call('/v1/tasks/claim',{taskId:second.taskId});assert.equal(response.status,200);
  const lease=await response.json();assert.equal(lease.taskId,second.taskId);
  assert.equal(e.f.store.getTask(first.taskId).status,'queued');
  assert.equal((await e.call('/v1/tasks/claim',{taskId:second.taskId})).status,204);
  assert.equal((await e.call('/v1/tasks/claim',{taskId:first.taskId})).status,204);
  assert.equal(e.f.store.getTask(first.taskId).status,'queued');
});
test('facade exact claim stops for cancelled and expired tasks without FIFO fallback',async t=>{
  const e=await env(t),first=e.enqueue(),cancelled=e.enqueue();e.f.store.cancelTask(cancelled.taskId);
  assert.equal((await e.call('/v1/tasks/claim',{taskId:cancelled.taskId})).status,204);
  assert.equal(e.f.store.getTask(first.taskId).status,'queued');
  e.f.advance(300001);assert.equal((await e.call('/v1/tasks/claim',{taskId:first.taskId})).status,204);
});
test('facade new routes deny foreign tasks, malformed selectors and revoked identities',async t=>{
  const e=await env(t),other=e.f.store.createNode({name:'other',capabilities:['browser.public_read'],scopes:['public']}),foreign=e.enqueue(other.id),own=e.enqueue();
  assert.equal((await e.call('/v1/tasks/'+foreign.taskId)).status,403);
  assert.equal((await e.call('/v1/tasks/claim',{taskId:foreign.taskId})).status,403);
  for(const body of [{taskId:9},{taskId:own.taskId,nodeId:other.id},{taskId:''}])assert.equal((await e.call('/v1/tasks/claim',body)).status,400);
  assert.equal((await e.call('/v1/tasks/'+own.taskId+'?x=y')).status,404);
  assert.equal((await e.call('/v1/tasks/'+own.taskId,undefined,null)).status,401);
  assert.equal(e.f.store.getTask(own.taskId).status,'queued');
  e.f.store.revokeNode(e.f.nodeId);
  for(const route of ['/v1/tasks/'+own.taskId,'/v1/openapi.json'])assert.equal((await e.call(route)).status,401);
});
test('facade serves authenticated OpenAPI with resolvable schemas and no deployment secrets',async t=>{
  const e=await env(t);assert.equal((await e.call('/v1/openapi.json',undefined,null)).status,401);
  const response=await e.call('/v1/openapi.json');assert.equal(response.status,200);const doc=await response.json();
  assert.equal(doc.openapi,'3.0.3');assert.equal(doc.components.securitySchemes.NodeBearer.scheme,'bearer');
  assert.deepEqual(doc.security,[{NodeBearer:[]}]);assert.equal(doc.servers,undefined);
  assert.deepEqual(doc.paths['/health'].get.security,[]);
  assert.equal(doc.paths['/v1/tasks/claim'].post.requestBody.content['application/json'].schema.$ref,'#/components/schemas/ClaimRequest');
  assert.deepEqual(doc.components.schemas.ClaimRequest.required,undefined);
  assert.deepEqual(Object.keys(doc.components.schemas.ClaimRequest.properties),['taskId']);
  assert.equal(doc.components.schemas.ClaimRequest.additionalProperties,false);
  assert.ok(doc.paths['/v1/tasks/{taskId}'].get);assert.ok(doc.paths['/v1/pilot/tasks/{taskId}/artifact'].post);
  const operationIds=new Set();for(const item of Object.values(doc.paths))for(const op of Object.values(item)){assert.equal(operationIds.has(op.operationId),false);operationIds.add(op.operationId);}
  function walk(value){if(!value||typeof value!=='object')return;if(value.$ref){assert.ok(value.$ref.startsWith('#/'));let found=doc;for(const segment of value.$ref.slice(2).split('/'))found=found?.[segment];assert.ok(found,value.$ref);}for(const child of Object.values(value))walk(child);}
  walk(doc);const text=JSON.stringify(doc);for(const secret of [e.f.token,e.f.nodeId,'127.0.0.1','192.168.10.88','47.108.217.178'])assert.equal(text.includes(secret),false);
  assert.equal(Object.keys(doc.paths).some(p=>p.includes('admin')||p.includes('pair')),false);
});
test('facade legacy empty claim remains compatible',async t=>{
  const e=await env(t),first=e.enqueue();const response=await e.call('/v1/tasks/claim',{});
  assert.equal(response.status,200);assert.equal((await response.json()).taskId,first.taskId);
});
