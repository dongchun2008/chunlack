'use strict';
const http=require('node:http');
const P=require('../../gateway/protocol.cjs');
function createPilotMcp({store,artifacts,uploads,resolvePrincipal,events,workspaceAccess,ready=()=>true}){
  if(store.multiUser&&!workspaceAccess)P.fail('workspace_gateway_configuration',503);
  if(store.multiUser&&events&&events.multiUser!==true)P.fail('workspace_events_configuration',503);
  if(typeof resolvePrincipal!=='function')throw new Error('principal_resolver_required');let closed=false;const sockets=new Set(),rates=new Map();
  const id={type:'string',pattern:'^[A-Za-z0-9_-]{1,100}$'},num={type:'integer',minimum:1,maximum:3};
  const schema=props=>({type:'object',properties:props,required:Object.keys(props),additionalProperties:false});
  const lease={taskId:id,leaseId:id,attempt:num};
  const definitions=[['pilot.read_task',{taskId:id},true],['pilot.claim_task',{taskId:id},false],['pilot.heartbeat',lease,false],['pilot.report_event',{envelope:{type:'object'}},false],['pilot.submit_result',{envelope:{type:'object'}},false],...(uploads?[['pilot.artifact_begin',{...lease,eventId:id,contentType:{type:'string',enum:['image/png','image/jpeg']}},false],['pilot.artifact_chunk',{uploadId:id,index:{type:'integer',minimum:0,maximum:32767},data:{type:'string',maxLength:87384}},false],['pilot.artifact_finish',{uploadId:id},false]]:[])].map(([name,props,readOnly])=>({name,description:'Public pilot only; does not grant browser, shell or private-network access.',inputSchema:schema(props),annotations:{readOnlyHint:readOnly,destructiveHint:false,openWorldHint:false}}));
  function principal(value){if(workspaceAccess)return workspaceAccess.forNode(value).principal;if(!value?.nodeId)P.fail('unauthorized',401);const n=store.getNode(value.nodeId);if(n.revoked||!n.capabilities.includes('browser.public_read')||!n.scopes.includes('public'))P.fail('unauthorized',401);return {nodeId:n.id};}
  function call(p,name,args){
    const definition=definitions.find(x=>x.name===name);if(!definition)P.fail('unsupported_tool');P.fields(args,Object.keys(definition.inputSchema.properties));if(Object.keys(definition.inputSchema.properties).some(key=>args[key]===undefined))P.fail('missing_tool_field');
    if(name.startsWith('pilot.artifact_')){const action=name.slice('pilot.artifact_'.length);return uploads[action](p.nodeId,args);}
    const taskId=args.taskId||args.envelope?.taskId;if(taskId!==undefined)store.authorizePilotTask(p.nodeId,taskId);
    if(name==='pilot.read_task'){const task=store.authorizePilotTask(p.nodeId,args.taskId);return {taskId:task.id,taskType:task.task_type,scopeId:'public',status:task.status,input:task.input,deadlineAt:task.deadline_at,acceptance:store.getPilotAcceptance(task.id)};}
    if(name==='pilot.claim_task')return store.claimPilotTask(p.nodeId,args.taskId)||{task:null};
    if(name==='pilot.heartbeat')return store.renewLease(p.nodeId,args.taskId,args.leaseId,args.attempt);
    if(name==='pilot.report_event'){if(store.multiUser&&args.envelope.workspaceId!==undefined&&args.envelope.workspaceId!==p.workspaceId)P.fail('workspace_mismatch',403);return store.appendEvent(p.nodeId,args.envelope);}
    if(name==='pilot.submit_result'){if(store.multiUser&&args.envelope.workspaceId!==undefined&&args.envelope.workspaceId!==p.workspaceId)P.fail('workspace_mismatch',403);return store.submitResult(p.nodeId,args.envelope);}
    P.fail('unsupported_tool');
  }
  function error(id,code,reason){return {jsonrpc:'2.0',id:id??null,error:{code,message:reason,data:{reason}}};}
  async function handleRpc(request,auth){
    let requestId=null;
    try{
      P.fields(request,['jsonrpc','id','method','params']);requestId=request.id;
      if(request.jsonrpc!=='2.0'||!(typeof requestId==='string'&&requestId.length<=100||Number.isSafeInteger(requestId))||typeof request.method!=='string')return error(null,-32600,'invalid_request');P.bounded(request);
      if(closed)P.fail('mcp_closed',503);let p,nodeAccess;try{const resolved=await resolvePrincipal(auth);nodeAccess=workspaceAccess?workspaceAccess.forNode(resolved):null;p=nodeAccess?nodeAccess.principal:principal(resolved);}catch{return error(requestId,-32001,'unauthorized');}
      const minute=Math.floor(Date.now()/60000),old=rates.get(p.nodeId),entry=old?.minute===minute?old:{minute,count:0};entry.count++;rates.set(p.nodeId,entry);if(entry.count>120)P.fail('rate_limited',429);
      const handleNode=async()=>{
      const params=request.params||{};let result;
      if(request.method==='server/discover'){P.fields(params,[]);result={resultType:'complete',supportedVersions:['2026-07-28'],capabilities:{tools:{},...(events?{events:{}}:{})}};}
      else if(request.method==='tools/list'){P.fields(params,[]);result={tools:definitions};}
      else if(request.method==='tools/call'){P.fields(params,['name','arguments']);const raw=call(p,params.name,params.arguments||{}),value=store.multiUser&&raw?{...raw,workspaceId:p.workspaceId}:raw;result={content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value,isError:false};}
      else if(events&&request.method==='events/list'){P.fields(params,[]);result=events.list(p);}
      else if(events&&request.method==='events/subscribe')result=await events.subscribe(p,params);
      else if(events&&request.method==='events/unsubscribe')result=await events.unsubscribe(p,params);
      else return error(requestId,-32601,'method_not_found');
      return {jsonrpc:'2.0',id:requestId,result};
      };
      return nodeAccess?await nodeAccess.run(handleNode):await handleNode();
    }catch(e){const reason=e instanceof P.GatewayError?e.code:e.reason||'mcp_error';const invalid=['unsupported_field','unsupported_tool','invalid_object','missing_tool_field','invalid_id','invalid_text','sensitive_or_unsafe_field'].includes(reason);return error(requestId,e.rpcCode||(invalid?-32602:-32000),reason);}
  }
  const server=http.createServer(async(req,res)=>{
    function send(status,value){if(res.destroyed||res.writableEnded)return;res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',Connection:'close'});res.end(JSON.stringify(value));}
    try{
      if(!ready()){send(503,{error:'runtime_starting'});req.resume();return;}
      if(req.method!=='POST'||req.url!=='/mcp'){send(404,{error:'not_found'});req.resume();return;}
      if(req.headers.origin||req.headers['sec-fetch-site']==='cross-site'){send(403,{error:'cross_origin_denied'});req.resume();return;}
      if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host||'')||req.rawHeaders.filter((_,i)=>i%2===0).filter(h=>h.toLowerCase()==='authorization').length!==1){send(401,{error:'unauthorized'});req.resume();return;}
      const auth=req.headers.authorization||'';if(!auth.startsWith('Bearer ')||auth.length>256){send(401,{error:'unauthorized'});req.resume();return;}
      if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')||Number(req.headers['content-length'])>262144){send(413,{error:'invalid_body'});req.resume();return;}
      let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>262144)P.fail('payload_too_large',413);chunks.push(chunk);}if(!req.complete||req.aborted)return;
      const reply=await handleRpc(JSON.parse(Buffer.concat(chunks).toString('utf8')),auth.slice(7));send(reply.error?.code===-32001?401:200,reply);
    }catch(e){req.resume();send(e instanceof P.GatewayError?e.status:400,{error:'invalid_request'});}
  });server.maxConnections=16;server.requestTimeout=40000;server.headersTimeout=10000;server.keepAliveTimeout=1000;server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});const listen=server.listen.bind(server);server.listen=(...args)=>{if(args[1]!=='127.0.0.1')P.fail('loopback_binding_required');return listen(...args);};
  async function close(){if(closed)return;closed=true;for(const socket of sockets)socket.destroy();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  return {handleRpc,server,close};
}
module.exports={createPilotMcp};
