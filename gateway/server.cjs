'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const P=require('./protocol.cjs');
function createAgentGateway({store,adminToken,workspaceAccess,now=Date.now,pollMs=P.LIMITS.pollMs}){
  if(store.multiUser&&!workspaceAccess)P.fail('workspace_gateway_configuration',503);
  if(typeof adminToken!=='string'||adminToken.length<43||adminToken.length>256)P.fail('invalid_admin_credential');
  const adminDigest=P.hash(adminToken),waiting=new Map(),rates=new Map();let closed=false;
  const page=fs.readFileSync(path.join(__dirname,'admin.html'));
  const matchSecret=token=>crypto.timingSafeEqual(Buffer.from(P.hash(token)),Buffer.from(adminDigest));
  function respond(res,status,value){if(res.destroyed||res.writableEnded)return;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(value===undefined?'':JSON.stringify(store.multiUser&&value&&!value.error?{...value,workspaceId:store.currentBinding().workspaceId}:value));}
  function rate(key,limit){const minute=Math.floor(now()/60000),previous=rates.get(key);const entry=previous?.minute===minute?previous:{minute,count:0};entry.count++;rates.set(key,entry);if(entry.count>limit)P.fail('rate_limited',429);}
  async function body(req){
    if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))P.fail('json_required',415);
    if(Number(req.headers['content-length'])>P.LIMITS.bodyBytes)P.fail('payload_too_large',413);
    let bytes=0;const chunks=[];
    for await(const chunk of req){bytes+=chunk.length;if(bytes>P.LIMITS.bodyBytes)P.fail('payload_too_large',413);chunks.push(chunk);}
    try{const value=P.object(JSON.parse(Buffer.concat(chunks).toString('utf8')));if(store.multiUser){if(value.workspaceId!==undefined&&value.workspaceId!==store.currentBinding().workspaceId)P.fail('workspace_mismatch',403);delete value.workspaceId;}return value;}catch(err){if(err instanceof P.GatewayError)throw err;P.fail('invalid_json');}
  }
  function bearer(req){const header=req.headers.authorization||'';if(!header.startsWith('Bearer ')||header.length>300)P.fail('unauthorized',401);return header.slice(7);}
  function finishWait(nodeId,status,data){const w=waiting.get(nodeId);if(!w)return;waiting.delete(nodeId);clearTimeout(w.timer);w.res.off('close',w.disconnect);respond(w.res,status,data);}
  function wake(){
    for(const [nodeId,w] of [...waiting]){
      try{const n=store.authenticate(w.token);const next=()=>{const task=store.claimTask(nodeId);if(task)finishWait(nodeId,200,task);};if(workspaceAccess)workspaceAccess.forNode(n).run(next);else next();}catch(error){finishWait(nodeId,error.status||500,{error:error.code||'gateway_error'});}
    }
  }
  store.changes.on('change',wake);
  const maintenance=setInterval(()=>{try{store.sweep();if(now()-lastCleanup>=60000){store.cleanup();lastCleanup=now();}for(const [key,item] of rates)if(item.minute<Math.floor(now()/60000)-1)rates.delete(key);}catch{}},15000);maintenance.unref();let lastCleanup=now();
  async function handle(req,res){
    const traceId=crypto.randomUUID();
    try{
      if(closed)P.fail('gateway_closed',503);
      if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host||''))P.fail('invalid_host',403);
      if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)P.fail('cross_origin_denied',403);
      if(req.headers['sec-fetch-site']==='cross-site')P.fail('cross_origin_denied',403);
      const url=new URL(req.url,'http://127.0.0.1');
      if(store.multiUser&&(url.pathname.startsWith('/admin')||url.pathname==='/v1/pair'||url.pathname==='/'))P.fail('not_found',404);
      if(url.searchParams.has('token')||url.searchParams.has('key'))P.fail('credential_query_denied');
      if(req.method==='GET'&&['/','/admin'].includes(url.pathname)){
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});res.end(page);return;
      }
      if(req.method==='POST'&&url.pathname==='/v1/pair'){
        rate('pair',20);const data=await body(req);P.fields(data,['code']);respond(res,200,store.pair(data.code));return;
      }
      const token=bearer(req);
      if(url.pathname.startsWith('/admin/v1/')){
        if(!matchSecret(token))P.fail('unauthorized',401);rate('admin',120);
        if(req.method==='GET'&&url.pathname==='/admin/v1/nodes'){respond(res,200,{nodes:store.listNodes()});return;}
        if(req.method==='GET'&&url.pathname==='/admin/v1/tasks'){respond(res,200,{tasks:store.listTasks(Number(url.searchParams.get('offset')||0))});return;}
        if(req.method==='GET'&&/^\/admin\/v1\/tasks\/[a-zA-Z0-9_-]+$/.test(url.pathname)){respond(res,200,store.getTask(url.pathname.split('/').at(-1)));return;}
        if(req.method==='POST'&&url.pathname==='/admin/v1/nodes'){respond(res,201,store.createNode(await body(req)));return;}
        let match=url.pathname.match(/^\/admin\/v1\/nodes\/([a-zA-Z0-9_-]+)\/(pause|resume|revoke|pair)$/);
        if(req.method==='POST'&&match){P.fields(await body(req),[]);const [,id,action]=match;const result=action==='revoke'?store.revokeNode(id):action==='pair'?store.rePair(id):store.setNodePaused(id,action==='pause');respond(res,200,result);return;}
        match=url.pathname.match(/^\/admin\/v1\/tasks\/([a-zA-Z0-9_-]+)\/(cancel|retry)$/);
        if(req.method==='POST'&&match){P.fields(await body(req),[]);respond(res,200,match[2]==='cancel'?store.cancelTask(match[1]):store.retryTask(match[1]));return;}
        P.fail('not_found',404);
      }
      const node=store.authenticate(token);rate(node.id,60);
      const handleNode=async()=>{
      if(store.multiUser&&req.headers['x-workspace-id']!==undefined&&req.headers['x-workspace-id']!==node.workspaceId)P.fail('workspace_mismatch',403);
      if(req.method==='GET'&&url.pathname==='/v1/manifest'){respond(res,200,{protocolVersion:1,nodeId:node.id,capabilities:node.capabilities,scopes:node.scopes,limits:P.LIMITS});return;}
      if(req.method==='GET'&&url.pathname==='/v1/agents/me'){respond(res,200,node);return;}
      if(req.method==='POST'&&url.pathname==='/v1/agents/me/heartbeat'){const data=await body(req);P.fields(data,['capabilities']);respond(res,200,store.heartbeat(node.id,data.capabilities||[]));return;}
      if(req.method==='POST'&&url.pathname==='/v1/tasks/claim'){
        P.fields(await body(req),[]);if(waiting.has(node.id))P.fail('poll_already_waiting',409);const task=store.claimTask(node.id);
        if(task){respond(res,200,task);return;}
        if(waiting.size>=P.LIMITS.nodes)P.fail('connection_capacity',429);
        const disconnect=()=>{const w=waiting.get(node.id);if(w?.res===res){clearTimeout(w.timer);waiting.delete(node.id);}};
        res.on('close',disconnect);const timer=setTimeout(()=>finishWait(node.id,204),pollMs);
        waiting.set(node.id,{token,res,timer,disconnect});return;
      }
      if(req.method==='GET'&&url.pathname==='/v1/events'){respond(res,200,store.nodeEvents(node.id,Number(url.searchParams.get('cursor')||0)));return;}
      const match=url.pathname.match(/^\/v1\/tasks\/([a-zA-Z0-9_-]+)\/(heartbeat|events|result)$/);
      if(req.method==='POST'&&match){
        const data=await body(req);if(data.taskId!==match[1])P.fail('task_id_mismatch');
        if(match[2]==='heartbeat'){P.fields(data,['taskId','leaseId','attempt']);respond(res,200,store.renewLease(node.id,data.taskId,data.leaseId,data.attempt));}
        else respond(res,200,match[2]==='result'?store.submitResult(node.id,data):store.appendEvent(node.id,data));return;
      }
      P.fail('not_found',404);
      };
      if(workspaceAccess)await workspaceAccess.forNode(node).run(handleNode);else await handleNode();
    }catch(error){respond(res,error instanceof P.GatewayError?error.status:500,{error:error instanceof P.GatewayError?error.code:'gateway_error',traceId});}
  }
  const server=http.createServer((req,res)=>{void handle(req,res);});server.maxConnections=16;server.requestTimeout=40000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
  const rawListen=server.listen.bind(server);server.listen=(...args)=>{if(args[1]!=='127.0.0.1')P.fail('loopback_binding_required');return rawListen(...args);};
  const close=async()=>{if(closed)return;closed=true;clearInterval(maintenance);store.changes.off('change',wake);for(const [id] of waiting)finishWait(id,503,{error:'gateway_closed'});server.closeAllConnections();if(server.listening)await new Promise(resolve=>server.close(resolve));};
  return {server,store,enqueueTask:input=>store.enqueueTask(input),close,waitingCount:()=>waiting.size};
}
module.exports={createAgentGateway};
