'use strict';
const {randomUUID} = require('node:crypto');
const {IdentityError, authorize} = require('./policy.cjs');
const {createMembershipEpochs} = require('./membership-epochs.cjs');
const {runWithWorkspace} = require('../collaboration/context.cjs');
const SCOPES = ['task.read', 'task.claim', 'task.result', 'events.read', 'events.subscribe'];
const fail = (code = 'unauthorized', status = 401) => new IdentityError(code, status);
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const clean = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\x00-\x20\x7f]/.test(value);
const scopeList = value => Array.isArray(value) && value.length > 0 && value.length <= SCOPES.length &&
  new Set(value).size === value.length && value.every(scope => SCOPES.includes(scope));

// Internal registry only. Human actors must originate in a trusted session
// route; opaque authority proofs are not gateway-authenticated node principals.
function createAgentAuthority({db, identity, workspaceAccess, verifier, config, now = Date.now, maxGrants = 2048} = {}) {
  if (config?.enabled !== true) return null;
  let issuer, resource, clients;
  try {
    issuer = new URL(config.issuer); resource = new URL(config.resource);
    for (const url of [issuer, resource]) {
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw Error();
    }
    if (issuer.origin !== config.issuer || resource.href !== config.resource ||
        !clean(config.browserClientId) || !Array.isArray(config.clientIds) || !config.clientIds.length ||
        config.clientIds.length > 32 || new Set(config.clientIds).size !== config.clientIds.length ||
        config.clientIds.some(id => !clean(id) || id === config.browserClientId) ||
        !db?.open || typeof db.transaction !== 'function' || typeof identity?.requireMembership !== 'function' ||
        typeof identity?.resolveExternalIdentity !== 'function' || typeof workspaceAccess?.forHuman !== 'function' ||
        typeof verifier?.verify !== 'function' || typeof verifier?.consume !== 'function' || typeof now !== 'function' ||
        !Number.isInteger(maxGrants) || maxGrants < 1 || maxGrants > 2048) throw Error();
    clients = new Set(config.clientIds);
  } catch {throw fail('invalid_agent_authority_config', 503);}
  let closed = false, proofs = new WeakMap(), epochs;
  const clock = () => {
    if (closed || !db.open) throw fail('service_closed', 503);
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0) throw fail('invalid_clock', 503);
    return value;
  };
  db.transaction(() => {
    const version = db.prepare("SELECT version FROM schema_version WHERE component='agent-authority'").get();
    if (version && version.version !== 1) throw fail('unsupported_agent_authority_schema', 503);
    db.prepare('SELECT issuer,subject,user_id,revoked_at FROM external_identities LIMIT 0').all();
    epochs = createMembershipEpochs(db);
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_authority_grants (
        id TEXT PRIMARY KEY, issuer TEXT NOT NULL, subject TEXT NOT NULL,
        client_id TEXT NOT NULL, resource TEXT NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id), workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        node_id TEXT NOT NULL, membership_epoch TEXT NOT NULL, scopes TEXT NOT NULL,
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
        UNIQUE(issuer,subject,client_id,workspace_id,node_id),
        FOREIGN KEY(issuer,subject) REFERENCES external_identities(issuer,subject) ON DELETE CASCADE ON UPDATE CASCADE
      );
      CREATE TRIGGER IF NOT EXISTS agent_authority_external_insert AFTER INSERT ON external_identities BEGIN
        DELETE FROM agent_authority_grants WHERE issuer=NEW.issuer AND subject=NEW.subject;
      END;
      CREATE TRIGGER IF NOT EXISTS agent_authority_external_update AFTER UPDATE ON external_identities BEGIN
        DELETE FROM agent_authority_grants WHERE (issuer=OLD.issuer AND subject=OLD.subject)
          OR (issuer=NEW.issuer AND subject=NEW.subject);
      END;
      CREATE TRIGGER IF NOT EXISTS agent_authority_external_delete AFTER DELETE ON external_identities BEGIN
        DELETE FROM agent_authority_grants WHERE issuer=OLD.issuer AND subject=OLD.subject;
      END;
    `);
    if (!version) db.prepare('INSERT INTO schema_version(component,version,applied_at) VALUES (?,?,?)')
      .run('agent-authority', 1, clock());
  }).immediate();
  const get = db.prepare('SELECT * FROM agent_authority_grants WHERE id=?');
  const connections = db.prepare(`SELECT g.*, w.name AS workspace_name FROM agent_authority_grants g
    JOIN workspaces w ON w.id=g.workspace_id
    WHERE g.issuer=? AND g.subject=? AND g.client_id=? AND g.resource=? ORDER BY g.id LIMIT ?`);
  const workspaceGrants = db.prepare('SELECT * FROM agent_authority_grants WHERE workspace_id=? ORDER BY created_at DESC,id LIMIT ?');
  const binding = db.prepare('SELECT user_id FROM external_identities WHERE issuer=? AND subject=? AND revoked_at IS NULL');
  const audit = db.prepare('INSERT INTO audit(id,workspace_id,actor_id,target_id,action,metadata,created_at) VALUES (?,?,?,?,?,?,?)');
  const prune = db.prepare(`DELETE FROM agent_authority_grants AS g WHERE expires_at<=?
    OR NOT EXISTS(SELECT 1 FROM agent_membership_epochs e WHERE e.user_id=g.user_id
      AND e.workspace_id=g.workspace_id AND e.epoch=g.membership_epoch)
    OR NOT EXISTS(SELECT 1 FROM external_identities x WHERE x.issuer=g.issuer AND x.subject=g.subject
      AND x.user_id=g.user_id AND x.revoked_at IS NULL)
    OR NOT EXISTS(SELECT 1 FROM users u WHERE u.id=g.user_id AND u.disabled_at IS NULL)
    OR NOT EXISTS(SELECT 1 FROM workspaces w WHERE w.id=g.workspace_id AND w.disabled_at IS NULL)`);
  function admin(actor, workspaceId) {
    try {
      if (!uuid(actor?.userId) || !uuid(workspaceId) || actor.workspaceId !== workspaceId) throw Error();
      const current = identity.requireMembership(actor.userId, workspaceId);
      if (current.role !== 'owner') throw Error();
      return current;
    } catch {throw fail('forbidden', 403);}
  }
  function node(userId, workspaceId, nodeId, scope) {
    const actor = identity.requireMembership(userId, workspaceId);
    authorize(actor, 'node.manage');
    const value = runWithWorkspace(actor, () => workspaceAccess.forHuman(actor).getNode(nodeId));
    if (!value || value.id !== nodeId || value.workspaceId !== workspaceId || value.createdBy !== userId || value.revoked) throw fail();
    if (scope === 'task.claim' && value.paused) throw fail('node_paused', 403);
    return value;
  }
  function evidence(entry, scope) {
    const time = clock();
    if (!SCOPES.includes(scope)) throw fail('invalid_scope', 400);
    try {
      if (!entry) throw fail();
      const row = get.get(entry.grantId), token = entry.evidence;
      if (!row || row.expires_at <= time || token.expiresAt * 1000 <= time ||
          row.issuer !== issuer.origin || row.resource !== resource.href || !clients.has(row.client_id) ||
          token.issuer !== row.issuer || token.resource !== row.resource ||
          token.subject !== row.subject || token.clientId !== row.client_id ||
          binding.get(row.issuer, row.subject)?.user_id !== row.user_id ||
          epochs.read(row.user_id, row.workspace_id).epoch !== row.membership_epoch) throw fail();
      if (typeof row.scopes !== 'string' || row.scopes.length > 256) throw fail();
      const allowed = JSON.parse(row.scopes);
      if (!scopeList(allowed)) throw fail();
      if (!allowed.includes(scope) || !token.scopes.includes(scope)) throw fail('insufficient_scope', 403);
      node(row.user_id, row.workspace_id, row.node_id, scope);
      return Object.freeze({grantId: row.id, userId: row.user_id, workspaceId: row.workspace_id,
        nodeId: row.node_id, issuer: row.issuer, subject: row.subject, clientId: row.client_id,
        resource: row.resource, scope, expiresAt: Math.min(row.expires_at, token.expiresAt * 1000)});
    } catch (error) {
      if (error instanceof IdentityError && ['insufficient_scope', 'node_paused'].includes(error.code)) throw error;
      throw fail();
    }
  }
  return Object.freeze({
    list(actor, {workspaceId} = {}) {
      clock(); admin(actor, workspaceId);
      // Administrative records, not usable-token evidence. Keep expired/stale
      // records visible so the owner can revoke them without re-enabling them.
      const grants = workspaceGrants.all(workspaceId, maxGrants).map(row => {
        let scopes;
        try {
          if (typeof row.scopes !== 'string' || row.scopes.length > 256) throw Error();
          scopes = JSON.parse(row.scopes);
          if (!scopeList(scopes)) throw Error();
        } catch {throw fail('invalid_grant_record', 503);}
        return Object.freeze({id: row.id, issuer: row.issuer, subject: row.subject, resource: row.resource,
          userId: row.user_id, workspaceId: row.workspace_id, nodeId: row.node_id, clientId: row.client_id,
          scopes: Object.freeze(scopes), createdAt: row.created_at, expiresAt: row.expires_at});
      });
      return Object.freeze({grants: Object.freeze(grants), issuer: issuer.origin, resource: resource.href,
        clientIds: Object.freeze([...clients])});
    },
    async discover(token) {
      clock();
      // Discovery requires the same read permission as protocol/tool discovery.
      // Verify once, then recheck live local authority for each bounded row.
      const verified = await verifier.verify(token, {scope: 'task.read'});
      clock();
      const facts = verifier.consume(verified), result = [];
      const label = value => String(value ?? '').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 160);
      for (const row of connections.all(issuer.origin, facts.subject, facts.clientId, resource.href, maxGrants)) {
        try {
          if (typeof row.scopes !== 'string' || row.scopes.length > 256) continue;
          const allowed = JSON.parse(row.scopes);
          if (!scopeList(allowed)) continue;
          let scopes = SCOPES.filter(scope => allowed.includes(scope) && facts.scopes.includes(scope));
          if (!scopes.length) continue;
          const scope = scopes.find(value => value !== 'task.claim') || scopes[0];
          const current = evidence({grantId: row.id, evidence: facts}, scope);
          const value = node(current.userId, current.workspaceId, current.nodeId, scope);
          if (value.paused) scopes = scopes.filter(value => value !== 'task.claim');
          if (!scopes.length) continue;
          result.push(Object.freeze({grantId: current.grantId, workspaceId: current.workspaceId,
            workspaceName: label(row.workspace_name), nodeId: current.nodeId, nodeName: label(value.name),
            scopes: Object.freeze(scopes), expiresAt: current.expiresAt}));
        } catch (error) {
          // Stale bindings are not discoverable; operational errors still fail closed.
          if (!(error instanceof IdentityError) || !['unauthorized', 'insufficient_scope', 'node_paused'].includes(error.code)) throw error;
        }
      }
      return Object.freeze({connections: Object.freeze(result)});
    },
    grant(actor, input = {}) {
      const time = clock();
      const manager = admin(actor, input.workspaceId);
      if (!uuid(input.subject) || !uuid(input.nodeId) || !clients.has(input.clientId) || !scopeList(input.scopes) ||
          !Number.isSafeInteger(input.expiresAt) || input.expiresAt <= time || input.expiresAt - time > 30 * 86400000) {
        throw fail('invalid_agent_grant', 400);
      }
      return db.transaction(() => {
        let user, membership;
        try {
          user = identity.resolveExternalIdentity({issuer: issuer.origin, sub: input.subject});
          if (binding.get(issuer.origin, input.subject)?.user_id !== user.id) throw Error();
          membership = epochs.read(user.id, input.workspaceId);
          node(user.id, input.workspaceId, input.nodeId);
        } catch {throw fail('forbidden', 403);}
        prune.run(time);
        if (db.prepare(`SELECT id FROM agent_authority_grants WHERE issuer=? AND subject=? AND client_id=?
          AND workspace_id=? AND node_id=?`).get(issuer.origin, input.subject, input.clientId, input.workspaceId, input.nodeId)) {
          throw fail('grant_exists', 409);
        }
        if (db.prepare('SELECT COUNT(*) AS n FROM agent_authority_grants').get().n >= maxGrants) throw fail('grant_capacity', 429);
        const id = randomUUID(), scopes = Object.freeze([...input.scopes].sort());
        db.prepare(`INSERT INTO agent_authority_grants(id,issuer,subject,client_id,resource,user_id,workspace_id,
          node_id,membership_epoch,scopes,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(id, issuer.origin, input.subject, input.clientId, resource.href, user.id, input.workspaceId,
            input.nodeId, membership.epoch, JSON.stringify(scopes), time, input.expiresAt);
        audit.run(randomUUID(), input.workspaceId, manager.userId, user.id, 'agent.grant.create',
          JSON.stringify({grantId: id, nodeId: input.nodeId, clientId: input.clientId, scopes}), time);
        return Object.freeze({id, userId: user.id, workspaceId: input.workspaceId, nodeId: input.nodeId,
          clientId: input.clientId, scopes, expiresAt: input.expiresAt});
      }).immediate();
    },
    revoke(actor, {workspaceId, grantId} = {}) {
      const time = clock();
      const manager = admin(actor, workspaceId);
      if (!uuid(grantId)) throw fail('not_found', 404);
      return db.transaction(() => {
        const row = get.get(grantId);
        if (!row || row.workspace_id !== workspaceId) throw fail('not_found', 404);
        db.prepare('DELETE FROM agent_authority_grants WHERE id=?').run(grantId);
        audit.run(randomUUID(), workspaceId, manager.userId, row.user_id, 'agent.grant.revoke',
          JSON.stringify({grantId, nodeId: row.node_id, clientId: row.client_id}), time);
        return true;
      }).immediate();
    },
    async authenticate(token, {grantId, scope} = {}) {
      clock();
      if (!uuid(grantId)) throw fail();
      if (!SCOPES.includes(scope)) throw fail('invalid_scope', 400);
      const verified = await verifier.verify(token, {scope});
      clock();
      const entry = Object.freeze({grantId, evidence: verifier.consume(verified)});
      evidence(entry, scope);
      const proof = Object.freeze({}); proofs.set(proof, entry); return proof;
    },
    assert(proof, {scope} = {}) {return evidence(proofs.get(proof), scope);},
    // Trusted, authenticated storage only: this is not a bearer authenticator.
    assertSubscription(value) {
      const fields = ['grantId', 'userId', 'workspaceId', 'nodeId', 'issuer', 'subject', 'clientId', 'resource', 'scope', 'expiresAt'];
      if (!value || typeof value !== 'object' || Array.isArray(value) ||
          Object.keys(value).length !== fields.length || fields.some(key => !Object.hasOwn(value, key)) ||
          !['grantId', 'userId', 'workspaceId', 'nodeId', 'subject'].every(key => uuid(value[key])) ||
          value.scope !== 'events.subscribe' || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= 0) throw fail();
      const current = evidence({grantId: value.grantId, evidence: {
        issuer: value.issuer, subject: value.subject, clientId: value.clientId, resource: value.resource,
        scopes: ['events.subscribe'], expiresAt: value.expiresAt / 1000
      }}, 'events.subscribe');
      if (fields.some(key => current[key] !== value[key])) throw fail();
      return current;
    },
    close() {closed = true; proofs = new WeakMap();}
  });
}
module.exports = {createAgentAuthority};
