'use strict';
const https=require('node:https');
const P=require('./protocol.cjs');
const {createPilotOpenApi}=require('./pilot-openapi.cjs');
function createPilotNodeHandler({store,artifacts,allowedNodeIds,workspaceAccess,publicOrigin,ready=()=>true}){
  if(store.multiUser&&!workspaceAccess)P.fail('workspace_gateway_configuration',503);
  if(allowedNodeIds===undefined?!store.multiUser:!Array.isArray(allowedNodeIds)||!allowedNodeIds.length||allowedNodeIds.length>5)P.fail('invalid_facade_configuration');allowedNodeIds?.forEach(P.id);const allowed=allowedNodeIds?new Set(allowedNodeIds):null,rates=new Map();let closed=false;
  const openApi=createPilotOpenApi({multiUser:store.multiUser,publicOrigin});
  function respond(res,status,value){if(res.destroyed||res.writableEnded)return;res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',Connection:'close'});res.end(status===204?undefined:JSON.stringify(store.multiUser&&value&&!value.error&&value.openapi===undefined&&value.mode!=='pilot_only'?{...value,workspaceId:store.currentBinding().workspaceId}:value));}
  async function body(req,max,json=true){if(json&&!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))P.fail('json_required',415);if(Number(req.headers['content-length'])>max)P.fail('payload_too_large',413);let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>max)P.fail('payload_too_large',413);chunks.push(chunk);}const raw=Buffer.concat(chunks);if(!json)return raw;try{return P.object(JSON.parse(raw.toString('utf8')));}catch{P.fail('invalid_json');}}
  function node(req){if(req.rawHeaders.filter((_,i)=>i%2===0).filter(h=>h.toLowerCase()==='authorization').length!==1)P.fail('unauthorized',401);const header=req.headers.authorization||'';if(!header.startsWith('Bearer ')||header.length>110)P.fail('unauthorized',401);const n=store.authenticate(header.slice(7));if(allowed&&!allowed.has(n.id)||n.capabilities.length!==1||n.capabilities[0]!=='browser.public_read'||n.scopes.length!==1||n.scopes[0]!=='public')P.fail('facade_scope_denied',403);const minute=Math.floor(Date.now()/60000),old=rates.get(n.id),rate=old?.minute===minute?old:{minute,count:0};rate.count++;rates.set(n.id,rate);if(rate.count>60)P.fail('rate_limited',429);return n;}
  function task(nodeId,id){P.id(id);const value=store.getTask(id);if(value.node_id!==nodeId||value.task_type!=='browser.public_read'||value.scope_id!=='public')P.fail('task_owner_denied',403);return value;}
  async function handle(req,res){try{
    if(closed)P.fail('facade_closed',503);
    if(!ready())P.fail('runtime_starting',503);
    if(req.headers.origin||req.headers['sec-fetch-site']==='cross-site')P.fail('cross_origin_denied',403);
    const route=req.url;if(typeof route!=='string'||/[?%#\\]/.test(route))P.fail('not_found',404);
    if(req.method==='GET'&&route==='/health'){respond(res,200,{status:'ok',mode:'pilot_only'});return;}
    const validGet=['/v1/manifest','/v1/agents/me','/v1/openapi.json'],validPost=['/v1/agents/me/heartbeat','/v1/tasks/claim'];const read=route.match(/^\/v1\/tasks\/([a-zA-Z0-9_-]{1,100})$/),match=route.match(/^\/v1\/tasks\/([a-zA-Z0-9_-]{1,100})\/(heartbeat|events|result)$/),upload=route.match(/^\/v1\/pilot\/tasks\/([a-zA-Z0-9_-]{1,100})\/artifact$/);
    if(!(req.method==='GET'&&(validGet.includes(route)||read))&&!(req.method==='POST'&&(validPost.includes(route)||match||upload)))P.fail('not_found',404);
    const n=node(req);
    const revalidate=()=>{if(closed)P.fail('facade_closed',503);if(workspaceAccess)workspaceAccess.forNode(n).run(()=>{});else store.assertAuthenticatedNode(n);};
    const handleNode=async()=>{
    if(store.multiUser&&req.headers['x-workspace-id']!==undefined&&req.headers['x-workspace-id']!==n.workspaceId)P.fail('workspace_mismatch',403);
    if(req.method==='GET'){
      if(read){const value=store.authorizePilotTask(n.id,read[1]);respond(res,200,{taskId:value.id,taskType:value.task_type,scopeId:'public',status:value.status,input:value.input,deadlineAt:value.deadline_at,acceptance:store.getPilotAcceptance(value.id)});}
      else respond(res,200,route==='/v1/openapi.json'?openApi:route==='/v1/manifest'?{protocolVersion:1,nodeId:n.id,capabilities:n.capabilities,scopes:n.scopes,limits:P.LIMITS}:n);
      return;
    }
    if(upload){task(n.id,upload[1]);const attempt=req.headers['x-pilot-attempt'];if(typeof attempt!=='string'||! /^[1-3]$/.test(attempt))P.fail('invalid_attempt');const lease={taskId:upload[1],leaseId:req.headers['x-pilot-lease-id'],attempt:Number(attempt)};store.assertPilotLease(n.id,lease);const bytes=await body(req,2097152,false);revalidate();if(!req.complete||req.aborted||res.destroyed)P.fail('upload_disconnected',409);respond(res,201,artifacts.put(n.id,lease,{eventId:req.headers['x-pilot-event-id'],contentType:req.headers['content-type'],bytes}));return;}
    const data=await body(req,P.LIMITS.bodyBytes);
    revalidate();
    if(store.multiUser){if(data.workspaceId!==undefined&&data.workspaceId!==n.workspaceId)P.fail('workspace_mismatch',403);delete data.workspaceId;}
    if(route==='/v1/tasks/claim'){P.fields(data,['taskId']);if(data.taskId!==undefined)P.id(data.taskId);const value=data.taskId===undefined?store.claimTask(n.id):store.claimPilotTask(n.id,data.taskId);respond(res,value?200:204,value);return;}
    if(route==='/v1/agents/me/heartbeat'){P.fields(data,['capabilities']);if(data.capabilities!==undefined&&(!Array.isArray(data.capabilities)||data.capabilities.some(c=>c!=='browser.public_read')))P.fail('invalid_capability');respond(res,200,store.heartbeat(n.id,data.capabilities||[]));return;}
    task(n.id,match[1]);if(data.taskId!==match[1])P.fail('task_id_mismatch');
    if(match[2]==='heartbeat'){P.fields(data,['taskId','leaseId','attempt']);respond(res,200,store.renewLease(n.id,data.taskId,data.leaseId,data.attempt));}
    else respond(res,200,match[2]==='result'?store.submitResult(n.id,data):store.appendEvent(n.id,data));
    };
    if(workspaceAccess)await workspaceAccess.forNode(n).run(handleNode);else await handleNode();
  }catch(error){req.resume();respond(res,error instanceof P.GatewayError?error.status:500,{error:error instanceof P.GatewayError?error.code:'facade_error'});}}
  return {handle,close(){closed=true;rates.clear();}};
}
function createPilotNodeFacade(options){
  const {tls,allowedNodeIds}=options;
  if(!tls?.key||!tls?.cert||!Array.isArray(allowedNodeIds)||!allowedNodeIds.length||allowedNodeIds.length>5)P.fail('invalid_facade_configuration');
  const handler=createPilotNodeHandler(options),sockets=new Set();let closed=false;
  const server=https.createServer({...tls,minVersion:'TLSv1.2'},(req,res)=>void handler.handle(req,res));server.maxConnections=16;server.requestTimeout=40000;server.headersTimeout=10000;server.keepAliveTimeout=1000;
  server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});const rawListen=server.listen.bind(server);server.listen=(...args)=>{if(args[1]!=='127.0.0.1')P.fail('loopback_binding_required');return rawListen(...args);};
  async function close(){if(closed)return;closed=true;handler.close();for(const socket of sockets)socket.destroy();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  return {server,close};
}
module.exports={createPilotNodeFacade,createPilotNodeHandler};
