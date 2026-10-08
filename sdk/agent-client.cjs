'use strict';
const {randomUUID}=require('node:crypto');
const {setTimeout:sleep}=require('node:timers/promises');
function validateBaseUrl(value){
  const url=new URL(value);
  if(url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('Use a gateway origin without credentials or paths');
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)))throw new Error('Plain HTTP requires a loopback SSH forward');
  return url.origin;
}
class AgentClient{
  constructor({baseUrl,token,fetch:transport=globalThis.fetch,sleep:pause=sleep}){this.baseUrl=validateBaseUrl(baseUrl);this.token=token;this.transport=transport;this.pause=pause;}
  async request(route,{method='GET',body,signal}={}){
    const signals=[AbortSignal.timeout(40000)];if(signal)signals.push(signal);
    const response=await this.transport(this.baseUrl+route,{method,redirect:'error',headers:{'Content-Type':'application/json',...(this.token?{Authorization:'Bearer '+this.token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.any(signals)});
    if(response.status===204)return null;
    const text=await response.text();if(Buffer.byteLength(text)>262144)throw new Error('Gateway response too large');
    let value;try{value=JSON.parse(text);}catch{throw new Error('Invalid gateway response');}
    if(!response.ok){const error=new Error(typeof value.error==='string'?value.error:'Gateway request failed');error.status=response.status;throw error;}
    return value;
  }
  manifest(){return this.request('/v1/manifest');}
  status(){return this.request('/v1/agents/me');}
  claim(signal){return this.request('/v1/tasks/claim',{method:'POST',body:{},signal});}
  heartbeat(task,signal){return this.request(`/v1/tasks/${task.taskId}/heartbeat`,{method:'POST',body:{taskId:task.taskId,leaseId:task.leaseId,attempt:task.attempt},signal});}
  async send(task,envelope,result,signal){
    const payload={protocolVersion:1,taskId:task.taskId,leaseId:task.leaseId,attempt:task.attempt,eventId:randomUUID(),...envelope};
    for(let attempt=0;;attempt++){
      try{return await this.request(`/v1/tasks/${task.taskId}/${result?'result':'events'}`,{method:'POST',body:payload,signal});}
      catch(error){if(signal?.aborted||[400,401,403,409,413,415,429].includes(error.status)||attempt>=2)throw error;await this.pause(1000*2**attempt,undefined,{signal});}
    }
  }
  event(task,event,signal){return this.send(task,event,false,signal);}
  result(task,result,signal){return this.send(task,result,true,signal);}
  async execute(task,handler,{signal}={}){
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
