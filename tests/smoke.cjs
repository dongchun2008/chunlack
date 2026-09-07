'use strict';
// Real server, SQLite and WebSocket; synthetic model servers only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const {spawn,execFileSync} = require('node:child_process');
const {once} = require('node:events');
const WebSocket = require('ws');
const root = path.resolve(__dirname,'..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(),'lack-smoke-'));
const traffic = [];
let child, socket;
let output='';
const mock = http.createServer((req,res)=>{
  let body=''; req.on('data',chunk=>body+=chunk);
  req.on('end',()=>{
    traffic.push({url:req.url,body:body ? JSON.parse(body):null});
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify(req.url.endsWith('/models') ? {data:[{id:'mock-model'}]} : {choices:[{message:{content:'Synthetic test reply.'}}]}));
  });
});
async function listen(server) {server.listen(0,'127.0.0.1');await once(server,'listening');return server.address().port;}
async function stop() {
  if(socket) {socket.terminate();socket=null;}
  if(child && child.exitCode===null) {const closed=once(child,'exit');child.kill();await closed;}
}
async function start(port) {
  child=spawn(process.execPath,['server.js'],{cwd:temp,env:{...process.env,NODE_PATH:path.join(root,'node_modules'),LACK_BIND_HOST:'127.0.0.1',LACK_ALLOW_SHELL:'false'},stdio:['ignore','pipe','pipe'],windowsHide:true});
  child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
  const url=`http://127.0.0.1:${port}`;
  for(let i=0;i<450;i++) {
    if(child.exitCode!==null) throw new Error('Server exited: '+output);
    try {if((await fetch(url+'/health',{signal:AbortSignal.timeout(1000)})).ok) return url;}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('Server health timeout: '+output);
}
function inbox() {
  const messages=[];
  socket.on('message',data=>messages.push(JSON.parse(data)));
  return async predicate=>{
    for(let i=0;i<100;i++) {
      const index=messages.findIndex(predicate);
      if(index>=0)return messages.splice(index,1)[0];
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    throw new Error('WebSocket message timeout: '+output.slice(-3000));
  };
}
(async()=>{
  try {
    const mockPort=await listen(mock);
    const reservation=http.createServer();const port=await listen(reservation);await new Promise(r=>reservation.close(r));
    execFileSync(process.env.PYTHON || 'python',[path.join(root,'scripts/materialize.py'),'--output',temp],{cwd:root});
    const configPath=path.join(temp,'config/lack.config.json');
    const config=JSON.parse(fs.readFileSync(configPath,'utf8'));
    Object.assign(config,{httpPort:port,llmProvider:'mock-a',defaultModel:'mock-model',embeddingProvider:'none',autoPullModels:false,jspaceEnabled:false,enableMusing:false,enableTriangulation:false,llmCloudProviders:[],llmProviders:[
      {id:'mock-a',baseUrl:`http://127.0.0.1:${mockPort}/a/v1`,local:true,requiresApiKey:false},
      {id:'mock-b',baseUrl:`http://127.0.0.1:${mockPort}/b/v1`,local:true,requiresApiKey:false}
    ],agents:[
      {id:'a',name:'Alpha',provider:'mock-a',model:'mock-model',channels:['general'],systemPrompt:'Be brief.'},
      {id:'b',name:'Beta',provider:'mock-b',model:'mock-model',channels:['general'],systemPrompt:'Be brief.'}
    ]});
    fs.writeFileSync(configPath,JSON.stringify(config));
    // Materializing upgrades must preserve the operator's live configuration.
    execFileSync(process.env.PYTHON || 'python',[path.join(root,'scripts/materialize.py'),'--output',temp],{cwd:root});
    assert.equal(JSON.parse(fs.readFileSync(configPath)).llmProvider,'mock-a');
    let url=await start(port);
    const providers=await (await fetch(url+'/api/llm-providers')).json();
    assert.ok(providers.providers.some(p=>p.id==='mock-b'&&p.configured));
    assert.equal((await fetch(url+'/api/models?provider=unknown')).status,400);
    assert.equal((await fetch(url+'/api/tree?root=../')).status,400);
    assert.deepEqual((await (await fetch(url+'/api/models?provider=mock-b')).json()).models,['mock-model']);
    socket=new WebSocket(url.replace('http:','ws:'));let receive=inbox();
    let initial=await receive(m=>m.type==='agents_list');
    assert.equal(initial.agents.find(a=>a.id==='b').provider,'mock-b');
    socket.send(JSON.stringify({type:'join',channelId:'general'}));
    await receive(m=>m.type==='history');await receive(m=>m.type==='agents_list');
    socket.send(JSON.stringify({type:'update_agent',id:'b',name:'Beta saved',model:'mock-model',provider:'mock-b',systemPrompt:'Be brief.',channels:['general']}));
    const updated=await receive(m=>m.type==='agents_list'&&m.agents.some(a=>a.name==='Beta saved'));
    assert.equal(updated.agents.find(a=>a.id==='b').provider,'mock-b');
    // Exercise both providers through actual chat handling in one channel.
    socket.send(JSON.stringify({type:'message',content:'@Alpha Please reply briefly.'}));
    for(let i=0;i<100&&!traffic.some(t=>t.url==='/a/v1/chat/completions');i++)await new Promise(r=>setTimeout(r,50));
    assert.ok(traffic.some(t=>t.url==='/a/v1/chat/completions'),'Alpha model request');
    socket.send(JSON.stringify({type:'message',content:'@Beta saved Please review the reply.'}));
    for(let i=0;i<100&&!traffic.some(t=>t.url==='/b/v1/chat/completions');i++)await new Promise(r=>setTimeout(r,50));
    assert.ok(traffic.some(t=>t.url==='/b/v1/chat/completions'),'Beta model request');
    await stop();url=await start(port);
    socket=new WebSocket(url.replace('http:','ws:'));receive=inbox();
    initial=await receive(m=>m.type==='agents_list');
    assert.equal(initial.agents.find(a=>a.id==='b').name,'Beta saved');
    assert.equal(initial.agents.find(a=>a.id==='b').provider,'mock-b');
    console.log('PASS: real HTTP + WebSocket, two mock model backends in one channel, SQLite restart persistence, private bind, config preservation.');
  } finally {
    await stop();mock.closeAllConnections();await new Promise(r=>mock.close(r));
    fs.rmSync(temp,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
