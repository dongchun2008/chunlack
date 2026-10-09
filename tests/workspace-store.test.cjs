'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const vm = require('node:vm');
const {createRequire} = require('node:module');
const {workspaceFixture, throwsCode} = require('./helpers/workspace-fixture.cjs');
const {runWithWorkspace} = require('../collaboration/context.cjs');
const {createCollaborationStore, collaborationTableScopes} = require('../collaboration/store.cjs');
function fixture(t) {
  const f = workspaceFixture(t);
  const db = new Database(path.join(f.dir, 'collaboration.sqlite'));
  const store = createCollaborationStore({db, identity: f.store});
  const dispose = () => {store.close(); if (db.open) db.close();};
  // Close the extra connection before the identity fixture removes its Windows directory.
  t.after(dispose);
  const scope = (user, workspace, fn) => runWithWorkspace(f.actor(user, workspace), () => fn(store.forWorkspace(f.actor(user, workspace))));
  return {...f, db, collaboration: store, scope, dispose};
}
const message = (id, content, extra = {}) => ({id, content, senderType: 'human', timestamp: 1791504000000, ...extra});

test('same message, channel, thread and agent identifiers remain isolated across workspaces', t => {
  const f = fixture(t);
  try {
    for (const [user, workspace, content] of [['alice', 'a', 'A-only'], ['bob', 'b', 'B-only']]) f.scope(user, workspace, scope => {
      scope.saveAgent({id: 'moderator', name: 'Moderator', model: 'local-model', provider: 'openai-compatible', systemPrompt: content});
      scope.saveMessage(message('root', content), 'general');
      scope.saveMessage(message('reply', content + '-reply', {parentId: 'root', threadId: 'root'}), 'general');
      scope.saveProjectState('general', {content});
    });
    f.scope('alice', 'a', scope => {
      assert.deepEqual(scope.getMessages('general').map(m => m.content), ['A-only', 'A-only-reply']);
      assert.equal(scope.loadAgents()[0].systemPrompt, 'A-only');
      assert.deepEqual(scope.loadProjectState('general'), {content: 'A-only'});
    });
    f.scope('bob', 'b', scope => assert.deepEqual(scope.getMessages('general').map(m => m.content), ['B-only', 'B-only-reply']));
  } finally {f.dispose();}
});

test('workspace handles require a matching current context and refresh role on every operation', t => {
  const f = fixture(t);
  try {
    throwsCode(() => f.collaboration.forWorkspace(f.actor('alice', 'a')), 'workspace_context_required');
    let captured;
    f.scope('alice', 'a', scope => {captured = scope; scope.saveMessage(message('root', 'a'), 'general');});
    throwsCode(() => captured.getMessages('general'), 'workspace_context_required');
    f.scope('bob', 'b', () => throwsCode(() => captured.getMessages('general'), 'context_mismatch'));
    f.store.setMembership(f.actor('alice', 'a'), {workspaceId: f.workspaces.a.id, userId: f.users.bob.id, role: 'viewer'});
    runWithWorkspace({userId: f.users.bob.id, workspaceId: f.workspaces.a.id, role: 'owner', version: 1}, () => {
      const scope = f.collaboration.forWorkspace({userId: f.users.bob.id, workspaceId: f.workspaces.a.id});
      assert.equal(scope.getMessages('general').length, 1);
      throwsCode(() => scope.saveMessage(message('forged', 'bad'), 'general'), 'forbidden');
    });
  } finally {f.dispose();}
});

test('foreign keys prevent cross-workspace parent, thread, agent and memory associations', t => {
  const f = fixture(t);
  try {
    f.scope('alice', 'a', scope => {scope.saveAgent({id: 'agent-a', name: 'A', model: 'm', provider: 'ollama'}); scope.saveMessage(message('only-a', 'a'), 'general');});
    f.scope('bob', 'b', scope => {
      assert.throws(() => scope.saveMessage(message('reply', 'b', {parentId: 'only-a'}), 'general'), /FOREIGN KEY/);
      assert.throws(() => scope.saveMessage(message('reply', 'b', {threadId: 'only-a'}), 'general'), /FOREIGN KEY/);
      assert.throws(() => scope.saveMessage(message('reply', 'b', {senderType: 'agent', sender: 'agent-a'}), 'general'), /FOREIGN KEY/);
      assert.throws(() => scope.saveAgentMemory('agent-a', {facts: []}), /FOREIGN KEY/);
    });
    assert.throws(() => f.db.prepare('INSERT INTO project_states(workspace_id,store_id,state,timestamp) VALUES(NULL,?,?,?)').run('general', '{}', 0), /NOT NULL/);
  } finally {f.dispose();}
});

