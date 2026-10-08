'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
function fixture(t) {
  const {createGatewayStore} = require('../gateway/store.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-gateway-'));
  let time = Date.now();
  const store = createGatewayStore({dbPath: path.join(dir, 'gateway.db'), now: () => time});
  t.after(() => {store.close(); fs.rmSync(dir, {recursive:true, force:true});});
  const node = store.createNode({name:'Fixture', capabilities:['research.verify'], scopes:['public']});
  const paired = store.pair(node.pairingCode);
  return {store, dir, paired, advance: ms => {time += ms;}, input: {targetNodeId:paired.nodeId, scopeId:'public', taskType:'research.verify', input:{question:'Fixture'}, deadlineAt:time+300000}};
}
test('pairing is single-use, expires, and only hashes remain in SQLite', t => {
  const r = fixture(t);
  assert.equal(r.store.authenticate(r.paired.token).id, r.paired.nodeId);
  const another = r.store.createNode({name:'Other', capabilities:['research.verify'], scopes:['public']});
  r.advance(300001);
  assert.throws(() => r.store.pair(another.pairingCode), /pairing/);
  assert.throws(() => r.store.pair('wrong'), /pairing/);
  assert.ok(!fs.readFileSync(path.join(r.dir,'gateway.db')).includes(Buffer.from(r.paired.token)));
});
test('single active task, scoped ownership and lease expiry survive restart', t => {
  const r = fixture(t);
  const a = r.store.enqueueTask(r.input), b = r.store.enqueueTask(r.input);
  const lease = r.store.claimTask(r.paired.nodeId);
  assert.equal(lease.taskId, a.taskId);
  assert.equal(r.store.claimTask(r.paired.nodeId), null);
  assert.throws(() => r.store.enqueueTask({...r.input,scopeId:'private'}), /scope/);
  r.advance(90001);r.store.sweep();
  assert.equal(r.store.getTask(a.taskId).status,'needs_attention');
  assert.equal(r.store.claimTask(r.paired.nodeId).taskId,b.taskId);
  assert.throws(() => r.store.submitResult(r.paired.nodeId,{protocolVersion:1,taskId:lease.taskId,leaseId:lease.leaseId,attempt:lease.attempt,eventId:'late',status:'succeeded',output:{decisions:[]}}), /lease/);
});
test('results are idempotent, reject altered retries and can be recovered from SQLite', t => {
  const r = fixture(t);const task=r.store.enqueueTask(r.input);const lease=r.store.claimTask(r.paired.nodeId);
  const result={protocolVersion:1,taskId:lease.taskId,leaseId:lease.leaseId,attempt:lease.attempt,eventId:'result-1',status:'succeeded',output:{decisions:[]}};
  const first=r.store.submitResult(r.paired.nodeId,result);
  assert.deepEqual(r.store.submitResult(r.paired.nodeId,result),first);
  assert.throws(()=>r.store.submitResult(r.paired.nodeId,{...result,output:{decisions:['changed']}}), /conflict/);
  assert.equal(r.store.getTask(task.taskId).result.output.decisions.length,0);
  const Database=require('better-sqlite3');const reopened=new Database(path.join(r.dir,'gateway.db'));
  assert.equal(reopened.prepare('SELECT status FROM tasks WHERE id=?').get(task.taskId).status,'succeeded');reopened.close();
});
test('revocation invalidates credentials and does not claim remote cancellation', t => {
  const r=fixture(t);const task=r.store.enqueueTask(r.input);r.store.claimTask(r.paired.nodeId);
  r.store.revokeNode(r.paired.nodeId);
  assert.throws(()=>r.store.authenticate(r.paired.token),/unauthorized/);
  assert.equal(r.store.getTask(task.taskId).status,'cancel_requested');
  assert.throws(()=>r.store.claimTask(r.paired.nodeId),/revoked/);
});
test('pause, cancellation acknowledgement and manual retry keep attempts distinct', t => {
  const r=fixture(t);const task=r.store.enqueueTask(r.input);
  r.store.setNodePaused(r.paired.nodeId,true);assert.equal(r.store.claimTask(r.paired.nodeId),null);
  r.store.setNodePaused(r.paired.nodeId,false);const lease=r.store.claimTask(r.paired.nodeId);
  r.store.cancelTask(task.taskId);
  r.store.appendEvent(r.paired.nodeId,{protocolVersion:1,taskId:lease.taskId,leaseId:lease.leaseId,attempt:lease.attempt,eventId:'cancelled-1',type:'cancelled'});
  assert.equal(r.store.getTask(task.taskId).status,'cancelled');
  r.store.retryTask(task.taskId);const next=r.store.claimTask(r.paired.nodeId);
  assert.equal(next.attempt,2);assert.notEqual(next.leaseId,lease.leaseId);
});

