'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const syntheticHash = '$scrypt$test-only$' + 'a'.repeat(64);

function workspaceFixture(t, {passwordHash = syntheticHash} = {}) {
  const {createIdentityStore} = require('../../identity/store.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-identity-'));
  const dbPath = path.join(dir, 'identity.db');
  let time = Date.parse('2026-10-09T00:00:00Z');
  const stores = [];
  const open = () => {
    const store = createIdentityStore({dbPath, now: () => time});
    stores.push(store);
    return store;
  };
  t.after(() => {
    for (const store of stores) store.close();
    const root = fs.realpathSync(os.tmpdir());
    const target = fs.realpathSync(dir);
    if (path.dirname(target) !== root || !path.basename(target).startsWith('lack-identity-')) {
      throw new Error('Unsafe identity fixture cleanup');
    }
    fs.rmSync(target, {recursive: true, force: true});
  });
  const store = open();
  const users = Object.fromEntries(['alice', 'bob', 'carol'].map(login =>
    [login, store.createUser({login, passwordHash})]));
  const workspaces = {
    a: store.createWorkspace({name: 'Workspace A', ownerId: users.alice.id}),
    b: store.createWorkspace({name: 'Workspace B', ownerId: users.bob.id})
  };
  const actor = (user, workspace) => store.requireMembership(users[user].id, workspaces[workspace].id);
  store.setMembership(actor('alice', 'a'), {workspaceId: workspaces.a.id, userId: users.bob.id, role: 'member'});
  store.setMembership(actor('bob', 'b'), {workspaceId: workspaces.b.id, userId: users.carol.id, role: 'viewer'});
  return {dir, dbPath, store, users, workspaces, actor, open, own: value => {stores.push(value); return value;}, now: () => time, advance: ms => {time += ms;}};
}

function throwsCode(fn, code) {
  require('node:assert/strict').throws(fn, error => error.code === code);
}
module.exports = {workspaceFixture, throwsCode, syntheticHash};
