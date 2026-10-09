'use strict';
// Test harness, deliberately reusing local synthetic fixtures, never a Muse worker.
const {setup,png,output}=require('../tests/helpers/pilot-fixture.cjs');
const {tls,listen,proxy}=require('../tests/helpers/pilot-network.cjs');
const {createPilotArtifacts}=require('../gateway/pilot-artifacts.cjs');
const {createPilotNodeFacade}=require('../gateway/node-facade.cjs');
const {createMuseProxyTransport}=require('../sdk/transports/muse-proxy.cjs');
const {AgentClient}=require('../sdk/agent-client.cjs');
const fs=require('node:fs');
async function main(){const clean=[],t={after:f=>clean.push(f)};let report;
 try{const f=setup(t),artifacts=createPilotArtifacts({store:f.store,root:f.root,now:f.now}),facade=createPilotNodeFacade({store:f.store,artifacts,tls,allowedNodeIds:[f.nodeId]});clean.push(()=>facade.close());const origin=`https://127.0.0.1:${await listen(facade.server)}`,p=await proxy(t),transport=createMuseProxyTransport({proxyUrl:p.url,targetOrigin:origin,ca:tls.cert}),client=new AgentClient({baseUrl:origin,token:f.token,fetch:transport});
 const enqueue=()=>f.store.enqueueTask({targetNodeId:f.nodeId,scopeId:'public',taskType:'browser.public_read',input:{url:'https://example.com/',challenge:'A'.repeat(43)},deadlineAt:f.now()+300000});
 const upload=task=>transport(origin+`/v1/pilot/tasks/${task.taskId}/artifact`,{method:'POST',headers:{Authorization:'Bearer '+f.token,'Content-Type':'image/png','X-Pilot-Lease-Id':task.leaseId,'X-Pilot-Attempt':String(task.attempt),'X-Pilot-Event-Id':'fixture-'+task.taskId},body:png()});
 await client.manifest();enqueue();const task=await client.claim(),uploaded=await upload(task);if(uploaded.status!==201)throw new Error('upload_failed');const meta=await uploaded.json();await client.result(task,{status:'succeeded',output:output(meta.artifactId)});
 enqueue();const cancelled=await client.claim();f.store.cancelTask(cancelled.taskId);const denied=await upload(cancelled),admin=await transport(origin+'/admin/v1/nodes',{headers:{Authorization:'Bearer '+f.token}});
 report={mode:'synthetic_fixture',proxyVerified:p.connects>=5&&!p.leaked,museAgentVerified:false,acceptance:f.store.getPilotAcceptance(task.taskId).state,cancelledUploadRejected:denied.status===409,adminRejected:admin.status===404};if(!report.proxyVerified||!report.cancelledUploadRejected||!report.adminRejected)throw new Error('boundary_failed');report.temporaryDirectory=f.dir;
 }finally{for(const stop of clean.reverse())await stop();}
 report.cleanup=!fs.existsSync(report.temporaryDirectory);delete report.temporaryDirectory;console.log(JSON.stringify(report,null,2));
}
main().catch(()=>{console.error('muse_local_pilot_failed');process.exitCode=1;});
