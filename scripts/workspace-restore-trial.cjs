'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { verifyWorkspaceSnapshot } = require('./workspace-snapshot.cjs');

const MAX_FILE_BYTES = 64 * 1024 * 1024;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function checkedPath(value, allowMissing = false) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /[\x00-\x1f]/.test(value)) throw fail('restore_invalid_path');
  const result = path.resolve(value);
  let current = path.parse(result).root;
  for (const part of result.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let stat;
    try { stat = fs.lstatSync(current); }
    catch (error) {
      if (allowMissing && error.code === 'ENOENT') continue;
      throw error;
    }
    if (stat.isSymbolicLink()) throw fail('restore_link_denied');
  }
  return result;
}

function payloadFile(root, relative, allowMissing = false) {
  if (typeof relative !== 'string' || relative.length > 1024 || /[\\\x00-\x1f]/.test(relative) ||
      relative.split('/').some(part => !part || part === '.' || part === '..' || part.includes(':'))) throw fail('restore_invalid_relative_path');
  const file = checkedPath(path.join(root, ...relative.split('/')), allowMissing);
  if (!file.startsWith(root + path.sep)) throw fail('restore_path_escape');
  return file;
}

function readMetadata(file, limit) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit) throw fail('restore_metadata_invalid');
  const bytes = fs.readFileSync(file);
  try { return { bytes, value: JSON.parse(bytes.toString('utf8')) }; }
  catch { throw fail('restore_metadata_invalid'); }
}

function writeExclusive(file, bytes) {
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
}

function writeState(root, value, initial = false) {
  const target = path.join(root, 'restore-trial-state.json');
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  if (initial) return writeExclusive(target, bytes);
  const staging = path.join(root, '.restore-trial-state-' + randomUUID());
  writeExclusive(staging, bytes);
  fs.renameSync(staging, target);
}

function copyChecked(source, destination, expected) {
  if (!Number.isSafeInteger(expected.bytes) || expected.bytes < 0 || expected.bytes > MAX_FILE_BYTES) throw fail('restore_file_limit');
  const input = fs.openSync(source, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  let output;
  const buffer = Buffer.alloc(64 * 1024);
  const hash = createHash('sha256');
  let bytes = 0;
  try {
    const stat = fs.fstatSync(input);
    if (!stat.isFile() || stat.size !== expected.bytes) throw fail('restore_copy_mismatch');
    output = fs.openSync(destination, 'wx', 0o600);
    let count;
    while ((count = fs.readSync(input, buffer, 0, buffer.length, null)) > 0) {
      bytes += count;
      if (bytes > expected.bytes) throw fail('restore_copy_mismatch');
      hash.update(buffer.subarray(0, count));
      let offset = 0;
      while (offset < count) offset += fs.writeSync(output, buffer, offset, count - offset);
    }
    fs.fsyncSync(output);
  } finally {
    fs.closeSync(input);
    if (output !== undefined) fs.closeSync(output);
  }
  if (bytes !== expected.bytes || hash.digest('hex') !== expected.sha256) throw fail('restore_copy_mismatch');
}

function privateDirectory(directory) {
  checkedPath(directory, true);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}

function prepareWorkspaceRestoreTrial({ snapshotRoot, restoreRoot }) {
  const source = checkedPath(snapshotRoot);
  const target = checkedPath(restoreRoot, true);
  if (source === target || source.startsWith(target + path.sep) || target.startsWith(source + path.sep)) throw fail('restore_roots_overlap');
  if (fs.existsSync(target)) throw fail('restore_destination_exists');
  if (!fs.statSync(checkedPath(path.dirname(target))).isDirectory()) throw fail('restore_parent_missing');
  const verified = verifyWorkspaceSnapshot(source);
  const manifest = readMetadata(payloadFile(source, 'manifest.json'), 2 * 1024 * 1024);
  const originalState = readMetadata(payloadFile(source, 'snapshot-state.json'), 16384);
  const trialId = randomUUID();
  const marker = { version: 1, trialId, snapshotId: verified.snapshotId, status: 'building', migrationReady: false, restoreReady: false };
  // No source directory is created, replaced, changed, or started as a service.
  fs.mkdirSync(target, { mode: 0o700 });
  writeState(target, marker, true);
  try {
    const payload = path.join(target, 'payload');
    privateDirectory(payload);
    const records = [...manifest.value.records];
    for (const [relativePath, metadata] of [['manifest.json', manifest], ['snapshot-state.json', originalState]]) {
      records.push({ relativePath, bytes: metadata.bytes.length, sha256: createHash('sha256').update(metadata.bytes).digest('hex') });
    }
    for (const record of records) {
      const input = payloadFile(source, record.relativePath);
      const output = payloadFile(payload, record.relativePath, true);
      privateDirectory(path.dirname(output));
      copyChecked(input, output, record);
    }
    const restored = verifyWorkspaceSnapshot(payload);
    const freshSource = verifyWorkspaceSnapshot(source);
    if (JSON.stringify(restored) !== JSON.stringify(verified) || JSON.stringify(freshSource) !== JSON.stringify(verified)) throw fail('restore_source_changed');
    writeState(target, { ...marker, status: 'verified' });
    return verifyWorkspaceRestoreTrial(target);
  } catch (error) {
    writeState(target, { ...marker, status: 'failed', error: 'restore_preparation_failed' });
    throw error;
  }
}

function verifyWorkspaceRestoreTrial(restoreRoot) {
  const root = checkedPath(restoreRoot);
  const markerFile = payloadFile(root, 'restore-trial-state.json');
  const marker = readMetadata(markerFile, 16384).value;
  if (marker.version !== 1 || marker.status !== 'verified' || marker.migrationReady !== false || marker.restoreReady !== false ||
      typeof marker.trialId !== 'string' || !/^[0-9a-f-]{36}$/.test(marker.trialId)) throw fail('restore_metadata_invalid');
  const entries = fs.readdirSync(root).sort();
  if (JSON.stringify(entries) !== JSON.stringify(['payload', 'restore-trial-state.json'])) throw fail('restore_unlisted_file');
  if (process.platform !== 'win32' && ((fs.statSync(root).mode | fs.statSync(markerFile).mode) & 0o077)) throw fail('restore_permissions_invalid');
  const result = verifyWorkspaceSnapshot(checkedPath(path.join(root, 'payload')));
  if (result.snapshotId !== marker.snapshotId) throw fail('restore_metadata_invalid');
  return {
    status: 'verified', trialId: marker.trialId, snapshotId: result.snapshotId,
    fileCount: result.fileCount, databases: result.databases,
    migrationReady: false, restoreReady: false, applicationConsistency: result.applicationConsistency,
    permissionEvidence: result.permissionEvidence
  };
}

module.exports = { prepareWorkspaceRestoreTrial, verifyWorkspaceRestoreTrial };
