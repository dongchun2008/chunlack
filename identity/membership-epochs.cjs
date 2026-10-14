'use strict';
const {IdentityError} = require('./policy.cjs');
const component = 'agent-membership-epochs';
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

// Optional storage primitive for the future authority bridge, not an HTTP API.
// The caller owns this connection, its private path and the runtime writer lock.
function createMembershipEpochs(db) {
  if (!db?.open || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    throw new IdentityError('invalid_membership_epoch_store', 503);
  }
  db.transaction(() => {
    const version = db.prepare('SELECT version FROM schema_version WHERE component=?').get(component);
    if (version && version.version !== 1) throw new IdentityError('unsupported_membership_epoch_schema', 503);
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_membership_epochs (
        workspace_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        epoch TEXT NOT NULL CHECK(length(epoch)=32 AND epoch NOT GLOB '*[^0-9a-f]*'),
        PRIMARY KEY(workspace_id,user_id),
        FOREIGN KEY(workspace_id,user_id) REFERENCES memberships(workspace_id,user_id)
          ON DELETE CASCADE ON UPDATE CASCADE
      );
      CREATE TRIGGER IF NOT EXISTS agent_membership_epochs_insert
      AFTER INSERT ON memberships BEGIN
        INSERT INTO agent_membership_epochs(workspace_id,user_id,epoch)
        VALUES(NEW.workspace_id,NEW.user_id,lower(hex(randomblob(16))))
        ON CONFLICT(workspace_id,user_id) DO UPDATE SET epoch=excluded.epoch;
      END;
      CREATE TRIGGER IF NOT EXISTS agent_membership_epochs_update
      AFTER UPDATE ON memberships BEGIN
        DELETE FROM agent_membership_epochs WHERE workspace_id=OLD.workspace_id AND user_id=OLD.user_id;
        INSERT INTO agent_membership_epochs(workspace_id,user_id,epoch)
        VALUES(NEW.workspace_id,NEW.user_id,lower(hex(randomblob(16))))
        ON CONFLICT(workspace_id,user_id) DO UPDATE SET epoch=excluded.epoch;
      END;
      CREATE TRIGGER IF NOT EXISTS agent_membership_epochs_delete
      AFTER DELETE ON memberships BEGIN
        DELETE FROM agent_membership_epochs WHERE workspace_id=OLD.workspace_id AND user_id=OLD.user_id;
      END;
      CREATE TRIGGER IF NOT EXISTS agent_membership_epochs_user_insert
      AFTER INSERT ON users BEGIN
        INSERT INTO agent_membership_epochs(workspace_id,user_id,epoch)
        SELECT workspace_id,user_id,lower(hex(randomblob(16))) FROM memberships WHERE user_id=NEW.id
        ON CONFLICT(workspace_id,user_id) DO UPDATE SET epoch=excluded.epoch;
      END;
      CREATE TRIGGER IF NOT EXISTS agent_membership_epochs_workspace_insert
      AFTER INSERT ON workspaces BEGIN
        INSERT INTO agent_membership_epochs(workspace_id,user_id,epoch)
        SELECT workspace_id,user_id,lower(hex(randomblob(16))) FROM memberships WHERE workspace_id=NEW.id
        ON CONFLICT(workspace_id,user_id) DO UPDATE SET epoch=excluded.epoch;
      END;
      CREATE TRIGGER IF NOT EXISTS agent_membership_epochs_user_state
      AFTER UPDATE OF disabled_at ON users WHEN OLD.disabled_at IS NOT NEW.disabled_at BEGIN
        UPDATE agent_membership_epochs SET epoch=lower(hex(randomblob(16))) WHERE user_id=NEW.id;
      END;
      CREATE TRIGGER IF NOT EXISTS agent_membership_epochs_workspace_state
      AFTER UPDATE OF disabled_at ON workspaces WHEN OLD.disabled_at IS NOT NEW.disabled_at BEGIN
        UPDATE agent_membership_epochs SET epoch=lower(hex(randomblob(16))) WHERE workspace_id=NEW.id;
      END;
      CREATE TRIGGER IF NOT EXISTS agent_membership_epochs_user_delete
      AFTER DELETE ON users BEGIN
        DELETE FROM agent_membership_epochs WHERE user_id=OLD.id;
      END;
      CREATE TRIGGER IF NOT EXISTS agent_membership_epochs_workspace_delete
      AFTER DELETE ON workspaces BEGIN
        DELETE FROM agent_membership_epochs WHERE workspace_id=OLD.id;
      END;
      INSERT INTO agent_membership_epochs(workspace_id,user_id,epoch)
      SELECT workspace_id,user_id,lower(hex(randomblob(16))) FROM memberships WHERE 1
      ON CONFLICT(workspace_id,user_id) DO NOTHING;
    `);
    if (!version) db.prepare('INSERT INTO schema_version(component,version,applied_at) VALUES (?,?,?)')
      .run(component, 1, Date.now());
  }).immediate();
  const current = db.prepare(`
    SELECT m.user_id AS userId,m.workspace_id AS workspaceId,m.role,
      m.version AS membershipVersion,e.epoch
    FROM memberships m
    JOIN agent_membership_epochs e ON e.workspace_id=m.workspace_id AND e.user_id=m.user_id
    JOIN users u ON u.id=m.user_id AND u.disabled_at IS NULL
    JOIN workspaces w ON w.id=m.workspace_id AND w.disabled_at IS NULL
    WHERE m.user_id=? AND m.workspace_id=?
  `);
  const invalidate = db.transaction(() => db.prepare(
    'UPDATE agent_membership_epochs SET epoch=lower(hex(randomblob(16)))').run().changes);
  return Object.freeze({
    read(userId, workspaceId) {
      if (!uuid(userId) || !uuid(workspaceId)) throw new IdentityError('not_found', 404);
      const row = current.get(userId, workspaceId);
      if (!row) throw new IdentityError('not_found', 404);
      return Object.freeze(row);
    },
    invalidateAll() {return invalidate.immediate();}
  });
}

module.exports = {createMembershipEpochs};
