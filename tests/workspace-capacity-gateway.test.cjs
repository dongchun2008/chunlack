'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {once}=require('node:events');
const {gatewayFixture}=require('./helpers/workspace-gateway-fixture.cjs');
const {createCapacityCoordinator}=require('../collaboration/capacity.cjs');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(value=>{resolve=value;});return {promise,resolve};}
const setup=t=>gatewayFixture(t,{capacityFactory:f=>createCapacityCoordinator({now:f.now})});
function model(f,workspaceId,taskId,run){return f.capacity.submit({workspaceId,taskId,deadlineAt:f.now()+120000,kind:'model.generate',run});}

test('gateway and model work share one coordinator, including capacity denial before leasing',async t=>{
  const f=setup(t),hold=deferred();assert.equal(f.gatewayStore.capacity,f.capacity);
  f.enqueue('a');const active=model(f,f.workspaces.b.id,'model',()=>hold.promise);await turn();
  assert.equal(f.node('a').claimTask(),null);assert.equal(f.capacity.status(f.workspaces.a.id).active,0);
  hold.resolve();await active;assert.ok(f.node('a').claimTask());assert.equal(f.capacity.status(f.workspaces.a.id).active,1);
});
test('unconfirmed remote cancellation still occupies shared capacity; authentic cancelled evidence releases it',async t=>{
  const f=setup(t),task=f.enqueue('a'),lease=f.node('a').claimTask();let started=false;
  const waiting=model(f,f.workspaces.b.id,'model',()=>{started=true;return 1;});await turn();assert.equal(started,false);
  f.human('alice','a',h=>h.cancelTask(task.taskId));await turn();assert.equal(started,false);
  assert.equal(f.capacity.status(f.workspaces.a.id).remoteCancellationUnconfirmed,1);
  f.node('a').appendEvent({protocolVersion:1,taskId:task.taskId,leaseId:lease.leaseId,attempt:lease.attempt,eventId:'cancel-ack',type:'cancelled'});
  assert.equal(await waiting,1);assert.equal(f.capacity.status(f.workspaces.a.id).active,0);
});
test('valid persisted node lease is recovered after store restart before models can execute',async t=>{
  const f=setup(t);f.enqueue('a');const lease=f.node('a').claimTask();f.gatewayStore.close();f.capacity.close();
  const capacity=f.own(createCapacityCoordinator({now:f.now}));const store=f.own(require('../gateway/store.cjs').createGatewayStore({dbPath:path.join(f.dir,'gateway.sqlite'),now:f.now,multiUser:true,capacity}));
  assert.equal(store.capacity,capacity);let started=false;
  const waiting=capacity.submit({workspaceId:f.workspaces.b.id,taskId:'restart-model',deadlineAt:f.now()+120000,kind:'model.generate',run:()=>{started=true;return 2;}});await turn();assert.equal(started,false);
  f.advance(lease.leaseUntil-f.now()+1);capacity.refresh();assert.equal(await waiting,2);
});
test('node and model waiters count toward the same workspace limit of twenty',async t=>{
  const f=setup(t),hold=deferred(),active=model(f,f.workspaces.b.id,'active',()=>hold.promise);await turn();
  active.catch(()=>{});
  for(let i=0;i<19;i++)f.enqueue('a');const waiting=model(f,f.workspaces.a.id,'queued-model',()=>3);waiting.catch(()=>{});
  assert.throws(()=>f.enqueue('a'),error=>error.code==='workspace_queue_full');
  assert.equal(f.capacity.status(f.workspaces.a.id).queued,20);hold.resolve();await active;assert.equal(await waiting,3);
});
test('local model release wakes the existing HTTP long poll even without any database task transition',async t=>{
  const f=setup(t),hold=deferred();f.enqueue('a');const active=model(f,f.workspaces.b.id,'active',()=>hold.promise);await turn();
  const gateway=require('../gateway/server.cjs').createAgentGateway({store:f.gatewayStore,workspaceAccess:f.access,adminToken:'a'.repeat(43),now:f.now,pollMs:1000});t.after(()=>gateway.close());
  gateway.server.listen(0,'127.0.0.1');await once(gateway.server,'listening');const url=`http://127.0.0.1:${gateway.server.address().port}/v1/tasks/claim`;
  let settled=false;const response=fetch(url,{method:'POST',headers:{Authorization:'Bearer '+f.credentials.a.token,'Content-Type':'application/json'},body:'{}'}).then(value=>{settled=true;return value;});response.catch(()=>{});
  await new Promise(resolve=>setTimeout(resolve,50));assert.equal(settled,false);hold.resolve();await active;
  const claimed=await response;assert.equal(claimed.status,200);assert.equal((await claimed.json()).workspaceId,f.workspaces.a.id);
});
