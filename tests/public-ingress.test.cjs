'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const https = require('node:https');
const http2 = require('node:http2');
const {once} = require('node:events');
const {spawn, execFileSync} = require('node:child_process');
const {setTimeout: delay} = require('node:timers/promises');
const {WebSocket, WebSocketServer} = require('ws');
const {renderPublicIngress} = require('../deploy/public/render-ingress.cjs');
const {publicAgentFixture} = require('./helpers/public-agent-fixture.cjs');
const WEB = 'lack.fixture.invalid', AGENTS = 'agents.fixture.invalid';
const lowCpuIsolation = process.env.CHUNLACK_TEST_LOW_CPU === '1';
const windowsStartup = process.platform === 'win32';
const certificateTimeoutMs = lowCpuIsolation ? 20000 : 5000;
const caddyCommandTimeoutMs = windowsStartup ? 20000 : 5000;
const tlsTestTimeoutMs = windowsStartup ? 90000 : lowCpuIsolation ? 40000 : 20000;
const config = {httpPort: 23721, agentGateway: {port: 23722}, publicRuntime: {webOrigin: 'https://' + WEB, agentsOrigin: 'https://' + AGENTS, mcpPort: 23723}};

test('owned fixture closes connections and awaits its child before removing its directory', async () => {
  const order=[];
  await finishFixture([
    async()=>{order.push('connections');},
    async()=>{await new Promise(resolve=>setImmediate(resolve));order.push('child-exited');}
  ],()=>{assert.deepEqual(order,['connections','child-exited']);order.push('directory');});
  assert.deepEqual(order,['connections','child-exited','directory']);
});
test('owned fixture still stops its child after connection cleanup fails and preserves its directory', async () => {
  const order=[];
  await assert.rejects(finishFixture([
    async()=>{order.push('connections');throw Error('synthetic_connection_failure');},
    async()=>{order.push('child-exited');}
  ],()=>order.push('directory')),error=>error.message==='owned_fixture_cleanup_incomplete'&&error.errors[0].message==='synthetic_connection_failure');
  assert.deepEqual(order,['connections','child-exited']);
});
test('owned fixture bounds an uncooperative cleanup and never deletes its directory', async () => {
  const order=[];
  await assert.rejects(finishFixture([
    ()=>new Promise(()=>{}),
    async()=>{order.push('child-stop-attempted');}
  ],()=>order.push('directory'),20),error=>error.message==='owned_fixture_cleanup_incomplete'&&error.errors[0].message==='owned_fixture_cleanup_timeout');
  assert.deepEqual(order,['child-stop-attempted']);
});

