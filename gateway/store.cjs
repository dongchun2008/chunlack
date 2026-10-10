'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {EventEmitter}=require('node:events');
const Database=require('better-sqlite3');
const P=require('./protocol.cjs');
const {AsyncLocalStorage}=require('node:async_hooks');
const gatewayTableScopes=Object.freeze({nodes:'workspace',pairings:'workspace',tasks:'workspace',events:'workspace',pilot_artifacts:'workspace',pilot_acceptance:'workspace',gateway_schema:'platform'});
const Pilot=require('./pilot-schema.cjs');
function createGatewayStore({dbPath,now=Date.now,multiUser=false,capacity}){
  if(typeof multiUser!=='boolean')P.fail('invalid_gateway_mode',503);
  const contexts=new AsyncLocalStorage(),proofs=new WeakMap();
  function binding(){const value=contexts.getStore();if(multiUser&&!value)P.fail('workspace_context_required',503);return value||{workspaceId:'legacy-local',userId:null};}
  function withWorkspace(value,fn){P.id(value.workspaceId);if(value.userId!==undefined&&value.userId!==null)P.id(value.userId);if(typeof fn!=='function')P.fail('invalid_context');return contexts.run(Object.freeze({workspaceId:value.workspaceId,userId:value.userId||null}),fn);}
  if(multiUser){if(dbPath!==':memory:'&&!path.isAbsolute(dbPath))P.fail('invalid_database_path',503);let current=path.parse(path.resolve(dbPath)).root;for(const part of path.resolve(dbPath).slice(current.length).split(path.sep).filter(Boolean)){current=path.join(current,part);try{if(fs.lstatSync(current).isSymbolicLink())P.fail('unsafe_gateway_path',503);}catch(e){if(e.code!=='ENOENT')throw e;}}}

  if(dbPath!==':memory:')fs.mkdirSync(path.dirname(dbPath),{recursive:true});
  const db=new Database(dbPath);
  if(dbPath!==':memory:'&&process.platform!=='win32')fs.chmodSync(dbPath,0o600);
  try{
    const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(row=>row.name));
    if([...tables].some(name=>!Object.hasOwn(gatewayTableScopes,name)))P.fail('unclassified_gateway_table',503);
    const meta=tables.has('gateway_schema')?db.prepare('SELECT version,mode FROM gateway_schema').get():null;
    if(meta&&(meta.version!==1||(!multiUser&&meta.mode==='multi-user')))P.fail('gateway_mode_mismatch',503);
    if(multiUser)for(const name of ['nodes','tasks','pairings','events','pilot_artifacts','pilot_acceptance'])if(tables.has(name)){
      const columns=new Set(db.prepare('PRAGMA table_info('+name+')').all().map(row=>row.name));
      const unassigned=columns.has('workspace_id')?db.prepare("SELECT COUNT(*) AS n FROM "+name+" WHERE workspace_id IS NULL OR workspace_id IN ('','legacy-local')").get().n:db.prepare('SELECT COUNT(*) AS n FROM '+name).get().n;
      if(unassigned)P.fail('gateway_migration_required',503);
    }
  }catch(error){db.close();throw error;}
  db.pragma('journal_mode = WAL');db.pragma('busy_timeout = 1000');db.pragma('foreign_keys = ON');db.pragma('max_page_count = 16384');
  db.exec(`CREATE TABLE IF NOT EXISTS nodes(id TEXT PRIMARY KEY,name TEXT NOT NULL,capabilities TEXT NOT NULL,scopes TEXT NOT NULL,token_hash TEXT UNIQUE,paused INTEGER NOT NULL DEFAULT 0,revoked INTEGER NOT NULL DEFAULT 0,last_seen INTEGER,created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS pairings(code_hash TEXT PRIMARY KEY,node_id TEXT NOT NULL REFERENCES nodes(id),expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,node_id TEXT NOT NULL REFERENCES nodes(id),scope_id TEXT NOT NULL,task_type TEXT NOT NULL,input TEXT NOT NULL,status TEXT NOT NULL,lease_id TEXT,lease_until INTEGER,attempt INTEGER NOT NULL DEFAULT 0,deadline_at INTEGER NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,result TEXT,last_error TEXT);
    CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,node_id TEXT NOT NULL REFERENCES nodes(id),task_id TEXT NOT NULL REFERENCES tasks(id),event_id TEXT NOT NULL,content_hash TEXT NOT NULL,ack TEXT NOT NULL,type TEXT NOT NULL,message TEXT,created_at INTEGER NOT NULL,UNIQUE(node_id,event_id));
    CREATE INDEX IF NOT EXISTS tasks_node_status ON tasks(node_id,status,created_at);
    CREATE INDEX IF NOT EXISTS tasks_expiry ON tasks(status,lease_until,deadline_at);
    CREATE INDEX IF NOT EXISTS events_task ON events(task_id);
    CREATE INDEX IF NOT EXISTS events_node_seq ON events(node_id,seq);
    CREATE TABLE IF NOT EXISTS pilot_artifacts(id TEXT PRIMARY KEY,node_id TEXT NOT NULL REFERENCES nodes(id),task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,event_id TEXT NOT NULL,sha256 TEXT NOT NULL,size_bytes INTEGER NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,content_type TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(node_id,event_id));
    CREATE TABLE IF NOT EXISTS pilot_acceptance(task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,state TEXT NOT NULL,artifact_id TEXT,accepted_at INTEGER);`);
  db.transaction(()=>{
    const columns=new Set(db.prepare('PRAGMA table_info(tasks)').all().map(column=>column.name));
    if(!columns.has('trace_id'))db.exec('ALTER TABLE tasks ADD COLUMN trace_id TEXT');
    if(!columns.has('research_session_id'))db.exec('ALTER TABLE tasks ADD COLUMN research_session_id TEXT');
    const update=db.prepare('UPDATE tasks SET trace_id=? WHERE id=?');
    for(const task of db.prepare('SELECT id FROM tasks WHERE trace_id IS NULL').all())update.run(randomUUID(),task.id);
  }).immediate();
  db.transaction(()=>{
    for(const name of ['nodes','tasks','pairings','events','pilot_artifacts','pilot_acceptance'])if(!db.prepare('PRAGMA table_info('+name+')').all().some(row=>row.name==='workspace_id'))db.exec("ALTER TABLE "+name+" ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'legacy-local'");
    for(const name of ['nodes','tasks'])if(!db.prepare('PRAGMA table_info('+name+')').all().some(row=>row.name==='created_by'))db.exec('ALTER TABLE '+name+' ADD COLUMN created_by TEXT');
    db.exec('CREATE TABLE IF NOT EXISTS gateway_schema(version INTEGER NOT NULL,mode TEXT NOT NULL)');
    db.prepare('DELETE FROM gateway_schema').run();db.prepare('INSERT INTO gateway_schema(version,mode) VALUES(1,?)').run(multiUser?'multi-user':'legacy-local');
    for(const [child,parent,foreign] of [['pairings','nodes','node_id'],['tasks','nodes','node_id'],['events','tasks','task_id'],['pilot_artifacts','tasks','task_id'],['pilot_acceptance','tasks','task_id']]){
      db.exec('CREATE TRIGGER IF NOT EXISTS '+child+'_workspace_insert BEFORE INSERT ON '+child+' WHEN NEW.workspace_id<>(SELECT workspace_id FROM '+parent+' WHERE id=NEW.'+foreign+") BEGIN SELECT RAISE(ABORT,'workspace_foreign_key'); END");
    }
    for(const name of ['nodes','tasks','pairings','events','pilot_artifacts','pilot_acceptance'])db.exec('CREATE TRIGGER IF NOT EXISTS '+name+"_workspace_immutable BEFORE UPDATE OF workspace_id ON "+name+" WHEN NEW.workspace_id<>OLD.workspace_id BEGIN SELECT RAISE(ABORT,'workspace_immutable'); END");
    db.exec('CREATE INDEX IF NOT EXISTS nodes_workspace ON nodes(workspace_id,id);CREATE INDEX IF NOT EXISTS tasks_workspace ON tasks(workspace_id,created_at);CREATE INDEX IF NOT EXISTS artifacts_workspace ON pilot_artifacts(workspace_id,id)');
  }).immediate();
  const changes=new EventEmitter();changes.setMaxListeners(40);let artifactReader=null;
  const q=sql=>db.prepare(sql), parse=row=>row?{...row,...(multiUser?{workspaceId:row.workspace_id,createdBy:row.created_by}:{}),input:JSON.parse(row.input),result:row.result?JSON.parse(row.result):null}:null;
  const mutate=(fn,notify=true)=>{const result=db.transaction(fn).immediate();if(notify)changes.emit('change');return result;};
  function node(id){P.id(id);const scope=binding();const row=q(multiUser?'SELECT * FROM nodes WHERE id=? AND workspace_id=?':'SELECT * FROM nodes WHERE id=?').get(...(multiUser?[id,scope.workspaceId]:[id]));if(!row)P.fail('unknown_node',404);return {...row,capabilities:JSON.parse(row.capabilities),scopes:JSON.parse(row.scopes)};}
  function publicNode(row){return {id:row.id,...(multiUser?{workspaceId:row.workspace_id,createdBy:row.created_by}:{}),name:row.name,capabilities:row.capabilities,scopes:row.scopes,paused:!!row.paused,revoked:!!row.revoked,lastSeen:row.last_seen,createdAt:row.created_at};}
  function liveNode(id){const row=node(id);if(row.revoked)P.fail('node_revoked',401);return row;}
  function getTask(id){P.id(id);const scope=binding();const task=parse(q(multiUser?'SELECT * FROM tasks WHERE id=? AND workspace_id=?':'SELECT * FROM tasks WHERE id=?').get(...(multiUser?[id,scope.workspaceId]:[id])));if(!task)P.fail('unknown_task',404);return task;}
  function sweepInternal(){
    const t=now();
    q("UPDATE tasks SET status='needs_attention',last_error='lease_expired',updated_at=? WHERE status IN ('leased','running','cancel_requested') AND (lease_until<=? OR deadline_at<=?)").run(t,t,t);
    q("UPDATE tasks SET status='failed',last_error='deadline_expired',updated_at=? WHERE status='queued' AND deadline_at<=?").run(t,t);
    q('DELETE FROM pairings WHERE expires_at<=?').run(t);
  }
  function pairCode(nodeId){q('DELETE FROM pairings WHERE node_id=?').run(nodeId);const code=P.secret(16);q('INSERT INTO pairings(code_hash,node_id,expires_at,workspace_id) VALUES(?,?,?,?)').run(P.hash(code),nodeId,now()+P.LIMITS.pairMs,binding().workspaceId);return code;}
  function createNode(spec){
    const scope=binding();if(multiUser&&!scope.userId)P.fail('creator_required',503);
    P.fields(spec,['name','capabilities','scopes']);P.text(spec.name,80);
    if(!Array.isArray(spec.capabilities)||!spec.capabilities.length||spec.capabilities.length>P.TYPES.length||spec.capabilities.some(c=>!P.TYPES.includes(c)))P.fail('invalid_capability');
    if(!Array.isArray(spec.scopes)||!spec.scopes.length||spec.scopes.length>8)P.fail('invalid_scope');spec.scopes.forEach(P.id);
    return mutate(()=>{
      if(q('SELECT COUNT(*) AS n FROM nodes WHERE revoked=0').get().n>=P.LIMITS.nodes||q('SELECT COUNT(*) AS n FROM nodes').get().n>=100)P.fail('node_capacity',429);
      const id=randomUUID();q('INSERT INTO nodes(id,name,capabilities,scopes,created_at,workspace_id,created_by) VALUES(?,?,?,?,?,?,?)').run(id,spec.name,JSON.stringify([...new Set(spec.capabilities)]),JSON.stringify([...new Set(spec.scopes)]),now(),scope.workspaceId,scope.userId);
      return {...publicNode(node(id)),pairingCode:pairCode(id),expiresInSeconds:300};
    });
  }
  function pair(code,{workspaceId,authorize}={}){P.text(code,100);if(workspaceId!==undefined)P.id(workspaceId);if(authorize!==undefined&&typeof authorize!=='function')P.fail('invalid_pairing_binding');return mutate(()=>{
    const p=q('SELECT * FROM pairings WHERE code_hash=?').get(P.hash(code));if(!p||p.expires_at<=now())P.fail('invalid_pairing',401);
    if(workspaceId!==undefined&&p.workspace_id!==workspaceId)P.fail('workspace_mismatch',403);
    return withWorkspace({workspaceId:p.workspace_id},()=>{const n=liveNode(p.node_id);if(authorize)authorize(publicNode(n));const token=P.secret();q('DELETE FROM pairings WHERE node_id=?').run(n.id);q('UPDATE nodes SET token_hash=?,last_seen=? WHERE id=?').run(P.hash(token),now(),n.id);
    return {protocolVersion:1,nodeId:n.id,...(multiUser?{workspaceId:n.workspace_id}:{}),token};});
  });}
  function authenticate(token){if(typeof token!=='string'||token.length<40||token.length>100)P.fail('unauthorized',401);const digest=P.hash(token),row=q('SELECT id,workspace_id FROM nodes WHERE token_hash=? AND revoked=0').get(digest);if(!row)P.fail('unauthorized',401);return withWorkspace({workspaceId:row.workspace_id},()=>{const result=Object.freeze(publicNode(liveNode(row.id)));proofs.set(result,{digest,workspaceId:row.workspace_id});return result;});}
  function assertAuthenticatedNode(value){const proof=value&&proofs.get(value);if(!proof)P.fail('unauthorized',401);const row=q('SELECT token_hash,workspace_id,revoked FROM nodes WHERE id=?').get(value.id);if(!row||row.revoked||row.token_hash!==proof.digest||row.workspace_id!==proof.workspaceId)P.fail('unauthorized',401);return withWorkspace({workspaceId:row.workspace_id},()=>publicNode(liveNode(value.id)));}
  function rePair(id){if(multiUser)return mutate(()=>{
    const old=liveNode(id),scope=binding();if(!scope.userId)P.fail('creator_required',503);
    if(q('SELECT COUNT(*) AS n FROM nodes').get().n>=100)P.fail('node_capacity',429);
    q('UPDATE nodes SET revoked=1,token_hash=NULL WHERE id=?').run(id);q('DELETE FROM pairings WHERE node_id=?').run(id);
    q("UPDATE tasks SET status=CASE WHEN status='queued' THEN 'cancelled' ELSE 'cancel_requested' END,updated_at=? WHERE node_id=? AND status IN ('queued','leased','running')").run(now(),id);
    const fresh=randomUUID();q('INSERT INTO nodes(id,name,capabilities,scopes,created_at,workspace_id,created_by) VALUES(?,?,?,?,?,?,?)').run(fresh,old.name,JSON.stringify(old.capabilities),JSON.stringify(old.scopes),now(),scope.workspaceId,scope.userId);
    return {nodeId:fresh,workspaceId:scope.workspaceId,pairingCode:pairCode(fresh),expiresInSeconds:300};
  });return mutate(()=>{const n=liveNode(id);q('UPDATE nodes SET token_hash=NULL WHERE id=?').run(id);return {nodeId:n.id,pairingCode:pairCode(id),expiresInSeconds:300};});}
  function enqueueTask(input){
    const scope=binding();if(multiUser&&!scope.userId)P.fail('creator_required',503);
    P.fields(input,['targetNodeId','scopeId','taskType','input','deadlineAt','traceId','researchSessionId']);P.id(input.targetNodeId);P.id(input.scopeId);
    if(!P.TYPES.includes(input.taskType))P.fail('unsupported_task');const encoded=P.bounded(P.object(input.input));
    if(input.taskType===Pilot.TYPE){if(input.scopeId!=='public')P.fail('pilot_scope_denied',403);Pilot.validatePilotInput(input.input);}
    if(input.traceId!==undefined)P.id(input.traceId);if(input.researchSessionId!==undefined)P.id(input.researchSessionId);
    if(!Number.isFinite(input.deadlineAt)||input.deadlineAt<=now()||input.deadlineAt>now()+300000)P.fail('invalid_deadline');
    return mutate(()=>{
      const n=liveNode(input.targetNodeId);if(!n.capabilities.includes(input.taskType))P.fail('capability_denied',403);if(!n.scopes.includes(input.scopeId))P.fail('scope_denied',403);
      coordinator?.assertCanQueue(scope.workspaceId);
      if(q('SELECT COUNT(*) AS n FROM tasks').get().n>=P.LIMITS.tasks)P.fail('task_capacity',429);
      if(q('SELECT COUNT(*) AS n FROM events').get().n+eventReservations()+3>P.LIMITS.events)P.fail('event_capacity',429);
      const id=randomUUID(),t=now(),traceId=input.traceId||randomUUID();q('INSERT INTO tasks(id,node_id,scope_id,task_type,input,status,deadline_at,created_at,updated_at,trace_id,research_session_id,workspace_id,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,n.id,input.scopeId,input.taskType,encoded,'queued',input.deadlineAt,t,t,traceId,input.researchSessionId??null,scope.workspaceId,scope.userId);
      if(input.taskType===Pilot.TYPE)q("INSERT INTO pilot_acceptance(task_id,state,workspace_id) VALUES(?,'received',?)").run(id,scope.workspaceId);
      return {taskId:id,...(multiUser?{workspaceId:scope.workspaceId}:{}),status:'queued',traceId,researchSessionId:input.researchSessionId??null};
    });
  }
  function eventReservations(){return q("SELECT COALESCE(SUM(MAX(0,CASE WHEN status IN ('leased','running','cancel_requested') THEN 4-attempt ELSE 3-attempt END)),0) AS n FROM tasks").get().n;}
  function leaseEnvelope(task){return {protocolVersion:1,...(multiUser?{workspaceId:task.workspace_id}:{}),taskId:task.id,taskType:task.task_type,targetNodeId:task.node_id,scopeId:task.scope_id,input:task.input,deadlineAt:task.deadline_at,leaseId:task.lease_id,leaseUntil:task.lease_until,attempt:task.attempt,traceId:task.trace_id,researchSessionId:task.research_session_id};}
  function claimTask(nodeId,pilotTaskId){let acquired=null,committed=false;try{const result=mutate(()=>{
    const n=liveNode(nodeId);sweepInternal();q('UPDATE nodes SET last_seen=? WHERE id=?').run(now(),nodeId);
    if(pilotTaskId!==undefined)authorizePilotTask(nodeId,pilotTaskId);
    if(n.paused)return null;
    const row=pilotTaskId===undefined?q("SELECT * FROM tasks WHERE node_id=? AND status='queued' ORDER BY created_at,rowid LIMIT 1").get(nodeId):q("SELECT * FROM tasks WHERE node_id=? AND id=? AND status='queued'").get(nodeId,pilotTaskId);if(!row)return null;
    if(!n.capabilities.includes(row.task_type)||!n.scopes.includes(row.scope_id))P.fail('scope_denied',403);
    const lease=randomUUID(),t=now(),until=Math.min(t+P.LIMITS.leaseMs,row.deadline_at),candidate={workspaceId:row.workspace_id,taskId:row.id,leaseId:lease,leaseExpiresAt:until,status:'leased'};
    if(coordinator&&!coordinator.claimExternal(candidate))return null;
    if(coordinator)acquired=candidate;
    if(q("SELECT COUNT(*) AS n FROM tasks WHERE status IN ('leased','running','cancel_requested')").get().n>=P.LIMITS.activeTasks){if(acquired){coordinator.releaseExternal(acquired.taskId,acquired.leaseId,{confirmed:true});acquired=null;}return null;}
    q("UPDATE tasks SET status='leased',lease_id=?,lease_until=?,attempt=attempt+1,updated_at=? WHERE id=?").run(lease,until,t,row.id);
    return leaseEnvelope(getTask(row.id));
  },false);committed=true;if(acquired)coordinator.refresh();return result;}catch(error){if(acquired&&!committed)coordinator.releaseExternal(acquired.taskId,acquired.leaseId,{confirmed:true});throw error;}}
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
    if(body?.workspaceId!==undefined&&body.workspaceId!==binding().workspaceId)P.fail('workspace_mismatch',403);
    P.envelope(body);const serialized=P.bounded(body),digest=P.hash(serialized);
    return mutate(()=>{
      liveNode(nodeId);const previous=q('SELECT * FROM events WHERE node_id=? AND event_id=?').get(nodeId,body.eventId);
      if(previous){if(previous.content_hash!==digest||previous.task_id!==body.taskId)P.fail('event_conflict',409);return JSON.parse(previous.ack);}
      const task=owned(nodeId,body,!result);
      if(result&&body.status==='succeeded'&&task.task_type===Pilot.TYPE){
        const output=Pilot.validatePilotOutput(body.output,task.input);verifyArtifact(nodeId,task.id,output.artifactId);
        q("UPDATE pilot_acceptance SET state='evidence_checked',artifact_id=?,accepted_at=NULL WHERE task_id=?").run(output.artifactId,task.id);
      }
      const totalEvents=q('SELECT COUNT(*) AS n FROM events').get().n,taskEvents=q('SELECT COUNT(*) AS n FROM events WHERE task_id=?').get(task.id).n;
      const terminal=result||body.type==='cancelled';
      // Reserve one terminal acknowledgement per remaining allowed attempt.
      // Terminal recording consumes a reservation; progress cannot consume it.
      if(totalEvents>=P.LIMITS.events||taskEvents>=P.LIMITS.eventsPerTask||(!terminal&&(totalEvents+1+eventReservations()>P.LIMITS.events||taskEvents+1+(4-task.attempt)>P.LIMITS.eventsPerTask)))P.fail('event_capacity',429);
      const t=now();let state=task.status;
      if(result){if(!['succeeded','failed'].includes(body.status))P.fail('invalid_result_status');P.object(body.output);state=body.status;q('UPDATE tasks SET status=?,result=?,updated_at=?,last_error=? WHERE id=?').run(state,serialized,t,state==='failed'?'node_reported_failure':null,task.id);}
      else {if(!['started','progress','cancelled'].includes(body.type))P.fail('invalid_event_type');if(body.message!==undefined)P.text(body.message,2000);if(body.type==='cancelled'){if(task.status!=='cancel_requested')P.fail('cancellation_not_requested',409);state='cancelled';}else if(task.status==='leased')state='running';q('UPDATE tasks SET status=?,updated_at=? WHERE id=?').run(state,t,task.id);}
      const ack={...(multiUser?{workspaceId:binding().workspaceId}:{}),eventId:body.eventId,taskId:task.id,status:state,accepted:true};q('INSERT INTO events(node_id,task_id,event_id,content_hash,ack,type,message,created_at,workspace_id) VALUES(?,?,?,?,?,?,?,?,?)').run(nodeId,task.id,body.eventId,digest,JSON.stringify(ack),result?'result':body.type,body.message||null,t,binding().workspaceId);q('UPDATE nodes SET last_seen=? WHERE id=?').run(t,nodeId);return ack;
    });
  }
  function cancelTask(id){return mutate(()=>{const task=getTask(id);if(task.status==='queued')q("UPDATE tasks SET status='cancelled',updated_at=? WHERE id=?").run(now(),id);else if(['leased','running'].includes(task.status))q("UPDATE tasks SET status='cancel_requested',updated_at=? WHERE id=?").run(now(),id);return getTask(id);});}
  function retryTask(id){return mutate(()=>{const task=getTask(id);liveNode(task.node_id);if(task.task_type===Pilot.TYPE)P.fail('pilot_retry_denied',409);if(!['failed','cancelled','needs_attention'].includes(task.status)||task.attempt>=3)P.fail('retry_denied',409);coordinator?.assertCanQueue(task.workspace_id);q("UPDATE tasks SET status='queued',lease_id=NULL,lease_until=NULL,result=NULL,last_error=NULL,deadline_at=?,updated_at=? WHERE id=?").run(now()+120000,now(),id);return getTask(id);});}
  function revokeNode(id){return mutate(()=>{liveNode(id);q('UPDATE nodes SET revoked=1,token_hash=NULL WHERE id=?').run(id);q('DELETE FROM pairings WHERE node_id=?').run(id);q("UPDATE tasks SET status=CASE WHEN status='queued' THEN 'cancelled' ELSE 'cancel_requested' END,updated_at=? WHERE node_id=? AND status IN ('queued','leased','running')").run(now(),id);return publicNode(node(id));});}
  function setNodePaused(id,paused){return mutate(()=>{liveNode(id);q('UPDATE nodes SET paused=? WHERE id=?').run(paused?1:0,id);return publicNode(node(id));});}
  function heartbeat(nodeId,capabilities=[]){const n=liveNode(nodeId);if(!Array.isArray(capabilities)||capabilities.some(c=>!P.TYPES.includes(c)))P.fail('invalid_capability');q('UPDATE nodes SET last_seen=? WHERE id=?').run(now(),nodeId);return {...publicNode(n),lastSeen:now(),matchedCapabilities:capabilities.filter(c=>n.capabilities.includes(c))};}
  function listNodes(){const scope=binding();return q(multiUser?'SELECT id FROM nodes WHERE workspace_id=? ORDER BY created_at':'SELECT id FROM nodes ORDER BY created_at').all(...(multiUser?[scope.workspaceId]:[])).map(row=>({...publicNode(node(row.id)),currentTask:q("SELECT id,status,task_type FROM tasks WHERE node_id=? AND status IN ('leased','running','cancel_requested') LIMIT 1").get(row.id)||null,recentError:q('SELECT last_error FROM tasks WHERE node_id=? AND last_error IS NOT NULL ORDER BY updated_at DESC LIMIT 1').get(row.id)?.last_error||null}));}
  function listTasks(offset=0){if(!Number.isInteger(offset)||offset<0||offset>1000)P.fail('invalid_offset');const scope=binding();return q('SELECT id,node_id,scope_id,task_type,status,attempt,deadline_at,created_at,updated_at,last_error,trace_id,research_session_id,workspace_id,created_by FROM tasks '+(multiUser?'WHERE workspace_id=? ':'')+'ORDER BY created_at DESC LIMIT 50 OFFSET ?').all(...(multiUser?[scope.workspaceId,offset]:[offset])).map(row=>({...row,...(multiUser?{workspaceId:row.workspace_id,createdBy:row.created_by}:{})}));}
  function nodeEvents(nodeId,cursor=0){liveNode(nodeId);if(!Number.isSafeInteger(cursor)||cursor<0)P.fail('invalid_cursor');const events=q('SELECT seq,task_id,type,message,created_at FROM events WHERE node_id=? AND seq>? ORDER BY seq LIMIT 50').all(nodeId,cursor);return {events,cursor:events.at(-1)?.seq||cursor,cancellations:q("SELECT id AS taskId,lease_id AS leaseId,attempt FROM tasks WHERE node_id=? AND status='cancel_requested' LIMIT 1").all(nodeId)};}
  function cleanup(){mutate(()=>{sweepInternal();const cutoff=now()-7*86400000;const ids=q("SELECT id FROM tasks WHERE status IN ('succeeded','failed','cancelled') AND updated_at<? AND NOT EXISTS (SELECT 1 FROM pilot_artifacts WHERE task_id=tasks.id) LIMIT 50").all(cutoff);for(const {id} of ids){q('DELETE FROM events WHERE task_id=?').run(id);q('DELETE FROM tasks WHERE id=?').run(id);}});db.pragma('wal_checkpoint(PASSIVE)');}
  function assertPilotLease(nodeId,lease){
    P.id(lease.taskId);P.id(lease.leaseId);if(!Number.isInteger(lease.attempt))P.fail('invalid_attempt');
    const task=owned(nodeId,lease);if(task.task_type!==Pilot.TYPE||task.scope_id!=='public')P.fail('pilot_task_required',403);return task;
  }
  function authorizePilotTask(nodeId,taskId){const n=liveNode(nodeId),task=getTask(taskId);if(task.node_id!==nodeId||task.task_type!==Pilot.TYPE||task.scope_id!=='public'||!n.scopes.includes('public')||!n.capabilities.includes(Pilot.TYPE))P.fail('pilot_task_owner_denied',403);return task;}
  function publicArtifact(row){return row?{artifactId:row.id,...(multiUser?{workspaceId:row.workspace_id}:{}),nodeId:row.node_id,taskId:row.task_id,eventId:row.event_id,sha256:row.sha256,sizeBytes:row.size_bytes,width:row.width,height:row.height,contentType:row.content_type,createdAt:row.created_at}:null;}
  function listPilotArtifacts(){const scope=binding();return q(multiUser?'SELECT * FROM pilot_artifacts WHERE workspace_id=?':'SELECT * FROM pilot_artifacts').all(...(multiUser?[scope.workspaceId]:[])).map(publicArtifact);}
  function listArtifactsForMaintenance(){return q('SELECT * FROM pilot_artifacts').all().map(publicArtifact);}
  function getPilotArtifact(id){P.id(id);const scope=binding();return publicArtifact(q(multiUser?'SELECT * FROM pilot_artifacts WHERE id=? AND workspace_id=?':'SELECT * FROM pilot_artifacts WHERE id=?').get(...(multiUser?[id,scope.workspaceId]:[id])));}
  function findPilotArtifact(nodeId,eventId){liveNode(nodeId);return publicArtifact(q('SELECT * FROM pilot_artifacts WHERE node_id=? AND event_id=?').get(nodeId,eventId));}
  function savePilotArtifact(nodeId,lease,meta){return mutate(()=>{
    assertPilotLease(nodeId,lease);
    if(q('SELECT id FROM pilot_artifacts WHERE task_id=?').get(lease.taskId))P.fail('artifact_already_exists',409);
    if(q('SELECT COALESCE(SUM(size_bytes),0) AS bytes FROM pilot_artifacts').get().bytes+meta.sizeBytes>20*1024*1024)P.fail('artifact_capacity',429);
    q('INSERT INTO pilot_artifacts(id,node_id,task_id,event_id,sha256,size_bytes,width,height,content_type,created_at,workspace_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(meta.artifactId,nodeId,lease.taskId,meta.eventId,meta.sha256,meta.sizeBytes,meta.width,meta.height,meta.contentType,now(),binding().workspaceId);return getPilotArtifact(meta.artifactId);
  },false);}
  function authorizePilotArtifact(nodeId,taskId,artifactId){
    const n=liveNode(nodeId),task=getTask(taskId),meta=getPilotArtifact(artifactId);
    if(task.node_id!==nodeId||task.task_type!==Pilot.TYPE||!n.scopes.includes(task.scope_id)||!n.capabilities.includes(Pilot.TYPE))P.fail('artifact_owner_denied',403);
    if(!meta||meta.nodeId!==nodeId||meta.taskId!==taskId||meta.createdAt<now()-7*86400000)P.fail('artifact_unavailable',409);return meta;
  }
  function expiredPilotArtifacts(){return listArtifactsForMaintenance().filter(a=>a.createdAt<now()-7*86400000&&!['leased','running','cancel_requested'].includes(q('SELECT status FROM tasks WHERE id=?').get(a.taskId)?.status));}
  function forgetPilotArtifact(artifactId){return mutate(()=>{if(multiUser&&!getPilotArtifact(artifactId))P.fail('artifact_unavailable',409);q('DELETE FROM pilot_artifacts WHERE id=?').run(artifactId);q("UPDATE pilot_acceptance SET state='received',artifact_id=NULL,accepted_at=NULL WHERE artifact_id=?").run(artifactId);},false);}
  function registerPilotArtifactReader(reader){if(typeof reader!=='function')P.fail('invalid_artifact_reader');artifactReader=reader;}
  function verifyArtifact(nodeId,taskId,id){authorizePilotArtifact(nodeId,taskId,id);if(!artifactReader)P.fail('artifact_service_unavailable',503);artifactReader(nodeId,taskId,id);}
  function getPilotAcceptance(taskId){const task=getTask(taskId);if(task.task_type!==Pilot.TYPE)P.fail('pilot_task_required');const row=q('SELECT * FROM pilot_acceptance WHERE task_id=?').get(taskId);return {state:row.state,artifactId:row.artifact_id,acceptedAt:row.accepted_at};}
  function acceptPilotTask(taskId){return mutate(()=>{const task=getTask(taskId),state=getPilotAcceptance(taskId);if(task.status!=='succeeded'||!['evidence_checked','accepted'].includes(state.state))P.fail('pilot_acceptance_denied',409);verifyArtifact(task.node_id,taskId,state.artifactId);q("UPDATE pilot_acceptance SET state='accepted',accepted_at=COALESCE(accepted_at,?) WHERE task_id=?").run(now(),taskId);return getPilotAcceptance(taskId);},false);}
  function capacitySnapshot(){
    db.transaction(sweepInternal).immediate();
    return {active:q("SELECT workspace_id AS workspaceId,id AS taskId,lease_id AS leaseId,lease_until AS leaseExpiresAt,status FROM tasks WHERE status IN ('leased','running','cancel_requested') ORDER BY created_at,rowid").all(),queued:q("SELECT workspace_id AS workspaceId,id AS taskId,deadline_at AS deadlineAt,created_at AS createdAt FROM tasks WHERE status='queued' ORDER BY created_at,rowid").all()};
  }
  const ownsCapacity=multiUser&&!capacity,coordinator=capacity||(multiUser?require('../collaboration/capacity.cjs').createCapacityCoordinator({now}):null);
  let detachCapacity,detachAvailable,closed=false;
  try{if(coordinator){detachCapacity=coordinator.bindLeaseSource(capacitySnapshot);detachAvailable=coordinator.onAvailable(()=>{if(!closed)changes.emit('change');});changes.on('change',()=>coordinator.refresh());}}
  catch(error){detachCapacity?.();detachAvailable?.();if(ownsCapacity)coordinator.close();db.close();throw error;}
  return {multiUser,capacity:coordinator,capacitySnapshot,withWorkspace,currentBinding:binding,assertAuthenticatedNode,listArtifactsForMaintenance,changes,createNode,pair,rePair,authenticate,getNode:id=>publicNode(node(id)),enqueueTask,claimTask,claimPilotTask:(nodeId,taskId)=>{P.id(taskId);return claimTask(nodeId,taskId);},authorizePilotTask,renewLease,appendEvent:(id,body)=>record(id,body,false),submitResult:(id,body)=>record(id,body,true),getTask,cancelTask,retryTask,revokeNode,setNodePaused,heartbeat,listNodes,listTasks,nodeEvents,sweep:()=>mutate(sweepInternal),cleanup,assertPilotLease,listPilotArtifacts,getPilotArtifact,findPilotArtifact,savePilotArtifact,authorizePilotArtifact,expiredPilotArtifacts,forgetPilotArtifact,registerPilotArtifactReader,getPilotAcceptance,acceptPilotTask,close:()=>{if(closed)return;closed=true;detachCapacity?.();detachAvailable?.();changes.removeAllListeners();if(ownsCapacity)coordinator.close();db.close();}};
}
module.exports={createGatewayStore,gatewayTableScopes};
