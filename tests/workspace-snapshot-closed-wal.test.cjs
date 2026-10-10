'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createHash}=require('node:crypto'),Database=require('better-sqlite3');
const {prepareWorkspaceSnapshot,verifyWorkspaceSnapshot}=require('../scripts/workspace-snapshot.cjs');
const digest=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
test('snapshot of a closed WAL database preserves its original bytes and absent sidecars without a false source-change rejection',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'lack-closed-wal-snapshot-'));
  t.after(()=>{const owned=path.resolve(root);if(!owned.startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(owned).startsWith('lack-closed-wal-snapshot-'))throw Error('unsafe cleanup');fs.rmSync(owned,{recursive:true,force:true});});
  const source=path.join(root,'source'),snapshot=path.join(root,'snapshot');
  fs.mkdirSync(path.join(source,'config'),{recursive:true,mode:0o700});fs.mkdirSync(path.join(source,'db'),{mode:0o700});
  fs.writeFileSync(path.join(source,'config','lack.config.json'),JSON.stringify({llmProvider:'ollama',agents:[]}),{mode:0o600});
  const file=path.join(source,'db','lack.db'),db=new Database(file);
  db.pragma('journal_mode=WAL');db.exec("CREATE TABLE messages(id TEXT PRIMARY KEY,content TEXT);INSERT INTO messages VALUES('original','source must remain untouched')");db.close();
  const before={main:digest(file),files:fs.readdirSync(path.dirname(file)).sort()};
  assert.equal(fs.existsSync(file+'-wal'),false);assert.equal(fs.existsSync(file+'-shm'),false);
  await prepareWorkspaceSnapshot({sourceRoot:source,snapshotRoot:snapshot});
  assert.equal(verifyWorkspaceSnapshot(snapshot).migrationReady,false);
  assert.deepEqual({main:digest(file),files:fs.readdirSync(path.dirname(file)).sort()},before);
  const copy=new Database(path.join(snapshot,'candidate','db','lack.db'),{readonly:true});
  try{assert.equal(copy.prepare('SELECT content FROM messages').get().content,'source must remain untouched');}finally{copy.close();}
});
