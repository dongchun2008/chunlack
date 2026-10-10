'use strict';
const fs=require('node:fs'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {crc32,inflateSync}=require('node:zlib');
const P=require('./protocol.cjs');
const MAX=2*1024*1024,RETENTION=7*86400000;
const filePattern=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|tmp)$/;
function reject(){P.fail('invalid_screenshot');}
function dimensions(width,height){if(!width||!height||width>4096||height>4096)reject();return {width,height};}
function png(bytes){
  if(bytes.length<57||!bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))reject();
  let pos=8,head=null,ended=false,sawData=false,dataEnded=false;const compressed=[];
  while(pos<bytes.length){
    if(pos+12>bytes.length)reject();const length=bytes.readUInt32BE(pos),end=pos+12+length;if(end>bytes.length)reject();
    const type=bytes.toString('ascii',pos+4,pos+8),data=bytes.subarray(pos+8,end-4);
    if(!/^[A-Za-z]{4}$/.test(type)||crc32(bytes.subarray(pos+4,end-4))!==bytes.readUInt32BE(end-4))reject();
    if(!head&&type!=='IHDR')reject();
    if(type==='IHDR'){if(head||length!==13)reject();head=dimensions(data.readUInt32BE(0),data.readUInt32BE(4));head.depth=data[8];head.color=data[9];if(head.depth!==8||![0,2,4,6].includes(head.color)||data[10]!==0||data[11]!==0||data[12]!==0)reject();}
    else if(type==='IDAT'){if(dataEnded)reject();sawData=true;compressed.push(data);}
    else if(type==='IEND'){if(length||!sawData||end!==bytes.length)reject();ended=true;pos=end;break;}
    else {if(sawData)dataEnded=true;if(type[0]===type[0].toUpperCase()&&type!=='PLTE')reject();if(type==='PLTE'&&(sawData||length===0||length>768||length%3))reject();}
    pos=end;
  }
  if(!ended)reject();const channels={0:1,2:3,4:2,6:4}[head.color],row=head.width*channels+1,expected=row*head.height;
  let raw;try{const decoded=inflateSync(Buffer.concat(compressed),{maxOutputLength:expected,info:true});raw=decoded.buffer;if(decoded.engine.bytesWritten!==Buffer.concat(compressed).length)reject();}catch{reject();}
  if(raw.length!==expected)reject();for(let offset=0;offset<raw.length;offset+=row)if(raw[offset]>4)reject();
  return {width:head.width,height:head.height};
}
function jpeg(bytes){
  if(bytes.length<12||bytes[0]!==255||bytes[1]!==216)reject();let pos=2,size=null,scan=false;
  while(pos<bytes.length){
    if(bytes[pos++]!==255)reject();while(bytes[pos]===255)pos++;if(pos>=bytes.length)reject();const marker=bytes[pos++];
    if(marker===217){if(!size||!scan||pos!==bytes.length)reject();return size;}
    if(marker===0||marker===216||(marker>=208&&marker<=215)||marker===1)reject();
    if(pos+2>bytes.length)reject();const length=bytes.readUInt16BE(pos),end=pos+length;if(length<2||end>bytes.length)reject();
    if([192,193,194].includes(marker)){if(size||length<11||bytes[pos+2]!==8)reject();const components=bytes[pos+7];if(![1,3].includes(components)||length!==8+3*components)reject();size=dimensions(bytes.readUInt16BE(pos+5),bytes.readUInt16BE(pos+3));}
    else if(marker>=192&&marker<=207&&![196,200,204].includes(marker))reject();
    if(marker===218){if(!size||length<8||length!==6+2*bytes[pos+2])reject();scan=true;pos=end;let entropy=0;
      while(pos<bytes.length){if(bytes[pos]!==255){entropy++;pos++;continue;}if(pos+1>=bytes.length)reject();const next=bytes[pos+1];if(next===0){entropy++;pos+=2;continue;}if(next>=208&&next<=215){pos+=2;continue;}if(next===255){pos++;continue;}break;}
      if(!entropy)reject();
    }else pos=end;
  }
  reject();
}
function checkImage(contentType,bytes){if(!Buffer.isBuffer(bytes)||!bytes.length)reject();if(bytes.length>MAX)P.fail('screenshot_too_large',413);if(contentType==='image/png')return png(bytes);if(contentType==='image/jpeg')return jpeg(bytes);reject();}
function secureDirectory(root){
  const resolved=path.resolve(root);let part=path.parse(resolved).root;
  for(const segment of resolved.slice(part.length).split(path.sep).filter(Boolean)){part=path.join(part,segment);if(fs.existsSync(part)){const stat=fs.lstatSync(part);if(stat.isSymbolicLink()||!stat.isDirectory())P.fail('unsafe_artifact_directory');}}
  fs.mkdirSync(resolved,{recursive:true,mode:0o700});if(process.platform!=='win32')fs.chmodSync(resolved,0o700);return resolved;
}
function createPilotArtifacts({store,root,now=Date.now}){
  const directory=secureDirectory(root);
  function file(meta){let root=directory;if(store.multiUser){P.id(meta.workspaceId);root=secureDirectory(path.join(directory,'workspaces',meta.workspaceId));}return path.join(root,meta.artifactId+(meta.contentType==='image/png'?'.png':'.jpg'));}
  function guard(){if(secureDirectory(directory)!==directory)P.fail('unsafe_artifact_directory');}
  function safeRead(meta){guard();const target=file(meta);let fd;
    try{const stat=fs.lstatSync(target);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==meta.sizeBytes||stat.size>MAX)P.fail('artifact_unavailable',409);fd=fs.openSync(target,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));const opened=fs.fstatSync(fd);if(opened.dev!==stat.dev||opened.ino!==stat.ino||opened.size!==stat.size)P.fail('artifact_unavailable',409);const bytes=fs.readFileSync(fd);if(createHash('sha256').update(bytes).digest('hex')!==meta.sha256)P.fail('artifact_integrity_failed',409);checkImage(meta.contentType,bytes);return bytes;}catch(error){if(error instanceof P.GatewayError)throw error;P.fail('artifact_unavailable',409);}finally{if(fd!==undefined)fs.closeSync(fd);}
  }
  function get(nodeId,taskId,artifactId){const meta=store.authorizePilotArtifact(nodeId,taskId,artifactId);return {...meta,bytes:safeRead(meta)};}
  function put(nodeId,lease,payload){
    store.assertPilotLease(nodeId,lease);P.fields(payload,['eventId','contentType','bytes']);P.id(payload.eventId);guard();const size=checkImage(payload.contentType,payload.bytes),digest=createHash('sha256').update(payload.bytes).digest('hex');
    const prior=store.findPilotArtifact(nodeId,payload.eventId);
    if(prior){if(prior.taskId!==lease.taskId||prior.sha256!==digest||prior.contentType!==payload.contentType)P.fail('artifact_event_conflict',409);safeRead(prior);return prior;}
    const records=store.listPilotArtifacts();if(records.some(a=>a.taskId===lease.taskId))P.fail('artifact_already_exists',409);
    if(records.reduce((total,a)=>total+a.sizeBytes,0)+payload.bytes.length>20*1024*1024)P.fail('artifact_capacity',429);
    const meta={...(store.multiUser?{workspaceId:store.currentBinding().workspaceId}:{}),artifactId:randomUUID(),eventId:payload.eventId,sha256:digest,sizeBytes:payload.bytes.length,...size,contentType:payload.contentType},target=file(meta),temporary=path.join(path.dirname(target),meta.artifactId+'.tmp');let committed=false;
    try{fs.writeFileSync(temporary,payload.bytes,{flag:'wx',mode:0o600});store.assertPilotLease(nodeId,lease);fs.renameSync(temporary,target);const saved=store.savePilotArtifact(nodeId,lease,meta);committed=true;return saved;}
    finally{if(!committed){for(const owned of [temporary,target])if(fs.existsSync(owned))fs.unlinkSync(owned);}}
  }
  function removeExpired(){guard();let count=0;for(const meta of store.expiredPilotArtifacts()){const target=file(meta);try{if(fs.existsSync(target)){const stat=fs.lstatSync(target);if(stat.isSymbolicLink()||!stat.isFile())continue;fs.unlinkSync(target);}if(store.multiUser)store.withWorkspace({workspaceId:meta.workspaceId},()=>store.forgetPilotArtifact(meta.artifactId));else store.forgetPilotArtifact(meta.artifactId);count++;}catch{ /* Keep metadata and capacity reservation if deletion fails. */ }}return count;}
  // Only recover old, unregistered files with names owned by this dedicated store.
  if(!store.multiUser){guard();const registered=new Set(store.listPilotArtifacts().map(a=>path.basename(file(a))));
  for(const name of fs.readdirSync(directory)){if(!filePattern.test(name)||registered.has(name))continue;const target=path.join(directory,name),stat=fs.lstatSync(target);if(stat.isFile()&&!stat.isSymbolicLink()&&stat.mtimeMs<now()-RETENTION)fs.unlinkSync(target);}
  }
  store.registerPilotArtifactReader((nodeId,taskId,id)=>get(nodeId,taskId,id));
  return {put,get,removeExpired};
}
module.exports={createPilotArtifacts,checkImage};
