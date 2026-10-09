'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const path = require('node:path');
const {Worker} = require('node:worker_threads');
const {workspaceFixture, throwsCode, syntheticHash} = require('./helpers/workspace-fixture.cjs');

test('independent users join only authorized workspaces with workspace-specific roles', t => {
  const r = workspaceFixture(t);
  assert.deepEqual(r.store.listWorkspaces(r.users.alice.id).map(w => w.name), ['Workspace A']);
  assert.deepEqual(r.store.listWorkspaces(r.users.bob.id).map(w => [w.name, w.role]),
    [['Workspace A', 'member'], ['Workspace B', 'owner']]);
  assert.deepEqual(r.store.listWorkspaces(r.users.carol.id).map(w => [w.name, w.role]), [['Workspace B', 'viewer']]);
  throwsCode(() => r.actor('alice', 'b'), 'not_found');
  throwsCode(() => r.actor('carol', 'a'), 'not_found');
  assert.ok(Object.isFrozen(r.actor('bob', 'a')));
});

test('role policy rejects viewer writes, unknown operations and platform privileges', t => {
  const r = workspaceFixture(t);
  const {authorize} = require('../identity/policy.cjs');
  assert.equal(authorize(r.actor('carol', 'b'), 'task.read'), true);
  for (const action of ['task.create', 'task.execute', 'artifact.upload', 'task.approve', 'node.manage']) {
    throwsCode(() => authorize(r.actor('carol', 'b'), action), 'forbidden');
  }
  assert.equal(authorize(r.actor('bob', 'a'), 'task.create'), true);
  throwsCode(() => authorize(r.actor('bob', 'a'), 'member.manage'), 'forbidden');
  throwsCode(() => authorize(r.actor('alice', 'a'), 'platform.manage'), 'forbidden');
  throwsCode(() => authorize(null, 'task.read'), 'unauthorized');
});

test('members cancel or retry only their own tasks while owners can manage workspace tasks', t => {
  const r = workspaceFixture(t);
  const {authorize} = require('../identity/policy.cjs');
  for (const action of ['task.cancel', 'task.retry']) {
    assert.equal(authorize(r.actor('bob', 'a'), action, r.users.bob.id), true);
    throwsCode(() => authorize(r.actor('bob', 'a'), action, r.users.alice.id), 'forbidden');
    throwsCode(() => authorize(r.actor('bob', 'a'), action), 'forbidden');
    assert.equal(authorize(r.actor('alice', 'a'), action, r.users.bob.id), true);
  }
});

test('case-insensitive unique login rejects duplicates and malformed input without leaking hashes', t => {
  const r = workspaceFixture(t);
  throwsCode(() => r.store.createUser({login: ' ALICE ', passwordHash: syntheticHash}), 'login_unavailable');
  for (const login of ['', 'ab', 'bad\nlogin', 'x'.repeat(129), '<script>']) {
    throwsCode(() => r.store.createUser({login, passwordHash: syntheticHash}), 'invalid_login');
  }
  throwsCode(() => r.store.createUser({login: 'other', passwordHash: ''}), 'invalid_password_hash');
  assert.equal(r.store.getUser(r.users.alice.id).passwordHash, undefined);
  assert.equal(r.store.findUserForLogin('ALICE').passwordHash, syntheticHash);
  assert.ok(!JSON.stringify(r.store.listWorkspaces(r.users.bob.id)).includes(syntheticHash));
});

test('missing and unauthorized resource selection have the same public error', t => {
  const r = workspaceFixture(t);
  const {randomUUID} = require('node:crypto');
  for (const workspaceId of [r.workspaces.b.id, randomUUID(), '../private']) {
    throwsCode(() => r.store.requireMembership(r.users.alice.id, workspaceId), 'not_found');
  }
});

test('member mutation revalidates current membership instead of trusting a forged owner role', t => {
  const r = workspaceFixture(t);
  const forged = {...r.actor('bob', 'a'), role: 'owner'};
  const input = {workspaceId: r.workspaces.a.id, userId: r.users.carol.id, role: 'owner'};
  throwsCode(() => r.store.setMembership(forged, input), 'forbidden');
  throwsCode(() => r.store.setMembership(r.actor('bob', 'b'), input), 'not_found');
  throwsCode(() => r.store.removeMembership(forged, {workspaceId: r.workspaces.a.id, userId: r.users.alice.id}), 'forbidden');
  throwsCode(() => r.actor('carol', 'a'), 'not_found');
});

