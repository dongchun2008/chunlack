'use strict';
const crypto = require('node:crypto');
const TYPES = Object.freeze(['research.retrieve','research.verify','research.summarize']);
const LIMITS = Object.freeze({nodes:5,activeTasks:1,tasks:1000,events:10000,eventsPerTask:100,bodyBytes:262144,leaseMs:90000,pairMs:300000,pollMs:30000});
class GatewayError extends Error {
  constructor(code,status=400){super(code);this.code=code;this.status=status;}
}
function fail(code,status=400){throw new GatewayError(code,status);}
function object(value){if(!value||typeof value!=='object'||Array.isArray(value))fail('invalid_object');return value;}
function fields(value,allowed){object(value);if(Object.keys(value).some(key=>!allowed.includes(key)))fail('unsupported_field');return value;}
function id(value){if(typeof value!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(value))fail('invalid_id');return value;}
function text(value,max=2000){if(typeof value!=='string'||!value.trim()||value.length>max)fail('invalid_text');return value;}
function canonical(value,depth=0){
  if(depth>12)fail('payload_too_deep');
  if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
  if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(v=>canonical(v,depth+1)).join(',')+']';
  object(value);
  const keys=Object.keys(value).sort();
  if(keys.some(k=>['__proto__','prototype','constructor','authorization','password','apikey','token','clientsecret'].includes(k.toLowerCase())))fail('sensitive_or_unsafe_field');
  return '{'+keys.map(k=>JSON.stringify(k)+':'+canonical(value[k],depth+1)).join(',')+'}';
}
function bounded(value){const data=canonical(value);if(Buffer.byteLength(data)>LIMITS.bodyBytes)fail('payload_too_large',413);return data;}
function hash(value){return crypto.createHash('sha256').update(value).digest('hex');}
function secret(bytes=32){return crypto.randomBytes(bytes).toString('base64url');}
function envelope(value){
  fields(value,['protocolVersion','taskId','leaseId','attempt','eventId','status','output','sources','claims','missingEvidence','usage','type','message']);
  if(value.protocolVersion!==1)fail('unsupported_version');id(value.taskId);id(value.leaseId);id(value.eventId);
  if(!Number.isInteger(value.attempt)||value.attempt<1||value.attempt>3)fail('invalid_attempt');bounded(value);
  if(value.sources!==undefined&&(!Array.isArray(value.sources)||value.sources.length>5))fail('too_many_sources');
  if(value.claims!==undefined&&(!Array.isArray(value.claims)||value.claims.length>25))fail('too_many_claims');
  return value;
}
module.exports={TYPES,LIMITS,GatewayError,fail,object,fields,id,text,canonical,bounded,hash,secret,envelope};
