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
const WEB = 'lack.fixture.invalid', AGENTS = 'agents.fixture.invalid';
const config = {httpPort: 23721, agentGateway: {port: 23722}, publicRuntime: {webOrigin: 'https://' + WEB, agentsOrigin: 'https://' + AGENTS, mcpPort: 23723}};

function folder(t) {const root=fs.mkdtempSync(path.join(os.tmpdir(),'lack-ingress-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
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
    const req=https.request({hostname:'127.0.0.1',port,servername:options.servername||host,ca:cert,rejectUnauthorized:true,path:uri,
      method:options.method||'GET',headers:options.headers||{Host:host+':'+port}},res=>{
      const chunks=[];res.on('data',data=>chunks.push(data));res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(chunks).toString('utf8')}));
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
async function caddyFixture(t) {
  const root=folder(t),backend=await servers(t),binary=process.env.CADDY_TEST_BIN;
  assert.ok(path.isAbsolute(binary),'CADDY_TEST_BIN must identify an already verified local executable');
  const probe=http.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const certFile=path.join(root,'fixture.crt'),keyFile=path.join(root,'fixture.key');
  const openssl=process.env.OPENSSL_TEST_BIN||(process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl');
  execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-keyout',keyFile,'-out',certFile,'-days','1','-subj','/CN='+WEB,'-addext','subjectAltName=DNS:'+WEB+',DNS:'+AGENTS],{timeout:5000,stdio:'pipe',windowsHide:true});
  const c={...config,httpPort:backend.ports[0],agentGateway:{port:backend.ports[1]},publicRuntime:{...config.publicRuntime,mcpPort:backend.ports[2]}};
  const file=path.join(root,'Caddyfile');fs.writeFileSync(file,renderPublicIngress(c,{fixture:{listenPort:port,certFile,keyFile}}),{mode:0o600});
  const env={...process.env,XDG_DATA_HOME:path.join(root,'data'),XDG_CONFIG_HOME:path.join(root,'config')};
  execFileSync(binary,['validate','--adapter','caddyfile','--config',file],{env,timeout:5000,stdio:'pipe',windowsHide:true});
  const adapted=JSON.parse(execFileSync(binary,['adapt','--adapter','caddyfile','--config',file],{env,timeout:5000,encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true}));
  assert.equal(adapted.admin.disabled,true);assert.ok(Object.values(adapted.apps.http.servers).every(s=>s.listen.every(p=>p.endsWith(':'+port))&&s.protocols.join(' ')==='h1 h2'));
  const child=spawn(binary,['run','--adapter','caddyfile','--config',file],{env,stdio:['ignore','ignore','pipe'],windowsHide:true});let logs='';child.stderr.on('data',data=>{logs+=data;});const exited=once(child,'exit');
  t.after(async()=>{if(child.exitCode===null){child.kill('SIGTERM');await Promise.race([exited,delay(3000)]);if(child.exitCode===null){child.kill('SIGKILL');await exited;}}});
  const cert=fs.readFileSync(certFile);let ready=false;
  for(let i=0;i<100;i++){try{const r=await client(port,WEB,cert);if(r.status===200){ready=true;break;}}catch{}if(child.exitCode!==null)break;await delay(20);}
  assert.ok(ready,'owned Caddy fixture not ready: '+logs.slice(-1200));backend.requests.length=0;
  return {root,port,cert,...backend,child,exited};
}

test('real Caddy TLS ingress enforces routing, raw path boundaries and trusted proxy headers', {skip:!process.env.CADDY_TEST_BIN,timeout:20000}, async t=>{
  const f=await caddyFixture(t);
  const web=await client(f.port,WEB,f.cert,'/login');assert.equal(web.status,200);assert.equal(JSON.parse(web.body).name,'web');
  const node=await client(f.port,AGENTS,f.cert,'/v1/manifest',{headers:{Host:AGENTS+':'+f.port,Authorization:'Bearer fixture','X-User-Id':'spoofed','X-Role':'owner','X-Workspace-Role':'owner','X-Node-Id':'other',Forwarded:'for=10.0.0.1','X-Forwarded-For':'10.0.0.1','X-Workspace-Id':'ws_fixture'}});
  assert.equal(node.status,200);const metadata=JSON.parse(node.body);assert.equal(metadata.name,'gateway');
  for(const name of ['x-user-id','x-role','x-workspace-role','x-node-id','forwarded'])assert.equal(metadata.headers[name],undefined);
  assert.equal(metadata.headers['x-workspace-id'],'ws_fixture','a workspace selector is not a trusted identity and must still reach server-side authorization');
  assert.equal(metadata.headers['x-forwarded-for'],'127.0.0.1');assert.equal(metadata.headers['x-forwarded-proto'],'https');
  const mcp=await client(f.port,AGENTS,f.cert,'/mcp',{method:'POST',headers:{Host:AGENTS+':'+f.port,'Content-Type':'application/json',Authorization:'Bearer fixture'},body:'{}'});
  assert.equal(mcp.status,200);assert.equal(JSON.parse(mcp.body).name,'mcp');
  for(const [host,uri,method] of [[WEB,'/mcp','POST'],[WEB,'/v1/manifest','GET'],[AGENTS,'/login','GET'],[AGENTS,'/v1/pair','POST'],[AGENTS,'/v1/admin/nodes','POST'],[AGENTS,'/v1/manifest','DELETE'],[AGENTS,'/mcp','GET']]){
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

test('real Caddy negotiates verified HTTP/2 and forwards WSS without changing the browser host boundary', {skip:!process.env.CADDY_TEST_BIN,timeout:20000},async t=>{
  const f=await caddyFixture(t),connection=http2.connect('https://127.0.0.1:'+f.port,{servername:WEB,ca:f.cert,rejectUnauthorized:true});
  t.after(()=>connection.destroy());await once(connection,'connect');assert.equal(connection.alpnProtocol,'h2');
  const request=connection.request({':path':'/login',':authority':WEB+':'+f.port});let responseStatus;request.on('response',headers=>{responseStatus=headers[':status'];});request.resume();await once(request,'end');assert.equal(responseStatus,200);
  const ws=new WebSocket('wss://127.0.0.1:'+f.port+'/',{servername:WEB,ca:f.cert,rejectUnauthorized:true,headers:{Host:WEB+':'+f.port,Origin:'https://'+WEB}});
  t.after(()=>ws.terminate());await once(ws,'open');const message=once(ws,'message');ws.send('fixture_echo');assert.equal((await message)[0].toString(),'fixture_echo');
  ws.close();await once(ws,'close');connection.close();
});