test('search, export, pipeline and loop health are workspace scoped including negative paths', t => {
  const f = fixture(t);
  try {
    for (const [user, workspace, content] of [['alice', 'a', 'alpha evidence'], ['bob', 'b', 'beta evidence']]) f.scope(user, workspace, scope => {
      scope.saveAgent({id: 'moderator', name: 'Moderator', model: 'm', provider: 'ollama'});
      scope.saveMessage(message('root', content), 'general');
      scope.savePipelineResult({id: 'pipeline', agentId: 'moderator', threadId: 'root', codeHash: 'a'.repeat(64), passed: true, attempt: 1, feedback: content});
      scope.saveLoopHealth('loop', {loopType: 'discussion', iterations: 1, convergence: 0, stagnation: 0.25, tokenSpend: 10});
    });
    f.scope('alice', 'a', scope => {
      assert.equal(scope.searchMessages('beta').length, 0);
      assert.equal(scope.searchMessages('%').length, 0);
      assert.equal(scope.getPipelineResults('root')[0].feedback, 'alpha evidence');
      assert.equal(scope.loadLoopHealth('missing'), null);
      assert.ok(!JSON.stringify(scope.exportWorkspace()).includes('beta evidence'));
    });
    f.scope('bob', 'b', scope => {assert.equal(scope.loadLoopHealth('loop').tokenSpend, 10); assert.equal(scope.loadLoopHealth('loop').stagnation, 0.25);});
  } finally {f.dispose();}
});

test('research sources retain original URL and cannot be read from another workspace', t => {
  const f = fixture(t);
  try {
    f.scope('alice', 'a', scope => {
      scope.saveResearch('research', {topic: 'Evidence', status: 'pending'});
      scope.saveResearchSource({id: 'source-a', researchId: 'research', url: 'https://example.com/original?q=source', title: 'Original', excerpt: 'observed excerpt'});
      assert.equal(scope.getResearchSources('research')[0].url, 'https://example.com/original?q=source');
    });
    f.scope('bob', 'b', scope => {
      assert.deepEqual(scope.getResearchSources('research'), []);
      assert.throws(() => scope.saveResearchSource({id: 'forged', researchId: 'research', url: 'https://example.com', title: 'X', excerpt: 'X'}), /FOREIGN KEY/);
    });
  } finally {f.dispose();}
});

test('schema inventory rejects unclassified tables and never silently migrates legacy messages', t => {
  const f = fixture(t);
  try {
    const tables = f.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(row => row.name).sort();
    assert.deepEqual(tables, Object.keys(collaborationTableScopes).sort());
    f.db.exec('CREATE TABLE unclassified_secret(id TEXT)');
    throwsCode(() => createCollaborationStore({db: f.db, identity: f.store}), 'unclassified_schema');
    const legacy = new Database(':memory:');
    try {
      legacy.exec("CREATE TABLE messages(id TEXT PRIMARY KEY,content TEXT); INSERT INTO messages VALUES('old','retain');");
      throwsCode(() => createCollaborationStore({db: legacy, identity: f.store}), 'workspace_migration_required');
      assert.equal(legacy.prepare('SELECT content FROM messages').get().content, 'retain');
    } finally {legacy.close();}
  } finally {f.dispose();}
});

