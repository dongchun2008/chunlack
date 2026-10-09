'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const vm=require('node:vm');const {execFileSync}=require('node:child_process');const {once}=require('node:events');
const {createGatewayStore}=require('../gateway/store.cjs');const {createAgentGateway}=require('../gateway/server.cjs');const {createResearchBridge,normalizeExternalRetrieval}=require('../gateway/research-bridge.cjs');const {AgentClient}=require('../sdk/agent-client.cjs');
const root=path.resolve(__dirname,'..'),sources=JSON.parse(execFileSync(process.env.PYTHON||'python',['-c','import json,runpy; print(json.dumps(runpy.run_path("scripts/materialize.py")["embedded_sources"]()))'],{cwd:root,encoding:'utf8'}));
const start=sources.SERVER_JS.indexOf('function formatResearchSummary('),end=sources.SERVER_JS.indexOf('async function runResearch(',start);
const settingsStart=sources.SERVER_JS.indexOf('function workspaceSetting('),settingsEnd=sources.SERVER_JS.indexOf('function workspaceTransport(',settingsStart);
assert.ok(settingsStart>=0&&settingsEnd>settingsStart);
test('actual external verification uses the existing evidence gate; invented quotes fail',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lack-bridge-'));const store=createGatewayStore({dbPath:path.join(dir,'gateway.db')});
 const node=store.createNode({name:'Verifier',capabilities:['research.verify'],scopes:['public']}),paired=store.pair(node.pairingCode),gateway=createAgentGateway({store,adminToken:'a'.repeat(43),pollMs:40}),bridge=createResearchBridge({store});
 gateway.server.listen(0,'127.0.0.1');await once(gateway.server,'listening');const stop=new AbortController(),client=new AgentClient({baseUrl:`http://127.0.0.1:${gateway.server.address().port}`,token:paired.token});
 let invented=false;const worker=client.run(async({task})=>({decisions:task.input.claims.map(claim=>({claimId:claim.claimId,status:'supported',reason:'Fixture evidence.',evidence:[{sourceId:claim.sourceId,quote:invented?'The fixture launched in 2099.':'The fixture launched in 2020.'}]}))}),{signal:stop.signal});
 t.after(async()=>{stop.abort();await worker.catch(()=>{});bridge.close();await gateway.close();store.close();fs.rmSync(dir,{recursive:true,force:true});});
 const role={kind:'external',nodeId:paired.nodeId};const material={question:'When did the fixture launch?',sources:[{sourceId:'S1',url:'https://example.org/fixture',excerpt:'The fixture launched in 2020.'}],claims:[{claimId:'C1',sourceId:'S1',text:'The fixture launched in 2020.'}]};
 const api=vm.runInNewContext(sources.SERVER_JS.slice(settingsStart,settingsEnd)+sources.SERVER_JS.slice(start,end)+'\n({validateResearchDecisions,dispatchResearchStage})',{workspaceServices:()=>null,config:{researchPublicOnly:true},agentGateway:{dispatchResearchStage:bridge.dispatchResearchStage},Date,Map,Set});
 const raw=await api.dispatchResearchStage({sessionId:'fixture',stage:'verify',role,input:material});const note={sources:material.sources,evidence:material.claims};assert.equal(api.validateResearchDecisions(raw,note)[0].status,'supported');
 invented=true;const bad=await api.dispatchResearchStage({sessionId:'fixture',stage:'verify',role,input:material});assert.throws(()=>api.validateResearchDecisions(bad,note),/saved source/);
 await assert.rejects(()=>bridge.dispatchResearchStage({sessionId:'fixture',stage:'verify',role,input:material,privacy:'private'}),/public/);
});
test('external retrieval stays unverified and cannot serve as a trusted supporting source',()=>{
 const material=normalizeExternalRetrieval({sources:[{url:'https://example.org/fixture',excerpt:'The fixture launched in 2020.'}],claims:[{text:'The fixture launched in 2020.',sourceIndex:0}]});
 assert.equal(material.sources[0].external,true);assert.equal(material.claims[0].status,'unverified');
 const validate=vm.runInNewContext(sources.SERVER_JS.slice(start,end)+'\nvalidateResearchDecisions',{Map,Set});
 assert.throws(()=>validate(JSON.stringify({decisions:[{claimId:'C1',status:'supported',reason:'claimed support',evidence:[{sourceId:'S1',quote:'The fixture launched in 2020.'}]}]}),{sources:material.sources,evidence:material.claims}),/trusted/);
 assert.throws(()=>normalizeExternalRetrieval({sources:[{url:'https://127.0.0.1/secret',excerpt:'not public'}],claims:[]}),/public/);
});
test('gateway startup is opt-in and failed initialization leaves the application usable',async t=>{
 const {startAgentGateway}=require('../gateway/runtime.cjs');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lack-start-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 assert.equal(await startAgentGateway({config:{},dataRoot:dir}),null);assert.equal(fs.existsSync(path.join(dir,'db')),false);
 await assert.rejects(()=>startAgentGateway({config:{agentGateway:{enabled:true,port:12345,adminTokenEnv:'FIXTURE_ADMIN'}},dataRoot:dir,env:{}}),/credential/);
 assert.equal(fs.existsSync(path.join(dir,'db')),false);
});
test('materialized runtime includes gateway and SDK without overwriting configuration',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lack-materialize-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 execFileSync(process.env.PYTHON||'python',[path.join(root,'scripts/materialize.py'),'--output',dir]);
 const configFile=path.join(dir,'config','lack.config.json');const cfg=JSON.parse(fs.readFileSync(configFile));cfg.operatorSetting='retained';fs.writeFileSync(configFile,JSON.stringify(cfg));
 execFileSync(process.env.PYTHON||'python',[path.join(root,'scripts/materialize.py'),'--output',dir]);
 assert.equal(JSON.parse(fs.readFileSync(configFile)).operatorSetting,'retained');assert.ok(fs.existsSync(path.join(dir,'gateway','server.cjs')));assert.ok(fs.existsSync(path.join(dir,'sdk','cli.cjs')));
 const html=fs.readFileSync(path.join(root,'gateway','admin.html'),'utf8');for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
});
