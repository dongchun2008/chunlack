'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function fixture(t,options={}){
  let time=Date.parse('2026-10-10T00:00:00Z');
  const capacity=require('../collaboration/capacity.cjs').createCapacityCoordinator({...options,now:()=>time});t.after(()=>capacity.close());
  let id=0;
  const submit=(workspaceId,run,extra={})=>capacity.submit({workspaceId,taskId:'job-'+(++id),deadlineAt:time+10000,kind:'model.generate',run,...extra});
  return {capacity,submit,advance:ms=>{time+=ms;capacity.refresh();},now:()=>time};
}
test('one global slot and workspace round-robin prevent a busy workspace from starving another',async t=>{
  const f=fixture(t),hold=deferred(),order=[];let active=0,peak=0;
  const work=name=>async()=>{active++;peak=Math.max(peak,active);order.push(name);await turn();active--;return name;};
  const first=f.submit('a',async()=>{active++;peak=Math.max(peak,active);order.push('a0');await hold.promise;active--;});await turn();
  const a1=f.submit('a',work('a1')),a2=f.submit('a',work('a2')),b=f.submit('b',work('b0'));
  assert.equal(f.capacity.status('a').active,1);assert.equal(f.capacity.status('a').queued,2);assert.equal(f.capacity.status('b').active,0);
  hold.resolve();await Promise.all([first,a1,a2,b]);assert.equal(peak,1);assert.deepEqual(order,['a0','b0','a1','a2']);
});
test('global and per-workspace waiting bounds reject excess without executing it',async t=>{
  const f=fixture(t,{maxQueued:3,maxQueuedPerWorkspace:2}),hold=deferred();
  const first=f.submit('a',()=>hold.promise);await turn();const pending=[f.submit('a',()=>1),f.submit('a',()=>2)];
  await assert.rejects(f.submit('a',()=>assert.fail('must not execute')),e=>e.code==='workspace_queue_full');
  pending.push(f.submit('b',()=>3));await assert.rejects(f.submit('c',()=>assert.fail('must not execute')),e=>e.code==='global_queue_full');
  hold.resolve();await Promise.all([first,...pending]);assert.equal(f.capacity.status('a').queued,0);
});
test('queued cancellation, abort and deadline never consume execution or leak another workspace status',async t=>{
  const f=fixture(t),hold=deferred(),first=f.submit('a',()=>hold.promise);await turn();
  const controller=new AbortController();const aborted=f.submit('b',()=>assert.fail('aborted task ran'),{signal:controller.signal,taskId:'abort'});const rejected=assert.rejects(aborted,e=>e.code==='task_aborted');controller.abort();await rejected;
  const cancel=f.submit('b',()=>assert.fail('cancelled task ran'),{taskId:'cancel'});const cancelled=assert.rejects(cancel,e=>e.code==='task_cancelled');assert.equal(f.capacity.cancel('cancel'),true);await cancelled;
  const expired=f.submit('b',()=>assert.fail('expired task ran'),{deadlineAt:f.now()+5});const expiry=assert.rejects(expired,e=>e.code==='task_deadline');f.advance(6);await expiry;
  assert.equal(f.capacity.status('b').active,0);assert.equal(f.capacity.status('b').queued,0);assert.equal(f.capacity.status('b').workspaceId,'b');hold.resolve();await first;
});
test('cancelling a running operation keeps its slot until the actual operation settles',async t=>{
  const f=fixture(t),hold=deferred();let signal,started=false;
  const active=f.submit('a',options=>{signal=options.signal;return hold.promise;},{taskId:'active'});const rejected=assert.rejects(active,e=>e.code==='task_cancelled');await turn();
  const next=f.submit('b',()=>{started=true;return 2;});f.capacity.cancel('active');await turn();
  assert.equal(signal.aborted,true);assert.equal(started,false);assert.equal(f.capacity.status('a').active,1);
  hold.resolve();await rejected;assert.equal(await next,2);
});
test('restored external lease and unconfirmed remote cancellation block models until proven lease termination',async t=>{
  const f=fixture(t);f.capacity.restoreExternalLeases([{workspaceId:'a',taskId:'remote',leaseId:'lease',leaseExpiresAt:f.now()+1000,status:'cancel_requested'}]);
  let started=false;const model=f.submit('b',()=>{started=true;return 'ok';});await turn();assert.equal(started,false);
  assert.equal(f.capacity.releaseExternal('remote','lease',{confirmed:false}),false);assert.equal(f.capacity.status('a').remoteCancellationUnconfirmed,1);
  f.advance(999);await turn();assert.equal(started,false);f.advance(1);assert.equal(await model,'ok');
});
test('fresh persisted lease source is recovered before any model is allowed to start',async t=>{
  const f=fixture(t);let leases=[{workspaceId:'a',taskId:'remote',leaseId:'lease',leaseExpiresAt:f.now()+1000,status:'running'}];
  const detach=f.capacity.bindLeaseSource(()=>({active:leases,queued:[]}));let started=false;
  const model=f.submit('b',()=>{started=true;return 3;});await turn();assert.equal(started,false);
  leases=[];f.capacity.refresh();assert.equal(await model,3);detach();
});
test('a ready external node receives fair handoff against continuous model work without holding an offline reservation forever',async t=>{
  const f=fixture(t),hold=deferred();let leases=[];let queued=[{workspaceId:'b',taskId:'node-task',deadlineAt:f.now()+10000,createdAt:f.now()}];
  f.capacity.bindLeaseSource(()=>({active:leases,queued}));const active=f.submit('a',()=>hold.promise);await turn();
  const remote={workspaceId:'b',taskId:'node-task',leaseId:'node-lease',leaseExpiresAt:f.now()+5000,status:'leased'};
  assert.equal(f.capacity.claimExternal(remote),false);let started=false;const following=f.submit('a',()=>{started=true;return 6;});hold.resolve();await active;await turn();assert.equal(started,false);
  assert.equal(f.capacity.claimExternal(remote),true);queued=[];leases=[remote];f.capacity.refresh();assert.equal(f.capacity.status('b').active,1);
  leases=[];f.capacity.refresh();assert.equal(await following,6);
  queued=[{workspaceId:'b',taskId:'offline',deadlineAt:f.now()+10000,createdAt:f.now()}];const second=f.submit('a',()=>hold.promise);await second;
  f.capacity.claimExternal({workspaceId:'b',taskId:'offline',leaseId:'offline-lease',leaseExpiresAt:f.now()+5000,status:'leased'});
  // Explicit lease expiry still bounds a disconnected remote executor.
  const bounded=f.submit('a',()=>7);f.advance(5001);assert.equal(await bounded,7);
});
test('model failure or deadline releases only after settlement and leaves later tasks runnable',async t=>{
  const f=fixture(t),hold=deferred();let signal;
  const active=f.submit('a',options=>{signal=options.signal;return hold.promise;},{deadlineAt:f.now()+5});const rejected=assert.rejects(active,e=>e.code==='task_deadline');await turn();
  const following=f.submit('b',()=>4);f.advance(6);await turn();assert.equal(signal.aborted,true);assert.equal(f.capacity.status('a').active,1);
  hold.reject(new Error('fixture transport ended'));await rejected;assert.equal(await following,4);
  await assert.rejects(f.submit('a',()=>Promise.reject(new Error('fixture failure'))),/fixture failure/);assert.equal(await f.submit('b',()=>5),5);
});
test('nested coordination does not hold a slot while planning and bounds depth, steps and unapproved work',async t=>{
  const f=fixture(t);const seen=[];
  await f.capacity.withTaskScope({workspaceId:'a',taskId:'root',createdBy:'alice',maxSteps:2,maxDepth:1,deadlineAt:f.now()+10000},async()=>{
    assert.equal(f.capacity.status('a').active,0);
    await f.submit('a',()=>seen.push('first'));
    await f.capacity.withTaskScope({workspaceId:'a',taskId:'child'},async()=>{
      await f.submit('a',()=>seen.push('child'));
      await assert.rejects(f.capacity.withTaskScope({workspaceId:'a',taskId:'grandchild'},async()=>{}),e=>e.code==='delegation_depth');
    });
    await assert.rejects(f.submit('a',()=>assert.fail('step budget exceeded')),e=>e.code==='task_step_budget');
    await assert.rejects(f.submit('b',()=>assert.fail('cross-workspace scope')),e=>e.code==='workspace_context_mismatch');
  });
  await assert.rejects(f.capacity.withTaskScope({workspaceId:'a',taskId:'approval',createdBy:'alice',approvalRequired:true},async()=>assert.fail('unapproved work')),e=>e.code==='approval_required');
  assert.deepEqual(seen,['first','child']);
});
test('coordinator forbids recursive inference acquisition instead of deadlocking and preserves ALS workspace identity',async t=>{
  const f=fixture(t);const {runWithWorkspace,requireWorkspaceContext}=require('../collaboration/context.cjs');
  const a={workspaceId:'a',userId:'alice',role:'owner',version:1},b={workspaceId:'b',userId:'bob',role:'owner',version:1};
  const hold=deferred();const first=runWithWorkspace(a,()=>f.submit('a',async()=>{assert.equal(requireWorkspaceContext().workspaceId,'a');await hold.promise;await assert.rejects(f.submit('a',()=>1),e=>e.code==='recursive_execution_slot');}));await turn();
  const next=runWithWorkspace(b,()=>f.submit('b',()=>requireWorkspaceContext().workspaceId));hold.resolve();await first;assert.equal(await next,'b');
});
test('five-agent round metric counts all five successful executions, not only accepted requests',async t=>{
  const f=fixture(t),rounds=[];
  for(let round=0;round<3;round++)rounds.push(Promise.all(Array.from({length:5},(_,agent)=>f.submit(round%2?'b':'a',async()=>{await turn();return {round,agent,complete:true};}))));
  const finished=await Promise.all(rounds);assert.equal(finished.length,3);assert.ok(finished.every(values=>values.length===5&&values.every(value=>value.complete)));assert.equal(f.capacity.status('a').active,0);assert.equal(f.capacity.status('b').active,0);
});
test('close rejects queued work, aborts running operations and cannot accept new jobs',async t=>{
  const f=fixture(t),hold=deferred();let signal;const first=f.submit('a',options=>{signal=options.signal;return hold.promise;});const activeClosed=assert.rejects(first,e=>e.code==='capacity_closed');await turn();
  const waiting=f.submit('b',()=>assert.fail('closed queue executed'));const queuedClosed=assert.rejects(waiting,e=>e.code==='capacity_closed');f.capacity.close();await queuedClosed;assert.equal(signal.aborted,true);hold.resolve();await activeClosed;
  await assert.rejects(f.submit('b',()=>1),e=>e.code==='capacity_closed');
});
