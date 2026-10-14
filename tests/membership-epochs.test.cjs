'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {randomUUID} = require('node:crypto');
const {workspaceFixture, throwsCode} = require('./helpers/workspace-fixture.cjs');
const {createMembershipEpochs} = require('../identity/membership-epochs.cjs');

function fixture(t) {
  const r = workspaceFixture(t);
  const db = new Database(r.dbPath);
  r.own({close: () => {if (db.open) db.close();}});
  const epochs = createMembershipEpochs(db);
  const read = (user, workspace) => epochs.read(r.users[user].id, r.workspaces[workspace].id);
  return {...r, db, epochs, read};
}

test('epoch installation backfills existing memberships and survives reopening unchanged', t => {
  const r = fixture(t);
  const before = r.read('bob', 'a');
  assert.match(before.epoch, /^[0-9a-f]{32}$/);
  assert.equal(before.role, 'member');
  assert.equal(before.userId, r.users.bob.id);
  assert.equal(before.workspaceId, r.workspaces.a.id);
  assert.ok(Number.isSafeInteger(before.membershipVersion));
  assert.ok(Object.isFrozen(before));
  const second = new Database(r.dbPath);
  try {
    const reopened = createMembershipEpochs(second);
    assert.deepEqual(reopened.read(r.users.bob.id, r.workspaces.a.id), before);
    assert.equal(second.pragma('integrity_check', {simple: true}), 'ok');
    assert.deepEqual(second.pragma('foreign_key_check'), []);
  } finally {second.close();}
});

test('delete and rejoin at the same time and reused version cannot revive an epoch', t => {
  const r = fixture(t);
  const before = r.read('carol', 'b');
  const target = {workspaceId: r.workspaces.b.id, userId: r.users.carol.id};
  r.store.removeMembership(r.actor('bob', 'b'), target);
  throwsCode(() => r.read('carol', 'b'), 'not_found');
  assert.equal(r.db.prepare('SELECT COUNT(*) AS n FROM agent_membership_epochs WHERE user_id=?').get(r.users.carol.id).n, 0);
  r.store.setMembership(r.actor('bob', 'b'), {...target, role: 'viewer'});
  const after = r.read('carol', 'b');
  assert.equal(before.membershipVersion, after.membershipVersion);
  assert.equal(before.role, after.role);
  assert.notEqual(before.epoch, after.epoch);
});

test('role changes and reversal through another identity connection rotate epochs', t => {
  const r = fixture(t), other = r.open();
  const before = r.read('bob', 'a');
  const target = {workspaceId: r.workspaces.a.id, userId: r.users.bob.id};
  other.setMembership(r.actor('alice', 'a'), {...target, role: 'viewer'});
  const downgraded = r.read('bob', 'a');
  assert.equal(downgraded.role, 'viewer');
  assert.notEqual(downgraded.epoch, before.epoch);
  other.setMembership(r.actor('alice', 'a'), {...target, role: 'member'});
  const restored = r.read('bob', 'a');
  assert.equal(restored.role, before.role);
  assert.notEqual(restored.epoch, before.epoch);
  assert.notEqual(restored.epoch, downgraded.epoch);
  assert.notEqual(r.read('bob', 'b').epoch, restored.epoch);
});

test('disabled identities are rejected and reenabling cannot restore old epochs', t => {
  const r = fixture(t), before = r.read('carol', 'b');
  r.store.disableUser(r.users.carol.id);
  throwsCode(() => r.read('carol', 'b'), 'not_found');
  r.db.prepare('UPDATE users SET disabled_at=NULL WHERE id=?').run(r.users.carol.id);
  assert.notEqual(r.read('carol', 'b').epoch, before.epoch);
  const enabled = r.read('carol', 'b');
  r.db.prepare('UPDATE workspaces SET disabled_at=? WHERE id=?').run(r.now(), r.workspaces.b.id);
  throwsCode(() => r.read('carol', 'b'), 'not_found');
  r.db.prepare('UPDATE workspaces SET disabled_at=NULL WHERE id=?').run(r.workspaces.b.id);
  assert.notEqual(r.read('carol', 'b').epoch, enabled.epoch);
});

