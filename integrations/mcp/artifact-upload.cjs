'use strict';
const {randomUUID}=require('node:crypto');
const P=require('../../gateway/protocol.cjs');
function createArtifactUpload({store,artifacts,now=Date.now}){
  const uploads=new Map();
  function discardExpired(){let removed=0;for(const [id,row] of uploads){try{if(row.expiresAt<=now())throw new Error();store.assertPilotLease(row.nodeId,row.lease);}catch{uploads.delete(id);removed++;}}return removed;}
  function row(nodeId,id){P.id(id);discardExpired();const value=uploads.get(id);if(!value)P.fail('upload_unavailable',409);if(value.nodeId!==nodeId)P.fail('upload_owner_denied',403);store.assertPilotLease(nodeId,value.lease);return value;}
  function begin(nodeId,spec){
    P.fields(spec,['taskId','leaseId','attempt','eventId','contentType']);P.id(spec.eventId);if(!['image/png','image/jpeg'].includes(spec.contentType))P.fail('invalid_screenshot');
    const lease={taskId:spec.taskId,leaseId:spec.leaseId,attempt:spec.attempt},task=store.assertPilotLease(nodeId,lease);discardExpired();
    for(const value of uploads.values())if(value.lease.taskId===spec.taskId){if(value.nodeId===nodeId&&value.eventId===spec.eventId&&value.contentType===spec.contentType)return {uploadId:value.id,expiresAt:value.expiresAt};P.fail('upload_already_exists',409);}
    if(uploads.size>=5)P.fail('upload_capacity',429);const id=randomUUID(),expiresAt=Math.min(now()+90000,task.lease_until,task.deadline_at);uploads.set(id,{id,nodeId,lease,eventId:spec.eventId,contentType:spec.contentType,expiresAt,chunks:[],totalBytes:0,finished:null});return {uploadId:id,expiresAt};
  }
  function chunk(nodeId,spec){
    P.fields(spec,['uploadId','index','data']);const value=row(nodeId,spec.uploadId);if(value.finished)P.fail('upload_finished',409);
    if(!Number.isInteger(spec.index)||spec.index<0||spec.index>32767||typeof spec.data!=='string'||!spec.data.length||spec.data.length>87384||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(spec.data))P.fail('invalid_upload_chunk');
    const bytes=Buffer.from(spec.data,'base64');if(!bytes.length||bytes.length>65536||bytes.toString('base64')!==spec.data)P.fail('invalid_upload_chunk');
    if(spec.index<value.chunks.length){if(!value.chunks[spec.index].equals(bytes))P.fail('upload_chunk_conflict',409);return {nextIndex:value.chunks.length,totalBytes:value.totalBytes};}
    if(spec.index!==value.chunks.length)P.fail('upload_chunk_order',409);if(value.totalBytes+bytes.length>2097152)P.fail('upload_too_large',413);
    if([...uploads.values()].reduce((n,r)=>n+r.totalBytes,0)+bytes.length>10485760)P.fail('upload_capacity',429);
    value.chunks.push(bytes);value.totalBytes+=bytes.length;return {nextIndex:value.chunks.length,totalBytes:value.totalBytes};
  }
  function finish(nodeId,spec){P.fields(spec,['uploadId']);const value=row(nodeId,spec.uploadId);if(value.finished)return value.finished;const meta=artifacts.put(nodeId,value.lease,{eventId:value.eventId,contentType:value.contentType,bytes:Buffer.concat(value.chunks,value.totalBytes)});value.finished=meta;value.chunks=[];value.totalBytes=0;return meta;}
  return {begin,chunk,finish,discardExpired};
}
module.exports={createArtifactUpload};
