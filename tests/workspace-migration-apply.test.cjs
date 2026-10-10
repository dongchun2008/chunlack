'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createHash,randomUUID}=require('node:crypto');
const Database=require('better-sqlite3');
const {createIdentityStore}=require('../identity/store.cjs');
const {hashPassword}=require('../identity/passwords.cjs');
const {createGatewayStore}=require('../gateway/store.cjs');
const {createCollaborationStore}=require('../collaboration/store.cjs');
const {runWithWorkspace}=require('../collaboration/context.cjs');
const {planMigration,applyMigration,verifyMigration}=require('../scripts/migrate-workspaces.cjs');
const {prepareWorkspaceSnapshot}=require('../scripts/workspace-snapshot.cjs');
const {validateMigration}=require('../gateway/public-runtime.cjs');
const {spawnSync}=require('node:child_process');
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
let passwordHash;
async function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'lack-migration-apply-'));
  const sourceRoot=path.join(root,'source'),targetRoot=path.join(root,'candidate'),snapshotRoot=path.join(root,'snapshot');
  fs.mkdirSync(path.join(sourceRoot,'db'),{recursive:true,mode:0o700});fs.mkdirSync(path.join(sourceRoot,'config'),{mode:0o700});
  fs.mkdirSync(path.join(sourceRoot,'memory'),{mode:0o700});fs.mkdirSync(path.join(sourceRoot,'attachments'),{mode:0o700});
  fs.writeFileSync(path.join(sourceRoot,'config','lack.config.json'),JSON.stringify({llmProvider:'ollama',defaultModel:'private-quant',apiKey:'synthetic-secret-never-print',agents:[],llmProviders:[{id:'ollama',local:true}]}));
  fs.writeFileSync(path.join(sourceRoot,'memory','agent.json'),JSON.stringify({sourceUrl:'https://example.com/original',summary:'original evidence'}));
  fs.writeFileSync(path.join(sourceRoot,'attachments','original.bin'),Buffer.from([0,2,255]));
  const dbPath=path.join(sourceRoot,'db','lack.db'),db=new Database(dbPath);
  db.pragma('journal_mode=WAL');db.pragma('wal_autocheckpoint=0');
  db.exec(`CREATE TABLE agents(id TEXT PRIMARY KEY,name TEXT,model TEXT,provider TEXT,system_prompt TEXT,channels TEXT,strict_channel TEXT,status TEXT,is_embed_operator INTEGER,is_code_moderator INTEGER);
  INSERT INTO agents VALUES('agent','Legacy Agent','private-quant','ollama','preserved prompt','["general"]',NULL,'idle',0,0);
  CREATE TABLE messages(id TEXT PRIMARY KEY,store_id TEXT,sender TEXT,sender_type TEXT,content TEXT,timestamp INTEGER,parent_id TEXT,thread_id TEXT,reply_count INTEGER,reactions TEXT);
  INSERT INTO messages VALUES('root','general','Legacy Human','human','original https://example.com/original',10,NULL,NULL,1,'{}');
  INSERT INTO messages VALUES('reply','general','Legacy Agent','agent','cited result',11,'root','root',0,'{}');
  CREATE TABLE agent_memory(agent_id TEXT PRIMARY KEY,e_pool TEXT,x_pool TEXT,weights TEXT,stats TEXT,last_update INTEGER);
  INSERT INTO agent_memory VALUES('agent','[]','[]','{}','{}',12);
  CREATE TABLE project_states(store_id TEXT PRIMARY KEY,state TEXT,timestamp INTEGER);INSERT INTO project_states VALUES('general','{"stage":"review"}',13);
  CREATE TABLE pipeline_results(id TEXT PRIMARY KEY,agent_id TEXT,thread_id TEXT,code_hash TEXT,passed INTEGER,attempt INTEGER,feedback TEXT,timestamp INTEGER);
  INSERT INTO pipeline_results VALUES('pipeline','agent','root','${'a'.repeat(64)}',1,1,'original feedback',14);
  CREATE TABLE loop_health(loop_id TEXT PRIMARY KEY,loop_type TEXT,iterations INTEGER,convergence REAL,stagnation REAL,token_spend INTEGER,last_update INTEGER);
  INSERT INTO loop_health VALUES('loop','review',1,0.5,0,1,15);
  CREATE TABLE research_sessions(id TEXT PRIMARY KEY,data TEXT,timestamp INTEGER);INSERT INTO research_sessions VALUES('research','{"id":"research","missingEvidence":true}',16);
  CREATE TABLE research_sources(id TEXT PRIMARY KEY,research_id TEXT,url TEXT,title TEXT,excerpt TEXT,timestamp INTEGER);
  INSERT INTO research_sources VALUES('source','research','https://example.com/original','Original','original excerpt',17);
  CREATE TABLE unknown_notes(id TEXT PRIMARY KEY,content TEXT);INSERT INTO unknown_notes VALUES('note','never discard');`);
  const identitySourcePath=path.join(root,'identity.sqlite'),identity=createIdentityStore({dbPath:identitySourcePath});
  passwordHash=passwordHash||hashPassword('migration-fixture-password');
  const owner=identity.bootstrapIdentity({login:'migration-owner',passwordHash:await passwordHash,workspaceName:'Explicit legacy workspace'});
  identity.close();
  const gatewayPath=path.join(sourceRoot,'db','agent-gateway.db'),store=createGatewayStore({dbPath:gatewayPath});store.close();
  const gateway=new Database(gatewayPath),nodeId=randomUUID(),taskId=randomUUID(),leaseId=randomUUID(),leaseUntil=Date.now()+120000;
  gateway.prepare('INSERT INTO nodes(id,name,capabilities,scopes,token_hash,created_at) VALUES(?,?,?,?,?,?)').run(nodeId,'Legacy node','["research.retrieve"]','["general"]','b'.repeat(64),10);
  gateway.prepare('INSERT INTO tasks(id,node_id,scope_id,task_type,input,status,lease_id,lease_until,attempt,deadline_at,created_at,updated_at,trace_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(taskId,nodeId,'general','research.retrieve','{}','leased',leaseId,leaseUntil,1,leaseUntil+1000,11,11,randomUUID());
  gateway.prepare('INSERT INTO pairings(code_hash,node_id,expires_at) VALUES(?,?,?)').run('c'.repeat(64),nodeId,leaseUntil);gateway.close();
  t.after(()=>{db.close();if(!path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('unsafe cleanup');fs.rmSync(root,{recursive:true,force:true});});
  const input={sourceRoot,targetRoot,workspaceId:owner.workspace.id,ownerId:owner.user.id};
  const options={reviewed:true,snapshotRoot,identitySourcePath,modelGrants:{ollama:{models:['private-quant']}}};
  return {root,db,dbPath,input,options,nodeId,taskId,leaseId,leaseUntil,gatewayPath,snapshotRoot,targetRoot,sourceRoot};
}
async function prepared(t){const f=await fixture(t);const plan=planMigration(f.input);await prepareWorkspaceSnapshot({sourceRoot:f.sourceRoot,snapshotRoot:f.snapshotRoot});return {...f,plan};}

test('reviewed snapshot converts real legacy tables and gateway ownership, preserving WAL, original sources and Ollama',async t=>{
  const f=await prepared(t),before=[hash(f.dbPath),hash(f.dbPath+'-wal')];
  const result=await applyMigration(f.plan,f.options);assert.equal(result.migrationReady,true);assert.equal(result.restoreReady,false);
  assert.equal(validateMigration(f.targetRoot),path.join(f.targetRoot,'db','identity.db'));
  assert.deepEqual([hash(f.dbPath),hash(f.dbPath+'-wal')],before);f.db.prepare('INSERT INTO unknown_notes VALUES(?,?)').run('still-live','source writer usable');
  const identity=createIdentityStore({dbPath:path.join(f.targetRoot,'db','identity.db')}),db=new Database(path.join(f.targetRoot,'db','lack.db'));
  try{const actor=identity.requireMembership(f.input.ownerId,f.input.workspaceId),store=createCollaborationStore({db,identity});runWithWorkspace(actor,()=>{
    const scoped=store.forWorkspace(actor);assert.equal(scoped.loadAgents()[0].provider,'ollama');assert.equal(scoped.loadAgents()[0].model,'private-quant');
    assert.equal(scoped.getMessages('general').length,2);assert.equal(scoped.loadAgentMemory('agent').lastUpdate,12);
    assert.equal(scoped.getResearchSources('research')[0].url,'https://example.com/original');assert.equal(scoped.getPipelineResults('root').length,1);
  });store.close();}finally{db.close();identity.close();}
  const old=new Database(path.join(f.targetRoot,'quarantine','snapshot','candidate','db','lack.db'),{readonly:true});try{assert.equal(old.prepare('SELECT content FROM unknown_notes').get().content,'never discard');}finally{old.close();}
  const gateway=new Database(path.join(f.targetRoot,'db','agent-gateway.db'),{readonly:true});try{
    const node=gateway.prepare('SELECT * FROM nodes').get(),task=gateway.prepare('SELECT * FROM tasks').get();assert.equal(node.workspace_id,f.input.workspaceId);assert.equal(node.created_by,f.input.ownerId);
    assert.equal(node.revoked,1);assert.equal(node.paused,1);assert.equal(node.token_hash,null);assert.equal(gateway.prepare('SELECT count(*) n FROM pairings').get().n,0);
    assert.equal(task.status,'leased');assert.equal(task.lease_id,f.leaseId);assert.equal(task.lease_until,f.leaseUntil);
  }finally{gateway.close();}
  assert.equal(fs.readFileSync(path.join(f.targetRoot,'workspaces',f.input.workspaceId,'agent_memories','agent.json'),'utf8'),fs.readFileSync(path.join(f.sourceRoot,'memory','agent.json'),'utf8'));
  const config=JSON.parse(fs.readFileSync(path.join(f.targetRoot,'config','lack.config.json')));assert.equal(config.apiKey,'synthetic-secret-never-print');assert.equal(config.multiUser.migrationReady,true);
  assert.deepEqual(config.workspaceModelGrants[f.input.workspaceId],f.options.modelGrants);
  assert.ok(!JSON.stringify(result).includes('synthetic-secret-never-print'));
});
test('same reviewed plan verifies idempotently without importing rows twice',async t=>{const f=await prepared(t);await applyMigration(f.plan,f.options);const before=hash(path.join(f.targetRoot,'db','lack.db'));const result=await applyMigration(f.plan,f.options);assert.equal(result.migrationReady,true);assert.equal(hash(path.join(f.targetRoot,'db','lack.db')),before);assert.equal(verifyMigration(f.plan).migrationReady,true);});
test('no review and a wrong active owner never publish a candidate',async t=>{const f=await prepared(t);assert.throws(()=>applyMigration(f.plan),/migration_apply_not_ready/);await assert.rejects(Promise.resolve().then(()=>applyMigration({...f.plan,ownership:{...f.plan.ownership,ownerId:randomUUID()}},f.options)),/migration_owner_binding_invalid/);assert.equal(fs.existsSync(f.targetRoot),false);});
test('changed snapshot and changed candidate files are rejected rather than silently resealed',async t=>{const f=await prepared(t);await applyMigration(f.plan,f.options);fs.appendFileSync(path.join(f.targetRoot,'workspaces',f.input.workspaceId,'agent_memories','agent.json'),'changed');assert.throws(()=>verifyMigration(f.plan),/migration_file_mismatch/);const other=await prepared(t);fs.appendFileSync(path.join(other.snapshotRoot,'candidate','memory','agent.json'),'changed');await assert.rejects(Promise.resolve().then(()=>applyMigration(other.plan,other.options)),/snapshot_file_mismatch/);assert.equal(fs.existsSync(other.targetRoot),false);});
test('interruption leaves source unchanged and the owned candidate non-activatable',async t=>{const f=await prepared(t),before=[hash(f.dbPath),hash(f.dbPath+'-wal')];await assert.rejects(Promise.resolve().then(()=>applyMigration(f.plan,{...f.options,onPhase:phase=>{if(phase==='data-converted')throw Error('injected interruption');}})),/injected interruption/);assert.deepEqual([hash(f.dbPath),hash(f.dbPath+'-wal')],before);assert.equal(JSON.parse(fs.readFileSync(path.join(f.targetRoot,'config','lack.config.json'))).multiUser.migrationReady,false);assert.throws(()=>verifyMigration(f.plan),/migration_publication_incomplete/);});
test('an orphaned legacy message fails actual canonical foreign-key validation',async t=>{const f=await fixture(t);f.db.prepare('UPDATE messages SET parent_id=? WHERE id=?').run('absent-parent','reply');const plan=planMigration(f.input);await prepareWorkspaceSnapshot({sourceRoot:f.sourceRoot,snapshotRoot:f.snapshotRoot});await assert.rejects(Promise.resolve().then(()=>applyMigration(plan,f.options)),/migration_data_integrity_failed/);assert.equal(JSON.parse(fs.readFileSync(path.join(f.targetRoot,'config','lack.config.json'))).multiUser.migrationReady,false);});
test('referenced pilot evidence must exist with its original hash before migration can activate',async t=>{const f=await fixture(t),db=new Database(f.gatewayPath);const id=randomUUID();db.prepare('INSERT INTO pilot_artifacts(id,node_id,task_id,event_id,sha256,size_bytes,width,height,content_type,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,f.nodeId,f.taskId,randomUUID(),'a'.repeat(64),100,1,1,'image/png',10);db.close();const plan=planMigration(f.input);await prepareWorkspaceSnapshot({sourceRoot:f.sourceRoot,snapshotRoot:f.snapshotRoot});await assert.rejects(Promise.resolve().then(()=>applyMigration(plan,f.options)),/migration_attachment_missing/);assert.equal(JSON.parse(fs.readFileSync(path.join(f.targetRoot,'config','lack.config.json'))).multiUser.migrationReady,false);});
test('linked and occupied destinations are never overwritten even after a plan was reviewed',async t=>{const f=await prepared(t);fs.mkdirSync(f.targetRoot);fs.writeFileSync(path.join(f.targetRoot,'keep'),'existing bytes');await assert.rejects(Promise.resolve().then(()=>applyMigration(f.plan,f.options)),/migration_destination_exists/);assert.equal(fs.readFileSync(path.join(f.targetRoot,'keep'),'utf8'),'existing bytes');const other=await prepared(t);fs.symlinkSync(other.sourceRoot,other.targetRoot,process.platform==='win32'?'junction':'dir');await assert.rejects(Promise.resolve().then(()=>applyMigration(other.plan,other.options)),/migration_link_denied/);});

function cli(args){const result=spawnSync(process.execPath,[path.resolve(__dirname,'../scripts/migrate-workspaces.cjs'),...args],{encoding:'utf8',timeout:30000});assert.equal(result.error,undefined);assert.ok(!(result.stdout+result.stderr).includes('synthetic-secret-never-print'));return {...result,json:JSON.parse(result.stdout)};}
function recovery(){return require('../scripts/workspace-migration-recovery.cjs');}
test('CLI prepares, explicitly applies reviewed plan, verifies and repeats without exposing credentials',async t=>{
  const f=await fixture(t);
  const preview=cli(['--source-root',f.sourceRoot,'--target-root',f.targetRoot,'--workspace-id',f.input.workspaceId,'--owner-id',f.input.ownerId]);
  assert.equal(preview.status,0);assert.equal(preview.json.readyToApply,false);
  const planFile=path.join(f.root,'reviewed-plan.json'),grantFile=path.join(f.root,'model-grants.json');
  fs.writeFileSync(planFile,JSON.stringify(preview.json),{mode:0o600});fs.writeFileSync(grantFile,JSON.stringify(f.options.modelGrants),{mode:0o600});
  const snapshot=cli(['--prepare-snapshot','--source-root',f.sourceRoot,'--snapshot-root',f.snapshotRoot]);
  assert.equal(snapshot.status,0);assert.equal(snapshot.json.migrationReady,false);
  const args=['--apply','--reviewed','--plan-file',planFile,'--snapshot-root',f.snapshotRoot,'--identity-source',f.options.identitySourcePath,'--grants-file',grantFile];
  const unreviewed=cli(args.filter(arg=>arg!=='--reviewed'));assert.equal(unreviewed.status,2);assert.equal(unreviewed.json.error,'migration_apply_not_ready');assert.equal(fs.existsSync(f.targetRoot),false);
  const applied=cli(args);assert.equal(applied.status,0);assert.equal(applied.json.migrationReady,true);
  const before=hash(path.join(f.targetRoot,'db','lack.db'));const verified=cli(['--verify','--plan-file',planFile]);assert.equal(verified.status,0);assert.equal(verified.json.restoreReady,false);
  assert.equal(cli(args).status,0);assert.equal(hash(path.join(f.targetRoot,'db','lack.db')),before);
});
test('review does not turn wildcard grants or ungranted legacy model into model permission',async t=>{
  const f=await prepared(t);
  await assert.rejects(applyMigration(f.plan,{...f.options,modelGrants:{ollama:{models:['*']}}}),/migration_model_grants_required/);assert.equal(fs.existsSync(f.targetRoot),false);
  await assert.rejects(applyMigration(f.plan,{...f.options,modelGrants:{ollama:{models:['different-model']}}}),/migration_model_grants_required/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.targetRoot,'config','lack.config.json'))).multiUser.migrationReady,false);
});
test('identity source changes during conversion prevent candidate publication',async t=>{
  const f=await prepared(t);
  await assert.rejects(applyMigration(f.plan,{...f.options,onPhase:phase=>{if(phase==='data-converted'){const identity=new Database(f.options.identitySourcePath);try{identity.prepare("UPDATE memberships SET role='member' WHERE user_id=? AND workspace_id=?").run(f.input.ownerId,f.input.workspaceId);}finally{identity.close();}}}}),/migration_source_changed|migration_owner_binding_invalid/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.targetRoot,'config','lack.config.json'))).multiUser.migrationReady,false);
  assert.throws(()=>verifyMigration(f.plan),/migration_publication_incomplete/);
});