test('rolled-back membership mutation cannot change the committed epoch', t => {
  const r = fixture(t), before = r.read('bob', 'a');
  assert.throws(() => r.db.transaction(() => {
    r.db.prepare('UPDATE memberships SET role=?, version=version+1 WHERE user_id=? AND workspace_id=?')
      .run('viewer', r.users.bob.id, r.workspaces.a.id);
    assert.notEqual(r.read('bob', 'a').epoch, before.epoch);
    throw new Error('intentional rollback');
  })(), /intentional rollback/);
  assert.deepEqual(r.read('bob', 'a'), before);
});

test('triggers still prevent membership ABA when a writer disables foreign keys', t => {
  const r = fixture(t), before = r.read('carol', 'b');
  const other = new Database(r.dbPath);
  try {
    other.pragma('foreign_keys=OFF');
    const row = other.prepare('SELECT * FROM memberships WHERE user_id=? AND workspace_id=?')
      .get(r.users.carol.id, r.workspaces.b.id);
    other.prepare('DELETE FROM memberships WHERE user_id=? AND workspace_id=?').run(row.user_id, row.workspace_id);
    other.prepare('INSERT INTO memberships(workspace_id,user_id,role,version,created_at,updated_at) VALUES (?,?,?,?,?,?)')
      .run(row.workspace_id, row.user_id, row.role, row.version, row.created_at, row.updated_at);
    assert.notEqual(r.read('carol', 'b').epoch, before.epoch);
  } finally {other.close();}
});

test('current-state reads reject absent or cross-workspace membership without leaking it', t => {
  const r = fixture(t);
  throwsCode(() => r.read('alice', 'b'), 'not_found');
  throwsCode(() => r.epochs.read(randomUUID(), r.workspaces.a.id), 'not_found');
  for (const value of [null, undefined, [], {}, 42, '']) {
    throwsCode(() => r.epochs.read(value, r.workspaces.a.id), 'not_found');
    throwsCode(() => r.epochs.read(r.users.alice.id, value), 'not_found');
  }
});

test('restore invalidation rotates all epochs but preserves membership roles and versions', t => {
  const r = fixture(t), before = r.read('bob', 'a'), other = r.read('carol', 'b');
  const count = r.db.prepare('SELECT COUNT(*) AS n FROM memberships').get().n;
  assert.equal(r.epochs.invalidateAll(), count);
  const after = r.read('bob', 'a');
  assert.notEqual(after.epoch, before.epoch);
  assert.deepEqual({...after, epoch: before.epoch}, before);
  assert.notEqual(r.read('carol', 'b').epoch, other.epoch);
});

test('future epoch schema is refused without changing existing rows', t => {
  const r = fixture(t), before = r.read('bob', 'a');
  r.db.prepare("UPDATE schema_version SET version=99 WHERE component='agent-membership-epochs'").run();
  throwsCode(() => createMembershipEpochs(r.db), 'unsupported_membership_epoch_schema');
  assert.deepEqual(r.read('bob', 'a'), before);
});

test('frozen pre-OIDC identity schema supports epoch installation without changing identity version', t => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.exec(require('./helpers/identity-v1-schema.cjs'));
  const userId = randomUUID(), workspaceId = randomUUID();
  db.prepare('INSERT INTO schema_version VALUES (?,?,?)').run('identity', 1, 1);
  db.prepare('INSERT INTO users(id,login,password_hash,created_at) VALUES (?,?,?,?)').run(userId, 'old-user', 'synthetic', 1);
  db.prepare('INSERT INTO workspaces(id,name,created_at) VALUES (?,?,?)').run(workspaceId, 'Old workspace', 1);
  db.prepare('INSERT INTO memberships VALUES (?,?,?,?,?,?)').run(workspaceId, userId, 'owner', 1, 1, 1);
  const epochs = createMembershipEpochs(db);
  assert.match(epochs.read(userId, workspaceId).epoch, /^[0-9a-f]{32}$/);
  assert.equal(db.prepare("SELECT version FROM schema_version WHERE component='identity'").get().version, 1);
});
