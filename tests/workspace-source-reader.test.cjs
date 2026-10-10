'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const Database = require('better-sqlite3');
const { openWorkspaceSource } = require('../scripts/workspace-source-reader.cjs');
function fixture(t, live = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-source-reader-test-'));
  const source = path.join(root, 'original.db');
  const writer = new Database(source);
  writer.pragma('journal_mode = WAL'); writer.pragma('wal_autocheckpoint = 0');
  writer.exec('CREATE TABLE evidence(id INTEGER PRIMARY KEY,original TEXT); INSERT INTO evidence VALUES(1,\'original source\')');
  if (!live) writer.close();
  const readers = [];
  t.after(() => {
    for (const reader of readers.reverse()) reader.close();
    if (writer.open) writer.close();
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { source, root, writer, open() { const reader = openWorkspaceSource(source); readers.push(reader); return reader; } };
}
function inventory(root) { return fs.readdirSync(root).sort().map(name => ({ name, sha256: createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex') })); }
test('closed WAL source keeps original bytes and absent sidecars throughout inspection', t => {
  const f = fixture(t); const before = inventory(f.root); const reader = f.open();
  assert.equal(reader.db.readonly, true); assert.notEqual(reader.db.name, f.source);
  assert.equal(reader.db.prepare('SELECT original FROM evidence').get().original, 'original source');
  assert.deepEqual(inventory(f.root), before); reader.close(); reader.close(); assert.deepEqual(inventory(f.root), before);
});
test('committed live WAL rows survive private recovery without changing original main, WAL or SHM', t => {
  const f = fixture(t, true); f.writer.prepare('INSERT INTO evidence VALUES(?,?)').run(2, 'committed WAL');
  const before = inventory(f.root); const reader = f.open();
  assert.equal(reader.db.prepare('SELECT COUNT(*) AS n FROM evidence').get().n, 2);
  assert.equal(reader.db.prepare('SELECT original FROM evidence WHERE id=2').get().original, 'committed WAL');
  assert.deepEqual(inventory(f.root), before); reader.close(); assert.deepEqual(inventory(f.root), before);
});
test('an original empty WAL file is preserved rather than deleted or expanded', t => {
  const f = fixture(t); fs.writeFileSync(f.source + '-wal', Buffer.alloc(0));
  const before = inventory(f.root); const reader = f.open();
  assert.equal(reader.db.prepare('SELECT COUNT(*) AS n FROM evidence').get().n, 1);
  reader.close(); assert.deepEqual(inventory(f.root), before);
});
test('changed source while a reader is open is detected before cleanup without overwriting the source', t => {
  const f = fixture(t); const reader = f.open(); const ownedRoot = path.dirname(reader.db.name);
  fs.appendFileSync(f.source, Buffer.from('changed'));
  const changed = inventory(f.root);
  assert.throws(() => reader.close(), /migration_source_changed/);
  assert.deepEqual(inventory(f.root), changed); assert.equal(fs.existsSync(ownedRoot), false);
});
test('invalid database bytes and a nonempty rollback journal fail closed without mutating originals', t => {
  const f = fixture(t); fs.writeFileSync(f.source, 'not SQLite');
  let before = inventory(f.root); assert.throws(() => f.open(), /migration_source_database_invalid/); assert.deepEqual(inventory(f.root), before);
  fs.writeFileSync(f.source + '-journal', 'unresolved hot journal'); before = inventory(f.root);
  assert.throws(() => f.open(), /migration_source_busy/); assert.deepEqual(inventory(f.root), before);
});
test('linked sources and oversized main files are rejected before SQLite can touch their directory', t => {
  const f = fixture(t); const link = path.join(f.root, 'linked.db'); fs.symlinkSync(f.source, link, 'file');
  assert.throws(() => openWorkspaceSource(link), /migration_linked_path_denied/); fs.unlinkSync(link);
  const fd = fs.openSync(f.source, 'r+'); try { fs.ftruncateSync(fd, 64 * 1024 * 1024 + 1); } finally { fs.closeSync(fd); }
  assert.throws(() => f.open(), /migration_source_file_limit/);
  assert.deepEqual(fs.readdirSync(f.root), ['original.db']);
});
