'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),https=require('node:https');
const {isPublicAddress,createWebhookTransport,sendPinnedHttps}=require('../integrations/mcp/webhook-transport.cjs');
const {tls,track,listen}=require('./helpers/pilot-network.cjs');
const {setTimeout: delay}=require('node:timers/promises');

test('webhook aborts pending DNS and never sends after late resolution', async()=>{
  let release, posts=0; const cancellation=new AbortController();
  const transport=createWebhookTransport({allowedHosts:['callback.example'],lookup:()=>new Promise(resolve=>{release=resolve;}),post:async()=>{posts++;return new Response('{}');}});
  const pending=transport('https://callback.example/',{body:'{}',signal:cancellation.signal}).then(()=> 'sent', e=>e.reason);
  cancellation.abort();
  const observed=await Promise.race([pending,delay(100,'not_cancelled')]);
  release([{address:'8.8.8.8',family:4}]); await pending; await delay(5);
  assert.equal(observed,'callback_aborted'); assert.equal(posts,0);
});
test('webhook applies its deadline to DNS, not only the HTTPS socket', async()=>{
  let release, posts=0;
  const transport=createWebhookTransport({allowedHosts:['callback.example'],timeoutMs:50,lookup:()=>new Promise(resolve=>{release=resolve;}),post:async()=>{posts++;return new Response('{}');}});
  const pending=transport('https://callback.example/',{body:'{}'}).then(()=> 'sent', e=>e.reason);
  const observed=await Promise.race([pending,delay(150,'not_timed_out')]);
  release([{address:'8.8.8.8',family:4}]); await pending;
  assert.equal(observed,'callback_timeout'); assert.equal(posts,0);
});
test('webhook rechecks trusted authorization after DNS before sending', async()=>{
  let allowed=true, posts=0;
  const transport=createWebhookTransport({allowedHosts:['callback.example'],authorize:()=>allowed,
    lookup:async()=>{allowed=false;return [{address:'8.8.8.8',family:4}];},post:async()=>{posts++;return new Response('{}');}});
  await assert.rejects(transport('https://callback.example/',{body:'{}'}),/callback_access_denied/); assert.equal(posts,0);
});
test('webhook address policy blocks local, private, reserved and mapped addresses',()=>{for(const address of ['127.0.0.1','10.0.0.1','100.64.1.1','169.254.1.1','172.16.0.1','192.168.0.1','192.0.2.1','198.18.0.1','198.51.100.1','203.0.113.1','224.0.0.1','0.0.0.0','::1','::ffff:8.8.8.8','fc00::1','fe80::1','2001:db8::1','2002::1'])assert.equal(isPublicAddress(address),false,address);assert.equal(isPublicAddress('8.8.8.8'),true);assert.equal(isPublicAddress('2606:4700:4700::1111'),true);});
test('webhook validates every resolution and pins one checked address',async()=>{let resolves=0,posts=0;const transport=createWebhookTransport({allowedHosts:['callback.example'],lookup:async()=>++resolves===1?[{address:'8.8.8.8',family:4}]:[{address:'127.0.0.1',family:4}],post:async(url,options,address)=>{posts++;assert.equal(address.address,'8.8.8.8');return new Response('{}');}});await transport('https://callback.example/path',{method:'POST',body:'{}'});await assert.rejects(transport('https://callback.example/path',{method:'POST',body:'{}'}),/callback_address_denied/);assert.equal(posts,1);for(const bad of ['http://callback.example/path','https://other.example/path','https://callback.example:8443/path','https://user:pass@callback.example/path'])await assert.rejects(transport(bad,{body:'{}'}));});
test('webhook rejects mixed DNS public/private answers before sending',async()=>{let sent=false;const transport=createWebhookTransport({allowedHosts:['callback.example'],lookup:async()=>[{address:'8.8.8.8',family:4},{address:'10.0.0.1',family:4}],post:async()=>{sent=true;return new Response('{}');}});await assert.rejects(transport('https://callback.example/',{body:'{}'}));assert.equal(sent,false);});
test('pinned HTTPS keeps certificate validation and rejects redirects and oversized replies',async t=>{const server=https.createServer(tls,(req,res)=>{if(req.url==='/redirect'){res.writeHead(302,{Location:'https://example.com'});res.end();}else if(req.url==='/large')res.end(Buffer.alloc(262145));else res.end('{"ok":true}');});t.after(track(server));const origin=`https://localhost:${await listen(server)}`,address={address:'127.0.0.1',family:4};const r=await sendPinnedHttps(origin+'/',{body:'{}'},address,{ca:tls.cert});assert.deepEqual(await r.json(),{ok:true});await assert.rejects(sendPinnedHttps(origin+'/',{body:'{}'},address),/webhook_network_failed/);await assert.rejects(sendPinnedHttps(origin+'/redirect',{body:'{}'},address,{ca:tls.cert}),/callback_redirect_denied/);await assert.rejects(sendPinnedHttps(origin+'/large',{body:'{}'},address,{ca:tls.cert}),/callback_response_too_large/);});
