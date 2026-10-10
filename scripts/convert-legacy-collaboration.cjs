'use strict';
// Private offline component. It never publishes readiness, opens listeners,
// copies credentials, or modifies a source database. The caller still owns
// snapshot verification, quarantine, files, gateway conversion and publication.
const fs=require('node:fs'),path=require('node:path');
const {createCollaborationStore,collaborationTableScopes}=require('../collaboration/store.cjs');
const TABLES=['agents','messages','agent_memory','project_states','pipeline_results','loop_health','research_sessions','research_sources'];
const CORE=TABLES.slice(0,6),MAX_ROWS=50000,MAX_TEXT=262144,MAX_BYTES=64*1024*1024;
function fail(code){return Object.assign(new Error(code),{code});}
function identifier(value){if(typeof value!=='string'||!/^[A-Za-z0-9_.:-]{1,128}$/.test(value))throw fail('conversion_invalid_identifier');return value;}
function text(value,maximum=MAX_TEXT,empty=false){if(value==null&&empty)value='';if(typeof value!=='string'||Buffer.byteLength(value)>maximum)throw fail('conversion_invalid_record');return value;}
function integer(value,minimum=0,fallback){if(value==null&&fallback!==undefined)value=fallback;if(!Number.isSafeInteger(value)||value<minimum)throw fail('conversion_invalid_record');return value;}
function encoded(value){return text(JSON.stringify(value));}
function json(value,fallback,kind){let result;try{result=value==null||value===''?fallback:JSON.parse(text(value));}catch{throw fail('conversion_invalid_json');}if(kind==='array'&&!Array.isArray(result)||kind==='object'&&(!result||typeof result!=='object'||Array.isArray(result)))throw fail('conversion_invalid_json');return result;}
function reference(value){return value==null||value===''?null:identifier(value);}
function quote(value){return '"'+value.replaceAll('"','""')+'"';}
function owner(identity,ownerId,workspaceId){let actor;try{actor=identity.requireMembership(ownerId,workspaceId);}catch{throw fail('conversion_owner_required');}if(actor.role!=='owner')throw fail('conversion_owner_required');return actor;}