test('stores remain isolated after reopening and reject oversized or private configuration payloads', t => {
  const f = fixture(t);
  try {
    f.scope('alice', 'a', scope => {
      scope.saveMessage(message('root', 'persisted-a'), 'general');
      throwsCode(() => scope.saveAgent({id: 'bad', name: 'Bad', model: 'm', provider: 'ollama', apiKey: 'never-save'}), 'private_config_forbidden');
      throwsCode(() => scope.saveMessage(message('huge', 'x'.repeat(262145)), 'general'), 'invalid_content');
    });
    f.collaboration.close();
    const reopened = createCollaborationStore({db: f.db, identity: f.store});
    runWithWorkspace(f.actor('alice', 'a'), () => assert.equal(reopened.forWorkspace(f.actor('alice', 'a')).getMessages('general')[0].content, 'persisted-a'));
    runWithWorkspace(f.actor('bob', 'b'), () => assert.equal(reopened.forWorkspace(f.actor('bob', 'b')).getMessages('general').length, 0));
    reopened.close();
  } finally {f.dispose();}
});

test('embedded server delegates its persistence and map entry points and rejects raw unscoped business SQL', t => {
  const f = workspaceFixture(t);
  const root = path.resolve(__dirname, '..');
  const pythonSource = fs.readFileSync(path.join(root, 'lack.py'), 'utf8');
  const match = pythonSource.match(/SERVER_JS\s*=\s*r?'''([\s\S]*?)'''/);
  assert.ok(match, 'embedded source exists');
  const source = match[1];
  const persistenceStart = source.indexOf('// ==================== SQLite PERSISTENCE');
  const persistenceEnd = source.indexOf('// ==================== EMBEDDING CACHE');
  const mapsStart = source.indexOf('// ==================== DATA STRUCTURES');
  const mapsEnd = source.indexOf('function getUserId', mapsStart);
  assert.ok(persistenceStart >= 0 && persistenceEnd > persistenceStart && mapsStart >= 0 && mapsEnd > mapsStart);
  const context = vm.createContext({fs, path, sqlite3: Database, __dirname: f.dir, require: createRequire(path.join(root, 'server.js')), process: {env: {LACK_MULTI_USER: '1', LACK_IDENTITY_DB: f.dbPath}}});
  try {
    vm.runInContext(source.slice(persistenceStart, persistenceEnd) + source.slice(mapsStart, mapsEnd) + `
      globalThis.runtime={dbSaveMessage,dbGetMessages,dbSaveAgent,dbLoadAllAgents,getProjectState,setProjectState,
        channels,agents,loopHealth,rawRead(){return db.prepare('SELECT * FROM messages').all();}};
    `, context);
    const runtime = context.runtime;
    throwsCode(() => runtime.dbGetMessages('general'), 'workspace_context_required');
    for (const [user, workspace, content] of [['alice', 'a', 'server-a'], ['bob', 'b', 'server-b']]) runWithWorkspace(f.actor(user, workspace), () => {
      runtime.dbSaveAgent({id: 'moderator', name: 'Moderator', model: 'm', provider: 'ollama', systemPrompt: content});
      runtime.dbSaveMessage(message('root', content), 'general');
      runtime.dbSaveMessage(message('agent-output', content + '-agent', {senderType: 'agent', sender: 'Moderator'}), 'general');
      runtime.channels.set('general', content); runtime.agents.set('moderator', content);
      runtime.setProjectState('general', {active: true, title: content});
    });
    runWithWorkspace(f.actor('alice', 'a'), () => {
      assert.equal(runtime.dbGetMessages('general')[0].content, 'server-a');
      assert.equal(runtime.dbGetMessages('general')[1].sender, 'Moderator');
      assert.equal(runtime.dbLoadAllAgents().moderator.systemPrompt, 'server-a');
      assert.equal(runtime.channels.get('general'), 'server-a');
      assert.equal(runtime.agents.get('moderator'), 'server-a');
      assert.equal(runtime.getProjectState('general').title, 'server-a');
      assert.throws(() => runtime.rawRead(), /workspace_sql_required/);
    });
    context.process.env.LACK_PUBLIC_MODE = '1'; delete context.process.env.LACK_MULTI_USER;
    assert.throws(() => vm.runInContext('workspaceServices()', context), /legacy_public_forbidden/);
  } finally {
    vm.runInContext('workspaceRuntimeServices?.close(); db.close();', context);
  }
});
