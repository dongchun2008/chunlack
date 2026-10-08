'use strict';
const P=require('./protocol.cjs');
function createResearchBridge({store,now=Date.now}){
  const pending=new Map();
  function check(){for(const [id,item] of [...pending]){let task;try{task=store.getTask(id);}catch{item.finish(new Error('external_task_missing'));continue;}if(task.status==='succeeded')item.finish(null,{status:'succeeded',output:task.result.output,provenance:{nodeId:task.node_id,taskId:task.id,attempt:task.attempt,traceId:task.trace_id,researchSessionId:task.research_session_id}});else if(['failed','cancelled','needs_attention','cancel_requested'].includes(task.status))item.finish(new Error('external_task_'+task.status));}}
  store.changes.on('change',check);
  function dispatchResearchStage({sessionId,traceId,stage,role,input,deadlineAt=now()+120000,scopeId='public',privacy}){
    if(privacy!=='public')return Promise.reject(new Error('external_research_requires_public_material'));
    if(role?.kind!=='external'||!P.TYPES.includes('research.'+stage))return Promise.reject(new Error('unsupported_external_role'));
    if(pending.size>=32)return Promise.reject(new Error('external_wait_capacity'));
    const task=store.enqueueTask({targetNodeId:role.nodeId,scopeId,taskType:'research.'+stage,input,deadlineAt,researchSessionId:sessionId,traceId});
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{const item=pending.get(task.taskId);if(!item)return;try{store.cancelTask(task.taskId);}catch{}item.finish(new Error('external_task_timeout'));},Math.max(1,deadlineAt-now()));
      function finish(error,value){if(!pending.has(task.taskId))return;pending.delete(task.taskId);clearTimeout(timer);error?reject(error):resolve(value);}
      pending.set(task.taskId,{finish});check();
    });
  }
  const close=()=>{store.changes.off('change',check);for(const [,item] of [...pending])item.finish(new Error('gateway_closed'));};
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
