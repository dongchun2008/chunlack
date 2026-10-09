'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const Database = require('better-sqlite3');
const {IdentityError, roles, authorize} = require('./policy.cjs');

const identityTableScopes = Object.freeze({
  users: 'user', workspaces: 'workspace', memberships: 'workspace',
  invites: 'workspace', sessions: 'user', reset_tokens: 'user',
  audit: 'platform', schema_version: 'platform'
});

function normalizeLogin(login) {
  if (typeof login !== 'string' || login.length > 256) throw new IdentityError('invalid_login', 400);
  const value = login.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._@+-]{2,127}$/.test(value)) throw new IdentityError('invalid_login', 400);
  return value;
}

function safeUser(row) {
  return Object.freeze({id: row.id, login: row.login, createdAt: row.created_at, disabled: row.disabled_at !== null});
}

// Privileged provisioning/authentication primitives are never public routes.
function createIdentityStore({dbPath, now = Date.now}) {
  if (typeof dbPath !== 'string' || (dbPath !== ':memory:' && !path.isAbsolute(dbPath))) {
    throw new IdentityError('invalid_database_path', 400);
  }
  if (typeof now !== 'function') throw new IdentityError('invalid_clock', 400);
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), {recursive: true, mode: 0o700});
    if (fs.existsSync(dbPath)) {
      if (fs.lstatSync(dbPath).isSymbolicLink()) throw new IdentityError('invalid_database_path', 400);
    } else {
      const fd = fs.openSync(dbPath, 'wx', 0o600);
      fs.closeSync(fd);
    }
  }
  const db = new Database(dbPath);
  let closed = false;
  const clock = () => {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0) throw new IdentityError('invalid_clock', 500);
    return value;
  };
  try {
    db.pragma('busy_timeout = 3000');
    db.pragma('foreign_keys = ON');
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_version'").get()) {
      const row = db.prepare("SELECT version FROM schema_version WHERE component='identity'").get();
      if (row && row.version !== 1) throw new IdentityError('unsupported_schema', 503);
    }
    if (dbPath !== ':memory:') db.pragma('journal_mode = WAL');
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS schema_version (
          component TEXT PRIMARY KEY, version INTEGER NOT NULL, applied_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY, login TEXT NOT NULL UNIQUE COLLATE NOCASE,
          password_hash TEXT NOT NULL, created_at INTEGER NOT NULL, disabled_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS workspaces (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL, disabled_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS memberships (
          workspace_id TEXT NOT NULL REFERENCES workspaces(id),
          user_id TEXT NOT NULL REFERENCES users(id),
          role TEXT NOT NULL CHECK (role IN ('owner','member','viewer')),
          version INTEGER NOT NULL CHECK (version>=1),
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
          PRIMARY KEY(workspace_id,user_id)
        );
        CREATE INDEX IF NOT EXISTS membership_user ON memberships(user_id,workspace_id);
        CREATE TABLE IF NOT EXISTS invites (
          id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id), login TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('owner','member','viewer')),
          created_by TEXT NOT NULL REFERENCES users(id),
          created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, csrf_hash TEXT NOT NULL,
          user_id TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS session_user ON sessions(user_id,revoked_at);
        CREATE TABLE IF NOT EXISTS reset_tokens (
          id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
          user_id TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL, consumed_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS audit (
          id TEXT PRIMARY KEY, workspace_id TEXT REFERENCES workspaces(id),
          actor_id TEXT REFERENCES users(id), target_id TEXT,
          action TEXT NOT NULL, metadata TEXT NOT NULL, created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS audit_workspace ON audit(workspace_id,created_at);
      `);
      db.prepare('INSERT OR IGNORE INTO schema_version(component,version,applied_at) VALUES (?,?,?)')
        .run('identity', 1, clock());
    }).immediate();
  } catch (error) {
    db.close();
    throw error;
  }

  const userRow = userId => typeof userId === 'string' ? db.prepare('SELECT * FROM users WHERE id=?').get(userId) : undefined;
  function activeUser(userId, code = 'not_found') {
    const row = userRow(userId);
    if (!row || row.disabled_at !== null) throw new IdentityError(code, code === 'unauthorized' ? 401 : 404);
    return row;
  }
  function recordAudit({workspaceId = null, actorId = null, targetId = null, action, metadata = {}}) {
    db.prepare('INSERT INTO audit(id,workspace_id,actor_id,target_id,action,metadata,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(randomUUID(), workspaceId, actorId, targetId, action, JSON.stringify(metadata), clock());
  }
  function requireMembership(userId, workspaceId) {
    if (typeof userId !== 'string' || typeof workspaceId !== 'string') throw new IdentityError('not_found', 404);
    const row = db.prepare(`SELECT m.role,m.version FROM memberships m
      JOIN users u ON u.id=m.user_id JOIN workspaces w ON w.id=m.workspace_id
      WHERE m.user_id=? AND m.workspace_id=? AND u.disabled_at IS NULL AND w.disabled_at IS NULL`)
      .get(userId, workspaceId);
    if (!row) throw new IdentityError('not_found', 404);
    return Object.freeze({userId, workspaceId, role: row.role, version: row.version});
  }
  function managementActor(actor, workspaceId, action = 'member.manage') {
    if (!actor || typeof actor.userId !== 'string') throw new IdentityError('unauthorized', 401);
    if (actor.workspaceId !== workspaceId) throw new IdentityError('not_found', 404);
    const current = requireMembership(actor.userId, workspaceId);
    authorize(current, action);
    return current;
  }
  const ownerCount = workspaceId => db.prepare(`SELECT COUNT(*) AS n FROM memberships m
    JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? AND m.role='owner' AND u.disabled_at IS NULL`)
    .get(workspaceId).n;
  function protectOwner(workspaceId, userId) {
    const row = db.prepare('SELECT role FROM memberships WHERE workspace_id=? AND user_id=?').get(workspaceId, userId);
    if (row?.role === 'owner' && ownerCount(workspaceId) <= 1) throw new IdentityError('last_owner', 409);
  }

  const api = {
    createUser({login, passwordHash}) {
      const normalized = normalizeLogin(login);
      if (typeof passwordHash !== 'string' || passwordHash.length < 32 || passwordHash.length > 1024 ||
          /[\x00-\x1f\x7f]/.test(passwordHash)) throw new IdentityError('invalid_password_hash', 400);
      return db.transaction(() => {
        const id = randomUUID();
        try {
          db.prepare('INSERT INTO users(id,login,password_hash,created_at) VALUES (?,?,?,?)')
            .run(id, normalized, passwordHash, clock());
        } catch (error) {
          if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new IdentityError('login_unavailable', 409);
          throw error;
        }
        recordAudit({targetId: id, action: 'user.created'});
        return safeUser(userRow(id));
      }).immediate();
    },
    getUser(userId) {
      const row = userRow(userId);
      if (!row) throw new IdentityError('not_found', 404);
      return safeUser(row);
    },
    findUserForLogin(login) {
      let normalized;
      try {normalized = normalizeLogin(login);} catch {return null;}
      const row = db.prepare('SELECT * FROM users WHERE login=?').get(normalized);
      return row ? {...safeUser(row), passwordHash: row.password_hash} : null;
    },
    createWorkspace({name, ownerId}) {
      if (typeof name !== 'string' || !name.trim() || Array.from(name.trim()).length > 128 ||
          /[\x00-\x1f\x7f]/.test(name)) throw new IdentityError('invalid_workspace_name', 400);
      return db.transaction(() => {
        activeUser(ownerId);
        const id = randomUUID(), time = clock();
        db.prepare('INSERT INTO workspaces(id,name,created_at) VALUES (?,?,?)').run(id, name.trim(), time);
        db.prepare('INSERT INTO memberships(workspace_id,user_id,role,version,created_at,updated_at) VALUES (?,?,?,?,?,?)')
          .run(id, ownerId, 'owner', 1, time, time);
        recordAudit({workspaceId: id, targetId: ownerId, action: 'workspace.created'});
        return Object.freeze({id, name: name.trim(), createdAt: time});
      }).immediate();
    },
    listWorkspaces(userId) {
      activeUser(userId, 'unauthorized');
      return db.prepare(`SELECT w.id,w.name,w.created_at,m.role,m.version FROM workspaces w
        JOIN memberships m ON m.workspace_id=w.id WHERE m.user_id=? AND w.disabled_at IS NULL
        ORDER BY w.name COLLATE NOCASE,w.id`).all(userId)
        .map(row => Object.freeze({id: row.id, name: row.name, createdAt: row.created_at, role: row.role, version: row.version}));
    },
    requireMembership,
    setMembership(actor, {workspaceId, userId, role}) {
      return db.transaction(() => {
        const current = managementActor(actor, workspaceId);
        if (!roles.includes(role)) throw new IdentityError('invalid_role', 400);
        activeUser(userId);
        if (role !== 'owner') protectOwner(workspaceId, userId);
        const time = clock();
        db.prepare(`INSERT INTO memberships(workspace_id,user_id,role,version,created_at,updated_at) VALUES (?,?,?,?,?,?)
          ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=excluded.role,version=memberships.version+1,updated_at=excluded.updated_at`)
          .run(workspaceId, userId, role, 1, time, time);
        recordAudit({workspaceId, actorId: current.userId, targetId: userId, action: 'membership.set', metadata: {role}});
        return requireMembership(userId, workspaceId);
      }).immediate();
    },
    removeMembership(actor, {workspaceId, userId}) {
      return db.transaction(() => {
        const current = managementActor(actor, workspaceId);
        requireMembership(userId, workspaceId);
        protectOwner(workspaceId, userId);
        db.prepare('DELETE FROM memberships WHERE workspace_id=? AND user_id=?').run(workspaceId, userId);
        recordAudit({workspaceId, actorId: current.userId, targetId: userId, action: 'membership.removed'});
        return {removed: true};
      }).immediate();
    },
    disableUser(userId) {
      return db.transaction(() => {
        const row = userRow(userId);
        if (!row) throw new IdentityError('not_found', 404);
        if (row.disabled_at !== null) return safeUser(row);
        const ownerships = db.prepare("SELECT workspace_id FROM memberships WHERE user_id=? AND role='owner'").all(userId);
        for (const ownership of ownerships) protectOwner(ownership.workspace_id, userId);
        db.prepare('UPDATE users SET disabled_at=? WHERE id=?').run(clock(), userId);
        recordAudit({targetId: userId, action: 'user.disabled'});
        return safeUser(userRow(userId));
      }).immediate();
    },
    listAudit(actor, {limit = 100} = {}) {
      const current = managementActor(actor, actor?.workspaceId, 'audit.read');
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new IdentityError('invalid_limit', 400);
      return db.prepare('SELECT * FROM audit WHERE workspace_id=? ORDER BY created_at DESC,id DESC LIMIT ?')
        .all(current.workspaceId, limit).map(row => ({id: row.id, workspaceId: row.workspace_id, actorId: row.actor_id,
          targetId: row.target_id, action: row.action, metadata: JSON.parse(row.metadata), createdAt: row.created_at}));
    }
  };
  const guarded = Object.fromEntries(Object.entries(api).map(([name, fn]) => [name, (...args) => {
    if (closed) throw new IdentityError('store_closed', 503);
    return fn(...args);
  }]));
  guarded.close = () => {if (!closed) {db.close(); closed = true;}};
  return Object.freeze(guarded);
}

module.exports = {createIdentityStore, identityTableScopes};
