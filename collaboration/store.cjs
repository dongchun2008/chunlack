'use strict';
const {IdentityError, authorize} = require('../identity/policy.cjs');
const {requireWorkspaceContext} = require('./context.cjs');
const collaborationTableScopes = Object.freeze({
  workspace_scopes: 'workspace', messages: 'workspace', agents: 'workspace',
  agent_memory: 'workspace', project_states: 'workspace', pipeline_results: 'workspace',
  loop_health: 'workspace', research_sessions: 'workspace', research_sources: 'workspace',
  collaboration_schema: 'platform'
});
const schema = `
CREATE TABLE IF NOT EXISTS collaboration_schema(component TEXT PRIMARY KEY,version INTEGER NOT NULL);
INSERT OR IGNORE INTO collaboration_schema VALUES('collaboration',1);
CREATE TABLE IF NOT EXISTS workspace_scopes(workspace_id TEXT NOT NULL PRIMARY KEY);
CREATE TABLE IF NOT EXISTS agents(
  workspace_id TEXT NOT NULL REFERENCES workspace_scopes(workspace_id),id TEXT NOT NULL,
  name TEXT NOT NULL,model TEXT NOT NULL,provider TEXT NOT NULL,system_prompt TEXT NOT NULL,
  channels TEXT NOT NULL,strict_channel INTEGER NOT NULL,status TEXT NOT NULL,
  is_embed_operator INTEGER NOT NULL,is_code_moderator INTEGER NOT NULL,data TEXT NOT NULL,
  PRIMARY KEY(workspace_id,id));
CREATE TABLE IF NOT EXISTS messages(
  workspace_id TEXT NOT NULL REFERENCES workspace_scopes(workspace_id),id TEXT NOT NULL,
  store_id TEXT NOT NULL,sender TEXT NOT NULL,sender_type TEXT NOT NULL CHECK(sender_type IN ('human','agent','system')),
  agent_id TEXT,content TEXT NOT NULL,timestamp INTEGER NOT NULL,parent_id TEXT,thread_id TEXT,
  reply_count INTEGER NOT NULL DEFAULT 0 CHECK(reply_count>=0),reactions TEXT NOT NULL DEFAULT '{}',created_by TEXT NOT NULL,
  PRIMARY KEY(workspace_id,id),FOREIGN KEY(workspace_id,parent_id) REFERENCES messages(workspace_id,id),
  FOREIGN KEY(workspace_id,thread_id) REFERENCES messages(workspace_id,id),
  FOREIGN KEY(workspace_id,agent_id) REFERENCES agents(workspace_id,id));
CREATE INDEX IF NOT EXISTS messages_workspace_store ON messages(workspace_id,store_id,timestamp);
CREATE TABLE IF NOT EXISTS agent_memory(
  workspace_id TEXT NOT NULL REFERENCES workspace_scopes(workspace_id),agent_id TEXT NOT NULL,
  e_pool TEXT NOT NULL,x_pool TEXT NOT NULL,weights TEXT NOT NULL,stats TEXT NOT NULL,last_update INTEGER NOT NULL,data TEXT NOT NULL,
  PRIMARY KEY(workspace_id,agent_id),FOREIGN KEY(workspace_id,agent_id) REFERENCES agents(workspace_id,id));
CREATE TABLE IF NOT EXISTS project_states(
  workspace_id TEXT NOT NULL REFERENCES workspace_scopes(workspace_id),store_id TEXT NOT NULL,state TEXT NOT NULL,timestamp INTEGER NOT NULL,
  PRIMARY KEY(workspace_id,store_id));
CREATE TABLE IF NOT EXISTS pipeline_results(
  workspace_id TEXT NOT NULL REFERENCES workspace_scopes(workspace_id),id TEXT NOT NULL,agent_id TEXT NOT NULL,thread_id TEXT NOT NULL,
  code_hash TEXT NOT NULL,passed INTEGER NOT NULL,attempt INTEGER NOT NULL CHECK(attempt>=1),feedback TEXT NOT NULL,timestamp INTEGER NOT NULL,
  PRIMARY KEY(workspace_id,id),FOREIGN KEY(workspace_id,agent_id) REFERENCES agents(workspace_id,id),
  FOREIGN KEY(workspace_id,thread_id) REFERENCES messages(workspace_id,id));
CREATE TABLE IF NOT EXISTS loop_health(
  workspace_id TEXT NOT NULL REFERENCES workspace_scopes(workspace_id),loop_id TEXT NOT NULL,loop_type TEXT NOT NULL,
  iterations INTEGER NOT NULL,convergence REAL NOT NULL,stagnation REAL NOT NULL,token_spend INTEGER NOT NULL,last_update INTEGER NOT NULL,
  PRIMARY KEY(workspace_id,loop_id));
CREATE TABLE IF NOT EXISTS research_sessions(
  workspace_id TEXT NOT NULL REFERENCES workspace_scopes(workspace_id),id TEXT NOT NULL,data TEXT NOT NULL,timestamp INTEGER NOT NULL,
  PRIMARY KEY(workspace_id,id));
CREATE TABLE IF NOT EXISTS research_sources(
  workspace_id TEXT NOT NULL REFERENCES workspace_scopes(workspace_id),id TEXT NOT NULL,research_id TEXT NOT NULL,
  url TEXT NOT NULL,title TEXT NOT NULL,excerpt TEXT NOT NULL,timestamp INTEGER NOT NULL,
  PRIMARY KEY(workspace_id,id),FOREIGN KEY(workspace_id,research_id) REFERENCES research_sessions(workspace_id,id));
`;
function identifier(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(value)) throw new IdentityError('invalid_identifier', 400);
  return value;
}
function content(value, maximum = 262144) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > maximum) throw new IdentityError('invalid_content', 400);
  return value;
}
function encode(value) {
  let encoded;
  try {encoded = JSON.stringify(value);} catch {throw new IdentityError('invalid_content', 400);}
  return content(encoded);
}
function integer(value, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new IdentityError('invalid_number', 400);
  return value;
}
function boundedLimit(value) {if (!Number.isSafeInteger(value) || value < 1 || value > 1000) throw new IdentityError('invalid_limit', 400); return value;}
function publicConfiguration(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (['apikey', 'password', 'token', 'authorization', 'secret', 'credential'].includes(key.toLowerCase().replace(/[_-]/g, ''))) throw new IdentityError('private_config_forbidden', 400);
    publicConfiguration(item);
  }
}
function createCollaborationStore({db, identity}) {
  if (typeof db?.prepare !== 'function' || typeof identity?.requireMembership !== 'function') throw new IdentityError('invalid_store_config', 400);
  const legacy = db.prepare('PRAGMA table_info(messages)').all();
  if (legacy.length && !legacy.some(column => column.name === 'workspace_id')) throw new IdentityError('workspace_migration_required', 409);
  function inventory() {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    if (tables.some(table => !Object.hasOwn(collaborationTableScopes, table.name))) throw new IdentityError('unclassified_schema', 503);
  }
  inventory();
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 3000');
  db.transaction(() => db.exec(schema)).immediate();
  if (db.prepare("SELECT version FROM collaboration_schema WHERE component='collaboration'").get()?.version !== 1) throw new IdentityError('unsupported_schema', 503);
  inventory();
  let closed = false;
  function fresh(actor, action) {
    if (closed) throw new IdentityError('store_closed', 503);
    const context = requireWorkspaceContext();
    if (!actor || context.workspaceId !== actor.workspaceId || context.userId !== actor.userId) throw new IdentityError('context_mismatch', 403);
    const current = identity.requireMembership(context.userId, context.workspaceId);
    authorize(current, action);
    return current;
  }
  const decodeMessage = row => ({id: row.id, storeId: row.store_id, sender: row.sender, senderType: row.sender_type, content: row.content, timestamp: row.timestamp, parentId: row.parent_id, threadId: row.thread_id, replyCount: row.reply_count, reactions: JSON.parse(row.reactions)});
  const api = {
    forWorkspace(actor) {
      fresh(actor, 'workspace.read');
      const bound = Object.freeze({userId: actor.userId, workspaceId: actor.workspaceId});
      const workspaceId = bound.workspaceId;
      db.prepare('INSERT OR IGNORE INTO workspace_scopes(workspace_id) VALUES(?)').run(workspaceId);
      const check = action => fresh(bound, action);
      return Object.freeze({
        saveMessage(msg, storeId) {
          const current = check('message.send');
          const id = identifier(msg.id); identifier(storeId); content(msg.content);
          const senderType = msg.senderType || 'human';
          if (!['human', 'agent', 'system'].includes(senderType)) throw new IdentityError('invalid_sender', 400);
          const sender = senderType === 'human' ? current.userId : senderType === 'system' ? 'System' : content(msg.sender, 128);
          let agentId = null;
          if (senderType === 'agent') {
            if (msg.agentId != null) agentId = identifier(msg.agentId);
            else {
              const byId = db.prepare('SELECT id FROM agents WHERE workspace_id=? AND id=?').get(workspaceId, sender);
              const byName = byId ? [byId] : db.prepare('SELECT id FROM agents WHERE workspace_id=? AND name=? LIMIT 2').all(workspaceId, sender);
              if (byName.length > 1) throw new IdentityError('invalid_sender', 400);
              agentId = byName[0]?.id || identifier(sender);
            }
          }
          const parentId = msg.parentId == null ? null : identifier(msg.parentId);
          const threadId = msg.threadId == null ? null : identifier(msg.threadId);
          const reactions = encode(msg.reactions || {});
          const existing = db.prepare('SELECT created_by,store_id FROM messages WHERE workspace_id=? AND id=?').get(workspaceId, id);
          if (existing && (existing.store_id !== storeId || (current.role !== 'owner' && existing.created_by !== current.userId))) throw new IdentityError('forbidden', 403);
          db.prepare(`INSERT INTO messages(workspace_id,id,store_id,sender,sender_type,agent_id,content,timestamp,parent_id,thread_id,reply_count,reactions,created_by)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,id) DO UPDATE SET content=excluded.content,reply_count=excluded.reply_count,reactions=excluded.reactions`).run(workspaceId, id, storeId, sender, senderType, agentId, msg.content, integer(msg.timestamp ?? Date.now()), parentId, threadId, integer(msg.replyCount ?? 0), reactions, current.userId);
          return id;
        },
        getMessages(storeId, limit = 1000) {
          check('message.read'); identifier(storeId); boundedLimit(limit);
          return db.prepare('SELECT * FROM messages WHERE workspace_id=? AND store_id=? ORDER BY timestamp,rowid LIMIT ?').all(workspaceId, storeId, limit).map(decodeMessage);
        },
        searchMessages(query, {storeId = null, limit = 100} = {}) {
          check('message.read'); content(query, 1024); boundedLimit(limit);
          if (!query) throw new IdentityError('invalid_content', 400);
          if (storeId !== null) identifier(storeId);
          const pattern = '%' + query.replace(/[\\%_]/g, '\\$&') + '%';
          return db.prepare("SELECT * FROM messages WHERE workspace_id=? AND (? IS NULL OR store_id=?) AND content LIKE ? ESCAPE '\\' ORDER BY timestamp,rowid LIMIT ?").all(workspaceId, storeId, storeId, pattern, limit).map(decodeMessage);
        },
        saveAgent(agent) {
          check('agent.manage'); identifier(agent.id); publicConfiguration(agent);
          const data = encode(agent);
          db.prepare(`INSERT INTO agents(workspace_id,id,name,model,provider,system_prompt,channels,strict_channel,status,is_embed_operator,is_code_moderator,data)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,id) DO UPDATE SET name=excluded.name,model=excluded.model,provider=excluded.provider,system_prompt=excluded.system_prompt,channels=excluded.channels,strict_channel=excluded.strict_channel,status=excluded.status,is_embed_operator=excluded.is_embed_operator,is_code_moderator=excluded.is_code_moderator,data=excluded.data`).run(workspaceId, agent.id, content(agent.name, 128), content(agent.model, 256), content(agent.provider, 128), content(agent.systemPrompt || ''), encode(agent.channels || []), agent.strictChannel ? 1 : 0, content(agent.status || 'idle', 32), agent.isEmbedOperator ? 1 : 0, agent.isCodeModerator ? 1 : 0, data);
        },
        loadAgents() {check('agent.read'); return db.prepare('SELECT data FROM agents WHERE workspace_id=? ORDER BY id').all(workspaceId).map(row => JSON.parse(row.data));},
        saveProjectState(storeId, state) {
          check('task.execute'); identifier(storeId);
          db.prepare('INSERT INTO project_states(workspace_id,store_id,state,timestamp) VALUES(?,?,?,?) ON CONFLICT(workspace_id,store_id) DO UPDATE SET state=excluded.state,timestamp=excluded.timestamp').run(workspaceId, storeId, encode(state), Date.now());
        },
        loadProjectState(storeId) {check('task.read'); identifier(storeId); const row = db.prepare('SELECT state FROM project_states WHERE workspace_id=? AND store_id=?').get(workspaceId, storeId); return row ? JSON.parse(row.state) : null;},
        saveAgentMemory(agentId, memory) {
          check('agent.manage'); identifier(agentId);
          db.prepare(`INSERT INTO agent_memory(workspace_id,agent_id,e_pool,x_pool,weights,stats,last_update,data) VALUES(?,?,?,?,?,?,?,?)
            ON CONFLICT(workspace_id,agent_id) DO UPDATE SET e_pool=excluded.e_pool,x_pool=excluded.x_pool,weights=excluded.weights,stats=excluded.stats,last_update=excluded.last_update,data=excluded.data`).run(workspaceId, agentId, encode(memory.ePool || []), encode(memory.xPool || []), encode(memory.weights || {}), encode(memory.stats || {}), Date.now(), encode(memory));
        },
        loadAgentMemory(agentId) {check('memory.read'); identifier(agentId); const row = db.prepare('SELECT data FROM agent_memory WHERE workspace_id=? AND agent_id=?').get(workspaceId, agentId); return row ? JSON.parse(row.data) : null;},
        savePipelineResult(result) {
          check('task.execute'); identifier(result.id); identifier(result.agentId); identifier(result.threadId);
          if (!/^[a-f0-9]{64}$/.test(result.codeHash) || typeof result.passed !== 'boolean') throw new IdentityError('invalid_pipeline', 400);
          db.prepare('INSERT INTO pipeline_results(workspace_id,id,agent_id,thread_id,code_hash,passed,attempt,feedback,timestamp) VALUES(?,?,?,?,?,?,?,?,?)').run(workspaceId, result.id, result.agentId, result.threadId, result.codeHash, result.passed ? 1 : 0, integer(result.attempt, 1), content(result.feedback || ''), Date.now());
        },
        getPipelineResults(threadId) {check('task.read'); identifier(threadId); return db.prepare('SELECT id,agent_id AS agentId,thread_id AS threadId,code_hash AS codeHash,passed,attempt,feedback,timestamp FROM pipeline_results WHERE workspace_id=? AND thread_id=? ORDER BY timestamp,rowid').all(workspaceId, threadId);},
        saveLoopHealth(loopId, value) {
          check('task.execute'); identifier(loopId);
          if (![value.convergence, value.stagnation].every(number => Number.isFinite(number) && number >= 0 && number <= 1)) throw new IdentityError('invalid_number', 400);
          db.prepare(`INSERT INTO loop_health(workspace_id,loop_id,loop_type,iterations,convergence,stagnation,token_spend,last_update) VALUES(?,?,?,?,?,?,?,?)
            ON CONFLICT(workspace_id,loop_id) DO UPDATE SET loop_type=excluded.loop_type,iterations=excluded.iterations,convergence=excluded.convergence,stagnation=excluded.stagnation,token_spend=excluded.token_spend,last_update=excluded.last_update`).run(workspaceId, loopId, content(value.loopType, 128), integer(value.iterations), value.convergence, value.stagnation, integer(value.tokenSpend), Date.now());
        },
        loadLoopHealth(loopId) {check('task.read'); identifier(loopId); return db.prepare('SELECT loop_id AS loopId,loop_type AS loopType,iterations,convergence,stagnation,token_spend AS tokenSpend,last_update AS lastUpdate FROM loop_health WHERE workspace_id=? AND loop_id=?').get(workspaceId, loopId) || null;},
        saveResearch(id, data) {
          check('task.execute'); identifier(id);
          db.prepare('INSERT INTO research_sessions(workspace_id,id,data,timestamp) VALUES(?,?,?,?) ON CONFLICT(workspace_id,id) DO UPDATE SET data=excluded.data,timestamp=excluded.timestamp').run(workspaceId, id, encode(data), Date.now());
        },
        saveResearchSource(source) {
          check('task.execute'); identifier(source.id); identifier(source.researchId); content(source.url, 4096);
          let url; try {url = new URL(source.url);} catch {throw new IdentityError('invalid_source', 400);}
          if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new IdentityError('invalid_source', 400);
          db.prepare('INSERT INTO research_sources(workspace_id,id,research_id,url,title,excerpt,timestamp) VALUES(?,?,?,?,?,?,?)').run(workspaceId, source.id, source.researchId, source.url, content(source.title, 1024), content(source.excerpt), Date.now());
        },
        getResearchSources(researchId) {check('task.read'); identifier(researchId); return db.prepare('SELECT id,research_id AS researchId,url,title,excerpt,timestamp FROM research_sources WHERE workspace_id=? AND research_id=? ORDER BY rowid').all(workspaceId, researchId);},
        exportWorkspace() {
          check('workspace.manage'); const result = {};
          for (const [table, scope] of Object.entries(collaborationTableScopes)) {
            if (scope !== 'workspace') continue;
            const rows = db.prepare(`SELECT * FROM ${table} WHERE workspace_id=? LIMIT 1001`).all(workspaceId);
            if (rows.length > 1000) throw new IdentityError('export_limit', 413);
            result[table] = rows;
          }
          return result;
        }
      });
    },
    close() {closed = true;}
  };
  return Object.freeze(api);
}
module.exports = {createCollaborationStore, collaborationTableScopes};