async function finishFixture(cleanups, removeDirectory, timeoutMs=7000) {
  const failures=[];
  for(const cleanup of cleanups){
    let timer;
    try{
      await Promise.race([Promise.resolve().then(cleanup),new Promise((_,reject)=>{
        timer=setTimeout(()=>reject(Error('owned_fixture_cleanup_timeout')),timeoutMs);
      })]);
    }catch(error){failures.push(error);}finally{clearTimeout(timer);}
  }
  if(failures.length)throw new AggregateError(failures,'owned_fixture_cleanup_incomplete');
  await removeDirectory();
}
function folder(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'lack-ingress-'));
  t.after(()=>{
    const target=fs.realpathSync(root),parent=fs.realpathSync(os.tmpdir());
    if(fs.lstatSync(root).isSymbolicLink()||path.dirname(target)!==parent||!path.basename(target).startsWith('lack-ingress-'))throw Error('unsafe_fixture_cleanup');
    fs.rmSync(target,{recursive:true,force:true});
  });
  return root;
}
test('production ingress renders two isolated HTTPS hosts without admin, port 80, HTTP challenge or HTTP/3', () => {
  const source=renderPublicIngress(config);
  assert.match(source,/admin off/); assert.match(source,/auto_https disable_redirects/);
  assert.match(source,/protocols h1 h2\s/); assert.match(source,/strict_sni_host on/);
  assert.equal((source.match(/disable_http_challenge/g)||[]).length,2);
  assert.doesNotMatch(source,/disable_tlsalpn_challenge|tls_insecure_skip_verify|protocols[^\n]*h3/);
  assert.match(source,/https:\/\/lack\.fixture\.invalid:443/); assert.match(source,/https:\/\/agents\.fixture\.invalid:443/);
  assert.doesNotMatch(source,/http:\/\/[^\s]|:80\b|:2019\b/);
});
test('ingress rendering rejects unsafe host, upstream and test certificate input before creating a config',()=>{
  for(const bad of ['http://lack.example','https://127.0.0.1','https://lack.example/path','https://user:password@lack.example','https://lack.example:8443','https://lack.example\n{ admin :2019 }'])
    assert.throws(()=>renderPublicIngress({...config,publicRuntime:{...config.publicRuntime,webOrigin:bad}}),/ingress_/);
  assert.throws(()=>renderPublicIngress({...config,publicRuntime:{...config.publicRuntime,agentsOrigin:config.publicRuntime.webOrigin}}),/ingress_/);
  for(const value of [0,80,65536,'23721']) assert.throws(()=>renderPublicIngress({...config,httpPort:value}),/ingress_/);
  assert.throws(()=>renderPublicIngress({...config,agentGateway:{port:config.httpPort}}),/ingress_/);
  assert.throws(()=>renderPublicIngress(config,{fixture:{listenPort:24000,certFile:'relative.pem',keyFile:'relative.key'}}),/ingress_/);
});

