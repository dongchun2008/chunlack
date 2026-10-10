'use strict';
const https=require('node:https'),net=require('node:net'),dns=require('node:dns/promises');
function fail(reason){const error=new Error(reason);error.reason=reason;return error;}
function isPublicAddress(address){
  if(typeof address!=='string'||address.includes('%'))return false;const family=net.isIP(address);
  if(family===4){const [a,b,c]=address.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||a===100&&b>=64&&b<=127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0&&(c===0||c===2)||b===88&&c===99)||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);}
  if(family!==6||address.includes('.'))return false;
  const pieces=address.toLowerCase().split('::');if(pieces.length>2)return false;const left=pieces[0]?pieces[0].split(':'):[],right=pieces[1]?pieces[1].split(':'):[];const parts=pieces.length===2?[...left,...Array(8-left.length-right.length).fill('0'),...right]:left;if(parts.length!==8)return false;const first=parseInt(parts[0],16),second=parseInt(parts[1],16);
  return first>=0x2000&&first<=0x3fff&&first!==0x2002&&first!==0x3fff&&!(first===0x2001&&(second<0x200||second===0xdb8));
}
function sendPinnedHttps(value,options,address,{ca,timeoutMs=10000}={}){
  const url=new URL(value);
  if(url.protocol!=='https:'||!net.isIP(address.address)||address.family!==net.isIP(address.address)||process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0')return Promise.reject(fail('unsafe_webhook_configuration'));
  if(typeof options.body!=='string'||Buffer.byteLength(options.body)>262144)return Promise.reject(fail('callback_body_too_large'));
  return new Promise((resolve,reject)=>{
    let settled=false,request;const finish=(error,response)=>{if(settled)return;settled=true;clearTimeout(timer);options.signal?.removeEventListener('abort',abort);request?.destroy();if(error)reject(error);else resolve(response);};
    const abort=()=>finish(fail('callback_aborted')),timer=setTimeout(()=>finish(fail('callback_timeout')),timeoutMs);if(options.signal?.aborted){abort();return;}options.signal?.addEventListener('abort',abort,{once:true});
    const headers={...options.headers,Host:url.host,'Content-Length':String(Buffer.byteLength(options.body))};
    request=https.request(url,{method:'POST',headers,agent:false,ca,rejectUnauthorized:true,autoSelectFamily:false,lookup:(_,opts,callback)=>opts?.all?callback(null,[address]):callback(null,address.address,address.family)},response=>{
      if(response.statusCode>=300&&response.statusCode<400){finish(fail('callback_redirect_denied'));return;}
      let length=0;const chunks=[];response.on('data',chunk=>{length+=chunk.length;if(length>262144)finish(fail('callback_response_too_large'));else chunks.push(chunk);});response.on('error',()=>finish(fail('webhook_network_failed')));response.on('end',()=>{if(settled)return;finish(null,new Response([204,205,304].includes(response.statusCode)?null:Buffer.concat(chunks),{status:response.statusCode}));});
    });request.on('error',()=>finish(fail('webhook_network_failed')));request.end(options.body);
  });
}
function createWebhookTransport({allowedHosts,workspaceCallbackHosts={},multiUser=false,lookup=dns.lookup,ca,timeoutMs=10000,post=sendPinnedHttps,authorize}){
  if(!Array.isArray(allowedHosts)||!allowedHosts.length||allowedHosts.length>10||allowedHosts.some(h=>typeof h!=='string'||h!==h.toLowerCase()||net.isIP(h)||!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(h))||!Number.isInteger(timeoutMs)||timeoutMs<50||timeoutMs>10000)throw fail('invalid_webhook_configuration');const allowed=new Set(allowedHosts);
  const grants=new Map();
  if(authorize!==undefined&&typeof authorize!=='function')throw fail('invalid_webhook_configuration');
  if(multiUser){
    if(!workspaceCallbackHosts||typeof workspaceCallbackHosts!=='object'||Array.isArray(workspaceCallbackHosts)||Object.keys(workspaceCallbackHosts).length>100)throw fail('invalid_workspace_callback_grants');
    for(const [id,hosts] of Object.entries(workspaceCallbackHosts)){
      if(!/^[A-Za-z0-9_-]{1,100}$/.test(id)||!Array.isArray(hosts)||!hosts.length||hosts.length>10||hosts.some(host=>!allowed.has(host)))throw fail('invalid_workspace_callback_grants');
      grants.set(id,new Set(hosts));
    }
  }
  return async function transport(value,options={},binding){
    let url;try{url=new URL(value);}catch{throw fail('callback_url_denied');}
    if(url.protocol!=='https:'||url.username||url.password||url.hash||url.port&&url.port!=='443'||!allowed.has(url.hostname))throw fail('callback_url_denied');
    if(multiUser&&(!binding||!['workspaceId','nodeId','taskId'].every(field=>typeof binding[field]==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(binding[field]))||!grants.get(binding.workspaceId)?.has(url.hostname)))throw fail('callback_workspace_denied');
    if(authorize&&authorize(binding)!==true)throw fail('callback_access_denied');
    if(options.signal?.aborted)throw fail('callback_aborted');
    const deadline=new AbortController(),signal=options.signal?AbortSignal.any([options.signal,deadline.signal]):deadline.signal;
    let timedOut=false,abort;
    const timer=setTimeout(()=>{timedOut=true;deadline.abort();},timeoutMs);
    const stopped=new Promise((_,reject)=>{abort=()=>reject(fail(timedOut?'callback_timeout':'callback_aborted'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
    try{
      const addresses=await Promise.race([Promise.resolve(lookup(url.hostname,{all:true,verbatim:true})),stopped]);
      if(signal.aborted)throw fail(timedOut?'callback_timeout':'callback_aborted');
      if(!Array.isArray(addresses)||!addresses.length||addresses.length>32||addresses.some(a=>!isPublicAddress(a.address)||a.family!==net.isIP(a.address)))throw fail('callback_address_denied');
      if(authorize&&authorize(binding)!==true)throw fail('callback_access_denied');
      return await Promise.race([Promise.resolve(post(url.href,{...options,signal,method:'POST',redirect:'error'},addresses[0],{ca,timeoutMs})),stopped]);
    }finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
  };
}
module.exports={isPublicAddress,createWebhookTransport,sendPinnedHttps};
