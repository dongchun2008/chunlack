'use strict';
const {randomUUID}=require('node:crypto');
const {setTimeout:sleep}=require('node:timers/promises');
function safeId(value){
  if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(value))throw new Error('Invalid gateway identifier');
  return value;
}
async function readResponse(response){
  if(response.status===204)return null;
  const text=await response.text();if(Buffer.byteLength(text)>262144)throw new Error('Gateway response too large');
  let value;try{value=JSON.parse(text);}catch{throw new Error('Invalid gateway response');}
  if(!response.ok){const error=new Error(typeof value?.error==='string'?value.error:'Gateway request failed');error.status=response.status;throw error;}
  return value;
}
function validateBaseUrl(value){
  const url=new URL(value);
  if(url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('Use a gateway origin without credentials or paths');
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)))throw new Error('Plain HTTP requires a loopback SSH forward');
  return url.origin;
}
class AgentClient{
  constructor({baseUrl,token,workspaceId,nodeId,fetch:transport=globalThis.fetch,sleep:pause=sleep}){
    this.baseUrl=validateBaseUrl(baseUrl);this.token=token;this.transport=transport;this.pause=pause;
    Object.defineProperties(this,{workspaceId:{value:workspaceId===undefined?undefined:safeId(workspaceId),enumerable:true},nodeId:{value:nodeId===undefined?undefined:safeId(nodeId),enumerable:true}});
  }
  binding(value,{lease=false}={}){
    if(value===null)return value;
    const mismatch=()=>{const error=new Error('workspace_binding_mismatch');error.status=403;throw error;};
    if(!value||typeof value!=='object')mismatch();
    if(this.workspaceId!==undefined?value.workspaceId!==this.workspaceId:value.workspaceId!==undefined)mismatch();
    if(this.nodeId!==undefined&&value.nodeId!==undefined&&value.nodeId!==this.nodeId)mismatch();
    if(lease){safeId(value.taskId);safeId(value.leaseId);if(!Number.isInteger(value.attempt)||value.attempt<1||value.attempt>3)throw new Error('Invalid lease attempt');}
    return value;
  }
  async request(route,{method='GET',body,signal}={}){
    const signals=[AbortSignal.timeout(40000)];if(signal)signals.push(signal);
    const response=await this.transport(this.baseUrl+route,{method,redirect:'error',headers:{'Content-Type':'application/json',...(this.token?{Authorization:'Bearer '+this.token}:{}),...(this.workspaceId?{'X-Workspace-Id':this.workspaceId}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.any(signals)});
    const value=await readResponse(response);
    return route==='/v1/pair'?value:this.binding(value);
  }
  manifest(){return this.request('/v1/manifest');}
  status(){return this.request('/v1/agents/me');}
  claim(signal){return this.request('/v1/tasks/claim',{method:'POST',body:{},signal});}
  readTask(taskId,signal){return this.request(`/v1/tasks/${safeId(taskId)}`,{signal});}
  claimTask(taskId,signal){return this.request('/v1/tasks/claim',{method:'POST',body:{taskId:safeId(taskId)},signal});}
  async uploadArtifact(task,{bytes,contentType='image/png',eventId=randomUUID()}={},signal){
    this.binding(task,{lease:true});
    signal?.throwIfAborted();
    safeId(task.taskId);safeId(task.leaseId);safeId(eventId);
    if(!Number.isInteger(task.attempt)||task.attempt<1||task.attempt>3)throw new Error('Invalid lease attempt');
    if(!(bytes instanceof Uint8Array)||bytes.byteLength===0||bytes.byteLength>2097152)throw new Error('Artifact must contain 1 to 2097152 image bytes');
    if(!['image/png','image/jpeg'].includes(contentType))throw new Error('Unsupported artifact content type');
    const body=Buffer.from(bytes),route=`/v1/pilot/tasks/${task.taskId}/artifact`;
    const headers={'Content-Type':contentType,'X-Pilot-Lease-Id':task.leaseId,'X-Pilot-Attempt':String(task.attempt),'X-Pilot-Event-Id':eventId,...(this.token?{Authorization:'Bearer '+this.token}:{}),...(this.workspaceId?{'X-Workspace-Id':this.workspaceId}:{})};
    for(let attempt=0;;attempt++){
      try{
        signal?.throwIfAborted();
        const signals=[AbortSignal.timeout(40000)];if(signal)signals.push(signal);
        const response=await this.transport(this.baseUrl+route,{method:'POST',redirect:'error',headers,body,signal:AbortSignal.any(signals)});
        const value=this.binding(await readResponse(response));
        if(!value||typeof value.artifactId!=='string')throw new Error('Invalid artifact acknowledgment');
        return value;
      }catch(error){
        if(signal?.aborted||[400,401,403,409,413,415,429].includes(error.status)||attempt>=2)throw error;
        await this.pause(1000*2**attempt,undefined,{signal});
      }
    }
  }
  heartbeat(task,signal){this.binding(task,{lease:true});return this.request(`/v1/tasks/${task.taskId}/heartbeat`,{method:'POST',body:{taskId:task.taskId,leaseId:task.leaseId,attempt:task.attempt},signal});}
  async send(task,envelope,result,signal){
    this.binding(task,{lease:true});
    for(const field of ['protocolVersion','taskId','leaseId','attempt','workspaceId','nodeId'])if(Object.prototype.hasOwnProperty.call(envelope,field)){const error=new Error('Envelope cannot override execution identity');error.status=403;throw error;}
    const payload={protocolVersion:1,taskId:task.taskId,leaseId:task.leaseId,attempt:task.attempt,eventId:randomUUID(),...envelope};
    for(let attempt=0;;attempt++){
      try{return await this.request(`/v1/tasks/${task.taskId}/${result?'result':'events'}`,{method:'POST',body:payload,signal});}
      catch(error){if(signal?.aborted||[400,401,403,409,413,415,429].includes(error.status)||attempt>=2)throw error;await this.pause(1000*2**attempt,undefined,{signal});}
    }
  }
  event(task,event,signal){return this.send(task,event,false,signal);}
  result(task,result,signal){return this.send(task,result,true,signal);}
  async execute(task,handler,{signal}={}){
    this.binding(task,{lease:true});
    const cancellation=new AbortController(),activeSignal=signal?AbortSignal.any([signal,cancellation.signal]):cancellation.signal;let renewing=false,renewalFailure=false,cancelRequested=false;
    const timer=setInterval(async()=>{if(renewing||activeSignal.aborted)return;renewing=true;try{const state=await this.heartbeat(task,activeSignal);if(state.status==='cancel_requested'){cancelRequested=true;cancellation.abort(new Error('Task cancelled'));}}catch{renewalFailure=true;cancellation.abort(new Error('Lease renewal failed'));}finally{renewing=false;}},30000);
    const abort=()=>cancellation.abort(signal.reason);signal?.addEventListener('abort',abort,{once:true});
    try{
      await this.event(task,{type:'started'},activeSignal);
      const abortPromise=new Promise((_,reject)=>{if(activeSignal.aborted)reject(activeSignal.reason);else activeSignal.addEventListener('abort',()=>reject(activeSignal.reason),{once:true});});
      const output=await Promise.race([Promise.resolve().then(()=>handler({task,signal:activeSignal,reportProgress:message=>this.event(task,{type:'progress',message},activeSignal)})),abortPromise]);
      if(activeSignal.aborted)throw activeSignal.reason;
      await this.result(task,{status:'succeeded',output},activeSignal);
    }catch(error){
      if(cancelRequested)await this.event(task,{type:'cancelled'}).catch(()=>{});
      else if(!renewalFailure&&!activeSignal.aborted)await this.result(task,{status:'failed',output:{error:'handler_failed'}}).catch(()=>{});
      if([401,403].includes(error.status))throw error;
    }finally{clearInterval(timer);signal?.removeEventListener('abort',abort);cancellation.abort();}
  }
  async run(handler,{signal}={}){
    if(typeof handler!=='function')throw new Error('A trusted local handler is required');let backoff=1000;
    while(!signal?.aborted){
      try{const task=await this.claim(signal);backoff=1000;if(task)await this.execute(task,handler,{signal});else await this.pause(Math.floor(Math.random()*2000),undefined,{signal});}
      catch(error){if(signal?.aborted)return;if([400,401,403,409].includes(error.status))throw error;await this.pause(backoff,undefined,{signal});backoff=Math.min(backoff*2,30000);}
    }
  }
}
module.exports={AgentClient,validateBaseUrl};
