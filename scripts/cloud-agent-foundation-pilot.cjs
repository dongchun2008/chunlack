'use strict';
// Local synthetic fixture only: no network, cloud account or credential access.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {randomUUID,randomBytes}=require('node:crypto');
const {crc32,deflateSync}=require('node:zlib');
const {createGatewayStore}=require('../gateway/store.cjs');
const {createPilotArtifacts}=require('../gateway/pilot-artifacts.cjs');
function syntheticPNG(){
  function chunk(type,data){const name=Buffer.from(type),head=Buffer.alloc(4),tail=Buffer.alloc(4);head.writeUInt32BE(data.length);tail.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([head,name,data,tail]);}
  const head=Buffer.alloc(13);head.writeUInt32BE(1,0);head.writeUInt32BE(1,4);head[8]=8;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',head),chunk('IDAT',deflateSync(Buffer.from([0,120]))),chunk('IEND',Buffer.alloc(0))]);
}
function expectDenied(action,code){try{action();}catch(error){if(error.code===code)return true;throw error;}throw new Error('Expected boundary rejection: '+code);}
function main(){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'chunlack-foundation-pilot-'));let store,report;
  try{
    store=createGatewayStore({dbPath:path.join(directory,'gateway.db')});const artifacts=createPilotArtifacts({store,root:path.join(directory,'artifacts')});
    const node=store.createNode({name:'synthetic-pilot',capabilities:['browser.public_read'],scopes:['public']});
    const input={url:'https://example.com/',challenge:randomBytes(32).toString('base64url')};
    const claim=()=>{store.enqueueTask({targetNodeId:node.id,scopeId:'public',taskType:'browser.public_read',input,deadlineAt:Date.now()+300000});return store.claimTask(node.id);};
    const envelope=(task,out)=>({protocolVersion:1,taskId:task.taskId,leaseId:task.leaseId,attempt:task.attempt,eventId:randomUUID(),status:'succeeded',output:out});
    const output=artifactId=>({...input,title:'Example Domain (synthetic fixture)',executedAt:new Date().toISOString(),artifactId,activityEvidence:'synthetic_fixture: locally generated PNG, no browser or cloud Agent ran'});
    const task=claim(),artifact=artifacts.put(node.id,task,{eventId:randomUUID(),contentType:'image/png',bytes:syntheticPNG()});
    const body=envelope(task,output(artifact.artifactId)),ack=store.submitResult(node.id,body),duplicate=store.submitResult(node.id,body);
    if(!ack.accepted||ack.eventId!==duplicate.eventId)throw new Error('Idempotent result acknowledgement failed');
    const acceptance=store.getPilotAcceptance(task.taskId);
    const missing=claim();const missingEvidenceRejected=expectDenied(()=>store.submitResult(node.id,envelope(missing,output(randomUUID()))),'artifact_unavailable');
    store.cancelTask(missing.taskId);
    const cancelledResultRejected=expectDenied(()=>store.submitResult(node.id,envelope(missing,output(randomUUID()))),'invalid_lease');
    store.appendEvent(node.id,{protocolVersion:1,taskId:missing.taskId,leaseId:missing.leaseId,attempt:missing.attempt,eventId:randomUUID(),type:'cancelled'});
    const retryDenied=expectDenied(()=>store.retryTask(missing.taskId),'pilot_retry_denied');
    report={mode:'synthetic_fixture',cloudConnected:false,taskStatus:store.getTask(task.taskId).status,acceptance:acceptance.state,humanAccepted:acceptance.state==='accepted',missingEvidenceRejected,cancelledResultRejected,retryDenied,artifactBytes:artifact.sizeBytes,temporaryDirectory:directory};
    if(acceptance.state!=='evidence_checked'||report.humanAccepted)throw new Error('Acceptance boundary failed');
  }finally{
    store?.close();
    const resolved=path.resolve(directory);
    if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('chunlack-foundation-pilot-'))throw new Error('Unsafe temporary cleanup path');
    fs.rmSync(resolved,{recursive:true,force:true});
  }
  report.cleanup=!fs.existsSync(directory);process.stdout.write(JSON.stringify(report,null,2)+'\n');
}
try{main();}catch(error){process.stderr.write('Foundation pilot failed: '+(error.code||'local_validation_error')+'\n');process.exitCode=1;}