test('reviewed recovery materializes old data and original config without activating, changing sources or depending on the candidate afterwards',async t=>{
  const f=await prepared(t);await applyMigration(f.plan,f.options);const recoveryRoot=path.join(f.root,'recovery');
  const before=[hash(f.dbPath),hash(f.dbPath+'-wal'),hash(path.join(f.targetRoot,'db','lack.db')),hash(path.join(f.targetRoot,'config','lack.config.json'))];
  const result=recovery().prepareMigrationRecovery({candidateRoot:f.targetRoot,recoveryRoot,reviewed:true});
  assert.equal(result.status,'verified');assert.equal(result.migrationReady,false);assert.equal(result.restoreReady,false);assert.equal(result.applicationConsistency,'not_proven');assert.ok(!JSON.stringify(result).includes('synthetic-secret-never-print'));
  assert.deepEqual([hash(f.dbPath),hash(f.dbPath+'-wal'),hash(path.join(f.targetRoot,'db','lack.db')),hash(path.join(f.targetRoot,'config','lack.config.json'))],before);
  const legacy=path.join(recoveryRoot,'legacy-data'),db=new Database(path.join(legacy,'db','lack.db'),{readonly:true});
  try{assert.equal(db.prepare('SELECT count(*) n FROM messages').get().n,2);assert.equal(db.prepare('SELECT content FROM unknown_notes').get().content,'never discard');assert.equal(db.pragma('integrity_check',{simple:true}),'ok');}finally{db.close();}
  assert.equal(hash(path.join(legacy,'memory','agent.json')),hash(path.join(f.sourceRoot,'memory','agent.json')));
  assert.equal(hash(path.join(recoveryRoot,'original-config','lack.config.json')),hash(path.join(f.sourceRoot,'config','lack.config.json')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(legacy,'config','lack.config.json'))).multiUser.migrationReady,false);
  fs.renameSync(f.targetRoot,path.join(f.root,'candidate-moved'));assert.deepEqual(recovery().verifyMigrationRecovery(recoveryRoot),result);
  f.db.prepare('INSERT INTO unknown_notes VALUES(?,?)').run('writer-after-recovery','still usable');
});
test('an interrupted migration can recover its old-version snapshot while both candidates remain non-activatable',async t=>{
  const f=await prepared(t);await assert.rejects(applyMigration(f.plan,{...f.options,onPhase:phase=>{if(phase==='data-converted')throw Error('interrupted fixture');}}),/interrupted fixture/);
  const recoveryRoot=path.join(f.root,'recovery'),result=recovery().prepareMigrationRecovery({candidateRoot:f.targetRoot,recoveryRoot,reviewed:true});
  assert.equal(result.sourceStatus,'failed');assert.equal(result.migrationReady,false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.targetRoot,'config','lack.config.json'))).multiUser.migrationReady,false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(recoveryRoot,'legacy-data','config','lack.config.json'))).multiUser.migrationReady,false);
});
test('recovery needs explicit review and intact snapshot provenance before creating any output',async t=>{
  const f=await prepared(t);await applyMigration(f.plan,f.options);const recoveryRoot=path.join(f.root,'recovery');
  assert.throws(()=>recovery().prepareMigrationRecovery({candidateRoot:f.targetRoot,recoveryRoot}),/recovery_review_required/);assert.equal(fs.existsSync(recoveryRoot),false);
  fs.appendFileSync(path.join(f.targetRoot,'quarantine','snapshot','candidate','memory','agent.json'),'changed');
  assert.throws(()=>recovery().prepareMigrationRecovery({candidateRoot:f.targetRoot,recoveryRoot,reviewed:true}),/snapshot_file_mismatch|recovery_source_mismatch/);assert.equal(fs.existsSync(recoveryRoot),false);
});
test('recovery rejects occupied, overlapping and linked paths without overwriting old files',async t=>{
  const f=await prepared(t);await applyMigration(f.plan,f.options);const recoveryRoot=path.join(f.root,'recovery');fs.mkdirSync(recoveryRoot);fs.writeFileSync(path.join(recoveryRoot,'keep'),'original');
  assert.throws(()=>recovery().prepareMigrationRecovery({candidateRoot:f.targetRoot,recoveryRoot,reviewed:true}),/recovery_destination_exists/);assert.equal(fs.readFileSync(path.join(recoveryRoot,'keep'),'utf8'),'original');
  assert.throws(()=>recovery().prepareMigrationRecovery({candidateRoot:f.targetRoot,recoveryRoot:path.join(f.targetRoot,'nested'),reviewed:true}),/recovery_roots_overlap/);
  const link=path.join(f.root,'candidate-link');fs.symlinkSync(f.targetRoot,link,process.platform==='win32'?'junction':'dir');
  assert.throws(()=>recovery().prepareMigrationRecovery({candidateRoot:link,recoveryRoot:path.join(f.root,'other-recovery'),reviewed:true}),/recovery_link_denied/);
});
test('recovery verification detects changed legacy bytes and forged readiness flags',async t=>{
  const f=await prepared(t);await applyMigration(f.plan,f.options);const recoveryRoot=path.join(f.root,'recovery');recovery().prepareMigrationRecovery({candidateRoot:f.targetRoot,recoveryRoot,reviewed:true});
  const file=path.join(recoveryRoot,'legacy-data','memory','agent.json'),original=fs.readFileSync(file);fs.appendFileSync(file,'changed');
  assert.throws(()=>recovery().verifyMigrationRecovery(recoveryRoot),/recovery_file_mismatch/);fs.writeFileSync(file,original);
  const marker=path.join(recoveryRoot,'recovery-state.json'),state=JSON.parse(fs.readFileSync(marker));state.restoreReady=true;fs.writeFileSync(marker,JSON.stringify(state));
  assert.throws(()=>recovery().verifyMigrationRecovery(recoveryRoot),/recovery_metadata_invalid/);
});
test('interrupted recovery keeps a failed non-activatable copy and never changes the candidate',async t=>{
  const f=await prepared(t);await applyMigration(f.plan,f.options);const recoveryRoot=path.join(f.root,'recovery'),before=hash(path.join(f.targetRoot,'migration-state.json'));
  assert.throws(()=>recovery().prepareMigrationRecovery({candidateRoot:f.targetRoot,recoveryRoot,reviewed:true,onPhase:phase=>{if(phase==='legacy-materialized')throw Error('recovery interruption');}}),/recovery interruption/);
  assert.equal(hash(path.join(f.targetRoot,'migration-state.json')),before);assert.equal(JSON.parse(fs.readFileSync(path.join(recoveryRoot,'recovery-state.json'))).status,'failed');
  assert.equal(JSON.parse(fs.readFileSync(path.join(recoveryRoot,'legacy-data','config','lack.config.json'))).multiUser.migrationReady,false);
  assert.throws(()=>recovery().verifyMigrationRecovery(recoveryRoot),/recovery_metadata_invalid/);
});
test('CLI explicitly prepares and independently verifies a reviewed recovery without leaking credentials',async t=>{
  const f=await prepared(t);await applyMigration(f.plan,f.options);const recoveryRoot=path.join(f.root,'recovery');
  const denied=cli(['--recover','--candidate-root',f.targetRoot,'--recovery-root',recoveryRoot]);assert.equal(denied.status,2);assert.equal(denied.json.error,'recovery_review_required');assert.equal(fs.existsSync(recoveryRoot),false);
  const result=cli(['--recover','--reviewed','--candidate-root',f.targetRoot,'--recovery-root',recoveryRoot]);assert.equal(result.status,0);assert.equal(result.json.restoreReady,false);
  const check=cli(['--verify-recovery','--recovery-root',recoveryRoot]);assert.equal(check.status,0);assert.equal(check.json.migrationReady,false);
});
