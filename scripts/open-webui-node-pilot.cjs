'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{once}=require('node:events'),{execFileSync}=require('node:child_process');
const {createGatewayStore}=require('../gateway/store.cjs'),{createAgentGateway}=require('../gateway/server.cjs'),{createResearchBridge}=require('../gateway/research-bridge.cjs');
const {AgentClient}=require('../sdk/agent-client.cjs'),{createOpenWebUIHandler}=require('../sdk/adapters/open-webui.cjs'),{secret,hash}=require('../gateway/protocol.cjs');
async function main(){
 const env=process.env,handler=createOpenWebUIHandler({baseUrl:env.OPEN_WEBUI_URL,model:env.OPEN_WEBUI_MODEL,apiKeyFile:env.OPEN_WEBUI_API_KEY_FILE,allowLanHttp:env.OPEN_WEBUI_ALLOW_LAN_HTTP==='true'});
 const url='https://docs.openwebui.com/reference/api-endpoints/';const page=await fetch(url,{signal:AbortSignal.timeout(15000),redirect:'error'});if(!page.ok)throw new Error('original_source_unavailable');
 const parts=[];let size=0;for await(const chunk of page.body){size+=chunk.length;if(size>2097152)throw new Error('original_source_too_large');parts.push(chunk);}
 const text=Buffer.concat(parts).toString('utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
 const index=text.indexOf('GET /api/models');if(index<0)throw new Error('original_evidence_not_found');
 const excerpt=text.slice(Math.max(0,index-100),index+1000),source={sourceId:'S1',url,excerpt,excerptSha256:hash(excerpt),retrievedAt:new Date().toISOString(),external:false};
 const material={question:'Which endpoint retrieves the Open WebUI model catalog?',sources:[source],claims:[{claimId:'C1',sourceId:'S1',text:'Open WebUI exposes GET /api/models for retrieving the model catalog.'}]};
 const root=path.resolve(__dirname,'..');const sources=JSON.parse(execFileSync(process.env.PYTHON||'python',['-c','import json,runpy; print(json.dumps(runpy.run_path("scripts/materialize.py")["embedded_sources"]()))'],{cwd:root,encoding:'utf8'}));
 const start=sources.SERVER_JS.indexOf('function formatResearchSummary('),end=sources.SERVER_JS.indexOf('async function runResearch(',start);if(start<0||end<0)throw new Error('evidence_gate_not_found');
 const validate=vm.runInNewContext(sources.SERVER_JS.slice(start,end)+'\nvalidateResearchDecisions',{Map,Set});
 const store=createGatewayStore({dbPath:':memory:'}),gateway=createAgentGateway({store,adminToken:secret()}),bridge=createResearchBridge({store}),stop=new AbortController();
 try{
  const node=store.createNode({name:'Open WebUI public pilot',capabilities:['research.verify'],scopes:['public']}),paired=store.pair(node.pairingCode);
  gateway.server.listen(0,'127.0.0.1');await once(gateway.server,'listening');
  const client=new AgentClient({baseUrl:'http://127.0.0.1:'+gateway.server.address().port,token:paired.token});
  const pending=bridge.dispatchResearchStage({sessionId:'open-webui-public-pilot',traceId:'open-webui-public-pilot',stage:'verify',role:{kind:'external',nodeId:paired.nodeId},input:material,privacy:'public',deadlineAt:Date.now()+90000});pending.catch(()=>{});
  const lease=await client.claim(stop.signal),started=Date.now();await client.execute(lease,handler,{signal:stop.signal});const result=await pending;
  const decisions=validate(JSON.stringify(result.output),{sources:material.sources,evidence:material.claims});if(decisions.length!==1||decisions[0].status!=='supported')throw new Error('pilot_not_supported');
  console.log(JSON.stringify({scope:'temporary local gateway; real existing Open WebUI model; no VPS',model:env.OPEN_WEBUI_MODEL,completedTasks:1,sourceUrl:url,sourceSha256:source.excerptSha256,originalSourceAcquired:true,evidenceGatePassed:true,elapsedMs:Date.now()-started,provenance:result.provenance}));
 }finally{stop.abort();bridge.close();await gateway.close();store.close();}
}
if(require.main===module)main().catch(()=>{console.error('Live pilot failed; no success or trusted conclusion is claimed. Check private configuration, model JSON output, and original-source availability.');process.exitCode=1;});
