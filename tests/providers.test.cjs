'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const sources = JSON.parse(execFileSync(process.env.PYTHON || 'python', ['-c',
  'import json,runpy; print(json.dumps(runpy.run_path("scripts/materialize.py")["embedded_sources"]()))'
], { cwd: root, encoding: 'utf8' }));
const source = sources.SERVER_JS;
function section(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Source boundaries: ${start}`);
  return source.slice(from, to);
}
function runtime(overrides = {}, transport = {}, agentList = []) {
  const calls = [];
  const logs = [];
  const config = {
    httpPort: 3721, llmProvider: 'ollama', embeddingProvider: 'none',
    llmCloudProviders: [{id: 'cloud', baseUrl: 'https://models.example/v1', apiKeyEnv: 'TEST_KEY', fallbackModels: ['backup']}],
    ...overrides
  };
  const context = vm.createContext({
    config, process: {env: {TEST_KEY: 'synthetic-test-key'}}, URL,
    console: {log: value => logs.push(value), warn() {}, error() {}},
    path, fs, __dirname: root, setTimeout, clearTimeout,
    agents: new Map(agentList.map(a => [a.id, a])),
    axios: {
      async get(...args) { calls.push(['GET', ...args]); return transport.get ? transport.get(...args) : {data: {data: [{id: 'remote'}], models: [{name: 'local-model'}]}}; },
      async post(...args) { calls.push(['POST', ...args]); return transport.post ? transport.post(...args) : {data: {choices: [{message: {content: 'reply'}}], response: 'ollama reply', embedding: [1, 0]}}; }
    },
    logError: entry => logs.push(JSON.stringify(entry)), updateAgentMetrics() {}, broadcastAgents() {}, JSPACE_ENABLED: false
  });
  const api = vm.runInContext([
    section('const PORT =', 'const RESEARCH_DIR ='),
    section('const embeddingCache =', '// ==================== SEARCH PROVIDERS'),
    section('function simpleTfidfSimilarity', 'async function scanAndReindexTemplates'),
    section('const ollamaSemaphore =', 'async function agentRespond'),
    section('let ollamaCircuitOpen =', 'function extractCodeBlocks'),
    '({llmProviders, sanitizeLlmProviderName, queryOllamaWithRetry, queryOllama, getEmbedding, getCachedEmbedding, setCachedEmbedding, simpleTfidfSimilarity, cosineSimilarity})'
  ].join('\n'), context);
  return {api, calls, logs, config, context};
}

test('embedded server, launcher, frontend scripts and JSON parse', () => {
  new vm.Script(sources.SERVER_JS);
  new vm.Script(sources.BIN_LACK_JS);
  for (const match of sources.INDEX_HTML.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
  JSON.parse(sources.CONFIG_JSON);
});

test('Ollama and cloud agents use separate endpoints in one runtime', async () => {
  const {api, calls, logs} = runtime({}, {}, [{id:'a',provider:'ollama'},{id:'b',provider:'cloud'}]);
  assert.equal(await api.queryOllama('local-model', 'same task', '', .7, 'a'), 'ollama reply');
  assert.equal(await api.queryOllama('remote', 'same task', '', .7, 'b'), 'reply');
  assert.ok(calls[0][1].endsWith('/api/generate'));
  assert.ok(calls[1][1].endsWith('/chat/completions'));
  assert.equal(calls[1][3].maxRedirects, 0);
  assert.equal(calls[1][3].timeout, 30000);
  assert.equal(calls[1][2].max_tokens, 2048);
  assert.ok(logs.every(log => !log.includes('synthetic-test-key') && !log.includes('same task')));
});

test('cloud fallback stays within its configured model list', async () => {
  const {api,calls} = runtime({}, {post: async (url, body) => {
    if(body.model !== 'backup') throw {response:{status:404}, message:'sensitive transport data'};
    return {data:{choices:[{message:{content:'fallback reply'}}]}};
  }}, [{id:'b',provider:'cloud'}]);
  assert.equal(await api.queryOllamaWithRetry('bad', 'task', '', .7, 'b', 1), 'fallback reply');
  assert.deepEqual(calls.map(call => call[2].model), ['bad', 'backup']);
});

test('local-only blocks a cloud primary before transport', async () => {
  const {api,calls} = runtime({agentRouting:{b:{localOnly:true}}}, {}, [{id:'b',provider:'cloud'}]);
  assert.match(await api.queryOllama('remote', 'private', '', .7, 'b'), /blocked by policy/);
  assert.equal(calls.length,0);
});

test('cross-provider cloud fallback requires an explicit opt-in', async () => {
  for(const allow of [false,true]) {
    const {api,calls} = runtime({fallbackModels:[],agentRouting:{a:{allowCloudFallback:allow,fallback:{provider:'cloud',model:'remote'}}}},
      {post: async url => { if(url.endsWith('/api/generate')) throw new Error('local unavailable'); return {data:{choices:[{message:{content:'cloud fallback'}}]}}; }}, [{id:'a',provider:'ollama'}]);
    const reply = await api.queryOllama('local', 'task', '', .7, 'a');
    assert.equal(calls.length, allow ? 2 : 1);
    assert.equal(allow ? reply : reply.includes('blocked by policy'), allow ? 'cloud fallback' : true);
  }
});

test('explicit local OpenAI-compatible endpoint works without a key', async () => {
  const {api,calls} = runtime({llmProviders:[{id:'local-vllm',local:true,requiresApiKey:false,baseUrl:'http://127.0.0.1:8000/v1'}]}, {}, [{id:'a',provider:'local-vllm'}]);
  assert.equal(await api.queryOllama('local', 'task', '', .7, 'a'), 'reply');
  assert.equal(calls[0][3].headers.Authorization, undefined);
});

test('missing credentials and unknown providers do not send traffic', async () => {
  const {api,calls} = runtime({llmCloudProviders:[{id:'missing',baseUrl:'https://example.com/v1'}]}, {}, [{id:'b',provider:'missing'}]);
  assert.match(await api.queryOllama('remote', 'task', '', .7, 'b'), /not configured/);
  assert.throws(() => api.sanitizeLlmProviderName('typo', 'ollama'), /Unsupported/);
  assert.equal(calls.length,0);
  assert.throws(() => runtime({llmCloudProviders:[{id:'bad',baseUrl:'http://example.com/v1'}]}), /HTTPS/);
});

test('model discovery failure returns static models', async () => {
  const {api} = runtime({llmCloudProviders:[{id:'cloud',baseUrl:'https://example.com/v1',apiKeyEnv:'TEST_KEY',models:['manual-model']}]}, {get: async () => {throw new Error('unavailable');}});
  assert.deepEqual(Array.from(await api.llmProviders.cloud.listModels()), ['manual-model']);
});

test('timeout is propagated and a failed queued request does not poison later calls', async () => {
  let first = true;
  const {api,calls} = runtime({llmCloudProviders:[{id:'cloud',baseUrl:'https://example.com/v1',apiKeyEnv:'TEST_KEY',timeoutMs:100}]}, {post: async () => {
    if(first) {first=false;throw {code:'ECONNABORTED',message:'timeout with secret'};}
    return {data:{choices:[{message:{content:'recovered'}}]}};
  }}, [{id:'b',provider:'cloud'}]);
  assert.match(await api.queryOllama('model','task','',.7,'b'), /timed out/);
  assert.equal(await api.queryOllama('model','task','',.7,'b'), 'recovered');
  assert.equal(calls[0][3].timeout,100);
});

test('memory defaults stay independent of chat and cache uses full text', async () => {
  const {api,calls,config} = runtime({llmProvider:'cloud',embeddingProvider:'none'});
  assert.equal(await api.getEmbedding('private memory'), null);
  assert.equal(calls.length,0);
  config.embeddingProvider='ollama';
  await api.getEmbedding('private memory');
  assert.ok(calls[0][1].endsWith('/api/embeddings'));
  api.setCachedEmbedding('x'.repeat(501)+'a',[1]);
  assert.equal(api.getCachedEmbedding('x'.repeat(501)+'b'),null);
  config.embeddingModel='another-embedding';
  // Runtime model selection is immutable until restart; namespace includes resolved model.
  assert.ok(Number.isFinite(api.simpleTfidfSimilarity('same text','same text')));
  assert.equal(api.cosineSimilarity([0,0],[0,0]),0);
  assert.equal(api.cosineSimilarity([1],[1,2]),0);
});

test('workspace tools reject traversal and symbolic links', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'lack-path-'));
  t.after(() => fs.rmSync(temp,{recursive:true,force:true}));
  const workspace = path.join(temp,'workspace');
  const outside = path.join(temp,'outside');
  fs.mkdirSync(workspace);fs.mkdirSync(outside);
  fs.symlinkSync(outside,path.join(workspace,'link'),'junction');
  const check = vm.runInNewContext(section('function securePath(', 'const ALLOWED_COMMANDS')+';securePath', {path,fs,WORKSPACE_ROOT:workspace});
  assert.equal(check('notes/new.txt'),path.join(workspace,'notes/new.txt'));
  assert.throws(()=>check('../outside/secret'),/outside/);
  assert.throws(()=>check(path.join(outside,'secret')),/outside/);
  assert.throws(()=>check('link/secret'),/Symbolic/);
});

test('legacy database migration preserves local assignment under a cloud default', t => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');t.after(()=>db.close());
  db.exec("CREATE TABLE agents (id TEXT PRIMARY KEY,name TEXT,model TEXT,system_prompt TEXT,channels TEXT,strict_channel TEXT,status TEXT,is_embed_operator INTEGER,is_code_moderator INTEGER)");
  db.exec("INSERT INTO agents (id,name,model,system_prompt,channels) VALUES ('legacy','Legacy','old-local','prompt','[]')");
  const {context} = runtime({llmProvider:'cloud'});
  context.db=db;
  vm.runInContext(section('const existingAgentColumns =','function dbSaveMessage'),context);
  const api=vm.runInContext(section('function dbSaveAgent(', '// ==================== EMBEDDING CACHE')+';({dbSaveAgent,dbLoadAllAgents})',context);
  assert.equal(api.dbLoadAllAgents().legacy.provider,'ollama');
  api.dbSaveAgent({id:'new',name:'Cloud',provider:'cloud',model:'remote',systemPrompt:'prompt',channels:['general']});
  assert.equal(api.dbLoadAllAgents().new.provider,'cloud');
});

test('embedding namespace change invalidates vectors and preserves memory text', t => {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'lack-memory-'));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  fs.writeFileSync(path.join(temp,'a.json'),JSON.stringify({embeddingNamespace:'old',ePool:[{trajectory:'retained evidence',embedding:[1,2]}],xPool:[]}));
  const {context}=runtime();
  context.AGENT_MEMORY_DIR=temp;context.agentMemories=new Map();
  vm.runInContext(section('function initAgentMemory(', 'async function addToMemory')+";initAgentMemory('a');",context);
  const restored=JSON.parse(fs.readFileSync(path.join(temp,'a.json')));
  assert.equal(restored.ePool[0].trajectory,'retained evidence');
  assert.equal(restored.ePool[0].embedding,null);
  assert.notEqual(restored.embeddingNamespace,'old');
});

test('shell is disabled even for the Moderator by default', async () => {
  const {context}=runtime();
  const execute=vm.runInContext(section('async function executeTool(', 'const SKILLS_DIR')+';executeTool',context);
  assert.match(await execute('execute_command',{command:'should never execute'},'moderator'),/disabled/);
});

test('actual HTTP transport aborts a slow local model at its configured timeout', async t => {
  const http=require('node:http');
  const axios=require('axios');
  const {once}=require('node:events');
  const server=http.createServer((req,res)=>{setTimeout(()=>res.end('{}'),2000).unref();});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{server.closeAllConnections();server.close();});
  const {api}=runtime({llmProviders:[{id:'slow',local:true,requiresApiKey:false,baseUrl:`http://127.0.0.1:${server.address().port}/v1`,timeoutMs:100}]}, {post:(...args)=>axios.post(...args)}, [{id:'s',provider:'slow'}]);
  const started=Date.now();
  assert.match(await api.queryOllama('model','task','',.7,'s'),/timed out/);
  assert.ok(Date.now()-started<1500,'HTTP request was cancelled before the delayed response');
});