function convertLegacyCollaboration({source,target,identity,workspaceId,ownerId,defaultModel}={}){
  if(!source||!target||source===target||source.readonly!==true||target.readonly!==false||
    !source.open||!target.open||!path.isAbsolute(source.name)||!path.isAbsolute(target.name))throw fail('conversion_database_boundary_required');
  const normalize=value=>process.platform==='win32'?value.toLowerCase():value;
  if(normalize(fs.realpathSync(source.name))===normalize(fs.realpathSync(target.name)))throw fail('conversion_database_boundary_required');
  identifier(workspaceId);identifier(ownerId);
  const principal=owner(identity,ownerId,workspaceId);
  if(target.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().n)throw fail('conversion_empty_target_required');
  if(source.pragma('page_count',{simple:true})*source.pragma('page_size',{simple:true})>MAX_BYTES)throw fail('conversion_capacity_exceeded');
  let store;
  try{return source.transaction(()=>{
    if(source.pragma('integrity_check',{simple:true})!=='ok'||source.pragma('foreign_key_check').length)throw fail('conversion_source_integrity_failed');
    const names=source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>row.name);
    if(names.length>128||CORE.some(name=>!names.includes(name)))throw fail('conversion_legacy_schema_required');
    const converted={},unassignedTables=[];let rows=0;
    for(const name of names){const count=source.prepare('SELECT count(*) n FROM '+quote(name)).get().n;rows+=count;
      if(rows>MAX_ROWS)throw fail('conversion_capacity_exceeded');
      if(TABLES.includes(name)){
        if(source.prepare('PRAGMA table_info('+quote(name)+')').all().some(column=>column.name==='workspace_id'))throw fail('conversion_scoped_source_requires_review');
        converted[name]=count;
      }else if(!Object.hasOwn(collaborationTableScopes,name))unassignedTables.push({name,rows:count});
    }
    for(const table of TABLES)converted[table]??=0;
    target.pragma('max_page_count=16384');
    store=createCollaborationStore({db:target,identity});
    const insert=(table,value)=>{const columns=Object.keys(value);target.prepare('INSERT INTO '+table+'('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')').run(...columns.map(key=>value[key]));};
    const each=(table,fn)=>{if(names.includes(table))for(const row of source.prepare('SELECT * FROM '+table).iterate())fn(row);};
    target.transaction(()=>{
      target.pragma('defer_foreign_keys=ON');
      target.prepare('INSERT INTO workspace_scopes(workspace_id) VALUES(?)').run(workspaceId);
      const agentIds=new Set(),agentNames=new Map();
      each('agents',row=>{
        const id=identifier(row.id),name=text(row.name,128),model=text(row.model||defaultModel,256),provider=text(row.provider||'ollama',128);
        const channels=json(row.channels,[],'array');for(const channel of channels)identifier(channel);
        const strict=row.strict_channel==null?false:row.strict_channel;
        if(typeof strict!=='string'&&typeof strict!=='boolean'&&typeof strict!=='number')throw fail('conversion_invalid_record');
        const data={id,name,model,provider,systemPrompt:text(row.system_prompt,MAX_TEXT,true),channels,strictChannel:strict,
          status:text(row.status||'idle',32),isEmbedOperator:!!row.is_embed_operator,isCodeModerator:!!row.is_code_moderator};
        insert('agents',{workspace_id:workspaceId,id,name,model,provider,system_prompt:data.systemPrompt,channels:encoded(channels),strict_channel:strict?1:0,
          status:data.status,is_embed_operator:data.isEmbedOperator?1:0,is_code_moderator:data.isCodeModerator?1:0,data:encoded(data)});
        agentIds.add(id);const matches=agentNames.get(name)||[];matches.push(id);agentNames.set(name,matches);
      });
      each('messages',row=>{
        const senderType=row.sender_type;
        if(!['human','agent','system'].includes(senderType))throw fail('conversion_invalid_sender');
        const sender=text(row.sender,128);let agentId=null;
        if(senderType==='agent'){
          if(row.agent_id!=null)agentId=identifier(row.agent_id);
          else if(agentIds.has(sender))agentId=sender;
          else{const matches=agentNames.get(sender)||[];if(matches.length!==1)throw fail('conversion_sender_unresolved');agentId=matches[0];}
          if(!agentIds.has(agentId))throw fail('conversion_sender_unresolved');
        }
        insert('messages',{workspace_id:workspaceId,id:identifier(row.id),store_id:identifier(row.store_id),sender,sender_type:senderType,agent_id:agentId,
          content:text(row.content,MAX_TEXT,true),timestamp:integer(row.timestamp,0,0),parent_id:reference(row.parent_id),thread_id:reference(row.thread_id),
          reply_count:integer(row.reply_count,0,0),reactions:encoded(json(row.reactions,{},'object')),created_by:ownerId});
      });
      each('agent_memory',row=>{
        const data={ePool:json(row.e_pool,[],'array'),xPool:json(row.x_pool,[],'array'),weights:json(row.weights,{},'object'),stats:json(row.stats,{},'object'),lastUpdate:integer(row.last_update,0,0)};
        insert('agent_memory',{workspace_id:workspaceId,agent_id:identifier(row.agent_id),e_pool:encoded(data.ePool),x_pool:encoded(data.xPool),weights:encoded(data.weights),stats:encoded(data.stats),last_update:data.lastUpdate,data:encoded(data)});
      });
      each('project_states',row=>insert('project_states',{workspace_id:workspaceId,store_id:identifier(row.store_id),state:encoded(json(row.state,{})),timestamp:integer(row.timestamp,0,0)}));
      each('pipeline_results',row=>{
        if(typeof row.code_hash!=='string'||!/^[a-f0-9]{64}$/.test(row.code_hash)||![0,1].includes(row.passed))throw fail('conversion_invalid_record');
        insert('pipeline_results',{workspace_id:workspaceId,id:identifier(row.id),agent_id:identifier(row.agent_id),thread_id:identifier(row.thread_id),code_hash:row.code_hash,
          passed:row.passed,attempt:integer(row.attempt,1),feedback:text(row.feedback,MAX_TEXT,true),timestamp:integer(row.timestamp,0,0)});
      });
      each('loop_health',row=>{
        if(![row.convergence,row.stagnation].every(value=>Number.isFinite(value)&&value>=0&&value<=1))throw fail('conversion_invalid_record');
        insert('loop_health',{workspace_id:workspaceId,loop_id:identifier(row.loop_id),loop_type:text(row.loop_type,128),iterations:integer(row.iterations),
          convergence:row.convergence,stagnation:row.stagnation,token_spend:integer(row.token_spend),last_update:integer(row.last_update,0,0)});
      });
      each('research_sessions',row=>insert('research_sessions',{workspace_id:workspaceId,id:identifier(row.id),data:encoded(json(row.data,{},'object')),timestamp:integer(row.timestamp,0,0)}));
      each('research_sources',row=>{
        const value=text(row.url,4096);let url;try{url=new URL(value);}catch{throw fail('conversion_invalid_source_url');}
        if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw fail('conversion_invalid_source_url');
        insert('research_sources',{workspace_id:workspaceId,id:identifier(row.id),research_id:identifier(row.research_id),url:value,
          title:text(row.title,1024,true),excerpt:text(row.excerpt,MAX_TEXT,true),timestamp:integer(row.timestamp,0,0)});
      });
      if(target.pragma('foreign_key_check').length)throw fail('conversion_foreign_keys_failed');
      if(target.pragma('integrity_check',{simple:true})!=='ok')throw fail('conversion_target_integrity_failed');
      for(const table of TABLES)if(target.prepare('SELECT count(*) n FROM '+table+' WHERE workspace_id=?').get(workspaceId).n!==converted[table])throw fail('conversion_count_mismatch');
      const current=owner(identity,ownerId,workspaceId);if(current.version!==principal.version)throw fail('conversion_owner_changed');
    }).immediate();
    return Object.freeze({status:'converted',workspaceId,ownerId,migrationReady:false,converted:Object.freeze(converted),unassignedTables:Object.freeze(unassignedTables),
      historicalOwnership:'operator-assigned-not-author-verified'});
  }).deferred();}catch(error){if(error.code?.startsWith('conversion_'))throw error;if(error.code==='SQLITE_FULL')throw fail('conversion_capacity_exceeded');throw fail('conversion_invalid_record');}
  finally{store?.close();}
}
module.exports={convertLegacyCollaboration};
