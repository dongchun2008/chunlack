'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {workspaceFixture, throwsCode} = require('./helpers/workspace-fixture.cjs');
const {createMembershipEpochs} = require('../identity/membership-epochs.cjs');

function fixture(t, install = true) {
  const r = workspaceFixture(t);
  const open = () => {
    const db = new Database(r.dbPath);
    r.own({close: () => {if (db.open) db.close();}});
    return db;
  };
  const db = open();
  return {...r, db, openDb: open, epochs: install ? createMembershipEpochs(db) : null};
}
const rows = db => db.prepare('SELECT * FROM agent_membership_epochs ORDER BY workspace_id,user_id').all();
const current = r => r.epochs.read(r.users.carol.id, r.workspaces.b.id);
const unaffected = r => r.epochs.read(r.users.bob.id, r.workspaces.a.id);

function parentWriter(db, r, kind) {
  if (kind === 'user') {
    const row = db.prepare('SELECT * FROM users WHERE id=?').get(r.users.carol.id);
    const insert = db.prepare('INSERT OR REPLACE INTO users(id,login,password_hash,created_at,disabled_at) VALUES (?,?,?,?,?)');
    return {remove: () => db.prepare('DELETE FROM users WHERE id=?').run(row.id),
      put: disabled => insert.run(row.id, row.login, row.password_hash, row.created_at, disabled)};
  }
  const row = db.prepare('SELECT * FROM workspaces WHERE id=?').get(r.workspaces.b.id);
  const insert = db.prepare('INSERT OR REPLACE INTO workspaces(id,name,created_at,disabled_at) VALUES (?,?,?,?)');
  return {remove: () => db.prepare('DELETE FROM workspaces WHERE id=?').run(row.id),
    put: disabled => insert.run(row.id, row.name, row.created_at, disabled)};
}

for (const kind of ['user', 'workspace']) {
  for (const foreignKeys of ['OFF', 'ON']) {
    for (const recursiveTriggers of ['OFF', 'ON']) {
      test('parent REPLACE never revives epochs: ' + kind + ', FK=' + foreignKeys + ', recursive=' + recursiveTriggers, t => {
        const r = fixture(t), before = current(r), otherWorkspace = unaffected(r);
        const writer = r.openDb();
        writer.pragma('foreign_keys=' + foreignKeys);
        writer.pragma('recursive_triggers=' + recursiveTriggers);
        const parent = parentWriter(writer, r, kind);
        parent.put(r.now());
        throwsCode(() => current(r), 'not_found');
        parent.put(null);
        const after = current(r);
        assert.notEqual(after.epoch, before.epoch);
        assert.deepEqual({...after, epoch: before.epoch}, before);
        assert.deepEqual(unaffected(r), otherWorkspace);
        assert.deepEqual(writer.pragma('foreign_key_check'), []);
      });
    }
  }
}

test('migration registration failure rolls back all DDL, backfill and version changes', t => {
  const r = fixture(t, false);
  r.db.exec(`CREATE TRIGGER test_fail_epoch_registration BEFORE INSERT ON schema_version
    WHEN NEW.component='agent-membership-epochs' BEGIN
      SELECT RAISE(ABORT,'injected_epoch_registration_failure');
    END;`);
  const schema = () => r.db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY type,name').all();
  const beforeSchema = schema();
  const beforeMembers = r.db.prepare('SELECT * FROM memberships ORDER BY workspace_id,user_id').all();
  assert.throws(() => createMembershipEpochs(r.db), /injected_epoch_registration_failure/);
  assert.deepEqual(schema(), beforeSchema);
  assert.deepEqual(r.db.prepare('SELECT * FROM memberships ORDER BY workspace_id,user_id').all(), beforeMembers);
  assert.equal(r.db.prepare("SELECT COUNT(*) AS n FROM schema_version WHERE component='agent-membership-epochs'").get().n, 0);
  r.db.exec('DROP TRIGGER test_fail_epoch_registration');
  r.epochs = createMembershipEpochs(r.db);
  assert.equal(current(r).role, 'viewer');
});

test('outer transaction rollback restores every epoch after invalidateAll', t => {
  const r = fixture(t), before = rows(r.db);
  assert.throws(() => r.db.transaction(() => {
    assert.equal(r.epochs.invalidateAll(), before.length);
    assert.ok(rows(r.db).every((row, index) => row.epoch !== before[index].epoch));
    throw new Error('intentional_outer_rollback');
  })(), /intentional_outer_rollback/);
  assert.deepEqual(rows(r.db), before);
});

test('failure on the second epoch update rolls back the first update too', t => {
  const r = fixture(t), before = rows(r.db);
  let attempts = 0;
  r.db.function('test_epoch_update_failure', () => ++attempts === 2 ? 1 : 0);
  r.db.exec(`CREATE TRIGGER test_fail_epoch_update BEFORE UPDATE ON agent_membership_epochs
    WHEN test_epoch_update_failure()=1 BEGIN
      SELECT RAISE(ABORT,'injected_second_epoch_update_failure');
    END;`);
  assert.throws(() => r.epochs.invalidateAll(), /injected_second_epoch_update_failure/);
  assert.equal(attempts, 2);
  assert.deepEqual(rows(r.db), before);
  r.db.exec('DROP TRIGGER test_fail_epoch_update');
});

test('no-op membership update rotates only the affected workspace incarnation', t => {
  const r = fixture(t), before = current(r), otherWorkspace = unaffected(r);
  r.db.prepare('UPDATE memberships SET updated_at=updated_at WHERE user_id=? AND workspace_id=?')
    .run(r.users.carol.id, r.workspaces.b.id);
  const after = current(r);
  assert.notEqual(after.epoch, before.epoch);
  assert.deepEqual({...after, epoch: before.epoch}, before);
  assert.deepEqual(unaffected(r), otherWorkspace);
});

for (const kind of ['user', 'workspace']) {
  test('explicit parent delete/reinsert invalidates despite disabled foreign keys: ' + kind, t => {
    const r = fixture(t), before = current(r), otherWorkspace = unaffected(r);
    const writer = r.openDb();
    writer.pragma('foreign_keys=OFF');
    writer.pragma('recursive_triggers=OFF');
    const parent = parentWriter(writer, r, kind);
    parent.remove();
    throwsCode(() => current(r), 'not_found');
    assert.equal(r.db.prepare('SELECT COUNT(*) AS n FROM agent_membership_epochs WHERE user_id=? AND workspace_id=?')
      .get(r.users.carol.id, r.workspaces.b.id).n, 0);
    parent.put(null);
    assert.notEqual(current(r).epoch, before.epoch);
    assert.deepEqual(unaffected(r), otherWorkspace);
    assert.deepEqual(writer.pragma('foreign_key_check'), []);
  });
}

test('epochs persist unchanged after every connection closes and the database reopens', t => {
  const r = fixture(t), before = rows(r.db), beforeIdentity = current(r);
  r.store.close();
  r.db.close();
  const reopened = r.openDb();
  const epochs = createMembershipEpochs(reopened);
  assert.deepEqual(rows(reopened), before);
  assert.deepEqual(epochs.read(r.users.carol.id, r.workspaces.b.id), beforeIdentity);
  assert.equal(reopened.pragma('integrity_check', {simple: true}), 'ok');
  assert.deepEqual(reopened.pragma('foreign_key_check'), []);
});
