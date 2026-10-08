'use strict';
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {once}=require('node:events');const assert=require('node:assert/strict');
const {createGatewayStore}=require('../gateway/store.cjs');const {createAgentGateway}=require('../gateway/server.cjs');const {AgentClient}=require('../sdk/agent-client.cjs');const {handler}=require('../sdk/fixtures/research-worker.cjs');
async function benchmark({nodes=5,durationSeconds=300}={}){
 if(!Number.isInteger(nodes)||nodes<1||nodes>5||!Number.isInteger(durationSeconds)||durationSeconds<1||durationSeconds>600)throw new Error('Bounded benchmark: 1-5 nodes, 1-600 seconds');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lack-gateway-benchmark-')),dbPath=path.join(dir,'gateway.db'),rssBefore=process.memoryUsage().rss;
 const store=createGatewayStore({dbPath}),gateway=createAgentGateway({store,adminToken:'a'.repeat(43)}),clients=[],workers=[],tasks=[],controllers=[];
 let peakRss=rssBefore,peakWaiters=0,claimRequests=0,otherRequests=0,failures=0,cpuStart,started,sampler;
 try{
  gateway.server.listen(0,'127.0.0.1');await once(gateway.server,'listening');const baseUrl=`http://127.0.0.1:${gateway.server.address().port}`;
  for(let i=0;i<nodes;i++){const node=store.createNode({name:'Fixture '+i,capabilities:['research.verify'],scopes:['public']}),paired=store.pair(node.pairingCode);const client=new AgentClient({baseUrl,token:paired.token,fetch:(url,options)=>{url.endsWith('/claim')?claimRequests++:otherRequests++;return fetch(url,options);}}),stop=new AbortController();clients.push(client);controllers.push(stop);workers.push(client.run(handler,{signal:stop.signal}).catch(error=>{if(!stop.signal.aborted){failures++;throw error;}}));
   tasks.push(store.enqueueTask({targetNodeId:paired.nodeId,scopeId:'public',taskType:'research.verify',input:{fixture:true,question:'When did the fixture launch?',sources:[{sourceId:'S1',excerpt:'The fixture launched in 2020.'}],claims:[{claimId:'C1',sourceId:'S1',text:'The fixture launched in 2020.'}]},deadlineAt:Date.now()+120000}).taskId);
  }
  started=Date.now();cpuStart=process.cpuUsage();sampler=setInterval(()=>{peakRss=Math.max(peakRss,process.memoryUsage().rss);peakWaiters=Math.max(peakWaiters,gateway.waitingCount());},1000);
  await new Promise(resolve=>setTimeout(resolve,durationSeconds*1000));clearInterval(sampler);
  const elapsedMs=Date.now()-started,cpu=process.cpuUsage(cpuStart);for(const id of tasks)assert.equal(store.getTask(id).status,'succeeded');assert.equal(failures,0);
  controllers.forEach(controller=>controller.abort());await Promise.allSettled(workers);await gateway.close();store.close();
  const reopened=createGatewayStore({dbPath});for(const id of tasks)assert.equal(reopened.getTask(id).status,'succeeded');reopened.close();
  const databaseBytes=fs.statSync(dbPath).size,walBytes=fs.existsSync(dbPath+'-wal')?fs.statSync(dbPath+'-wal').size:0;
  return {nodes,durationSeconds,completedTasks:tasks.length,failures,claimRequests,otherRequests,claimRequestsPerMinute:Number((claimRequests*60000/elapsedMs).toFixed(2)),cpuPercentOfOneCore:Number(((cpu.user+cpu.system)/(elapsedMs*10)).toFixed(3)),rssStartMiB:Number((rssBefore/1048576).toFixed(2)),rssPeakMiB:Number((peakRss/1048576).toFixed(2)),rssIncreaseMiB:Number(((peakRss-rssBefore)/1048576).toFixed(2)),peakWaiters,databaseBytes,walBytes,persistenceVerified:true,scope:'Windows local, gateway and five fixture clients in one process; no real models or VPS'};
 }finally{clearInterval(sampler);controllers.forEach(controller=>controller.abort());await Promise.allSettled(workers);await gateway.close();try{store.close();}catch{}fs.rmSync(dir,{recursive:true,force:true});}
}
if(require.main===module){const args=process.argv.slice(2);const value=name=>{const index=args.indexOf(name);return index<0?undefined:Number(args[index+1]);};benchmark({nodes:value('--nodes')??5,durationSeconds:value('--duration-seconds')??300}).then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});}
module.exports={benchmark};
