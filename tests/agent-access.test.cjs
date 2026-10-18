'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createAgentAccessVerifier} = require('../identity/agent-access.cjs');
const issuer = 'https://pocket.example.test';
const resource = 'https://agents.example.test/mcp';
const subject = '0260c437-d400-41d4-8027-da545ff150f5';
const config = {enabled:true, issuer, resource, jwksUri:issuer+'/.well-known/jwks.json',
  clientIds:['native-test-client'], browserClientId:'human-login-client'};
let jose, key, wrongKey, jwk;
test.before(async () => {
  jose = await import('jose');
  key = await jose.generateKeyPair('RS256'); wrongKey = await jose.generateKeyPair('RS256');
  jwk = {...await jose.exportJWK(key.publicKey),kid:'test-rsa',alg:'RS256',use:'sig'};
});
async function fixture(t, options={}) {
  let time=Date.now(), fetches=0;
  const fetchImpl=async (url, init) => {
    fetches++;
    assert.equal(String(url), config.jwksUri); assert.equal(init.redirect,'error');
    assert.equal(new Headers(init.headers).has('authorization'),false);
    assert.equal(new Headers(init.headers).has('cookie'),false);
    return options.response ? options.response(init) : Response.json({keys:[jwk]});
  };
  const service=await createAgentAccessVerifier({config,fetchImpl,now:()=>time});
  t.after(()=>service.close());
  async function token(claims={}, header={}, signing=key.privateKey) {
    const seconds=Math.floor(time/1000);
    return new jose.SignJWT({iss:issuer,sub:subject,aud:resource,iat:seconds,exp:seconds+300,
      jti:'synthetic-token-id',client_id:'native-test-client',scope:'openid task.read task.result',...claims})
      .setProtectedHeader({alg:'RS256',typ:'at+jwt',kid:'test-rsa',...header}).sign(signing);
  }
  return {service,token,advance:ms=>{time+=ms;},fetches:()=>fetches};
}

test('Agent access is disabled without configuration or network side effects',async()=>{
  let calls=0;
  assert.equal(await createAgentAccessVerifier({fetchImpl:()=>{calls++;}}),null);
  assert.equal(calls,0);
});
test('verified access produces only one-use identity evidence, not a node principal',async t=>{
  const f=await fixture(t), proof=await f.service.verify(await f.token(),{scope:'task.read'});
  assert.deepEqual(Object.keys(proof),[]);
  const facts=f.service.consume(proof);
  assert.equal(facts.issuer,issuer); assert.equal(facts.subject,subject);
  assert.equal(facts.clientId,'native-test-client'); assert.equal(facts.resource,resource);
  assert.deepEqual(facts.scopes,['task.read','task.result']);
  assert.equal(Object.hasOwn(facts,'nodeId'),false); assert.equal(Object.hasOwn(facts,'workspaceId'),false);
  assert.ok(Object.isFrozen(facts)); assert.ok(Object.isFrozen(facts.scopes));
  assert.throws(()=>f.service.consume(proof),{code:'invalid_token'});
  assert.throws(()=>f.service.consume({...facts}),{code:'invalid_token'});
  assert.equal(f.fetches(),1);
});

for (const [name, claims, header] of [
  ['wrong issuer',{iss:'https://untrusted.example.test'}],
  ['wrong audience',{aud:'human-login-client'}],
  ['unapproved client',{client_id:'other-client'}],
  ['browser client',{client_id:'human-login-client'}],
  ['machine subject',{sub:'client-native-test-client'}],
  ['missing identity scope',{scope:'task.read'}],
  ['ID token',{}, {typ:'JWT'}],
  ['expired',{exp:1}],['missing expiry',{exp:undefined}],
  ['missing subject',{sub:undefined}],['missing token id',{jti:undefined}],
  ['future issued',{iat:Math.floor(Date.now()/1000)+7200}],
  ['future not-before',{nbf:Math.floor(Date.now()/1000)+7200}],
  ['excess lifetime',{exp:Math.floor(Date.now()/1000)+7200}],
  ['fractional expiry',{exp:Math.floor(Date.now()/1000)+300.5}],
  ['duplicate scopes',{scope:'openid task.read task.read'}],
  ['scope array',{scope:['openid','task.read']}],
  ['remote key header',{}, {jku:'https://untrusted.example.test/jwks'}]
]) test('Agent verifier rejects '+name,async t=>{
  const f=await fixture(t);
  await assert.rejects(f.service.verify(await f.token(claims,header),{scope:'task.read'}),{code:'invalid_token'});
});

