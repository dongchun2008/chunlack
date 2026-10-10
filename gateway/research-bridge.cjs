'use strict';
const P=require('./protocol.cjs');
function createResearchBridge({store,workspaceAccess,capacity=store.capacity,now=Date.now}){
  if(store.multiUser&&!workspaceAccess)P.fail('workspace_gateway_configuration',503);
  const pending=new Map(),lifecycle=new AbortController();let closed=false;
  function check(){for(const [id,item] of [...pending]){let task;try{task=item.withHuman(handle=>handle.getTask(id));}catch{item.finish(new Error('external_task_missing'));continue;}if(task.status==='succeeded')item.finish(null,{status:'succeeded',output:task.result.output,provenance:{...(store.multiUser?{workspaceId:task.workspace_id}:{}),nodeId:task.node_id,taskId:task.id,attempt:task.attempt,traceId:task.trace_id,researchSessionId:task.research_session_id}});else if(['failed','cancelled','needs_attention','cancel_requested'].includes(task.status))item.finish(new Error('external_task_'+task.status));}}
  store.changes.on('change',check);
  async function dispatchResearchStage({sessionId,traceId,stage,role,input,deadlineAt=now()+120000,scopeId='public',privacy}){
    if(closed)throw new Error('gateway_closed');
    if(privacy!=='public')return Promise.reject(new Error('external_research_requires_public_material'));
    if(role?.kind!=='external'||!P.TYPES.includes('research.'+stage))return Promise.reject(new Error('unsupported_external_role'));
    if(pending.size>=32)return Promise.reject(new Error('external_wait_capacity'));
    const actor=workspaceAccess?require('../collaboration/context.cjs').requireWorkspaceContext():null;
    const withHuman=actor?fn=>require('../collaboration/context.cjs').runWithWorkspace(actor,()=>fn(workspaceAccess.forHuman(actor))):fn=>fn(store);
    const root=capacity?.currentTask();root?.signal.throwIfAborted();
    const enqueue=()=>{if(closed)throw new Error('gateway_closed');if(pending.size>=32)throw new Error('external_wait_capacity');return withHuman(handle=>handle.enqueueTask({targetNodeId:role.nodeId,scopeId,taskType:'research.'+stage,input,deadlineAt,researchSessionId:sessionId,traceId}));};
    // Budget and authorize the small enqueue operation, not the whole remote
    // wait. The persisted remote lease alone owns its actual execution slot.
    let task;try{task=store.multiUser?await capacity.submit({workspaceId:actor.workspaceId,taskId:require('node:crypto').randomUUID(),kind:'external',deadlineAt,signal:lifecycle.signal,run:enqueue}):enqueue();}catch(error){if(closed)throw new Error('gateway_closed');throw error;}
    if(closed){try{withHuman(handle=>handle.cancelTask(task.taskId));}catch{}throw new Error('gateway_closed');}
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{const item=pending.get(task.taskId);if(!item)return;try{withHuman(handle=>handle.cancelTask(task.taskId));}catch{}item.finish(new Error('external_task_timeout'));},Math.max(1,deadlineAt-now()));
      timer.unref?.();
      function cancel(){try{withHuman(handle=>handle.cancelTask(task.taskId));}catch{}}
      function onAbort(){cancel();finish(root.signal.reason||new Error('external_task_cancel_requested'));}
      function finish(error,value){if(!pending.has(task.taskId))return;pending.delete(task.taskId);clearTimeout(timer);root?.signal.removeEventListener('abort',onAbort);error?reject(error):resolve(value);}
      pending.set(task.taskId,{finish,withHuman,cancel});
      if(root){root.signal.addEventListener('abort',onAbort,{once:true});if(root.signal.aborted)onAbort();}
      check();
    });
  }
  const close=()=>{if(closed)return;closed=true;lifecycle.abort(new Error('gateway_closed'));store.changes.off('change',check);for(const [,item] of [...pending]){item.cancel();item.finish(new Error('gateway_closed'));}};
  return {dispatchResearchStage,close,pendingCount:()=>pending.size};
}
function normalizeExternalRetrieval(output){
  P.fields(output,['sources','claims','missingEvidence']);
  if(!Array.isArray(output.sources)||output.sources.length>5||!Array.isArray(output.claims)||output.claims.length>25)P.fail('invalid_retrieval');
  const sources=output.sources.map((source,index)=>{
    P.fields(source,['url','excerpt','title']);P.text(source.url,2048);P.text(source.excerpt,4000);
    const url=new URL(source.url);if(url.protocol!=='https:'||url.username||url.password||url.hostname==='localhost'||url.hostname.endsWith('.local')||require('node:net').isIP(url.hostname.replace(/^\[|\]$/g,'')))P.fail('invalid_public_source');
    return {sourceId:'S'+(index+1),url:url.href,excerpt:source.excerpt,excerptSha256:P.hash(source.excerpt),status:'external_unverified',truncated:true,external:true,retrievedAt:new Date().toISOString()};
  });
  const claims=output.claims.map((claim,index)=>{P.fields(claim,['text','sourceIndex']);P.text(claim.text,500);if(!Number.isInteger(claim.sourceIndex)||!sources[claim.sourceIndex])P.fail('invalid_source_reference');return {claimId:'C'+(index+1),text:claim.text,sourceId:sources[claim.sourceIndex].sourceId,status:'unverified'};});
  return {sources,claims};
}
module.exports={createResearchBridge,normalizeExternalRetrieval};