test('HTTP isolates admin permissions, wakes polls and removes disconnected waiters', async t => {
  const {createAgentGateway}=require('../gateway/server.cjs');const {once}=require('node:events');
  const r=fixture(t),adminToken='a'.repeat(43),gateway=createAgentGateway({store:r.store,adminToken,pollMs:80});
  gateway.server.listen(0,'127.0.0.1');await once(gateway.server,'listening');t.after(()=>gateway.close());
  const url=`http://127.0.0.1:${gateway.server.address().port}`;
  const headers={Authorization:'Bearer '+r.paired.token,'Content-Type':'application/json'};
  assert.equal((await fetch(url+'/admin/v1/nodes',{headers})).status,401);
  assert.equal((await fetch(url+'/v1/manifest',{headers:{...headers,Origin:'https://evil.example'}})).status,403);
  assert.equal((await fetch(url+'/v1/manifest',{headers})).status,200);
  const pending=fetch(url+'/v1/tasks/claim',{method:'POST',headers,body:'{}'});
  await new Promise(resolve=>setTimeout(resolve,20));assert.equal(gateway.waitingCount(),1);
  r.store.enqueueTask(r.input);const claim=await (await pending).json();assert.equal(claim.taskType,'research.verify');
  assert.equal(gateway.waitingCount(),0);
  const aborted=new AbortController();const polling=fetch(url+'/v1/tasks/claim',{method:'POST',headers,body:'{}',signal:aborted.signal}).catch(()=>null);
  await new Promise(resolve=>setTimeout(resolve,20));aborted.abort();await polling;await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(gateway.waitingCount(),0);
  assert.equal((await fetch(url+'/v1/tasks/claim',{method:'POST',headers,body:'{}'})).status,204);
  assert.equal((await fetch(url+'/v1/agents/me/heartbeat',{method:'POST',headers,body:JSON.stringify({capabilities:['shell']})})).status,400);
  assert.equal((await fetch(url+'/v1/tasks/claim',{method:'POST',headers,body:JSON.stringify({data:'x'.repeat(262144)})})).status,413);
  assert.throws(()=>gateway.server.listen(0,'0.0.0.0'),/loopback/);
});

test('trace and research session survive reopening and manual retries', t=>{
  const r=fixture(t),task=r.store.enqueueTask({...r.input,traceId:'trace-1',researchSessionId:'session-1'});
  let lease=r.store.claimTask(r.paired.nodeId);
  assert.equal(lease.traceId,'trace-1');assert.equal(lease.researchSessionId,'session-1');
  r.store.submitResult(r.paired.nodeId,{protocolVersion:1,taskId:lease.taskId,leaseId:lease.leaseId,attempt:lease.attempt,eventId:'trace-failed',status:'failed',output:{}});
  r.store.retryTask(task.taskId);lease=r.store.claimTask(r.paired.nodeId);
  assert.equal(lease.traceId,'trace-1');assert.equal(lease.researchSessionId,'session-1');
  const {createGatewayStore}=require('../gateway/store.cjs');const reopened=createGatewayStore({dbPath:path.join(r.dir,'gateway.db')});
  try{assert.equal(reopened.getTask(task.taskId).trace_id,'trace-1');assert.equal(reopened.listTasks()[0].research_session_id,'session-1');}finally{reopened.close();}
  assert.throws(()=>r.store.enqueueTask({...r.input,traceId:'invalid trace'}),/invalid_id/);
});

test('progress saturation reserves terminal results for all three attempts', t=>{
  const r=fixture(t);r.store.enqueueTask(r.input);let lease=r.store.claimTask(r.paired.nodeId);
  const envelope=eventId=>({protocolVersion:1,taskId:lease.taskId,leaseId:lease.leaseId,attempt:lease.attempt,eventId});
  for(let i=0;i<97;i++)r.store.appendEvent(r.paired.nodeId,{...envelope('progress-'+i),type:'progress'});
  for(let attempt=1;attempt<=3;attempt++){
    assert.throws(()=>r.store.appendEvent(r.paired.nodeId,{...envelope('overflow-'+attempt),type:'progress'}),/event_capacity/);
    const result={...envelope('terminal-'+attempt),status:attempt===3?'succeeded':'failed',output:{}};
    const ack=r.store.submitResult(r.paired.nodeId,result);assert.deepEqual(r.store.submitResult(r.paired.nodeId,result),ack);
    if(attempt<3){r.store.retryTask(lease.taskId);lease=r.store.claimTask(r.paired.nodeId);}
  }
  assert.equal(r.store.getTask(lease.taskId).status,'succeeded');
});

test('saturated progress still permits cancellation acknowledgement', t=>{
  const r=fixture(t);r.store.enqueueTask(r.input);const lease=r.store.claimTask(r.paired.nodeId);
  const body={protocolVersion:1,taskId:lease.taskId,leaseId:lease.leaseId,attempt:lease.attempt};
  for(let i=0;i<97;i++)r.store.appendEvent(r.paired.nodeId,{...body,eventId:'cancel-progress-'+i,type:'progress'});
  r.store.cancelTask(lease.taskId);
  assert.equal(r.store.appendEvent(r.paired.nodeId,{...body,eventId:'cancel-terminal',type:'cancelled'}).status,'cancelled');
});

test('closed gateway releases pending connections', async t=>{
  const {createAgentGateway}=require('../gateway/server.cjs');const {once}=require('node:events');
  const r=fixture(t),gateway=createAgentGateway({store:r.store,adminToken:'a'.repeat(43)});
  gateway.server.listen(0,'127.0.0.1');await once(gateway.server,'listening');
  const request=fetch(`http://127.0.0.1:${gateway.server.address().port}/v1/tasks/claim`,{method:'POST',headers:{Authorization:'Bearer '+r.paired.token,'Content-Type':'application/json'},body:'{}'}).catch(()=>null);
  await new Promise(resolve=>setTimeout(resolve,20));await gateway.close();await request;
  assert.equal(gateway.waitingCount(),0);
});
