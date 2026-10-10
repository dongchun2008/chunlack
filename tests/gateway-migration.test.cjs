'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {randomUUID,createHash}=require('node:crypto'),{deflateSync,crc32}=require('node:zlib');
const Database=require('better-sqlite3'),P=require('../gateway/protocol.cjs');
const {createGatewayStore}=require('../gateway/store.cjs');
const {createIdentityStore}=require('../identity/store.cjs');
const convert=options=>require('../scripts/convert-legacy-gateway.cjs').convertLegacyGateway(options);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function png(){function chunk(name,data){const type=Buffer.from(name),buffer=Buffer.alloc(12+data.length);buffer.writeUInt32BE(data.length);type.copy(buffer,4);data.copy(buffer,8);buffer.writeUInt32BE(crc32(Buffer.concat([type,data])),8+data.length);return buffer;}const header=Buffer.alloc(13);header.writeUInt32BE(1);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,255,0,0,255]))),chunk('IEND',Buffer.alloc(0))]);}
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'lack-gateway-conversion-')),legacy=path.join(root,'legacy'),targetRoot=path.join(root,'candidate');
  fs.mkdirSync(legacy,{mode:0o700});fs.mkdirSync(targetRoot,{mode:0o700});fs.mkdirSync(path.join(targetRoot,'config'),{mode:0o700});
  const configFile=path.join(targetRoot,'config','lack.config.json');fs.writeFileSync(configFile,JSON.stringify({multiUser:{migrationReady:false}}),{mode:0o600});
  const sourcePath=path.join(legacy,'gateway.db'),init=createGatewayStore({dbPath:sourcePath});init.close();
  const clock={value:10000},now=()=>clock.value,oldToken=P.secret(),oldPair=P.secret(16),nodeId=randomUUID(),activeId=randomUUID(),queuedId=randomUUID(),pilotId=randomUUID(),leaseId=randomUUID(),artifactId=randomUUID(),eventId=randomUUID();
  const image=png(),imageFile=path.join(legacy,'original.png');fs.writeFileSync(imageFile,image,{mode:0o600});
  const db=new Database(sourcePath);db.pragma('journal_mode=DELETE');
  db.prepare('INSERT INTO nodes(id,name,capabilities,scopes,token_hash,paused,revoked,created_at) VALUES(?,?,?,?,?,?,?,?)').run(nodeId,'Historical fixture node',JSON.stringify(P.TYPES),'["general"]',P.hash(oldToken),0,0,1000);
  db.prepare('INSERT INTO pairings(code_hash,node_id,expires_at) VALUES(?,?,?)').run(P.hash(oldPair),nodeId,now()+P.LIMITS.pairMs);
  const insert=db.prepare('INSERT INTO tasks(id,node_id,scope_id,task_type,input,status,lease_id,lease_until,attempt,deadline_at,created_at,updated_at,result,trace_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const leaseUntil=now()+P.LIMITS.leaseMs;
  insert.run(activeId,nodeId,'general','research.retrieve','{"query":"original research"}','leased',leaseId,leaseUntil,1,now()+120000,1000,1000,null,randomUUID());
  insert.run(queuedId,nodeId,'general','research.verify','{"query":"original queued task"}','queued',null,null,0,now()+120000,1001,1001,null,null);
  const challenge=P.secret(),input={url:'https://example.com/',challenge},result={protocolVersion:1,taskId:pilotId,leaseId:randomUUID(),attempt:1,eventId,status:'succeeded',output:{url:input.url,challenge,title:'Synthetic fixture only',executedAt:new Date(5000).toISOString(),artifactId,activityEvidence:'Synthetic local migration fixture, NOT vendor execution'}};
  insert.run(pilotId,nodeId,'general','browser.public_read',JSON.stringify(input),'succeeded',result.leaseId,6000,1,6000,1002,5000,JSON.stringify(result),randomUUID());
  db.prepare('INSERT INTO events(node_id,task_id,event_id,content_hash,ack,type,message,created_at) VALUES(?,?,?,?,?,?,?,?)').run(nodeId,pilotId,eventId,P.hash(P.bounded(result)),JSON.stringify({eventId,taskId:pilotId,status:'succeeded',accepted:true}),'result','original acknowledgement',5000);
  db.prepare('INSERT INTO pilot_artifacts(id,node_id,task_id,event_id,sha256,size_bytes,width,height,content_type,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(artifactId,nodeId,pilotId,eventId,hash(image),image.length,1,1,'image/png',5000);
  db.prepare('INSERT INTO pilot_acceptance(task_id,state,artifact_id,accepted_at) VALUES(?,?,?,?)').run(pilotId,'accepted',artifactId,5000);
  db.exec("CREATE TABLE unknown_gateway_notes(id TEXT PRIMARY KEY,content TEXT);INSERT INTO unknown_gateway_notes VALUES('original','do not discard')");db.close();
  const source=new Database(sourcePath,{readonly:true,fileMustExist:true}),identity=createIdentityStore({dbPath:':memory:'}),owned=[];
  const {user,workspace}=identity.bootstrapIdentity({login:'gateway-migration-owner',passwordHash:'synthetic-store-fixture-hash-not-for-login'.repeat(2),workspaceName:'Reviewed legacy nodes'});
  const actor=identity.requireMembership(user.id,workspace.id),targetPath=path.join(targetRoot,'db','agent-gateway.db');
  t.after(()=>{for(const resource of owned.reverse())resource.close();source.close();identity.close();const dir=path.resolve(root);if(!dir.startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(dir).startsWith('lack-gateway-conversion-'))throw Error('unsafe cleanup');fs.rmSync(dir,{recursive:true,force:true});});
  const options={source,targetRoot,identity,workspaceId:workspace.id,ownerId:user.id,now,readArtifact:()=>fs.readFileSync(imageFile)};
  return {root,source,sourcePath,targetRoot,targetPath,identity,actor,clock,now,options,nodeId,activeId,queuedId,pilotId,leaseId,leaseUntil,artifactId,eventId,oldToken,oldPair,image,imageFile,configFile,own:value=>{owned.push(value);return value;}};
}
function edit(f,sql){const db=new Database(f.sourcePath);try{db.exec(sql);}finally{db.close();}}
function output(f){return f.own(new Database(f.targetPath,{readonly:true,fileMustExist:true}));}
test('legacy nodes and history are scoped without copying credentials or pretending historical acceptance is new evidence',t=>{
  const f=fixture(t),before=hash(fs.readFileSync(f.sourcePath)),configBefore=hash(fs.readFileSync(f.configFile)),result=convert(f.options),db=output(f);
  assert.equal(result.migrationReady,false);assert.equal(result.converted.nodes,1);assert.equal(result.converted.tasks,3);assert.equal(result.converted.events,1);assert.equal(result.converted.pilot_artifacts,1);
  assert.equal(result.quarantinedPairings,1);assert.equal(result.resetAcceptance,1);assert.deepEqual(result.unassignedTables,[{name:'unknown_gateway_notes',rows:1}]);
  const node=db.prepare('SELECT * FROM nodes').get();assert.equal(node.workspace_id,f.actor.workspaceId);assert.equal(node.created_by,f.actor.userId);assert.equal(node.token_hash,null);assert.equal(node.revoked,1);assert.equal(node.paused,1);
  assert.equal(db.prepare('SELECT count(*) n FROM pairings').get().n,0);assert.equal(db.prepare('SELECT status FROM tasks WHERE id=?').get(f.queuedId).status,'needs_attention');
  const active=db.prepare('SELECT * FROM tasks WHERE id=?').get(f.activeId);assert.equal(active.status,'leased');assert.equal(active.lease_id,f.leaseId);assert.equal(active.lease_until,f.leaseUntil);
  assert.equal(db.prepare('SELECT state FROM pilot_acceptance').get().state,'received');assert.equal(db.prepare('SELECT accepted_at FROM pilot_acceptance').get().accepted_at,null);
  const ack=JSON.parse(db.prepare('SELECT ack FROM events').get().ack);assert.equal(ack.workspaceId,f.actor.workspaceId);assert.equal(ack.taskId,f.pilotId);
  const saved=path.join(f.targetRoot,'artifacts','public-pilot','workspaces',f.actor.workspaceId,f.artifactId+'.png');assert.equal(hash(fs.readFileSync(saved)),hash(f.image));
  assert.equal(hash(fs.readFileSync(f.sourcePath)),before);assert.equal(hash(fs.readFileSync(f.configFile)),configBefore);assert.equal(f.source.prepare('SELECT token_hash FROM nodes').get().token_hash,P.hash(f.oldToken));
  assert.equal(f.source.prepare('SELECT content FROM unknown_gateway_notes').get().content,'do not discard');assert.equal(db.pragma('integrity_check',{simple:true}),'ok');assert.deepEqual(db.pragma('foreign_key_check'),[]);
  assert.ok(!JSON.stringify(result).includes(f.oldToken));assert.ok(!JSON.stringify(result).includes(P.hash(f.oldToken)));
});
test('valid imported lease blocks model work after reopening until the real lease expiry',async t=>{
  const f=fixture(t);convert(f.options);const store=f.own(createGatewayStore({dbPath:f.targetPath,multiUser:true,now:f.now}));
  assert.equal(store.capacity.status(f.actor.workspaceId).active,1);let started=false;
  const pending=store.capacity.submit({workspaceId:'another-workspace',taskId:'new-model-work',deadlineAt:f.now()+120000,kind:'model.generate',run:()=>{started=true;return 'bounded mock';}});pending.catch(()=>{});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(started,false);
  f.clock.value=f.leaseUntil+1;store.capacity.refresh();assert.equal(await pending,'bounded mock');assert.equal(store.capacity.status(f.actor.workspaceId).active,0);
});
test('missing or changed screenshot bytes reject without importing any node or task rows',t=>{
  for(const readArtifact of [undefined,()=>Buffer.from('not the original image')]){const f=fixture(t);assert.throws(()=>convert({...f.options,readArtifact}),/gateway_conversion_evidence_required|gateway_conversion_evidence_mismatch/);if(fs.existsSync(f.targetPath)){const db=output(f);assert.equal(db.prepare('SELECT count(*) n FROM nodes').get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM tasks').get().n,0);}assert.equal(JSON.parse(fs.readFileSync(f.configFile)).multiUser.migrationReady,false);}
});
test('only a current owner may assign legacy gateway data',t=>{const f=fixture(t),member=f.identity.createUser({login:'gateway-migration-member',passwordHash:'synthetic-store-member-hash'.repeat(2)});f.identity.setMembership(f.actor,{workspaceId:f.actor.workspaceId,userId:member.id,role:'member'});assert.throws(()=>convert({...f.options,ownerId:member.id}),/gateway_conversion_owner_required/);assert.equal(fs.existsSync(f.targetPath),false);});
test('foreign workspace assignment is never collapsed into the selected workspace',t=>{const f=fixture(t);edit(f,"DROP TRIGGER nodes_workspace_immutable;UPDATE nodes SET workspace_id='foreign-workspace'");assert.throws(()=>convert(f.options),/gateway_conversion_scoped_source_requires_review/);assert.equal(fs.existsSync(f.targetPath),false);});
test('malformed payload or mismatched event ownership leaves zero partially imported rows',t=>{const f=fixture(t);edit(f,"UPDATE tasks SET input='{invalid'");assert.throws(()=>convert(f.options),/gateway_conversion_invalid_json/);const db=output(f);assert.equal(db.prepare('SELECT count(*) n FROM nodes').get().n,0);const other=fixture(t);const writer=new Database(other.sourcePath),otherNode=randomUUID();writer.prepare('INSERT INTO nodes(id,name,capabilities,scopes,created_at) VALUES(?,?,?,?,?)').run(otherNode,'Other historical node','["browser.public_read"]','["general"]',1000);writer.prepare('UPDATE events SET node_id=?').run(otherNode);writer.close();assert.throws(()=>convert(other.options),/gateway_conversion_reference_mismatch/);assert.equal(output(other).prepare('SELECT count(*) n FROM nodes').get().n,0);});
test('occupied, linked or already-activatable candidates are rejected before writes',t=>{const f=fixture(t);fs.mkdirSync(path.dirname(f.targetPath),{mode:0o700});fs.writeFileSync(f.targetPath,'existing candidate bytes');assert.throws(()=>convert(f.options),/gateway_conversion_target_exists/);assert.equal(fs.readFileSync(f.targetPath,'utf8'),'existing candidate bytes');const other=fixture(t);fs.mkdirSync(path.dirname(other.targetPath),{mode:0o700});fs.symlinkSync(other.sourcePath,other.targetPath,'file');assert.throws(()=>convert(other.options),/gateway_conversion_link_denied/);const ready=fixture(t);fs.writeFileSync(ready.configFile,JSON.stringify({multiUser:{migrationReady:true}}));assert.throws(()=>convert(ready.options),/gateway_conversion_candidate_not_staged/);assert.equal(fs.existsSync(ready.targetPath),false);});
test('old token cannot authenticate; only explicit fresh node authorization creates new pairing',t=>{const f=fixture(t);convert(f.options);const store=f.own(createGatewayStore({dbPath:f.targetPath,multiUser:true,now:f.now}));assert.throws(()=>store.authenticate(f.oldToken),error=>error.code==='unauthorized');store.withWorkspace({workspaceId:f.actor.workspaceId,userId:f.actor.userId},()=>{assert.equal(store.listNodes().length,1);store.createNode({name:'Explicitly authorized replacement',capabilities:['research.retrieve'],scopes:['general']});const nodes=store.listNodes();assert.equal(nodes.length,2);assert.ok(nodes.find(node=>node.id!==f.nodeId&&!node.revoked));});});
test('owner revocation during evidence validation rolls back the whole gateway import',t=>{const f=fixture(t),replacement=f.identity.createUser({login:'gateway-replacement-owner',passwordHash:'synthetic-store-replacement-hash'.repeat(2)});f.identity.setMembership(f.actor,{workspaceId:f.actor.workspaceId,userId:replacement.id,role:'owner'});const next=f.identity.requireMembership(replacement.id,f.actor.workspaceId);assert.throws(()=>convert({...f.options,readArtifact:()=>{f.identity.removeMembership(next,{workspaceId:f.actor.workspaceId,userId:f.actor.userId});return f.image;}}),/gateway_conversion_owner_required/);assert.equal(output(f).prepare('SELECT count(*) n FROM nodes').get().n,0);assert.equal(JSON.parse(fs.readFileSync(f.configFile)).multiUser.migrationReady,false);});