test('signature verification cannot be replaced by decoding trusted-looking claims',async t=>{
  const f=await fixture(t);
  await assert.rejects(f.service.verify(await f.token({}, {}, wrongKey.privateKey),{scope:'task.read'}),{code:'invalid_token'});
});
test('requested operation requires its exact granted scope',async t=>{
  const f=await fixture(t);
  await assert.rejects(f.service.verify(await f.token(),{scope:'task.claim'}),{code:'insufficient_scope'});
  await assert.rejects(f.service.verify(await f.token(),{scope:'workspace.manage'}),{code:'invalid_scope'});
});
test('oversized, noncompact and unsigned inputs never fetch keys',async t=>{
  const f=await fixture(t);
  for(const raw of ['x'.repeat(8193),'not-a-jwt','eyJhbGciOiJub25lIn0.e30.'])
    await assert.rejects(f.service.verify(raw,{scope:'task.read'}),{code:'invalid_token'});
  assert.equal(f.fetches(),0);
});
test('proof expiry and shutdown invalidate previously verified evidence',async t=>{
  const f=await fixture(t), proof=await f.service.verify(await f.token(),{scope:'task.read'});
  f.advance(301000); assert.throws(()=>f.service.consume(proof),{code:'invalid_token'});
  const fresh=await f.service.verify(await f.token(),{scope:'task.read'});
  await f.service.close(); assert.throws(()=>f.service.consume(fresh),{code:'service_closed'});
  await assert.rejects(f.service.verify(await f.token(),{scope:'task.read'}),{code:'service_closed'});
});
test('JWKS cache avoids fetching on every authorized request',async t=>{
  const f=await fixture(t), token=await f.token();
  for(let i=0;i<3;i++) f.service.consume(await f.service.verify(token,{scope:'task.read'}));
  assert.equal(f.fetches(),1);
});
for(const [name,response] of [
  ['redirect',()=>new Response(null,{status:302,headers:{location:'https://untrusted.example.test/'}})],
  ['oversized body',()=>new Response(' '.repeat(65537))],
  ['too many keys',()=>Response.json({keys:Array.from({length:9},(_,i)=>({...jwk,kid:'key-'+i}))})],
  ['private key',()=>Response.json({keys:[{...jwk,d:'secret-private-component'}]})],
  ['duplicate key ids',()=>Response.json({keys:[jwk,{...jwk}]})]
]) test('JWKS rejects '+name+' without returning sensitive errors',async t=>{
  const f=await fixture(t,{response});
  await assert.rejects(f.service.verify(await f.token(),{scope:'task.read'}),error=>{
    assert.equal(error.code,'invalid_token'); assert.equal(error.message,'invalid_token'); return true;
  });
});
test('configuration disallows cross-origin keys, non-HTTPS and browser-client reuse',async()=>{
  for(const change of [{jwksUri:'https://untrusted.example.test/jwks'},{issuer:'http://pocket.example.test'},
    {resource:resource+'?access_token=private'},{clientIds:['human-login-client']},{clientIds:null},
    {clientIds:Array(33).fill('different')},{browserClientId:undefined}])
    await assert.rejects(createAgentAccessVerifier({config:{...config,...change}}),{code:'invalid_agent_access_config'});
});
test('bounded verification admits four requests, shares key fetch and rejects the fifth',async t=>{
  let release, entered;
  const started=new Promise(r=>{entered=r;});
  const f=await fixture(t,{response:()=>new Promise(r=>{release=()=>r(Response.json({keys:[jwk]}));entered();})});
  const raw=await f.token(); const running=Array.from({length:4},()=>f.service.verify(raw,{scope:'task.read'}));
  await started;
  await assert.rejects(f.service.verify(raw,{scope:'task.read'}),{code:'rate_limited'});
  release(); const proofs=await Promise.all(running); assert.equal(proofs.length,4); assert.equal(f.fetches(),1);
});
test('shutdown aborts key retrieval and returns no usable evidence',async t=>{
  let entered;const started=new Promise(r=>{entered=r;});
  const f=await fixture(t,{response:init=>new Promise((resolve,reject)=>{
    init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true});entered();
  })});
  const result=assert.rejects(f.service.verify(await f.token(),{scope:'task.read'}));
  await started; await f.service.close(); await result;
});