test('last effective workspace owner cannot be removed, downgraded or disabled', t => {
  const r = workspaceFixture(t);
  const actor = r.actor('alice', 'a');
  const target = {workspaceId: r.workspaces.a.id, userId: r.users.alice.id};
  throwsCode(() => r.store.removeMembership(actor, target), 'last_owner');
  throwsCode(() => r.store.setMembership(actor, {...target, role: 'member'}), 'last_owner');
  throwsCode(() => r.store.disableUser(r.users.alice.id), 'last_owner');
  assert.equal(r.actor('alice', 'a').role, 'owner');
  assert.equal(r.store.getUser(r.users.alice.id).disabled, false);
});

test('owner transfer permits removal and stale owner contexts no longer authorize management', t => {
  const r = workspaceFixture(t);
  const oldActor = r.actor('alice', 'a');
  r.store.setMembership(oldActor, {workspaceId: r.workspaces.a.id, userId: r.users.bob.id, role: 'owner'});
  r.store.removeMembership(r.actor('bob', 'a'), {workspaceId: r.workspaces.a.id, userId: r.users.alice.id});
  throwsCode(() => r.store.setMembership(oldActor,
    {workspaceId: r.workspaces.a.id, userId: r.users.carol.id, role: 'member'}), 'not_found');
  assert.equal(r.actor('bob', 'a').role, 'owner');
});

test('disabling an account revokes all memberships without deleting historical membership records', t => {
  const r = workspaceFixture(t);
  r.store.disableUser(r.users.carol.id);
  throwsCode(() => r.actor('carol', 'b'), 'not_found');
  throwsCode(() => r.store.listWorkspaces(r.users.carol.id), 'unauthorized');
  assert.equal(r.store.getUser(r.users.carol.id).disabled, true);
  const db = new Database(r.dbPath, {readonly: true});
  try {assert.equal(db.prepare('SELECT COUNT(*) AS n FROM memberships WHERE user_id=?').get(r.users.carol.id).n, 1);}
  finally {db.close();}
  throwsCode(() => r.store.setMembership(r.actor('bob', 'b'),
    {workspaceId: r.workspaces.b.id, userId: r.users.carol.id, role: 'member'}), 'not_found');
});

test('disabling an owner is atomic across all workspaces', t => {
  const r = workspaceFixture(t);
  r.store.setMembership(r.actor('alice', 'a'), {workspaceId: r.workspaces.a.id, userId: r.users.bob.id, role: 'owner'});
  const c = r.store.createWorkspace({name: 'Workspace C', ownerId: r.users.alice.id});
  throwsCode(() => r.store.disableUser(r.users.alice.id), 'last_owner');
  assert.equal(r.store.getUser(r.users.alice.id).disabled, false);
  assert.equal(r.store.requireMembership(r.users.alice.id, c.id).role, 'owner');
  r.store.removeMembership(r.actor('bob', 'a'), {workspaceId: r.workspaces.a.id, userId: r.users.alice.id});
  assert.equal(r.store.requireMembership(r.users.alice.id, c.id).role, 'owner');
});

test('workspace-scoped audit contains actor and target but never credentials or other workspace records', t => {
  const r = workspaceFixture(t);
  r.store.setMembership(r.actor('alice', 'a'), {workspaceId: r.workspaces.a.id, userId: r.users.carol.id, role: 'viewer'});
  const audit = r.store.listAudit(r.actor('alice', 'a'));
  assert.ok(audit.some(e => e.action === 'membership.set' && e.actorId === r.users.alice.id && e.targetId === r.users.carol.id));
  assert.ok(audit.every(e => e.workspaceId === r.workspaces.a.id));
  assert.ok(!JSON.stringify(audit).includes(syntheticHash));
  throwsCode(() => r.store.listAudit(r.actor('bob', 'a')), 'forbidden');
  throwsCode(() => r.store.listAudit({...r.actor('alice', 'a'), workspaceId: r.workspaces.b.id}), 'not_found');
});

