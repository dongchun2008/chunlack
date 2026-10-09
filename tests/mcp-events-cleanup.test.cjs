'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto');
const {createPilotEvents}=require('../integrations/mcp/events.cjs');
test('completed task permits owner subscription cleanup without permitting new work',async t=>{
  let active=true,revoked=false;
  const owner={nodeId:'owner_node'},taskId='approved_task';
  const params={name:'pilot.task_ready',arguments:{taskId},delivery:{mode:'webhook',url:'https://callback.example/task',secret:'whsec_'+randomBytes(32).toString('base64')}};
  const events=createPilotEvents({dbPath:':memory:',encryptionKey:randomBytes(32),
    authorize:(p,id)=>!revoked&&p.nodeId===owner.nodeId&&id===taskId&&active,
    authorizeCleanup:(p,id)=>!revoked&&p.nodeId===owner.nodeId&&id===taskId,
    transport:async(_url,options)=>new Response(JSON.stringify({challenge:JSON.parse(options.body).challenge}))});
  t.after(()=>events.close());
  await events.subscribe(owner,params);active=false;
  const cleanup={...params,delivery:{mode:'webhook',url:params.delivery.url}};
  assert.throws(()=>events.unsubscribe({nodeId:'other_node'},cleanup),/event_access_denied/);
  assert.deepEqual(events.unsubscribe(owner,cleanup),{unsubscribed:true});
  assert.deepEqual(events.unsubscribe(owner,cleanup),{unsubscribed:true});
  await assert.rejects(events.subscribe(owner,params),/event_access_denied/);
  assert.throws(()=>events.publish(owner,{eventId:'event_one',taskId,taskType:'browser.public_read',deadlineAt:Date.now()+10000}),/event_access_denied/);
  revoked=true;assert.throws(()=>events.unsubscribe(owner,cleanup),/event_access_denied/);
});
