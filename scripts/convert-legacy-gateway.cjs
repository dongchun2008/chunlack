'use strict';

// Offline conversion only. This module never activates a deployment or a node.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { inflateSync, crc32 } = require('node:zlib');
const Database = require('better-sqlite3');
const P = require('../gateway/protocol.cjs');
const { createGatewayStore } = require('../gateway/store.cjs');

const TABLES = ['nodes', 'pairings', 'tasks', 'events', 'pilot_artifacts', 'pilot_acceptance'];
const ACTIVE = new Set(['leased', 'running', 'cancel_requested']);
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'needs_attention']);
const MAX_BYTES = 64 * 1024 * 1024;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function fail(code) { throw new Error(`gateway_conversion_${code}`); }
function integer(value, min = 0) { if (!Number.isSafeInteger(value) || value < min) fail('invalid_record'); return value; }
function id(value) { try { return P.id(value); } catch { fail('invalid_record'); } }
function text(value, max = 2000) { try { return P.text(value, max); } catch { fail('invalid_record'); } }
function json(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > P.LIMITS.bodyBytes) fail('invalid_json');
  try { return JSON.parse(P.bounded(JSON.parse(value))); } catch { fail('invalid_json'); }
}
function sqlName(name) { return `"${name.replace(/"/g, '""')}"`; }
function exists(file) { try { return fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
function safeDirectory(directory) {
  if (!path.isAbsolute(directory)) fail('invalid_path');
  let current = path.parse(directory).root;
  for (const segment of path.relative(current, directory).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = exists(current);
    if (!stat || !stat.isDirectory()) fail(stat?.isSymbolicLink() ? 'link_denied' : 'invalid_path');
    if (stat.isSymbolicLink()) fail('link_denied');
  }
}
function mkdir(directory) {
  const parent = path.dirname(directory);
  safeDirectory(parent);
  const stat = exists(directory);
  if (stat?.isSymbolicLink()) fail('link_denied');
  if (stat && !stat.isDirectory()) fail('invalid_path');
  if (!stat) fs.mkdirSync(directory, { mode: 0o700 });
  if (process.platform !== 'win32' && (fs.statSync(directory).mode & 0o077)) fail('unsafe_permissions');
}
function owner(identity, workspaceId, ownerId) {
  let membership;
  try { membership = identity.requireMembership(ownerId, workspaceId); } catch { fail('owner_required'); }
  if (membership?.role !== 'owner') fail('owner_required');
  return membership;
}
function checkPng(bytes, meta) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 2 * 1024 * 1024 || bytes.length < 57 ||
      meta.content_type !== 'image/png' || bytes.length !== meta.size_bytes || sha(bytes) !== meta.sha256 ||
      !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) fail('evidence_mismatch');
  let cursor = 8; let header = false; let ended = false; let idatEnded = false;
  let stride; let height; const compressed = [];
  while (cursor < bytes.length) {
    if (cursor + 12 > bytes.length) fail('evidence_mismatch');
    const size = bytes.readUInt32BE(cursor);
    if (size > bytes.length - cursor - 12) fail('evidence_mismatch');
    const type = bytes.toString('ascii', cursor + 4, cursor + 8);
    const data = bytes.subarray(cursor + 8, cursor + 8 + size);
    if (crc32(bytes.subarray(cursor + 4, cursor + 8 + size)) !== bytes.readUInt32BE(cursor + 8 + size)) fail('evidence_mismatch');
    if (!header && type !== 'IHDR') fail('evidence_mismatch');
    if (type === 'IHDR') {
      if (header || size !== 13) fail('evidence_mismatch');
      const width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[data[9]];
      // Deliberately fail closed on indexed/interlaced or non-8-bit legacy images.
      if (!width || !height || width > 4096 || height > 4096 || width !== meta.width || height !== meta.height ||
          !channels || data[8] !== 8 || data[10] || data[11] || data[12]) fail('evidence_mismatch');
      stride = width * channels + 1;
      if (stride * height > 32 * 1024 * 1024) fail('evidence_mismatch');
      header = true;
    } else if (type === 'IDAT') {
      if (idatEnded || !size) fail('evidence_mismatch');
      compressed.push(data);
    } else if (type === 'IEND') {
      if (size || !compressed.length) fail('evidence_mismatch');
      ended = true;
      cursor += 12;
      break;
    } else {
      if (compressed.length) idatEnded = true;
      if (!(bytes[cursor + 4] & 32)) fail('evidence_mismatch');
    }
    cursor += size + 12;
  }
  if (!ended || cursor !== bytes.length) fail('evidence_mismatch');
  let decoded;
  try { decoded = inflateSync(Buffer.concat(compressed), { maxOutputLength: stride * height }); } catch { fail('evidence_mismatch'); }
  if (decoded.length !== stride * height) fail('evidence_mismatch');
  for (let row = 0; row < height; row++) if (decoded[row * stride] > 4) fail('evidence_mismatch');
}