test('membership validation rejects unsupported roles and unknown targets before writes', t => {
  const r = workspaceFixture(t);
  throwsCode(() => r.store.setMembership(r.actor('alice', 'a'),
    {workspaceId: r.workspaces.a.id, userId: r.users.bob.id, role: 'admin'}), 'invalid_role');
  throwsCode(() => r.store.setMembership(r.actor('alice', 'a'),
    {workspaceId: r.workspaces.a.id, userId: require('node:crypto').randomUUID(), role: 'viewer'}), 'not_found');
  assert.equal(r.actor('bob', 'a').role, 'member');
});

test('identity tables enforce foreign keys and persist memberships across reopening', t => {
  const r = workspaceFixture(t);
  const other = r.open();
  assert.equal(other.requireMembership(r.users.bob.id, r.workspaces.a.id).role, 'member');
  const db = new Database(r.dbPath);
  try {
    db.pragma('foreign_keys = ON');
    assert.throws(() => db.prepare('INSERT INTO memberships(workspace_id,user_id,role,version,created_at,updated_at) VALUES (?,?,?,?,?,?)')
      .run(r.workspaces.a.id, 'missing-user', 'viewer', 1, 1, 1), /FOREIGN KEY/);
    assert.equal(db.pragma('integrity_check', {simple: true}), 'ok');
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(x => x.name);
    assert.deepEqual(names, ['audit', 'invites', 'memberships', 'reset_tokens', 'schema_version', 'sessions', 'users', 'workspaces']);
  } finally {db.close();}
});

test('future identity schema is rejected instead of silently downgraded', t => {
  const r = workspaceFixture(t);
  r.store.close();
  const db = new Database(r.dbPath);
  db.prepare("UPDATE schema_version SET version=99 WHERE component='identity'").run();
  db.close();
  throwsCode(() => r.open(), 'unsupported_schema');
});

test('two concurrent SQLite writers cannot both remove the final effective ownership', async t => {
  const r = workspaceFixture(t);
  r.store.setMembership(r.actor('alice', 'a'), {workspaceId: r.workspaces.a.id, userId: r.users.bob.id, role: 'owner'});
  const gate = new SharedArrayBuffer(4);
  const control = new Int32Array(gate);
  const workers = [];
  const jobs = ['alice', 'bob'].map(user => {
    let readyResolve, resolve, reject;
    const ready = new Promise(done => {readyResolve = done;});
    const result = new Promise((done, fail) => {resolve = done; reject = fail;});
    const worker = new Worker(`
      const {parentPort,workerData:d}=require('node:worker_threads');
      const {createIdentityStore}=require(d.modulePath);
      let store;
      try {
        store=createIdentityStore({dbPath:d.dbPath});
        const actor=store.requireMembership(d.userId,d.workspaceId);
        parentPort.postMessage({ready:true});
        Atomics.wait(new Int32Array(d.gate),0,0,5000);
        store.setMembership(actor,{workspaceId:d.workspaceId,userId:d.userId,role:'member'});
        parentPort.postMessage({ok:true});
      } catch(error) {parentPort.postMessage({ok:false,code:error.code,message:error.message});}
      finally {if(store)store.close();}
    `, {eval: true, workerData: {dbPath: r.dbPath, modulePath: path.resolve(__dirname, '../identity/store.cjs'), userId: r.users[user].id, workspaceId: r.workspaces.a.id, gate}});
    workers.push(worker);
    worker.on('message', message => {if (message.ready) readyResolve(); else {readyResolve(); resolve(message);}});
    worker.on('error', error => {readyResolve(); reject(error);});
    worker.on('exit', code => {if (code !== 0) reject(new Error('Worker exit ' + code));});
    return {ready, result};
  });
  t.after(async () => {for (const worker of workers) await worker.terminate();});
  await Promise.all(jobs.map(j => j.ready));
  Atomics.store(control, 0, 1);
  Atomics.notify(control, 0);
  const results = await Promise.all(jobs.map(j => j.result));
  assert.equal(results.filter(x => x.ok).length, 1, JSON.stringify(results));
  assert.equal(results.find(x => !x.ok).code, 'last_owner');
  const roles = ['alice', 'bob'].map(user => r.actor(user, 'a').role);
  assert.equal(roles.filter(role => role === 'owner').length, 1);
});

test('close is idempotent and later operations fail explicitly', t => {
  const r = workspaceFixture(t);
  r.store.close();
  r.store.close();
  throwsCode(() => r.store.listWorkspaces(r.users.alice.id), 'store_closed');
});
