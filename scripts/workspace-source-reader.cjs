'use strict';

// SQLite may create WAL/SHM even for readonly connections. Never open an
// operator's original database here: read bounded bytes into an owned directory,
// check stability, let SQLite recover the copied WAL, then return a readonly DB.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const Database = require('better-sqlite3');
const LIMIT = 64 * 1024 * 1024;
function fail(code) { return Object.assign(new Error(code), { code }); }
function checked(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || /[\x00-\x1f\x7f]/.test(file)) throw fail('migration_absolute_path_required');
  file = path.resolve(file);
  for (let current = file;; current = path.dirname(current)) {
    try { if (fs.lstatSync(current).isSymbolicLink()) throw fail('migration_linked_path_denied'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (path.dirname(current) === current) break;
  }
  return file;
}
function inspect(file, output) {
  checked(file);
  let stat;
  try { stat = fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT' && !output) return null; throw error; }
  if (!stat.isFile()) throw fail('migration_invalid_path');
  if (stat.size > LIMIT) throw fail('migration_source_file_limit');
  let fd; let destination;
  const hash = createHash('sha256'); const buffer = Buffer.alloc(65536); let bytes = 0;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.ino !== stat.ino || opened.dev !== stat.dev || opened.size !== stat.size) throw fail('migration_source_changed');
    if (output) destination = fs.openSync(output, 'wx', 0o600);
    for (;;) {
      const count = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!count) break;
      bytes += count;
      if (bytes > LIMIT) throw fail('migration_source_file_limit');
      hash.update(buffer.subarray(0, count));
      if (destination !== undefined) {
        let written = 0;
        while (written < count) written += fs.writeSync(destination, buffer, written, count - written);
      }
    }
    if (destination !== undefined) fs.fsyncSync(destination);
    const final = fs.fstatSync(fd); const named = fs.lstatSync(file);
    if (named.isSymbolicLink() || named.ino !== stat.ino || named.dev !== stat.dev || final.size !== stat.size || bytes !== stat.size) throw fail('migration_source_changed');
    return { bytes, sha256: hash.digest('hex'), ino: stat.ino, dev: stat.dev };
  } finally {
    if (destination !== undefined) fs.closeSync(destination);
    if (fd !== undefined) fs.closeSync(fd);
  }
}
function fingerprint(file) {
  const main = inspect(file);
  if (!main) throw fail('migration_source_missing');
  const wal = inspect(file + '-wal');
  const journal = inspect(file + '-journal');
  // A hot rollback journal cannot be discarded or recovered on the original.
  if (journal?.bytes) throw fail('migration_source_busy');
  return { main, wal, journal };
}
function openWorkspaceSource(sourcePath) {
  sourcePath = checked(sourcePath);
  const before = fingerprint(sourcePath);
  const parent = path.resolve(os.tmpdir());
  checked(parent);
  const staging = fs.mkdtempSync(path.join(parent, 'chunlack-source-read-'));
  if (process.platform !== 'win32') fs.chmodSync(staging, 0o700);
  const copy = path.join(staging, 'source.db');
  let db; let closed = false;
  function removeOwned() {
    const resolved = path.resolve(staging);
    if (path.dirname(resolved) !== parent || !path.basename(resolved).startsWith('chunlack-source-read-') || fs.lstatSync(resolved).isSymbolicLink()) throw fail('migration_unsafe_cleanup');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
  try {
    if (JSON.stringify(inspect(sourcePath, copy)) !== JSON.stringify(before.main)) throw fail('migration_source_changed');
    if (before.wal && JSON.stringify(inspect(sourcePath + '-wal', copy + '-wal')) !== JSON.stringify(before.wal)) throw fail('migration_source_changed');
    if (JSON.stringify(fingerprint(sourcePath)) !== JSON.stringify(before)) throw fail('migration_source_changed');
    db = new Database(copy, { fileMustExist: true, timeout: 1000 });
    if (db.pragma('quick_check', { simple: true }) !== 'ok') throw fail('migration_source_database_invalid');
    if (db.pragma('wal_checkpoint(TRUNCATE)').some(row => row.busy !== 0)) throw fail('migration_source_busy');
    if (db.pragma('journal_mode = DELETE', { simple: true }) !== 'delete') throw fail('migration_source_database_invalid');
    db.close(); db = new Database(copy, { readonly: true, fileMustExist: true, timeout: 1000 });
    db.pragma('query_only = ON');
    return { db, close() {
      if (closed) return;
      closed = true;
      try {
        db.close();
        if (JSON.stringify(fingerprint(sourcePath)) !== JSON.stringify(before)) throw fail('migration_source_changed');
      } finally { removeOwned(); }
    } };
  } catch (error) {
    if (db?.open) db.close();
    removeOwned();
    if (error.code?.startsWith('migration_')) throw error;
    throw fail('migration_source_database_invalid');
  }
}

module.exports = { openWorkspaceSource };