function convertLegacyGateway({ source, targetRoot, identity, workspaceId, ownerId, now = Date.now, readArtifact }) {
  workspaceId = id(workspaceId); ownerId = id(ownerId);
  owner(identity, workspaceId, ownerId);
  if (!source?.open || !source.readonly || !path.isAbsolute(source.name) || !path.isAbsolute(targetRoot)) fail('invalid_source');
  safeDirectory(targetRoot);
  const root = fs.realpathSync(targetRoot);
  const sourceParent = path.dirname(fs.realpathSync(source.name));
  for (const [parent, child] of [[root, sourceParent], [sourceParent, root]]) {
    const relative = path.relative(parent, child);
    if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) fail('invalid_path');
  }
  const dbPath = path.join(root, 'db', 'agent-gateway.db');
  const imageRoot = path.join(root, 'artifacts', 'public-pilot');
  for (const file of [dbPath, imageRoot]) {
    const stat = exists(file);
    if (stat?.isSymbolicLink()) fail('link_denied');
    if (stat) fail('target_exists');
  }
  const config = path.join(root, 'config', 'lack.config.json');
  function staged() {
    const stat = exists(config);
    if (!stat) return;
    safeDirectory(path.dirname(config));
    if (stat.isSymbolicLink() || !stat.isFile()) fail('link_denied');
    if (stat.size > P.LIMITS.bodyBytes) fail('candidate_not_staged');
    try { if (JSON.parse(fs.readFileSync(config, 'utf8')).multiUser?.migrationReady !== false) fail('candidate_not_staged'); }
    catch { fail('candidate_not_staged'); }
  }
  staged();
  const timestamp = integer(now());
  let target;
  const report = {
    status: 'converted', migrationReady: false, workspaceId, ownerId,
    converted: Object.fromEntries(TABLES.map(name => [name, 0])),
    quarantinedPairings: 0, resetAcceptance: 0, heldLeases: 0, pausedQueuedTasks: 0,
    generatedTraces: 0, artifactCopies: 0, unassignedTables: [],
    historicalOwnership: 'operator-assigned-not-author-verified',
  };
  try {
    return source.transaction(() => {
      if (source.pragma('integrity_check', { simple: true }) !== 'ok' || source.pragma('foreign_key_check').length) fail('source_integrity');
      if (source.pragma('page_count', { simple: true }) * source.pragma('page_size', { simple: true }) > MAX_BYTES) fail('source_limit');
      const tables = source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(row => row.name);
      if (tables.length > 128 || !tables.includes('nodes') || !tables.includes('tasks')) fail('invalid_schema');
      if (tables.includes('gateway_schema')) {
        const versions = source.prepare('SELECT version,mode FROM gateway_schema').all();
        if (versions.length !== 1 || versions[0].version !== 1 || versions[0].mode !== 'legacy-local') fail('scoped_source_requires_review');
      }
      const counts = {};
      for (const name of tables) {
        const rows = source.prepare(`SELECT COUNT(*) AS n FROM ${sqlName(name)}`).get().n;
        const columns = source.prepare(`PRAGMA table_info(${sqlName(name)})`).all();
        if (columns.some(column => column.name === 'workspace_id') && source.prepare(`SELECT 1 FROM ${sqlName(name)} WHERE workspace_id IS NOT NULL AND workspace_id NOT IN ('','legacy-local') LIMIT 1`).get()) fail('scoped_source_requires_review');
        if (!TABLES.includes(name) && name !== 'gateway_schema') report.unassignedTables.push({ name, rows });
        counts[name] = rows;
      }
      if ((counts.nodes || 0) > P.LIMITS.nodes || (counts.tasks || 0) > P.LIMITS.tasks || (counts.events || 0) > P.LIMITS.events ||
          (counts.pilot_artifacts || 0) > P.LIMITS.tasks || (counts.pilot_acceptance || 0) > P.LIMITS.tasks || (counts.pairings || 0) > 10000) fail('source_limit');
      report.quarantinedPairings = counts.pairings || 0;
      mkdir(path.join(root, 'db'));
      const empty = createGatewayStore({ dbPath, now, multiUser: true });
      empty.close();
      target = new Database(dbPath);
      target.pragma('foreign_keys = ON');
      target.pragma('journal_mode = DELETE');
      target.pragma('max_page_count = 16384');
      const rows = name => tables.includes(name) ? source.prepare(`SELECT * FROM ${sqlName(name)}`).iterate() : [];
      target.transaction(() => {
        const nodeIds = new Set(); const taskNodes = new Map(); const artifacts = new Map();
        const insertNode = target.prepare('INSERT INTO nodes(id,name,capabilities,scopes,token_hash,paused,revoked,last_seen,created_at,workspace_id,created_by) VALUES(?,?,?,?,NULL,1,1,?,?,?,?)');
        for (const row of rows('nodes')) {
          const nodeId = id(row.id); const capabilities = json(row.capabilities); const scopes = json(row.scopes);
          if (!Array.isArray(capabilities) || !capabilities.length || capabilities.length > P.TYPES.length || capabilities.some(type => !P.TYPES.includes(type)) ||
              !Array.isArray(scopes) || !scopes.length || scopes.length > 100) fail('invalid_record');
          scopes.forEach(id);
          if (row.last_seen != null) integer(row.last_seen);
          insertNode.run(nodeId, text(row.name, 200), JSON.stringify(capabilities), JSON.stringify(scopes), row.last_seen ?? null, integer(row.created_at), workspaceId, ownerId);
          nodeIds.add(nodeId); report.converted.nodes++;
        }
        const insertTask = target.prepare('INSERT INTO tasks(id,node_id,scope_id,task_type,input,status,lease_id,lease_until,attempt,deadline_at,created_at,updated_at,result,last_error,trace_id,research_session_id,workspace_id,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
        for (const row of rows('tasks')) {
          const taskId = id(row.id); const nodeId = id(row.node_id);
          if (!nodeIds.has(nodeId)) fail('reference_mismatch');
          if (!P.TYPES.includes(row.task_type) || (!ACTIVE.has(row.status) && !TERMINAL.has(row.status) && row.status !== 'queued')) fail('invalid_record');
          const input = json(row.input);
          if (!input || Array.isArray(input) || typeof input !== 'object') fail('invalid_json');
          const result = row.result == null ? null : json(row.result);
          const attempt = integer(row.attempt); if (attempt > 3) fail('invalid_record');
          const deadline = integer(row.deadline_at); let status = row.status;
          let leaseId = row.lease_id ?? null; let leaseUntil = row.lease_until ?? null;
          let error = row.last_error == null ? null : text(row.last_error);
          if (ACTIVE.has(status)) {
            id(leaseId); integer(leaseUntil, 1);
            if (!attempt) fail('invalid_record');
            if (leaseUntil > timestamp && deadline > timestamp) report.heldLeases++;
            else { status = 'needs_attention'; error = 'migration_expired_lease_requires_review'; leaseId = null; leaseUntil = null; }
          } else if (status === 'queued') {
            status = 'needs_attention'; error = 'migration_human_reauthorization_required'; leaseId = null; leaseUntil = null; report.pausedQueuedTasks++;
          } else {
            if (leaseId != null) id(leaseId);
            if (leaseUntil != null) integer(leaseUntil);
          }
          const trace = row.trace_id == null ? `migration_${taskId}` : id(row.trace_id);
          if (row.trace_id == null) report.generatedTraces++;
          const session = row.research_session_id == null ? null : id(row.research_session_id);
          insertTask.run(taskId, nodeId, id(row.scope_id), row.task_type, JSON.stringify(input), status, leaseId, leaseUntil, attempt, deadline,
            integer(row.created_at), integer(row.updated_at), result == null ? null : JSON.stringify(result), error, trace, session, workspaceId, ownerId);
          taskNodes.set(taskId, nodeId); report.converted.tasks++;
        }
        const eventCounts = new Map();
        const insertEvent = target.prepare('INSERT INTO events(seq,node_id,task_id,event_id,content_hash,ack,type,message,created_at,workspace_id) VALUES(?,?,?,?,?,?,?,?,?,?)');
        for (const row of rows('events')) {
          if (taskNodes.get(row.task_id) !== row.node_id) fail('reference_mismatch');
          const n = (eventCounts.get(row.task_id) || 0) + 1;
          if (n > P.LIMITS.eventsPerTask) fail('source_limit');
          eventCounts.set(row.task_id, n);
          const ack = json(row.ack);
          if (!ack || Array.isArray(ack) || typeof ack !== 'object' || (ack.taskId != null && ack.taskId !== row.task_id) || (ack.eventId != null && ack.eventId !== row.event_id)) fail('reference_mismatch');
          if (!/^[a-f0-9]{64}$/.test(row.content_hash)) fail('invalid_record');
          ack.workspaceId = workspaceId;
          insertEvent.run(integer(row.seq, 1), id(row.node_id), id(row.task_id), id(row.event_id), row.content_hash, JSON.stringify(ack), text(row.type, 100),
            row.message == null ? null : text(row.message), integer(row.created_at), workspaceId);
          report.converted.events++;
        }
        let totalEvidence = 0;
        const insertArtifact = target.prepare('INSERT INTO pilot_artifacts(id,node_id,task_id,event_id,sha256,size_bytes,width,height,content_type,created_at,workspace_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
        for (const row of rows('pilot_artifacts')) {
          if (taskNodes.get(row.task_id) !== row.node_id) fail('reference_mismatch');
          if (typeof readArtifact !== 'function') fail('evidence_required');
          if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(row.id)) fail('invalid_record');
          let bytes;
          try { bytes = readArtifact(Object.freeze({ ...row })); } catch { fail('evidence_mismatch'); }
          checkPng(bytes, row);
          totalEvidence += bytes.length;
          if (totalEvidence > 20 * 1024 * 1024) fail('source_limit');
          mkdir(path.join(root, 'artifacts')); mkdir(imageRoot); mkdir(path.join(imageRoot, 'workspaces'));
          const destination = path.join(imageRoot, 'workspaces', workspaceId); mkdir(destination);
          const file = path.join(destination, `${row.id}.png`);
          const fd = fs.openSync(file, 'wx', 0o600);
          try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
          if (sha(fs.readFileSync(file)) !== row.sha256) fail('evidence_mismatch');
          insertArtifact.run(row.id, id(row.node_id), id(row.task_id), id(row.event_id), row.sha256, integer(row.size_bytes, 1), integer(row.width, 1), integer(row.height, 1), row.content_type, integer(row.created_at), workspaceId);
          artifacts.set(row.id, row.task_id); report.artifactCopies++; report.converted.pilot_artifacts++;
        }
        const insertAcceptance = target.prepare("INSERT INTO pilot_acceptance(task_id,state,artifact_id,accepted_at,workspace_id) VALUES(?,'received',?,NULL,?)");
        for (const row of rows('pilot_acceptance')) {
          if (!taskNodes.has(row.task_id) || (row.artifact_id != null && artifacts.get(row.artifact_id) !== row.task_id)) fail('reference_mismatch');
          if (row.state !== 'received' || row.accepted_at != null) report.resetAcceptance++;
          insertAcceptance.run(id(row.task_id), row.artifact_id ?? null, workspaceId); report.converted.pilot_acceptance++;
        }
        if (target.pragma('integrity_check', { simple: true }) !== 'ok' || target.pragma('foreign_key_check').length) fail('target_integrity');
        for (const name of TABLES) if (target.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get().n !== report.converted[name]) fail('target_integrity');
        owner(identity, workspaceId, ownerId);
        staged();
      })();
      return report;
    }).deferred();
  } finally { if (target?.open) target.close(); }
}

module.exports = { convertLegacyGateway };
