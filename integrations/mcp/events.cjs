'use strict';
const fs=require('node:fs'),path=require('node:path');
const {randomBytes,randomUUID,createHash,createCipheriv,createDecipheriv,createHmac,timingSafeEqual}=require('node:crypto');
const Database=require('better-sqlite3');
const P=require('../../gateway/protocol.cjs');
const eventTableScopes=Object.freeze({subscriptions:'workspace',deliveries:'workspace',event_schema:'platform'});
function problem(reason,rpcCode){const error=new Error(reason);error.reason=reason;error.rpcCode=rpcCode;return error;}
function signingKey(secret){if(typeof secret!=='string'||!secret.startsWith('whsec_'))throw problem('invalid_signing_secret');const value=secret.slice(6),bytes=Buffer.from(value,'base64');if(bytes.length<24||bytes.length>64||bytes.toString('base64')!==value)throw problem('invalid_signing_secret');return bytes;}
function signedHeaders(secret,eventId,body,subscriptionId,now){const timestamp=String(Math.floor(now/1000));return {'Content-Type':'application/json','webhook-id':eventId,'webhook-timestamp':timestamp,'webhook-signature':'v1,'+createHmac('sha256',signingKey(secret)).update(eventId+'.'+timestamp+'.'+body).digest('base64'),'X-MCP-Subscription-Id':subscriptionId};}
function createPilotEvents({dbPath,encryptionKey,authorize,authorizeCleanup=authorize,transport,now=Date.now,multiUser=false}){
  if(typeof multiUser!=='boolean'||typeof dbPath!=='string'||!Buffer.isBuffer(encryptionKey)||encryptionKey.length!==32||typeof authorize!=='function'||typeof authorizeCleanup!=='function'||typeof transport!=='function')throw problem('invalid_events_configuration');
  if(multiUser&&dbPath!==':memory:'){
    if(!path.isAbsolute(dbPath))throw problem('event_path_denied');
    for(let current=path.resolve(dbPath);;current=path.dirname(current)){
      try{if(fs.lstatSync(current).isSymbolicLink())throw problem('event_path_denied');}catch(error){if(error.code!=='ENOENT')throw error;}
      if(path.dirname(current)===current)break;
    }
  }
  const key=Buffer.from(encryptionKey),cancellation=new AbortController();let closed=false;
  async function invokeTransport(url,options,binding){
    const signal=AbortSignal.any([cancellation.signal,options.signal]);signal.throwIfAborted();let abort;
    const stopped=new Promise((_,reject)=>{abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
    try{return await Promise.race([Promise.resolve().then(()=>{signal.throwIfAborted();return transport(url,{...options,signal},binding);}),stopped]);}
    finally{signal.removeEventListener('abort',abort);}
  }
  if(dbPath!==':memory:')fs.mkdirSync(path.dirname(dbPath),{recursive:true,mode:0o700});const db=new Database(dbPath);
  try {
    const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(row=>row.name);
    if(tables.some(name=>!['subscriptions','deliveries','event_schema'].includes(name)))throw problem('event_table_unclassified');
    const metadata=tables.includes('event_schema')?db.prepare('SELECT version,mode FROM event_schema').get():null;
    if(metadata&&(metadata.version!==1||metadata.mode!==(multiUser?'multi-user':'legacy')))throw problem('event_schema_mode_mismatch');
    if(multiUser)for(const name of ['subscriptions','deliveries'])if(tables.includes(name)){
      const columns=db.prepare(`PRAGMA table_info(${name})`).all();
      const count=columns.some(column=>column.name==='workspace_id')?db.prepare(`SELECT COUNT(*) AS n FROM ${name} WHERE workspace_id IS NULL OR workspace_id='' OR workspace_id='legacy-local'`).get().n:db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get().n;
      if(count)throw problem('event_migration_required');
    }
  }catch(error){db.close();key.fill(0);throw error;}
  if(dbPath!==':memory:'&&process.platform!=='win32')fs.chmodSync(dbPath,0o600);db.pragma('journal_mode = WAL');db.pragma('foreign_keys = ON');db.pragma('busy_timeout = 1000');db.pragma('max_page_count = 4096');
  db.exec(`CREATE TABLE IF NOT EXISTS subscriptions(id TEXT PRIMARY KEY,node_id TEXT NOT NULL,task_id TEXT NOT NULL,sealed TEXT NOT NULL,expires_at INTEGER NOT NULL,verified_at INTEGER NOT NULL,active INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY,subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,event_id TEXT NOT NULL,body TEXT NOT NULL,state TEXT NOT NULL,attempt INTEGER NOT NULL,next_at INTEGER NOT NULL,deadline_at INTEGER NOT NULL,UNIQUE(subscription_id,event_id));`);
  db.transaction(()=>{
    for(const table of ['subscriptions','deliveries'])if(!db.prepare(`PRAGMA table_info(${table})`).all().some(column=>column.name==='workspace_id'))db.exec(`ALTER TABLE ${table} ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'legacy-local'`);
    db.exec("CREATE TABLE IF NOT EXISTS event_schema(version INTEGER NOT NULL,mode TEXT NOT NULL); CREATE INDEX IF NOT EXISTS subscription_workspace ON subscriptions(workspace_id,node_id,task_id);");
    if(!db.prepare('SELECT version FROM event_schema').get())db.prepare('INSERT INTO event_schema(version,mode) VALUES(1,?)').run(multiUser?'multi-user':'legacy');
    db.exec("CREATE TRIGGER IF NOT EXISTS delivery_workspace_parent BEFORE INSERT ON deliveries WHEN NOT EXISTS(SELECT 1 FROM subscriptions WHERE id=NEW.subscription_id AND workspace_id=NEW.workspace_id) BEGIN SELECT RAISE(ABORT,'workspace_mismatch'); END; CREATE TRIGGER IF NOT EXISTS subscription_workspace_immutable BEFORE UPDATE OF workspace_id ON subscriptions WHEN NEW.workspace_id<>OLD.workspace_id BEGIN SELECT RAISE(ABORT,'workspace_mismatch'); END; CREATE TRIGGER IF NOT EXISTS delivery_workspace_immutable BEFORE UPDATE OF workspace_id ON deliveries WHEN NEW.workspace_id<>OLD.workspace_id BEGIN SELECT RAISE(ABORT,'workspace_mismatch'); END;");
  }).immediate();
  const q=sql=>db.prepare(sql),workspace=principal=>multiUser?P.id(principal.workspaceId):'legacy-local';
  function seal(value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv),data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64');}
  function open(value){try{const data=Buffer.from(value,'base64'),decipher=createDecipheriv('aes-256-gcm',key,data.subarray(0,12));decipher.setAuthTag(data.subarray(12,28));return JSON.parse(Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]).toString('utf8'));}catch{throw problem('event_state_key_mismatch');}}
  try{for(const row of q('SELECT sealed FROM subscriptions').all())open(row.sealed);}catch(e){db.close();key.fill(0);throw e;}
  function check(principal,taskId,cleanup=false){if(closed)throw problem('events_closed');P.fields(principal,multiUser?['nodeId','workspaceId']:['nodeId']);P.id(principal.nodeId);workspace(principal);if((cleanup?authorizeCleanup:authorize)(principal,taskId)!==true)throw problem('event_access_denied',-32001);}
  function identity(principal,params,needsSecret){
    check(principal,params?.arguments?.taskId,!needsSecret);P.fields(params,['name','arguments','delivery','cursor','ttlMs']);if(params.name!=='pilot.task_ready')throw problem('unsupported_event');P.fields(params.arguments,['taskId']);P.id(params.arguments.taskId);P.fields(params.delivery,needsSecret?['mode','url','secret']:['mode','url']);
    let url;try{url=new URL(params.delivery.url);}catch{throw problem('callback_url_denied');}if(params.delivery.mode!=='webhook'||url.protocol!=='https:'||url.username||url.password||url.hash||url.port&&url.port!=='443')throw problem('callback_url_denied');if(params.cursor!==undefined&&params.cursor!==null)throw problem('cursor_not_supported');
    if(needsSecret)signingKey(params.delivery.secret);return {id:'sub_'+createHash('sha256').update(P.canonical({nodeId:principal.nodeId,name:params.name,taskId:params.arguments.taskId,url:url.href,...(multiUser?{workspaceId:workspace(principal)}:{})})).digest('hex'),url:url.href};
  }
  function list(principal){check(principal);return {events:[{name:'pilot.task_ready',description:'One approved public browser task is ready; notification cannot expand permissions.',delivery:['webhook'],inputSchema:{type:'object',properties:{taskId:{type:'string'}},required:['taskId'],additionalProperties:false},payloadSchema:{type:'object',properties:{taskId:{type:'string'},taskType:{const:'browser.public_read'},deadlineAt:{type:'integer'},...(multiUser?{workspaceId:{type:'string',pattern:'^[A-Za-z0-9_-]{1,100}$'}}:{})},required:['taskId','taskType','deadlineAt',...(multiUser?['workspaceId']:[])],additionalProperties:false}}]};}
  async function subscribe(principal,params){
    const value=identity(principal,params,true),ttl=params.ttlMs===undefined?300000:params.ttlMs;if(!Number.isInteger(ttl)||ttl<1000||ttl>300000)throw problem('invalid_subscription_lifetime');
    let previous=q('SELECT * FROM subscriptions WHERE id=?').get(value.id),verified=previous&&previous.active&&previous.expires_at>now()&&now()-previous.verified_at<30000&&open(previous.sealed).secret===params.delivery.secret;
    if(!previous&&q('SELECT COUNT(*) AS n FROM subscriptions').get().n>=5)throw problem('subscription_capacity');
    if(!verified){const challenge=randomBytes(32).toString('base64url'),started=now(),eventId='verify_'+randomUUID(),body=JSON.stringify({type:'verification',challenge});let response;
      try{response=await invokeTransport(value.url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:signedHeaders(params.delivery.secret,eventId,body,value.id,now()),body},multiUser?Object.freeze({workspaceId:workspace(principal),nodeId:principal.nodeId,taskId:params.arguments.taskId}):undefined);const raw=await response.text();if(raw.length>262144||!response.ok||now()-started>=30000)throw problem('challenge_failed');const reply=JSON.parse(raw),actual=typeof reply.challenge==='string'?Buffer.from(reply.challenge):Buffer.alloc(0),expected=Buffer.from(challenge);if(actual.length!==expected.length||!timingSafeEqual(actual,expected))throw problem('challenge_failed');}catch(e){throw problem(e.reason==='callback_timeout'?'timeout':'challenge_failed',-32015);}
      check(principal,params.arguments.taskId);
    }
    const expires=now()+ttl,sealed=seal({url:value.url,secret:params.delivery.secret});db.transaction(()=>{if(!q('SELECT id FROM subscriptions WHERE id=?').get(value.id)&&q('SELECT COUNT(*) AS n FROM subscriptions').get().n>=5)throw problem('subscription_capacity');q('INSERT INTO subscriptions(id,node_id,task_id,sealed,expires_at,verified_at,workspace_id,active) VALUES(?,?,?,?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET sealed=excluded.sealed,expires_at=excluded.expires_at,verified_at=excluded.verified_at,active=1').run(value.id,principal.nodeId,params.arguments.taskId,sealed,expires,verified?previous.verified_at:now(),workspace(principal));}).immediate();
    return {id:value.id,refreshBefore:new Date(expires).toISOString(),cursor:null,truncated:false};
  }
  function unsubscribe(principal,params){const value=identity(principal,params,false);q('UPDATE subscriptions SET active=0 WHERE id=? AND node_id=?').run(value.id,principal.nodeId);q("UPDATE deliveries SET state='stopped' WHERE subscription_id=? AND state='pending'").run(value.id);return {unsubscribed:true};}
  function publish(principal,event){
    P.fields(event,['eventId','taskId','taskType','deadlineAt']);check(principal,event.taskId);P.id(event.eventId);P.id(event.taskId);if(event.taskType!=='browser.public_read'||!Number.isSafeInteger(event.deadlineAt)||event.deadlineAt<=now()||event.deadlineAt>now()+300000)throw problem('invalid_pilot_event');
    const data={taskId:event.taskId,taskType:event.taskType,deadlineAt:event.deadlineAt,...(multiUser?{workspaceId:workspace(principal)}:{})},body=JSON.stringify({eventId:event.eventId,name:'pilot.task_ready',timestamp:new Date(now()).toISOString(),data,cursor:null});
    return db.transaction(()=>{let queued=0;for(const sub of q('SELECT * FROM subscriptions WHERE workspace_id=? AND node_id=? AND task_id=? AND active=1 AND expires_at>?').all(workspace(principal),principal.nodeId,event.taskId,now())){const previous=q('SELECT body FROM deliveries WHERE subscription_id=? AND event_id=?').get(sub.id,event.eventId);if(previous){if(P.canonical(JSON.parse(previous.body).data)!==P.canonical(data))throw problem('event_conflict');continue;}if(q('SELECT COUNT(*) AS n FROM deliveries').get().n>=100)throw problem('delivery_capacity');q('INSERT INTO deliveries(id,subscription_id,event_id,body,state,attempt,next_at,deadline_at,workspace_id) VALUES(?,?,?,?,\'pending\',0,?,?,?)').run(randomUUID(),sub.id,event.eventId,body,now(),event.deadlineAt,workspace(principal));queued++;}return {queued};}).immediate();
  }
  let delivering=false;
  async function deliverDue({limit=100}={}){if(closed)throw problem('events_closed');if(!Number.isInteger(limit)||limit<1||limit>100)throw problem('invalid_delivery_limit');if(delivering)return {delivered:0};delivering=true;let delivered=0;
    try{for(const row of q("SELECT d.*,s.node_id,s.task_id,s.sealed,s.expires_at,s.active FROM deliveries d JOIN subscriptions s ON s.id=d.subscription_id WHERE d.state='pending' AND d.next_at<=? ORDER BY d.next_at LIMIT ?").all(now(),limit)){
      if(closed)return {delivered};
      const p={nodeId:row.node_id,...(multiUser?{workspaceId:row.workspace_id}:{})};let permitted=false;try{check(p,row.task_id);permitted=true;}catch{}
      if(!permitted||!row.active||row.expires_at<=now()||row.deadline_at<=now()){q("UPDATE deliveries SET state='stopped' WHERE id=?").run(row.id);continue;}
      const secret=open(row.sealed),attempt=row.attempt+1;let status=0;
      try{const response=await invokeTransport(secret.url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:signedHeaders(secret.secret,row.event_id,row.body,row.subscription_id,now()),body:row.body},multiUser?Object.freeze({workspaceId:row.workspace_id,nodeId:row.node_id,taskId:row.task_id}):undefined);status=response.status;}catch{}
      if(closed)return {delivered};
      const accepted=status>=200&&status<300,state=accepted?'delivered':attempt>=3||[410,413].includes(status)?'failed':'pending';q('UPDATE deliveries SET state=?,attempt=?,next_at=? WHERE id=?').run(state,attempt,now()+1000*2**(attempt-1),row.id);if(accepted)delivered++;
    }return {delivered};}finally{delivering=false;}
  }
  function close(){if(closed)return;closed=true;cancellation.abort(problem('events_closed'));db.close();key.fill(0);}
  function cleanup(){if(closed)throw problem('events_closed');return db.transaction(()=>({removed:q('DELETE FROM subscriptions WHERE active=0 OR expires_at<=?').run(now()).changes})).immediate();}
  function pendingTargets(){if(closed)throw problem('events_closed');return q('SELECT node_id,task_id,workspace_id FROM subscriptions WHERE active=1 AND expires_at>? ORDER BY rowid LIMIT 5').all(now()).map(row=>({nodeId:row.node_id,...(multiUser?{workspaceId:row.workspace_id}:{}),taskId:row.task_id}));}
  return {multiUser,list,subscribe,unsubscribe,publish,deliverDue,cleanup,pendingTargets,close};
}
module.exports={createPilotEvents,signedHeaders,eventTableScopes};
