'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {setTimeout: delay} = require('node:timers/promises');
const {workspaceFixture, throwsCode} = require('./helpers/workspace-fixture.cjs');
const {runWithWorkspace, requireWorkspaceContext} = require('../collaboration/context.cjs');
const {createWorkspaceState, createWorkspaceStateRegistry, createScopedMap} = require('../collaboration/state.cjs');

test('workspace context is required, frozen and never inherited from client privilege fields', () => {
  throwsCode(() => requireWorkspaceContext(), 'workspace_context_required');
  throwsCode(() => runWithWorkspace({workspaceId: 'a', role: 'owner'}, () => {}), 'invalid_context');
  runWithWorkspace({userId: 'alice', workspaceId: 'a', role: 'member', version: 1, platformAdmin: true}, () => {
    const actor = requireWorkspaceContext();
    assert.equal(Object.isFrozen(actor), true);
    assert.equal(actor.platformAdmin, undefined);
    assert.throws(() => {actor.workspaceId = 'b';}, TypeError);
  });
  throwsCode(() => requireWorkspaceContext(), 'workspace_context_required');
});

test('parallel promises, nested workspaces and delayed callbacks preserve independent context', async () => {
  const result = await Promise.all(['a', 'b'].map((workspaceId, index) => runWithWorkspace({userId: 'alice', workspaceId, role: 'owner', version: 1}, async () => {
    await delay(index ? 1 : 10);
    const observed = await new Promise(resolve => setImmediate(() => resolve(requireWorkspaceContext().workspaceId)));
    runWithWorkspace({userId: 'bob', workspaceId: 'nested', role: 'viewer', version: 1}, () => assert.equal(requireWorkspaceContext().workspaceId, 'nested'));
    assert.equal(requireWorkspaceContext().workspaceId, workspaceId);
    return observed;
  })));
  assert.deepEqual(result, ['a', 'b']);
  throwsCode(() => requireWorkspaceContext(), 'workspace_context_required');
});

test('workspace states isolate identically named agents, channels, caches and loop controls', () => {
  const a = createWorkspaceState('a'); const b = createWorkspaceState('b');
  for (const name of ['channels', 'agents', 'agentMemories', 'projectStates', 'researchSessions', 'embeddingCache', 'agentMetrics', 'ralphActive', 'ralphTimers', 'loopHealth']) {
    a[name].set('general', 'only-a');
    assert.equal(b[name].has('general'), false, name);
  }
  assert.equal(a.clients, undefined);
  assert.equal(Object.isFrozen(a), true);
  assert.throws(() => createWorkspaceState('../b'));
  a.close(); b.close();
});

test('state registry revalidates membership and bounds retained workspaces', t => {
  const f = workspaceFixture(t);
  const registry = createWorkspaceStateRegistry({identity: f.store, maxWorkspaces: 1});
  t.after(() => registry.close());
  runWithWorkspace(f.actor('bob', 'a'), () => registry.get().channels.set('general', 'a'));
  runWithWorkspace(f.actor('bob', 'b'), () => throwsCode(() => registry.get(), 'workspace_capacity'));
  f.store.removeMembership(f.actor('alice', 'a'), {workspaceId: f.workspaces.a.id, userId: f.users.bob.id});
  runWithWorkspace({userId: f.users.bob.id, workspaceId: f.workspaces.a.id, role: 'owner', version: 1}, () => throwsCode(() => registry.get(), 'not_found'));
  throwsCode(() => registry.get(), 'workspace_context_required');
});

test('scoped map facade never falls back to legacy storage in multi-user or public mode', t => {
  const f = workspaceFixture(t);
  const registry = createWorkspaceStateRegistry({identity: f.store}); t.after(() => registry.close());
  const map = createScopedMap('agents', {registry, mode: 'multi-user'});
  throwsCode(() => map.get('moderator'), 'workspace_context_required');
  runWithWorkspace(f.actor('alice', 'a'), () => map.set('moderator', 'alice-agent'));
  runWithWorkspace(f.actor('bob', 'b'), () => {assert.equal(map.size, 0); map.set('moderator', 'bob-agent');});
  runWithWorkspace(f.actor('alice', 'a'), () => assert.deepEqual([...map], [['moderator', 'alice-agent']]));
  const legacy = new Map([['moderator', 'local-only']]);
  const local = createScopedMap('agents', {mode: 'legacy-local', legacyMap: legacy, isPublic: false});
  assert.equal(local.get('moderator'), 'local-only');
  throwsCode(() => createScopedMap('agents', {mode: 'legacy-local', legacyMap: legacy, isPublic: true}), 'legacy_public_forbidden');
});
