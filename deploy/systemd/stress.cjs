'use strict';
// Five shared Agents, one outstanding full-team round per independent channel.
const fs=require('node:fs'),http=require('node:http'),WebSocket=require('ws');
const {once}=require('node:events');
const dir=process.env.STRESS_RESULTS;
if(!dir)throw new Error('STRESS_RESULTS is required');
const emit=data=>{const line=JSON.stringify({time:new Date().toISOString(),...data});fs.appendFileSync(dir+'/driver.jsonl',line+'\n');console.log(line);};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const percentile=(a,p)=>a.length?[...a].sort((x,y)=>x-y)[Math.min(a.length-1,Math.ceil(a.length*p)-1)]:null;
const names=Array.from({length:5},(_,i)=>'Work'+String(i+1).padStart(2,'0'));
const rooms=['general','bench2','bench3','bench4','bench5'];
const sockets=[],pending=new Map(),mockTimers=new Set();
let stage,sequence=0,modelDelay=1000,replyBytes=2048,activeModels=0,fatal=null,mock;
function check(){if(fatal)throw fatal;if(fs.existsSync(dir+'/abort'))throw new Error('Safety watchdog aborted test');}
function fail(error){fatal=fatal||error;for(const item of pending.values()){clearTimeout(item.timer);item.reject(fatal);}pending.clear();}
async function connect(room){
 const s=new WebSocket('ws://127.0.0.1:3723');sockets.push(s);let joined=false;
 s.on('error',fail);
 s.on('message',data=>{
  const m=JSON.parse(data);
  if(m.type==='history'&&m.channelId===room)joined=true;
  if(m.type!=='new_message'||m.channelId!==room||m.message?.senderType!=='agent')return;
  const item=pending.get(room);
  if(item&&names.includes(m.message.sender)&&String(m.message.content).includes(item.token)){
   if(!item.seen.has(m.message.sender)){item.seen.add(m.message.sender);stage.agentReplies++;}
   if(item.seen.size===5){clearTimeout(item.timer);pending.delete(room);item.resolve(Date.now()-item.start);}
  }
 });
 await once(s,'open');s.send(JSON.stringify({type:'join',channelId:room}));
 for(let n=0;n<100&&!joined;n++){check();await delay(50);}
 if(!joined)throw new Error('Channel join timeout '+room);
}
async function worker(i,end){
 const room=rooms[i];
 while(Date.now()<end){
  check();const token='LOAD_JOB_'+String(++sequence).padStart(8,'0');stage.started++;
  const result=new Promise((resolve,reject)=>{
   const item={token,start:Date.now(),seen:new Set(),resolve,reject};
   item.timer=setTimeout(()=>{pending.delete(room);reject(new Error('Round timeout '+room+' '+token+' received='+[...item.seen].join(',')));},Math.max(45000,modelDelay*30+15000));
   pending.set(room,item);
  });
  sockets[i].send(JSON.stringify({type:'message',content:token+' Each team member: summarize the synthetic scenario. '+('Input facts only. '.repeat(Math.ceil(stage.inputBytes/18)))}));
  try{stage.latencies.push(await result);stage.completed++;}
  catch(e){stage.errors++;fail(e);throw e;}
  await delay(2500); // Respect the existing per-Agent/channel cooldown.
 }
}
async function runStage(label,concurrency,seconds,inputBytes=1024){
 check();stage={label,concurrency,seconds,inputBytes,started:0,completed:0,errors:0,agentReplies:0,latencies:[],modelCalls:0,modelPeak:0,modelInputMax:0,modelInputBytes:0};
 const started=Date.now(),sloMs=modelDelay*20+5000;
 emit({event:'stage_start',label,concurrency,seconds,modelDelay,replyBytes,inputBytes,sloMs,agentsPerRound:5});
 const outcomes=await Promise.allSettled(Array.from({length:concurrency},(_,i)=>worker(i,started+seconds*1000)));
 const result={...stage,latencies:undefined,event:'stage_complete',elapsedSeconds:(Date.now()-started)/1000,p50Ms:percentile(stage.latencies,.5),p95Ms:percentile(stage.latencies,.95),maxMs:Math.max(0,...stage.latencies),sloMs};
 result.roundsPerMinute=result.completed*60/result.elapsedSeconds;
 result.meetsLatencySlo=result.errors===0&&result.completed>=concurrency&&result.agentReplies===result.completed*5&&result.p95Ms<=sloMs;
 emit(result);const error=outcomes.find(x=>x.status==='rejected');if(error)throw error.reason;
 await delay(3500);return result;
}
async function main(){
 emit({event:'start',fixture:'127.0.0.1:3723',agents:5,rooms,cooldownMs:2500,taskDefinition:'all five Agents reply to one round in its channel'});
 mock=http.createServer((req,res)=>{
  let body='';req.on('data',c=>body+=c);
  req.on('end',()=>{
   res.setHeader('Content-Type','application/json');
   if(req.url.endsWith('/models')){res.end(JSON.stringify({data:[{id:'mock-model'}]}));return;}
   const matches=[...body.matchAll(/LOAD_JOB_\d{8}/g)],token=matches.length?matches[matches.length-1][0]:'BACKGROUND';
   activeModels++;
   if(stage){stage.modelCalls++;stage.modelPeak=Math.max(stage.modelPeak,activeModels);stage.modelInputMax=Math.max(stage.modelInputMax,Buffer.byteLength(body));stage.modelInputBytes+=Buffer.byteLength(body);}
   const size=replyBytes;
   const timer=setTimeout(()=>{mockTimers.delete(timer);activeModels--;res.end(JSON.stringify({choices:[{message:{content:token+' '+('Synthetic verified facts. '.repeat(Math.ceil(size/26))).slice(0,size)}}]}));},modelDelay);
   mockTimers.add(timer);
  });
 });
 mock.listen(13871,'127.0.0.1');await once(mock,'listening');
 for(const room of rooms)await connect(room);
 const results=[];
 for(const n of [1,2,3,5]){const r=await runStage('ramp-'+n,n,90);results.push(r);if(!r.meetsLatencySlo)break;}
 const good=results.filter(r=>r.meetsLatencySlo);if(!good.length)throw new Error('No full-team stage met SLO');
 const ceiling=good[good.length-1].concurrency;
 const soak=await runStage('soak-'+ceiling,ceiling,480);
 modelDelay=5000;replyBytes=8192;
 const slow=await runStage('slow-'+ceiling,ceiling,120,16384);
 emit({event:'finished',testedConcurrentRounds:ceiling,agents:5,soakPassed:soak.meetsLatencySlo,slowModelPassed:slow.meetsLatencySlo,realInference:false,hardwareFailureCeilingFound:false});
}
main().catch(e=>{fail(e);emit({event:'failed',error:e.message});process.exitCode=1;}).finally(async()=>{
 sockets.forEach(s=>s.terminate());mockTimers.forEach(t=>clearTimeout(t));
 if(mock){mock.closeAllConnections();await new Promise(r=>mock.close(r));}
});
