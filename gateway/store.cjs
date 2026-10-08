'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {EventEmitter}=require('node:events');
const Database=require('better-sqlite3');
const P=require('./protocol.cjs');
function createGatewayStore({dbPath,now=Date.now}){
  if(dbPath!==':memory:')fs.mkdirSync(path.dirname(dbPath),{recursive:true});
  const db=new Database(dbPath);
  if(dbPath!==':memory:'&&process.platform!=='win32')fs.chmodSync(dbPath,0o600);
  db.pragma('journal_mode = WAL');db.pragma('busy_timeout = 1000');db.pragma('foreign_keys = ON');db.pragma('max_page_count = 16384');
  db.exec(`CREATE TABLE IF NOT EXISTS nodes(id TEXT PRIMARY KEY,name TEXT NOT NULL,capabilities TEXT NOT NULL,scopes TEXT NOT NULL,token_hash TEXT UNIQUE,paused INTEGER NOT NULL DEFAULT 0,revoked INTEGER NOT NULL DEFAULT 0,last_seen INTEGER,created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS pairings(code_hash TEXT PRIMARY KEY,node_id TEXT NOT NULL REFERENCES nodes(id),expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,node_id TEXT NOT NULL REFERENCES nodes(id),scope_id TEXT NOT NULL,task_type TEXT NOT NULL,input TEXT NOT NULL,status TEXT NOT NULL,lease_id TEXT,lease_until INTEGER,attempt INTEGER NOT NULL DEFAULT 0,deadline_at INTEGER NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,result TEXT,last_error TEXT);
    CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,node_id TEXT NOT NULL REFERENCES nodes(id),task_id TEXT NOT NULL REFERENCES tasks(id),event_id TEXT NOT NULL,content_hash TEXT NOT NULL,ack TEXT NOT NULL,type TEXT NOT NULL,message TEXT,created_at INTEGER NOT NULL,UNIQUE(node_id,event_id));
    CREATE INDEX IF NOT EXISTS tasks_node_status ON tasks(node_id,status,created_at);
    CREATE INDEX IF NOT EXISTS tasks_expiry ON tasks(status,lease_until,deadline_at);
    CREATE INDEX IF NOT EXISTS events_task ON events(task_id);
    CREATE INDEX IF NOT EXISTS events_node_seq ON events(node_id,seq);`);
  const changes=new EventEmitter();changes.setMaxListeners(40);
  const q=sql=>db.prepare(sql), parse=row=>row?{...row,input:JSON.parse(row.input),result:row.result?JSON.parse(row.result):null}:null;
  const mutate=(fn,notify=true)=>{const result=db.transaction(fn).immediate();if(notify)changes.emit('change');return result;};
  function node(id){P.id(id);const row=q('SELECT * FROM nodes WHERE id=?').get(id);if(!row)P.fail('unknown_node',404);return {...row,capabilities:JSON.parse(row.capabilities),scopes:JSON.parse(row.scopes)};}
  function publicNode(row){return {id:row.id,name:row.name,capabilities:row.capabilities,scopes:row.scopes,paused:!!row.paused,revoked:!!row.revoked,lastSeen:row.last_seen,createdAt:row.created_at};}
  function liveNode(id){const row=node(id);if(row.revoked)P.fail('node_revoked',401);return row;}
  function getTask(id){P.id(id);const task=parse(q('SELECT * FROM tasks WHERE id=?').get(id));if(!task)P.fail('unknown_task',404);return task;}
  function sweepInternal(){
    const t=now();
    q("UPDATE tasks SET status='needs_attention',last_error='lease_expired',updated_at=? WHERE status IN ('leased','running','cancel_requested') AND (lease_until<=? OR deadline_at<=?)").run(t,t,t);
    q("UPDATE tasks SET status='failed',last_error='deadline_expired',updated_at=? WHERE status='queued' AND deadline_at<=?").run(t,t);
    q('DELETE FROM pairings WHERE expires_at<=?').run(t);
  }
  function pairCode(nodeId){q('DELETE FROM pairings WHERE node_id=?').run(nodeId);const code=P.secret(16);q('INSERT INTO pairings VALUES(?,?,?)').run(P.hash(code),nodeId,now()+P.LIMITS.pairMs);return code;}
  function createNode(spec){
    P.fields(spec,['name','capabilities','scopes']);P.text(spec.name,80);
    if(!Array.isArray(spec.capabilities)||!spec.capabilities.length||spec.capabilities.length>3||spec.capabilities.some(c=>!P.TYPES.includes(c)))P.fail('invalid_capability');
    if(!Array.isArray(spec.scopes)||!spec.scopes.length||spec.scopes.length>8)P.fail('invalid_scope');spec.scopes.forEach(P.id);
    return mutate(()=>{
      if(q('SELECT COUNT(*) AS n FROM nodes WHERE revoked=0').get().n>=P.LIMITS.nodes||q('SELECT COUNT(*) AS n FROM nodes').get().n>=100)P.fail('node_capacity',429);
      const id=randomUUID();q('INSERT INTO nodes(id,name,capabilities,scopes,created_at) VALUES(?,?,?,?,?)').run(id,spec.name,JSON.stringify([...new Set(spec.capabilities)]),JSON.stringify([...new Set(spec.scopes)]),now());
      return {...publicNode(node(id)),pairingCode:pairCode(id),expiresInSeconds:300};
    });
  }
  function pair(code){P.text(code,100);return mutate(()=>{
    const p=q('SELECT * FROM pairings WHERE code_hash=?').get(P.hash(code));if(!p||p.expires_at<=now())P.fail('invalid_pairing',401);
    const n=liveNode(p.node_id),token=P.secret();q('DELETE FROM pairings WHERE node_id=?').run(n.id);q('UPDATE nodes SET token_hash=?,last_seen=? WHERE id=?').run(P.hash(token),now(),n.id);
    return {protocolVersion:1,nodeId:n.id,token};
  });}
  function authenticate(token){if(typeof token!=='string'||token.length<40||token.length>100)P.fail('unauthorized',401);const row=q('SELECT id FROM nodes WHERE token_hash=? AND revoked=0').get(P.hash(token));if(!row)P.fail('unauthorized',401);return publicNode(liveNode(row.id));}
  function rePair(id){return mutate(()=>{const n=liveNode(id);q('UPDATE nodes SET token_hash=NULL WHERE id=?').run(id);return {nodeId:n.id,pairingCode:pairCode(id),expiresInSeconds:300};});}
  function enqueueTask(input){
    P.fields(input,['targetNodeId','scopeId','taskType','input','deadlineAt','traceId','researchSessionId']);P.id(input.targetNodeId);P.id(input.scopeId);
    if(!P.TYPES.includes(input.taskType))P.fail('unsupported_task');const encoded=P.bounded(P.object(input.input));
    if(!Number.isFinite(input.deadlineAt)||input.deadlineAt<=now()||input.deadlineAt>now()+300000)P.fail('invalid_deadline');
    return mutate(()=>{
      const n=liveNode(input.targetNodeId);if(!n.capabilities.includes(input.taskType))P.fail('capability_denied',403);if(!n.scopes.includes(input.scopeId))P.fail('scope_denied',403);
      if(q('SELECT COUNT(*) AS n FROM tasks').get().n>=P.LIMITS.tasks)P.fail('task_capacity',429);
      const id=randomUUID(),t=now();q('INSERT INTO tasks(id,node_id,scope_id,task_type,input,status,deadline_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,n.id,input.scopeId,input.taskType,encoded,'queued',input.deadlineAt,t,t);
      return {taskId:id,status:'queued'};
    });
  }
  function leaseEnvelope(task){return {protocolVersion:1,taskId:task.id,taskType:task.task_type,targetNodeId:task.node_id,scopeId:task.scope_id,input:task.input,deadlineAt:task.deadline_at,leaseId:task.lease_id,leaseUntil:task.lease_until,attempt:task.attempt};}
  function claimTask(nodeId){return mutate(()=>{
    const n=liveNode(nodeId);sweepInternal();q('UPDATE nodes SET last_seen=? WHERE id=?').run(now(),nodeId);
    if(n.paused||q("SELECT COUNT(*) AS n FROM tasks WHERE status IN ('leased','running','cancel_requested')").get().n>=P.LIMITS.activeTasks)return null;
    const row=q("SELECT * FROM tasks WHERE node_id=? AND status='queued' ORDER BY created_at,rowid LIMIT 1").get(nodeId);if(!row)return null;
    if(!n.capabilities.includes(row.task_type)||!n.scopes.includes(row.scope_id))P.fail('scope_denied',403);
    const lease=randomUUID(),t=now();q("UPDATE tasks SET status='leased',lease_id=?,lease_until=?,attempt=attempt+1,updated_at=? WHERE id=?").run(lease,Math.min(t+P.LIMITS.leaseMs,row.deadline_at),t,row.id);
    return leaseEnvelope(getTask(row.id));
  },false);}
  function owned(nodeId,body,allowCancel=false){
    liveNode(nodeId);const task=getTask(body.taskId);
    if(task.node_id!==nodeId)P.fail('task_owner_denied',403);
    if(!['leased','running',...(allowCancel?['cancel_requested']:[])].includes(task.status)||task.lease_id!==body.leaseId||task.attempt!==body.attempt||task.lease_until<=now()||task.deadline_at<=now())P.fail('invalid_lease',409);
    return task;
  }
  function renewLease(nodeId,taskId,leaseId,attempt){P.id(taskId);P.id(leaseId);return mutate(()=>{
    const task=owned(nodeId,{taskId,leaseId,attempt},true),t=now(),until=Math.min(t+P.LIMITS.leaseMs,task.deadline_at);
    q('UPDATE tasks SET status=?,lease_until=?,updated_at=? WHERE id=?').run(task.status==='cancel_requested'?'cancel_requested':'running',until,t,task.id);q('UPDATE nodes SET last_seen=? WHERE id=?').run(t,nodeId);
    return {taskId,status:task.status==='cancel_requested'?'cancel_requested':'running',leaseUntil:until};
  });}
  function record(nodeId,body,result){
    P.envelope(body);const serialized=P.bounded(body),digest=P.hash(serialized);
    return mutate(()=>{
      liveNode(nodeId);const previous=q('SELECT * FROM events WHERE node_id=? AND event_id=?').get(nodeId,body.eventId);
      if(previous){if(previous.content_hash!==digest||previous.task_id!==body.taskId)P.fail('event_conflict',409);return JSON.parse(previous.ack);}
      const task=owned(nodeId,body,!result);
      if(q('SELECT COUNT(*) AS n FROM events').get().n>=P.LIMITS.events||q('SELECT COUNT(*) AS n FROM events WHERE task_id=?').get(task.id).n>=P.LIMITS.eventsPerTask)P.fail('event_capacity',429);
      const t=now();let state=task.status;
      if(result){if(!['succeeded','failed'].includes(body.status))P.fail('invalid_result_status');P.object(body.output);state=body.status;q('UPDATE tasks SET status=?,result=?,updated_at=?,last_error=? WHERE id=?').run(state,serialized,t,state==='failed'?'node_reported_failure':null,task.id);}
      else {if(!['started','progress','cancelled'].includes(body.type))P.fail('invalid_event_type');if(body.message!==undefined)P.text(body.message,2000);if(body.type==='cancelled'){if(task.status!=='cancel_requested')P.fail('cancellation_not_requested',409);state='cancelled';}else if(task.status==='leased')state='running';q('UPDATE tasks SET status=?,updated_at=? WHERE id=?').run(state,t,task.id);}
      const ack={eventId:body.eventId,taskId:task.id,status:state,accepted:true};q('INSERT INTO events(node_id,task_id,event_id,content_hash,ack,type,message,created_at) VALUES(?,?,?,?,?,?,?,?)').run(nodeId,task.id,body.eventId,digest,JSON.stringify(ack),result?'result':body.type,body.message||null,t);q('UPDATE nodes SET last_seen=? WHERE id=?').run(t,nodeId);return ack;
    });
  }
  function cancelTask(id){return mutate(()=>{const task=getTask(id);if(task.status==='queued')q("UPDATE tasks SET status='cancelled',updated_at=? WHERE id=?").run(now(),id);else if(['leased','running'].includes(task.status))q("UPDATE tasks SET status='cancel_requested',updated_at=? WHERE id=?").run(now(),id);return getTask(id);});}
  function retryTask(id){return mutate(()=>{const task=getTask(id);liveNode(task.node_id);if(!['failed','cancelled','needs_attention'].includes(task.status)||task.attempt>=3)P.fail('retry_denied',409);q("UPDATE tasks SET status='queued',lease_id=NULL,lease_until=NULL,result=NULL,last_error=NULL,deadline_at=?,updated_at=? WHERE id=?").run(now()+120000,now(),id);return getTask(id);});}
  function revokeNode(id){return mutate(()=>{liveNode(id);q('UPDATE nodes SET revoked=1,token_hash=NULL WHERE id=?').run(id);q('DELETE FROM pairings WHERE node_id=?').run(id);q("UPDATE tasks SET status=CASE WHEN status='queued' THEN 'cancelled' ELSE 'cancel_requested' END,updated_at=? WHERE node_id=? AND status IN ('queued','leased','running')").run(now(),id);return publicNode(node(id));});}
  function setNodePaused(id,paused){return mutate(()=>{liveNode(id);q('UPDATE nodes SET paused=? WHERE id=?').run(paused?1:0,id);return publicNode(node(id));});}
  function heartbeat(nodeId,capabilities=[]){const n=liveNode(nodeId);if(!Array.isArray(capabilities)||capabilities.some(c=>!P.TYPES.includes(c)))P.fail('invalid_capability');q('UPDATE nodes SET last_seen=? WHERE id=?').run(now(),nodeId);return {...publicNode(n),lastSeen:now(),matchedCapabilities:capabilities.filter(c=>n.capabilities.includes(c))};}
  function listNodes(){return q('SELECT id FROM nodes ORDER BY created_at').all().map(row=>({...publicNode(node(row.id)),currentTask:q("SELECT id,status,task_type FROM tasks WHERE node_id=? AND status IN ('leased','running','cancel_requested') LIMIT 1").get(row.id)||null,recentError:q('SELECT last_error FROM tasks WHERE node_id=? AND last_error IS NOT NULL ORDER BY updated_at DESC LIMIT 1').get(row.id)?.last_error||null}));}
  function listTasks(offset=0){if(!Number.isInteger(offset)||offset<0||offset>1000)P.fail('invalid_offset');return q('SELECT id,node_id,scope_id,task_type,status,attempt,deadline_at,created_at,updated_at,last_error FROM tasks ORDER BY created_at DESC LIMIT 50 OFFSET ?').all(offset);}
  function nodeEvents(nodeId,cursor=0){liveNode(nodeId);if(!Number.isSafeInteger(cursor)||cursor<0)P.fail('invalid_cursor');const events=q('SELECT seq,task_id,type,message,created_at FROM events WHERE node_id=? AND seq>? ORDER BY seq LIMIT 50').all(nodeId,cursor);return {events,cursor:events.at(-1)?.seq||cursor,cancellations:q("SELECT id AS taskId,lease_id AS leaseId,attempt FROM tasks WHERE node_id=? AND status='cancel_requested' LIMIT 1").all(nodeId)};}
  function cleanup(){mutate(()=>{sweepInternal();const cutoff=now()-7*86400000;const ids=q("SELECT id FROM tasks WHERE status IN ('succeeded','failed','cancelled') AND updated_at<? LIMIT 50").all(cutoff);for(const {id} of ids){q('DELETE FROM events WHERE task_id=?').run(id);q('DELETE FROM tasks WHERE id=?').run(id);}});db.pragma('wal_checkpoint(PASSIVE)');}
  return {changes,createNode,pair,rePair,authenticate,getNode:id=>publicNode(node(id)),enqueueTask,claimTask,renewLease,appendEvent:(id,body)=>record(id,body,false),submitResult:(id,body)=>record(id,body,true),getTask,cancelTask,retryTask,revokeNode,setNodePaused,heartbeat,listNodes,listTasks,nodeEvents,sweep:()=>mutate(sweepInternal),cleanup,close:()=>{changes.removeAllListeners();db.close();}};
}
module.exports={createGatewayStore};
