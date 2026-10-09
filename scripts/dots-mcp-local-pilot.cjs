'use strict';
// Local mock only. This does not trigger dots or operate a cloud browser.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),https=require('node:https');
const {randomBytes,randomUUID,createHmac}=require('node:crypto');
const {setup,png,input,output,result}=require('../tests/helpers/pilot-fixture.cjs');
const {createPilotArtifacts}=require('../gateway/pilot-artifacts.cjs');
const {createArtifactUpload}=require('../integrations/mcp/artifact-upload.cjs');
const {createPilotMcp}=require('../integrations/mcp/pilot-server.cjs');
const {createPilotEvents}=require('../integrations/mcp/events.cjs');
const {sendPinnedHttps}=require('../integrations/mcp/webhook-transport.cjs');
async function main(){
  const cleanup=[],key=randomBytes(32),webhookKey=randomBytes(32),received=[];
  const f=setup({after:fn=>cleanup.push(fn)});
  let report;
  try{
    const tls={cert:fs.readFileSync(path.join(__dirname,'../tests/fixtures/pilot-tls-cert.pem')),key:fs.readFileSync(path.join(__dirname,'../tests/fixtures/pilot-tls-key.pem'))};
    const sockets=new Set();
    const receiver=https.createServer(tls,async(req,res)=>{
      try{
        const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;assert.ok(size<=262144);chunks.push(chunk);}
        const body=Buffer.concat(chunks).toString('utf8');
        const expected='v1,'+createHmac('sha256',webhookKey).update(req.headers['webhook-id']+'.'+req.headers['webhook-timestamp']+'.'+body).digest('base64');
        assert.equal(req.headers['webhook-signature'],expected);
        const payload=JSON.parse(body);if(payload.type!=='verification')received.push(payload);
        res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(payload.type==='verification'?{challenge:payload.challenge}:{}));
      }catch{res.writeHead(400);res.end('{}');}
    });
    receiver.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
    cleanup.push(async()=>{for(const socket of sockets)socket.destroy();if(receiver.listening)await new Promise(resolve=>receiver.close(resolve));});
    await new Promise(resolve=>receiver.listen(0,'127.0.0.1',resolve));
    // Explicit local test transport injection; public-IP enforcement is not weakened.
    const transport=(_url,options)=>sendPinnedHttps('https://localhost:'+receiver.address().port+'/callback',options,{address:'127.0.0.1',family:4},{ca:tls.cert,timeoutMs:3000});
    const authorize=(p,taskId)=>{try{const task=f.store.authorizePilotTask(p.nodeId,taskId);return ['queued','leased','running'].includes(task.status)&&task.deadline_at>f.now();}catch{return false;}};
    const authorizeCleanup=(p,taskId)=>{try{f.store.authorizePilotTask(p.nodeId,taskId);return true;}catch{return false;}};
    const events=createPilotEvents({dbPath:path.join(f.dir,'events.db'),encryptionKey:key,authorize,authorizeCleanup,transport,now:f.now});cleanup.push(()=>events.close());
    const artifacts=createPilotArtifacts({store:f.store,root:f.root,now:f.now});
    const uploads=createArtifactUpload({store:f.store,artifacts,now:f.now});
    const mcp=createPilotMcp({store:f.store,artifacts,uploads,events,resolvePrincipal:token=>token===f.token?{nodeId:f.nodeId}:null});cleanup.push(()=>mcp.close());
    await new Promise(resolve=>mcp.server.listen(0,'127.0.0.1',resolve));
    let rpcId=0;
    async function rpc(method,params={}){
      const response=await fetch('http://127.0.0.1:'+mcp.server.address().port+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+f.token,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++rpcId,method,params}),signal:AbortSignal.timeout(5000)});
      const body=await response.json();assert.equal(response.status,200);assert.equal(body.error,undefined,JSON.stringify(body.error));return body.result;
    }
    const tool=async(name,args)=>(await rpc('tools/call',{name,arguments:args})).structuredContent;
    const discover=await rpc('server/discover');assert.ok(discover.capabilities.events);
    const queued=f.store.enqueueTask({targetNodeId:f.nodeId,scopeId:'public',taskType:'browser.public_read',input:{...input},deadlineAt:f.now()+300000});
    const subscription={name:'pilot.task_ready',arguments:{taskId:queued.taskId},delivery:{mode:'webhook',url:'https://callback.example/dot',secret:'whsec_'+webhookKey.toString('base64')},ttlMs:300000};
    await rpc('events/subscribe',subscription);
    const ready={eventId:'evt_local_'+randomUUID(),taskId:queued.taskId,taskType:'browser.public_read',deadlineAt:f.now()+300000};
    events.publish({nodeId:f.nodeId},ready);events.publish({nodeId:f.nodeId},ready);
    assert.equal((await events.deliverDue()).delivered,1);assert.equal(received.length,1);
    assert.equal(f.store.getTask(queued.taskId).status,'queued');
    const read=await tool('pilot.read_task',{taskId:queued.taskId});assert.equal(read.input.challenge,input.challenge);
    const task=await tool('pilot.claim_task',{taskId:queued.taskId});assert.equal(task.taskId,queued.taskId);
    assert.deepEqual(await tool('pilot.claim_task',{taskId:queued.taskId}),{task:null});
    const upload=await tool('pilot.artifact_begin',{taskId:task.taskId,leaseId:task.leaseId,attempt:task.attempt,eventId:randomUUID(),contentType:'image/png'});
    await tool('pilot.artifact_chunk',{uploadId:upload.uploadId,index:0,data:png().toString('base64')});
    const image=await tool('pilot.artifact_finish',{uploadId:upload.uploadId});assert.ok(image.artifactId);
    const envelope=result(task,output(image.artifactId));
    await tool('pilot.submit_result',{envelope});await tool('pilot.submit_result',{envelope});
    assert.equal(f.store.getTask(task.taskId).status,'succeeded');
    const unsubscribe={name:subscription.name,arguments:subscription.arguments,delivery:{mode:'webhook',url:subscription.delivery.url}};
    await rpc('events/unsubscribe',unsubscribe);assert.equal((await events.deliverDue()).delivered,0);assert.equal(received.length,1);
    report={mode:'mock_dot',dotsAgentVerified:false,eventReceived:true,receiptDoesNotExecuteTask:true,taskClaimed:true,artifactSaved:true,resultRecorded:true,duplicateNotReexecuted:true,unsubscribeStopsDelivery:true,acceptance:f.store.getPilotAcceptance(task.taskId),humanAccepted:false};
  }finally{for(const release of cleanup.reverse())await release();key.fill(0);webhookKey.fill(0);}
  report.cleanup=!fs.existsSync(f.dir);assert.equal(report.cleanup,true);process.stdout.write(JSON.stringify(report)+'\n');
}
main().catch(()=>{process.stderr.write('dots_local_pilot_failed\n');process.exitCode=1;});
