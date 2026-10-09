'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {setTimeout: delay} = require('node:timers/promises');
const {workspaceFixture, throwsCode} = require('./helpers/workspace-fixture.cjs');
const {runWithWorkspace} = require('../collaboration/context.cjs');
const {createWorkspaceResources} = require('../collaboration/resources.cjs');
const scoped = (f, user, workspace, fn) => runWithWorkspace(f.actor(user, workspace), () => fn(f.actor(user, workspace)));

test('same named memory, skills and original research evidence remain isolated and survive reopening', t => {
  const f = workspaceFixture(t);
  const r = createWorkspaceResources({dataRoot: f.dir, identity: f.store});
  for (const [user, workspace] of [['alice', 'a'], ['bob', 'b']]) scoped(f, user, workspace, actor => {
    for (const name of ['agent_memories/moderator.json', 'skills/same.json', 'research/session.json']) {
      r.writeJson(actor, name, {owner: workspace, url: 'https://example.com/original', excerpt: 'Original source excerpt'});
    }
    assert.equal(r.readJson(actor, 'research/session.json').owner, workspace);
    assert.equal(r.paths(actor).personal, path.join(r.paths(actor).root, 'users', actor.userId));
  });
  const reopened = createWorkspaceResources({dataRoot: f.dir, identity: f.store});
  scoped(f, 'alice', 'a', actor => assert.deepEqual(reopened.readJson(actor, 'research/session.json'), {owner: 'a', url: 'https://example.com/original', excerpt: 'Original source excerpt'}));
  throwsCode(() => r.paths(f.actor('alice', 'a')), 'workspace_context_required');
});

test('absolute paths, traversal, alternate separators, drive syntax and symlink ancestors are denied', t => {
  const f = workspaceFixture(t);
  const r = createWorkspaceResources({dataRoot: f.dir, identity: f.store});
  scoped(f, 'alice', 'a', actor => {
    const root = r.paths(actor).root;
    const outside = path.join(f.dir, 'outside'); fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(root, 'escape'), 'junction');
    for (const value of ['../outside/key', '..\\outside\\key', '/etc/passwd', 'C:\\key', 'skills/a:stream', 'skills/../key', 'a\0b', path.join(f.dir, 'workspaces', f.workspaces.b.id, 'key'), 'escape/key']) {
      throwsCode(() => r.safePath(actor, value), 'unsafe_resource_path');
    }
    assert.equal(r.safePath(actor, 'skills/notes.json'), path.join(root, 'skills', 'notes.json'));
    fs.symlinkSync(outside, path.join(root, 'research', 'bad.json'), 'file');
    throwsCode(() => r.writeJson(actor, 'research/bad.json', {}), 'unsafe_resource_path');
  });
  throwsCode(() => createWorkspaceResources({dataRoot: path.join(f.dir, 'workspaces', f.workspaces.a.id, 'escape'), identity: f.store}), 'unsafe_resource_path');
});

test('fresh membership, actual roles and matching contexts control file access and private caches', t => {
  const f = workspaceFixture(t);
  const r = createWorkspaceResources({dataRoot: f.dir, identity: f.store});
  let aliceKey, bobAKey, bobBKey;
  scoped(f, 'alice', 'a', actor => {aliceKey = r.cacheKey(actor, {kind: 'embedding', resourceId: 'same private text'});});
  scoped(f, 'bob', 'a', actor => {
    bobAKey = r.cacheKey(actor, {kind: 'embedding', resourceId: 'same private text'});
    throwsCode(() => r.cacheKey(actor, {kind: 'embedding', userId: f.users.alice.id, resourceId: 'same private text'}), 'forbidden');
    throwsCode(() => r.safePath(actor, 'users/' + f.users.alice.id + '/memory.json'), 'not_found');
    throwsCode(() => r.paths(f.actor('bob', 'b')), 'workspace_context_mismatch');
  });
  scoped(f, 'bob', 'b', actor => {bobBKey = r.cacheKey(actor, {kind: 'embedding', resourceId: 'same private text'});});
  assert.equal(new Set([aliceKey, bobAKey, bobBKey]).size, 3);
  assert.ok(!aliceKey.includes('same private text'));
  scoped(f, 'carol', 'b', actor => throwsCode(() => r.writeJson(actor, 'skills/new.json', {}), 'forbidden'));
  const revoked = f.actor('bob', 'a');
  f.store.removeMembership(f.actor('alice', 'a'), {workspaceId: f.workspaces.a.id, userId: f.users.bob.id});
  runWithWorkspace(revoked, () => throwsCode(() => r.safePath(revoked, 'research/session.json'), 'not_found'));
});

test('delayed maintenance retains its exact workspace and refuses work after revocation', async t => {
  const f = workspaceFixture(t);
  const r = createWorkspaceResources({dataRoot: f.dir, identity: f.store});
  const results = await Promise.all([['alice', 'a'], ['bob', 'b']].map(([user, workspace], index) => scoped(f, user, workspace, async actor => {
    await delay(index ? 1 : 10);
    r.writeJson(actor, 'agent_memories/maintenance.json', {workspace});
    return r.readJson(actor, 'agent_memories/maintenance.json').workspace;
  })));
  assert.deepEqual(results, ['a', 'b']);
  const actor = f.actor('bob', 'a');
  const pending = runWithWorkspace(actor, async () => {await delay(10); throwsCode(() => r.writeJson(actor, 'skills/new.json', {}), 'not_found');});
  f.store.removeMembership(f.actor('alice', 'a'), {workspaceId: f.workspaces.a.id, userId: f.users.bob.id});
  await pending;
});

test('resource JSON is bounded, private, atomic and cannot expose credential-shaped payloads', t => {
  const f = workspaceFixture(t);
  const r = createWorkspaceResources({dataRoot: f.dir, identity: f.store});
  scoped(f, 'alice', 'a', actor => {
    r.writeJson(actor, 'skills/safe.json', {text: 'retained'});
    throwsCode(() => r.writeJson(actor, 'skills/safe.json', {text: 'x'.repeat(300000)}), 'resource_too_large');
    assert.equal(r.readJson(actor, 'skills/safe.json').text, 'retained');
    throwsCode(() => r.writeJson(actor, 'skills/key.json', {nested: {apiKey: 'synthetic-only'}}), 'private_resource_configuration');
    if (process.platform !== 'win32') assert.equal(fs.statSync(r.safePath(actor, 'skills/safe.json')).mode & 0o777, 0o600);
  });
});
