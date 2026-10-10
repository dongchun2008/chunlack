'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),https=require('node:https');
const {tls,track,listen,proxy}=require('./helpers/pilot-network.cjs');
const {createMuseProxyTransport}=require('../sdk/transports/muse-proxy.cjs');
async function target(t,handler){const server=https.createServer(tls,handler);t.after(track(server));return `https://127.0.0.1:${await listen(server)}`;}
test('Muse transport uses CONNECT and keeps node Authorization inside TLS',async t=>{let token;const origin=await target(t,(req,res)=>{token=req.headers.authorization;res.end('{"ok":true}');});const p=await proxy(t),fetch=createMuseProxyTransport({proxyUrl:p.url,targetOrigin:origin,ca:tls.cert});const response=await fetch(origin+'/v1/manifest',{headers:{Authorization:'Bearer synthetic-node'}});assert.deepEqual(await response.json(),{ok:true});assert.equal(token,'Bearer synthetic-node');assert.equal(p.connects,1);assert.equal(p.leaked,false);});
test('Muse proxy denial never falls back to direct traffic',async t=>{let hits=0;const origin=await target(t,(req,res)=>{hits++;res.end();}),p=await proxy(t,{deny:true}),fetch=createMuseProxyTransport({proxyUrl:p.url,targetOrigin:origin,ca:tls.cert});await assert.rejects(fetch(origin+'/health'),/proxy_connection_failed/);assert.equal(hits,0);});
test('Muse TLS errors, target changes and redirects are rejected',async t=>{const origin=await target(t,(req,res)=>{res.writeHead(302,{Location:'https://example.com/'});res.end();}),p=await proxy(t);const untrusted=createMuseProxyTransport({proxyUrl:p.url,targetOrigin:origin});await assert.rejects(untrusted(origin+'/health'),/proxy_transport_failed/);const fetch=createMuseProxyTransport({proxyUrl:p.url,targetOrigin:origin,ca:tls.cert});await assert.rejects(fetch('https://example.com/'),/target_origin_denied/);await assert.rejects(fetch(origin+'/health'),/redirect_denied/);});
test('Muse abort and timeout terminate stalled CONNECT',async t=>{const p=await proxy(t,{stall:true}),origin='https://127.0.0.1:9',fetch=createMuseProxyTransport({proxyUrl:p.url,targetOrigin:origin,timeoutMs:150});await assert.rejects(fetch(origin+'/health'),/transport_timeout/);const controller=new AbortController(),pending=fetch(origin+'/health',{signal:controller.signal});controller.abort();await assert.rejects(pending,/transport_aborted/);});
test('Muse proxy pins workspace headers inside TLS and refuses a changed selector before connecting',async t=>{
  let hits=0,workspace;const origin=await target(t,(req,res)=>{hits++;workspace=req.headers['x-workspace-id'];res.end('{"ok":true}');}),p=await proxy(t);
  assert.throws(()=>createMuseProxyTransport({proxyUrl:p.url,targetOrigin:origin,workspaceId:'../other'}));
  const fetch=createMuseProxyTransport({proxyUrl:p.url,targetOrigin:origin,ca:tls.cert,workspaceId:'workspace-a'});
  await assert.rejects(fetch(origin+'/v1/manifest',{headers:{'x-workspace-id':'workspace-b'}}),/workspace_binding_mismatch/);
  assert.equal(hits,0);assert.equal(p.connects,0);
  await fetch(origin+'/v1/manifest');assert.equal(workspace,'workspace-a');assert.equal(hits,1);
});
