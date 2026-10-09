'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {deflateSync}=require('node:zlib');
const {randomUUID}=require('node:crypto');
const {createGatewayStore}=require('../../gateway/store.cjs');
const challenge='A'.repeat(43),input={url:'https://example.com/',challenge};
function crc(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function chunk(type,bytes){const name=Buffer.from(type),head=Buffer.alloc(4),tail=Buffer.alloc(4);head.writeUInt32BE(bytes.length);tail.writeUInt32BE(crc(Buffer.concat([name,bytes])));return Buffer.concat([head,name,bytes,tail]);}
function png({width=1,height=1,padding=0}={}){const head=Buffer.alloc(13);head.writeUInt32BE(width,0);head.writeUInt32BE(height,4);head[8]=8;return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',head),...(padding?[chunk('tEXt',Buffer.alloc(padding,65))]:[]),chunk('IDAT',deflateSync(Buffer.from([0,120]))),chunk('IEND',Buffer.alloc(0))]);}
function setup(t){let clock=Date.parse('2026-10-09T00:00:00.000Z');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chunlack-pilot-test-'));const dbPath=path.join(dir,'pilot.db');let store=createGatewayStore({dbPath,now:()=>clock});t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 const n=store.createNode({name:'pilot',capabilities:['browser.public_read'],scopes:['public']});const paired=store.pair(n.pairingCode);
 const fixture={dir,root:path.join(dir,'artifacts'),nodeId:n.id,token:paired.token,now:()=>clock,advance:ms=>{clock+=ms;},get store(){return store;},reopen(){store.close();store=createGatewayStore({dbPath,now:()=>clock});},task(overrides={}){const q=store.enqueueTask({targetNodeId:n.id,scopeId:'public',taskType:'browser.public_read',input:{...input},deadlineAt:clock+300000,...overrides});return store.claimTask(n.id)||store.getTask(q.taskId);}};return fixture;
}
function output(artifactId){return {...input,title:'Example Domain',executedAt:'2026-10-09T00:00:00.000Z',artifactId,activityEvidence:'synthetic_fixture: no cloud browser executed'};}
function result(task,out,status='succeeded'){return {protocolVersion:1,taskId:task.taskId,leaseId:task.leaseId,attempt:task.attempt,eventId:randomUUID(),status,output:out};}
module.exports={challenge,input,png,setup,output,result};