function client(port, host, cert, uri='/', options={}) {
  return new Promise((resolve,reject)=>{
    const req=https.request({hostname:'127.0.0.1',port,servername:options.servername||host,ca:cert,rejectUnauthorized:true,path:uri,signal:options.signal,
      method:options.method||'GET',headers:options.headers||{Host:host+':'+port}},res=>{
      const chunks=[];res.on('data',data=>chunks.push(data));res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(chunks).toString('utf8'),headers:res.headers}));
    });req.setTimeout(2000,()=>req.destroy(new Error('fixture_request_timeout')));req.on('error',reject);req.end(options.body);
  });
}
async function servers(t) {
  const owned=[],requests=[];
  for(const name of ['web','gateway','mcp']){
    const server=http.createServer((req,res)=>{
      const duplicate=req.rawHeaders.filter((_,i)=>i%2===0&&req.rawHeaders[i].toLowerCase()==='authorization').length;
      requests.push({name,url:req.url,headers:req.headers,duplicate});
      if(duplicate>1){res.writeHead(401);res.end('duplicate_authorization');return;}
      req.resume();req.on('end',()=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({name,url:req.url,headers:req.headers}));});
    });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));owned.push(server);
  }
  const wss=new WebSocketServer({server:owned[0]});wss.on('connection',ws=>ws.on('message',message=>ws.send(message)));
  t.after(async()=>{for(const ws of wss.clients)ws.terminate();await new Promise(resolve=>wss.close(resolve));for(const server of owned){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}});
  return {requests,ports:owned.map(server=>server.address().port)};
}
async function caddyFixture(t, {mcpPort, agentsHost=AGENTS}={}) {
  const cleanups=[],scope={after:cleanup=>cleanups.push(cleanup)};let removeDirectory;
  const root=folder({after:cleanup=>{removeDirectory=cleanup;}}),binary=process.env.CADDY_TEST_BIN;
  // One owning hook: connections first, then the child; remove files only on success.
  t.after(()=>finishFixture(cleanups,removeDirectory));
  const backend=await servers(scope);
  assert.ok(path.isAbsolute(binary),'CADDY_TEST_BIN must identify an already verified local executable');
  const probe=http.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const certFile=path.join(root,'fixture.crt'),keyFile=path.join(root,'fixture.key');
  const openssl=process.env.OPENSSL_TEST_BIN||(process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl');
  const certificateStarted = performance.now();
  try {
    execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-keyout',keyFile,'-out',certFile,'-days','1','-subj','/CN='+WEB,'-addext','subjectAltName=DNS:'+WEB+',DNS:'+agentsHost],{timeout:certificateTimeoutMs,stdio:'pipe',windowsHide:true});
  } finally {
    console.log('CERTIFICATE_FIXTURE_TIMING=' + JSON.stringify({elapsedMs: Math.ceil(performance.now() - certificateStarted), timeoutMs: certificateTimeoutMs, lowCpuIsolation}));
  }
  const c={...config,httpPort:backend.ports[0],agentGateway:{port:backend.ports[1]},publicRuntime:{...config.publicRuntime,agentsOrigin:'https://'+agentsHost,mcpPort:mcpPort??backend.ports[2]}};
  const file=path.join(root,'Caddyfile');fs.writeFileSync(file,renderPublicIngress(c,{fixture:{listenPort:port,certFile,keyFile}}),{mode:0o600});
  const env={...process.env,XDG_DATA_HOME:path.join(root,'data'),XDG_CONFIG_HOME:path.join(root,'config')};
  function caddyPhase(phase) {
    const started=performance.now();
    try {return execFileSync(binary,[phase,'--adapter','caddyfile','--config',file],{env,timeout:caddyCommandTimeoutMs,encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true});}
    finally {console.log('CADDY_FIXTURE_TIMING='+JSON.stringify({phase,elapsedMs:Math.ceil(performance.now()-started),timeoutMs:caddyCommandTimeoutMs,windowsStartup}));}
  }
  caddyPhase('validate');
  const adapted=JSON.parse(caddyPhase('adapt'));
  assert.equal(adapted.admin.disabled,true);assert.ok(Object.values(adapted.apps.http.servers).every(s=>s.listen.every(p=>p.endsWith(':'+port))&&s.protocols.join(' ')==='h1 h2'));
  const child=spawn(binary,['run','--adapter','caddyfile','--config',file],{env,stdio:['ignore','ignore','pipe'],windowsHide:true});let logs='';child.stderr.on('data',data=>{logs+=data;});const exited=once(child,'exit');
  scope.after(async()=>{if(child.exitCode===null){child.kill('SIGTERM');await Promise.race([exited,delay(3000)]);if(child.exitCode===null){child.kill('SIGKILL');await exited;}}});
  const cert=fs.readFileSync(certFile);let ready=false;
  const readinessStarted=performance.now(), readinessAbort=new AbortController();
  const readinessTimer=windowsStartup?setTimeout(()=>readinessAbort.abort(),20000):null;
  try {
    for(let i=0;windowsStartup?performance.now()-readinessStarted<20000:i<100;i++){
      try{const r=await client(port,WEB,cert,'/',{signal:windowsStartup?readinessAbort.signal:undefined});if(r.status===200){ready=true;break;}}catch{}
      if(child.exitCode!==null||readinessAbort.signal.aborted)break;
      await delay(20,undefined,{signal:readinessAbort.signal}).catch(()=>{});
    }
  } finally {
    clearTimeout(readinessTimer);readinessAbort.abort();
    console.log('CADDY_FIXTURE_TIMING='+JSON.stringify({phase:'readiness',elapsedMs:Math.ceil(performance.now()-readinessStarted),timeoutMs:windowsStartup?20000:null,maxProbes:windowsStartup?null:100,ready,windowsStartup}));
  }
  assert.ok(ready,'owned Caddy fixture not ready: '+logs.slice(-1200));backend.requests.length=0;
  return {root,port,cert,...backend,child,exited};
}

test('real Caddy TLS ingress enforces routing, raw path boundaries and trusted proxy headers', {skip:!process.env.CADDY_TEST_BIN,timeout:tlsTestTimeoutMs}, async t=>{
  const f=await caddyFixture(t);
  const web=await client(f.port,WEB,f.cert,'/login');assert.equal(web.status,200);assert.equal(JSON.parse(web.body).name,'web');
  const node=await client(f.port,AGENTS,f.cert,'/v1/manifest',{headers:{Host:AGENTS+':'+f.port,Authorization:'Bearer fixture','X-User-Id':'spoofed','X-Role':'owner','X-Workspace-Role':'owner','X-Node-Id':'other',Forwarded:'for=10.0.0.1','X-Forwarded-For':'10.0.0.1','X-Workspace-Id':'ws_fixture'}});
  assert.equal(node.status,200);const metadata=JSON.parse(node.body);assert.equal(metadata.name,'gateway');
  for(const name of ['x-user-id','x-role','x-workspace-role','x-node-id','forwarded'])assert.equal(metadata.headers[name],undefined);
  assert.equal(metadata.headers['x-workspace-id'],'ws_fixture','a workspace selector is not a trusted identity and must still reach server-side authorization');
  assert.equal(metadata.headers['x-forwarded-for'],'127.0.0.1');assert.equal(metadata.headers['x-forwarded-proto'],'https');
  const mcp=await client(f.port,AGENTS,f.cert,'/mcp',{method:'POST',headers:{Host:AGENTS+':'+f.port,'Content-Type':'application/json',Authorization:'Bearer fixture'},body:'{}'});
  assert.equal(mcp.status,200);assert.equal(JSON.parse(mcp.body).name,'mcp');
  const mcpGet=await client(f.port,AGENTS,f.cert,'/mcp');assert.equal(mcpGet.status,200);assert.equal(JSON.parse(mcpGet.body).name,'mcp');
  const resourcePaths=['/.well-known/oauth-protected-resource','/.well-known/oauth-protected-resource/mcp'];
  for(const uri of resourcePaths){
    for(const method of ['GET','HEAD']){
      const before=f.requests.length;
      const response=await client(f.port,AGENTS,f.cert,uri,{method,headers:{Host:AGENTS+':'+f.port,'X-User-Id':'spoofed','X-Role':'owner','X-Node-Id':'foreign',Forwarded:'for=10.0.0.1'}});
      assert.equal(response.status,200);assert.equal(f.requests.length,before+1);assert.equal(f.requests.at(-1).name,'mcp');assert.equal(f.requests.at(-1).url,uri);
      for(const name of ['x-user-id','x-role','x-node-id','forwarded'])assert.equal(f.requests.at(-1).headers[name],undefined);
      if(method==='HEAD')assert.equal(response.body,'');else assert.equal(JSON.parse(response.body).name,'mcp');
    }
    for(const method of ['POST','PUT','DELETE','OPTIONS']){
      const before=f.requests.length;assert.equal((await client(f.port,AGENTS,f.cert,uri,{method})).status,404);assert.equal(f.requests.length,before);
    }
    for(const variant of [uri+'/',uri+'/extra',uri+'?x=1',uri+'?',uri+'?token=fixture',uri.toUpperCase(),uri.replace('/.well-known','/%2ewell-known'),uri.replace('/.well-known','//.well-known')]){
      const before=f.requests.length;assert.equal((await client(f.port,AGENTS,f.cert,variant)).status,404,variant);assert.equal(f.requests.length,before);
    }
    const before=f.requests.length;assert.equal((await client(f.port,WEB,f.cert,uri)).status,404);assert.equal(f.requests.length,before);
  }
  for(const [host,uri,method] of [[WEB,'/mcp','POST'],[WEB,'/mcp','GET'],[WEB,'/v1/manifest','GET'],[AGENTS,'/login','GET'],[AGENTS,'/v1/pair','POST'],[AGENTS,'/v1/admin/nodes','POST'],[AGENTS,'/v1/manifest','DELETE'],[AGENTS,'/mcp','HEAD'],[AGENTS,'/mcp','DELETE'],[AGENTS,'/MCP','GET'],[AGENTS,'/mcp/','GET'],[AGENTS,'/mcp?x=1','GET'],[AGENTS,'/api/workspaces/a/agent-grants','GET'],[AGENTS,'/api/workspaces/a/agent-grants','POST'],[AGENTS,'/api/workspaces/a/agent-grants/x','DELETE']]){
    const before=f.requests.length;assert.equal((await client(f.port,host,f.cert,uri,{method})).status,404,method+' '+uri);assert.equal(f.requests.length,before,'denied route must not reach any upstream');
  }
  for(const uri of ['/v1/%6danifest','//v1/manifest','/v1/./manifest','/v1/tasks/../manifest','/v1\\manifest','/v1/manifest?token=fixture','/v1/manifest?unknown=1']){
    const before=f.requests.length;const r=await client(f.port,AGENTS,f.cert,uri);assert.ok([400,404].includes(r.status),uri+' '+r.status);assert.equal(f.requests.length,before);
  }
  assert.equal((await client(f.port,WEB,f.cert,'/',{headers:{Host:AGENTS+':'+f.port}})).status,421,'SNI/Host mismatch must fail before routing');
  await assert.rejects(client(f.port,'unknown.fixture.invalid',f.cert));
  const duplicate=await client(f.port,AGENTS,f.cert,'/v1/manifest',{headers:['Host',AGENTS+':'+f.port,'Authorization','Bearer fixture','Authorization','Bearer fixture']});
  assert.equal(duplicate.status,401);assert.equal(f.requests.at(-1).duplicate,2,'Caddy must preserve duplicate auth for the node API to reject');
});

test('real Caddy negotiates verified HTTP/2 and forwards WSS without changing the browser host boundary', {skip:!process.env.CADDY_TEST_BIN,timeout:tlsTestTimeoutMs},async t=>{
  const f=await caddyFixture(t),connection=http2.connect('https://127.0.0.1:'+f.port,{servername:WEB,ca:f.cert,rejectUnauthorized:true});
  t.after(()=>connection.destroy());await once(connection,'connect');assert.equal(connection.alpnProtocol,'h2');
  const request=connection.request({':path':'/login',':authority':WEB+':'+f.port});let responseStatus;request.on('response',headers=>{responseStatus=headers[':status'];});request.resume();await once(request,'end');assert.equal(responseStatus,200);
  const ws=new WebSocket('wss://127.0.0.1:'+f.port+'/',{servername:WEB,ca:f.cert,rejectUnauthorized:true,headers:{Host:WEB+':'+f.port,Origin:'https://'+WEB}});
  t.after(()=>ws.terminate());await once(ws,'open');const message=once(ws,'message');ws.send('fixture_echo');assert.equal((await message)[0].toString(),'fixture_echo');
  ws.close();await once(ws,'close');connection.close();
});

test('real TLS Agent discovery and lifecycle preserve signed authorization, revocation and host separation', {skip:!process.env.CADDY_TEST_BIN,timeout:tlsTestTimeoutMs},async t=>{
  const a=await publicAgentFixture(t),agentsHost=new URL(a.config.publicRuntime.agentsOrigin).hostname;
  const f=await caddyFixture(t,{mcpPort:a.ports[2],agentsHost});
  const request=(uri,options={})=>client(f.port,agentsHost,f.cert,uri,{...options,headers:{Host:agentsHost+':'+f.port,...options.headers}});
  const resource=a.config.publicRuntime.agentOAuth.resource,metadataUrl='https://'+agentsHost+'/.well-known/oauth-protected-resource/mcp';
  const paths=['/.well-known/oauth-protected-resource','/.well-known/oauth-protected-resource/mcp'];
  for(const uri of paths){
    const response=await request(uri),metadata=JSON.parse(response.body);
    assert.equal(response.status,200);assert.equal(metadata.resource,resource);
    assert.deepEqual(metadata.authorization_servers,[a.config.publicRuntime.agentOAuth.issuer]);
    assert.deepEqual(metadata.bearer_methods_supported,['header']);assert.ok(metadata.scopes_supported.includes('task.read'));
    assert.match(response.headers['cache-control'],/no-store/);
    const head=await request(uri,{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.body,'');
    assert.equal((await client(f.port,WEB,f.cert,uri)).status,404);
  }
  const ping=JSON.stringify({jsonrpc:'2.0',id:1,method:'ping',params:{}});
  const challenge=await request('/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:ping});
  assert.equal(challenge.status,401);assert.ok(challenge.headers['www-authenticate'].includes('resource_metadata="'+metadataUrl+'"'));
  const discovered=await request(new URL(metadataUrl).pathname);assert.equal(discovered.status,200);assert.equal(JSON.parse(discovered.body).resource,resource);
  assert.equal((await request('/mcp',{headers:{Cookie:a.humanCookie}})).status,401,'a valid human session is not an Agent token');
  assert.equal((await request('/mcp',{headers:{Authorization:'Bearer invalid.fixture.jwt'}})).status,401);
  const authorization={Authorization:'Bearer '+a.token(),'MCP-Protocol-Version':'2025-11-25'};
  const get=await request('/mcp',{headers:authorization});assert.equal(get.status,405);assert.equal(get.headers.allow,'POST');
  const post=body=>request('/mcp',{method:'POST',headers:{...authorization,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const initialized=await post({jsonrpc:'2.0',id:2,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'tls-fixture',version:'1'}}});
  assert.equal(initialized.status,200);assert.equal(JSON.parse(initialized.body).result.protocolVersion,'2025-11-25');
  const notification=await post({jsonrpc:'2.0',method:'notifications/initialized'});assert.equal(notification.status,202);assert.equal(notification.body,'');
  const pong=await post({jsonrpc:'2.0',id:3,method:'ping',params:{}});assert.equal(pong.status,200);assert.deepEqual(JSON.parse(pong.body).result,{});
  const tools=await post({jsonrpc:'2.0',id:4,method:'tools/list',params:{}});assert.equal(tools.status,200);assert.ok(Array.isArray(JSON.parse(tools.body).result.tools));
  assert.equal((await request('/mcp',{headers:{...authorization,'MCP-Protocol-Version':'unsupported'}})).status,400);
  assert.equal((await request('/mcp',{method:'POST',headers:{...authorization,'Content-Type':'application/json',Origin:'https://foreign.invalid'},body:ping})).status,403);
  const duplicate=await client(f.port,agentsHost,f.cert,'/mcp',{method:'POST',headers:['Host',agentsHost+':'+f.port,'Content-Type','application/json','Authorization',authorization.Authorization,'Authorization',authorization.Authorization],body:ping});
  assert.equal(duplicate.status,401);
  assert.equal((await request('/api/workspaces/'+a.workspaces.a.id+'/agent-grants',{headers:{Cookie:a.humanCookie}})).status,404);
  await a.revoke('a');await a.revoke('b');
  assert.equal((await request('/mcp',{headers:authorization})).status,403,'revoked grants do not authorize optional GET');
  assert.equal((await request(paths[0])).status,200,'public metadata does not itself grant authority');
});

test('real TLS metadata forwarding remains unavailable when the packaged Agent OAuth backend is disabled', {skip:!process.env.CADDY_TEST_BIN,timeout:tlsTestTimeoutMs},async t=>{
  const a=await publicAgentFixture(t,{agentOAuthEnabled:false}),agentsHost=new URL(a.config.publicRuntime.agentsOrigin).hostname;
  const f=await caddyFixture(t,{mcpPort:a.ports[2],agentsHost});
  for(const uri of ['/.well-known/oauth-protected-resource','/.well-known/oauth-protected-resource/mcp']){
    for(const method of ['GET','HEAD']){
      const response=await client(f.port,agentsHost,f.cert,uri,{method});assert.equal(response.status,404);if(method==='HEAD')assert.equal(response.body,'');
    }
  }
  const response=await client(f.port,agentsHost,f.cert,'/mcp',{method:'POST',headers:{Host:agentsHost+':'+f.port,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'ping'})});
  assert.equal(response.status,401);assert.equal(response.headers['www-authenticate'],undefined);
});
