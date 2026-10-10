'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {gatewayFixture,screenshot}=require('./helpers/workspace-gateway-fixture.cjs');
const {workspaceFixture}=require('./helpers/workspace-fixture.cjs');
const {tls,listen,proxy}=require('./helpers/pilot-network.cjs');
const {createPilotEvents}=require('../integrations/mcp/events.cjs');

test('workspace SDK completes real verified HTTPS CONNECT, image upload and evidence receipt without changing another workspace',async t=>{
  const f=gatewayFixture(t),a=f.enqueue('a'),b=f.enqueue('b');
  const facade=require('../gateway/node-facade.cjs').createPilotNodeFacade({store:f.gatewayStore,workspaceAccess:f.access,artifacts:f.artifacts,tls,allowedNodeIds:[f.nodes.a.id,f.nodes.b.id]});
  t.after(()=>facade.close());const origin='https://127.0.0.1:'+await listen(facade.server),p=await proxy(t);
  const transport=require('../sdk/transports/muse-proxy.cjs').createMuseProxyTransport({proxyUrl:p.url,targetOrigin:origin,ca:tls.cert,workspaceId:f.workspaces.a.id});
  const client=new(require('../sdk/agent-client.cjs').AgentClient)({baseUrl:origin,token:f.credentials.a.token,workspaceId:f.workspaces.a.id,nodeId:f.nodes.a.id,fetch:transport});
  const task=await client.claimTask(a.taskId);assert.equal(task.workspaceId,f.workspaces.a.id);
  const image=await client.uploadArtifact(task,{bytes:screenshot()});assert.equal(image.workspaceId,f.workspaces.a.id);
  await client.event(task,{type:'started'});assert.equal((await client.heartbeat(task)).status,'running');
  await client.result(task,{status:'succeeded',output:{url:task.input.url,challenge:task.input.challenge,title:'Example Domain',executedAt:new Date(f.now()).toISOString(),artifactId:image.artifactId,activityEvidence:'Local HTTPS integration fixture, not a vendor computer activity record'}});
  assert.equal((await client.readTask(a.taskId)).status,'succeeded');
  assert.equal(f.human('bob','b',h=>h.getTask(b.taskId)).status,'queued');
  assert.equal(p.leaked,false);
  const forged=await transport(origin+`/v1/tasks/${a.taskId}/events`,{method:'POST',headers:{Authorization:'Bearer '+f.credentials.a.token,'Content-Type':'application/json'},body:JSON.stringify({protocolVersion:1,taskId:a.taskId,leaseId:task.leaseId,attempt:task.attempt,eventId:'forged',type:'progress',workspaceId:f.workspaces.b.id})});
  assert.equal(forged.status,403);
});

test('public events refuse symbolic-link storage and invalid modes before creating SQLite state',t=>{
  const f=workspaceFixture(t),base={encryptionKey:Buffer.alloc(32,1),authorize:()=>true,transport:async()=>new Response('')};
  assert.throws(()=>createPilotEvents({...base,dbPath:path.join(f.dir,'bad-mode.sqlite'),multiUser:'true'}));
  const destination=path.join(f.dir,'real');fs.mkdirSync(destination);const link=path.join(f.dir,'link');
  fs.symlinkSync(destination,link,process.platform==='win32'?'junction':'dir');
  assert.throws(()=>createPilotEvents({...base,dbPath:path.join(link,'events.sqlite'),multiUser:true}));
  assert.equal(fs.existsSync(path.join(destination,'events.sqlite')),false);
  fs.unlinkSync(link);
});

test('public MCP refuses legacy event state instead of silently mixing scopes',t=>{
  const f=gatewayFixture(t);
  assert.throws(()=>require('../integrations/mcp/pilot-server.cjs').createPilotMcp({store:f.gatewayStore,workspaceAccess:f.access,artifacts:f.artifacts,resolvePrincipal:token=>f.gatewayStore.authenticate(token),events:{list:()=>({events:[]})}}));
});
