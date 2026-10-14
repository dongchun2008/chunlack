'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {generateKeyPairSync, sign, randomUUID} = require('node:crypto');
const {gatewayFixture} = require('./helpers/workspace-gateway-fixture.cjs');
const {throwsCode} = require('./helpers/workspace-fixture.cjs');
const {createAgentAccessVerifier} = require('../identity/agent-access.cjs');
const {createAgentAuthority} = require('../identity/agent-authority.cjs');
const issuer = 'https://pocket.example.test', resource = 'https://agents.example.test/mcp';
const subject = '11111111-1111-4111-8111-111111111111';
const config = {enabled: true, issuer, resource, jwksUri: issuer + '/.well-known/jwks.json',
  clientIds: ['native-client', 'other-native-client'], browserClientId: 'human-login-client'};
let pair, jwk;
test.before(() => {
  pair = generateKeyPairSync('rsa', {modulusLength: 2048});
  jwk = {...pair.publicKey.export({format: 'jwk'}), kid: 'authority-test', alg: 'RS256', use: 'sig'};
});
async function fixture(t, {maxGrants, fetchImpl, install = true} = {}) {
  const r = gatewayFixture(t), db = new Database(r.dbPath);
  r.own({close: () => {if (db.open) db.close();}});
  r.store.linkExternalIdentity({issuer, sub: subject, userId: r.users.alice.id});
  const verifier = await createAgentAccessVerifier({config, now: r.now,
    fetchImpl: fetchImpl || (async () => Response.json({keys: [jwk]}))});
  t.after(() => verifier.close());
  const options = {db, identity: r.store, workspaceAccess: r.access, verifier, config, now: r.now, maxGrants};
  const authority = install ? r.own(createAgentAuthority(options)) : null;
  const token = (claims = {}) => {
    const iat = Math.floor(r.now() / 1000), encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const input = encode({alg: 'RS256', typ: 'at+jwt', kid: jwk.kid}) + '.' + encode({
      iss: issuer, sub: subject, aud: resource, iat, exp: iat + 600, jti: 'authority-token',
      client_id: config.clientIds[0], scope: 'openid task.read task.claim task.result events.read events.subscribe', ...claims
    });
    return input + '.' + sign('RSA-SHA256', Buffer.from(input), pair.privateKey).toString('base64url');
  };
  const input = extra => ({subject, clientId: config.clientIds[0], workspaceId: r.workspaces.a.id,
    nodeId: r.nodes.a.id, scopes: ['task.read', 'task.claim', 'task.result'], expiresAt: r.now() + 3600000, ...extra});
  const grant = extra => authority.grant(r.actor('alice', 'a'), input(extra));
  const authenticate = (g, scope = 'task.read', claims) => authority.authenticate(token(claims), {grantId: g.id, scope});
  return {...r, db, options, authority, verifier, token, input, grant, authenticate};
}

test('signed identity requires an explicit local grant and produces no gateway principal', async t => {
  const r = await fixture(t), g = r.grant();
  const proof = await r.authenticate(g), evidence = r.authority.assert(proof, {scope: 'task.read'});
  assert.deepEqual(Object.keys(proof), []);
  assert.equal(evidence.nodeId, r.nodes.a.id);
  assert.equal(evidence.workspaceId, r.workspaces.a.id);
  assert.equal(evidence.userId, r.users.alice.id);
  assert.ok(Object.isFrozen(proof)); assert.ok(Object.isFrozen(evidence));
  throwsCode(() => r.authority.assert({...evidence}, {scope: 'task.read'}), 'unauthorized');
  throwsCode(() => r.gatewayStore.assertAuthenticatedNode(proof), 'unauthorized');
  await assert.rejects(r.authenticate({id: randomUUID()}), {code: 'unauthorized'});
  assert.ok(!JSON.stringify(g).includes(r.token()));
});

test('grant administration revalidates owner roles and workspace/node ownership', async t => {
  const r = await fixture(t);
  throwsCode(() => r.authority.grant({...r.actor('bob', 'a'), role: 'owner'}, r.input()), 'forbidden');
  throwsCode(() => r.authority.grant(r.actor('alice', 'a'), r.input({workspaceId: r.workspaces.b.id})), 'forbidden');
  throwsCode(() => r.grant({nodeId: r.nodes.b.id}), 'forbidden');
  assert.equal(r.db.prepare('SELECT COUNT(*) AS n FROM agent_authority_grants').get().n, 0);
});

test('matching issuer identity still cannot use another allowed client or ungranted scope', async t => {
  const r = await fixture(t), g = r.grant({scopes: ['task.read']});
  await assert.rejects(r.authenticate(g, 'task.read', {client_id: config.clientIds[1]}), {code: 'unauthorized'});
  await assert.rejects(r.authenticate(g, 'task.claim'), {code: 'insufficient_scope'});
  const proof = await r.authenticate(g);
  throwsCode(() => r.authority.assert(proof, {scope: 'task.result'}), 'insufficient_scope');
});

test('revocation and explicit regrant cannot revive the old opaque proof', async t => {
  const r = await fixture(t), g = r.grant(), proof = await r.authenticate(g);
  r.authority.revoke(r.actor('alice', 'a'), {workspaceId: r.workspaces.a.id, grantId: g.id});
  throwsCode(() => r.authority.assert(proof, {scope: 'task.read'}), 'unauthorized');
  const replacement = r.grant();
  assert.notEqual(replacement.id, g.id);
  throwsCode(() => r.authority.assert(proof, {scope: 'task.read'}), 'unauthorized');
  assert.equal(r.authority.assert(await r.authenticate(replacement), {scope: 'task.read'}).grantId, replacement.id);
  const audit = r.store.listAudit(r.actor('alice', 'a'));
  assert.ok(audit.some(row => row.action === 'agent.grant.create'));
  assert.ok(audit.some(row => row.action === 'agent.grant.revoke'));
  assert.ok(!JSON.stringify(audit).includes(r.token()));
});

test('external unlink revokes grants and cannot silently relink a revoked identity', async t => {
  const r = await fixture(t), first = r.grant(), proof = await r.authenticate(first);
  r.store.unlinkExternalIdentity({issuer, sub: subject});
  throwsCode(() => r.store.linkExternalIdentity({issuer, sub: subject, userId: r.users.alice.id}), 'identity_already_linked');
  throwsCode(() => r.authority.assert(proof, {scope: 'task.read'}), 'unauthorized');
  await assert.rejects(r.authenticate(first), error => error.code === 'unauthorized');
  assert.equal(r.db.prepare('SELECT COUNT(*) AS n FROM agent_authority_grants').get().n, 0);
});

test('parent REPLACE revokes grants even with reused timestamps and recursive triggers disabled', async t => {
  const r = await fixture(t);
  const second = r.grant(), nextProof = await r.authenticate(second);
  r.db.pragma('recursive_triggers=OFF');
  r.db.prepare('INSERT OR REPLACE INTO external_identities(issuer,subject,user_id,created_at,revoked_at) VALUES (?,?,?,?,NULL)')
    .run(issuer, subject, r.users.alice.id, r.now());
  throwsCode(() => r.authority.assert(nextProof, {scope: 'task.read'}), 'unauthorized');
  await assert.rejects(r.authenticate(second), error => error.code === 'unauthorized');
  const replacement = r.grant();
  assert.notEqual(replacement.id, second.id);
  r.authority.assert(await r.authenticate(replacement), {scope: 'task.read'});
});

for (const operation of ['grant', 'revoke']) {
  test(`stale owner context cannot ${operation} after demotion`, async t => {
    const r = await fixture(t), actor = r.actor('alice', 'a'), existing = r.grant();
    r.db.prepare('UPDATE memberships SET role=? WHERE user_id=? AND workspace_id=?')
      .run('member', r.users.alice.id, r.workspaces.a.id);
    const before = r.db.prepare('SELECT * FROM agent_authority_grants ORDER BY id').all();
    const auditBefore = r.db.prepare('SELECT * FROM audit ORDER BY id').all();
    if (operation === 'grant') {
      throwsCode(() => r.authority.grant(actor, r.input({clientId: 'other-native-client'})), 'forbidden');
    } else {
      throwsCode(() => r.authority.revoke(actor, {workspaceId: r.workspaces.a.id, grantId: existing.id}), 'forbidden');
    }
    assert.deepEqual(r.db.prepare('SELECT * FROM agent_authority_grants ORDER BY id').all(), before);
    assert.deepEqual(r.db.prepare('SELECT * FROM audit ORDER BY id').all(), auditBefore);
  });
}

test('recipient demotion and later promotion never revive an old grant', async t => {
  const r = await fixture(t), grant = r.grant(), proof = await r.authenticate(grant);
  const update = r.db.prepare('UPDATE memberships SET role=? WHERE user_id=? AND workspace_id=?');
  update.run('viewer', r.users.alice.id, r.workspaces.a.id);
  throwsCode(() => r.authority.assert(proof, {scope: 'task.read'}), 'unauthorized');
  await assert.rejects(r.authenticate(grant), error => error.code === 'unauthorized');
  update.run('owner', r.users.alice.id, r.workspaces.a.id);
  throwsCode(() => r.authority.assert(proof, {scope: 'task.read'}), 'unauthorized');
  await assert.rejects(r.authenticate(grant), error => error.code === 'unauthorized');
  const replacement = r.grant();
  r.authority.assert(await r.authenticate(replacement), {scope: 'task.read'});
});

for (const target of ['users', 'workspaces']) {
  test(`${target} disable and reenable never revive an old grant`, async t => {
    const r = await fixture(t), grant = r.grant(), proof = await r.authenticate(grant);
    const id = target === 'users' ? r.users.alice.id : r.workspaces.a.id;
    const update = r.db.prepare(`UPDATE ${target} SET disabled_at=? WHERE id=?`);
    update.run(r.now(), id);
    throwsCode(() => r.authority.assert(proof, {scope: 'task.read'}), 'unauthorized');
    await assert.rejects(r.authenticate(grant), error => error.code === 'unauthorized');
    update.run(null, id);
    throwsCode(() => r.authority.assert(proof, {scope: 'task.read'}), 'unauthorized');
    await assert.rejects(r.authenticate(grant), error => error.code === 'unauthorized');
    const replacement = r.grant();
    r.authority.assert(await r.authenticate(replacement), {scope: 'task.read'});
  });
}

for (const invalidation of ['expiry', 'membership epoch']) {
  test(`full capacity prunes ${invalidation} without losing audit history or reviving old proofs`, async t => {
    const r = await fixture(t, {maxGrants: 1});
    const grant = r.grant({expiresAt: r.now() + 10000}), proof = await r.authenticate(grant);
    const audits = r.db.prepare("SELECT * FROM audit WHERE action='agent.grant.create' ORDER BY id").all();
    assert.equal(audits.length, 1);
    throwsCode(() => r.grant({clientId: 'other-native-client'}), 'grant_capacity');
    if (invalidation === 'expiry') r.advance(10000);
    else {
      const update = r.db.prepare('UPDATE memberships SET role=? WHERE user_id=? AND workspace_id=?');
      update.run('member', r.users.alice.id, r.workspaces.a.id);
      update.run('owner', r.users.alice.id, r.workspaces.a.id);
    }
    throwsCode(() => r.authority.assert(proof, {scope: 'task.read'}), 'unauthorized');
    const replacement = r.grant();
    assert.notEqual(replacement.id, grant.id);
    assert.equal(r.db.prepare('SELECT COUNT(*) AS n FROM agent_authority_grants').get().n, 1);
    assert.equal(r.db.prepare('SELECT id FROM agent_authority_grants WHERE id=?').get(grant.id), undefined);
    assert.deepEqual(r.db.prepare('SELECT * FROM audit WHERE id=?').get(audits[0].id), audits[0]);
    assert.equal(r.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='agent.grant.create'").get().n, 2);
    throwsCode(() => r.authority.assert(proof, {scope: 'task.read'}), 'unauthorized');
    await assert.rejects(r.authenticate(grant), error => error.code === 'unauthorized');
    r.authority.assert(await r.authenticate(replacement), {scope: 'task.read'});
  });
}

for (const component of ['agent-authority', 'agent-membership-epochs']) {
  test(`future ${component} schema is rejected without schema or data changes`, async t => {
    const r = await fixture(t, {install: false});
    r.db.prepare('INSERT INTO schema_version(component,version,applied_at) VALUES (?,?,?) ON CONFLICT(component) DO UPDATE SET version=excluded.version')
      .run(component, 999, r.now());
    const snapshot = () => r.db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all()
      .map(entry => ({...entry, rows: entry.type === 'table'
        ? r.db.prepare('SELECT * FROM "' + entry.name.replaceAll('"', '""') + '"').all() : null}));
    const before = snapshot();
    assert.throws(() => createAgentAuthority(r.options));
    assert.deepEqual(snapshot(), before);
  });
}

test('remove and rejoin invalidates old grants despite node identity and version reuse', async t => {
  const r = await fixture(t);
  r.store.setMembership(r.actor('alice', 'a'), {workspaceId: r.workspaces.a.id, userId: r.users.bob.id, role: 'owner'});
  const g = r.grant(), proof = await r.authenticate(g);
  r.store.removeMembership(r.actor('bob', 'a'), {workspaceId: r.workspaces.a.id, userId: r.users.alice.id});
  r.store.setMembership(r.actor('bob', 'a'), {workspaceId: r.workspaces.a.id, userId: r.users.alice.id, role: 'owner'});
  throwsCode(() => r.authority.assert(proof, {scope: 'task.read'}), 'unauthorized');
  await assert.rejects(r.authenticate(g), {code: 'unauthorized'});
});

test('pause denies new claims but permits results, and revocation denies every scope', async t => {
  const r = await fixture(t), g = r.grant(), proof = await r.authenticate(g);
  r.human('alice', 'a', h => h.setNodePaused(r.nodes.a.id, true));
  throwsCode(() => r.authority.assert(proof, {scope: 'task.claim'}), 'node_paused');
  assert.equal(r.authority.assert(proof, {scope: 'task.result'}).nodeId, r.nodes.a.id);
  r.human('alice', 'a', h => h.setNodePaused(r.nodes.a.id, false));
  assert.equal(r.authority.assert(proof, {scope: 'task.claim'}).nodeId, r.nodes.a.id);
  r.human('alice', 'a', h => h.revokeNode(r.nodes.a.id));
  throwsCode(() => r.authority.assert(proof, {scope: 'task.result'}), 'unauthorized');
});

test('node re-pair never transfers an old grant to the replacement node', async t => {
  const r = await fixture(t), g = r.grant(), proof = await r.authenticate(g);
  const replacement = r.human('alice', 'a', h => h.rePair(r.nodes.a.id));
  assert.notEqual(replacement.nodeId, r.nodes.a.id);
  throwsCode(() => r.authority.assert(proof, {scope: 'task.read'}), 'unauthorized');
});

for (const expires of ['grant', 'token']) {
  test('current authority stops at ' + expires + ' expiry', async t => {
    const r = await fixture(t), g = r.grant(expires === 'grant' ? {expiresAt: r.now() + 10000} : {});
    const proof = await r.authenticate(g, 'task.read', expires === 'token' ? {exp: Math.floor(r.now() / 1000) + 10} : {});
    r.advance(10000);
    throwsCode(() => r.authority.assert(proof, {scope: 'task.read'}), 'unauthorized');
  });
}

test('capacity, duplicate and malformed grants do not expand authority', async t => {
  const r = await fixture(t, {maxGrants: 1}), g = r.grant();
  throwsCode(() => r.grant(), 'grant_exists');
  throwsCode(() => r.grant({clientId: config.clientIds[1]}), 'grant_capacity');
  for (const extra of [{scopes: ['platform.manage']}, {scopes: []}, {clientId: config.browserClientId},
    {subject: [subject]}, {expiresAt: r.now()}, {expiresAt: r.now() + 31 * 86400000}]) {
    throwsCode(() => r.grant(extra), 'invalid_agent_grant');
  }
  assert.equal(r.db.prepare('SELECT COUNT(*) AS n FROM agent_authority_grants').get().n, 1);
  r.authority.revoke(r.actor('alice', 'a'), {workspaceId: r.workspaces.a.id, grantId: g.id});
  assert.ok(r.grant({clientId: config.clientIds[1]}).id);
});

test('registry restart preserves grants but not previous instance proofs', async t => {
  const r = await fixture(t), g = r.grant(), proof = await r.authenticate(g);
  r.authority.close();
  const reopened = r.own(createAgentAuthority(r.options));
  throwsCode(() => reopened.assert(proof, {scope: 'task.read'}), 'unauthorized');
  const fresh = await reopened.authenticate(r.token(), {grantId: g.id, scope: 'task.read'});
  assert.equal(reopened.assert(fresh, {scope: 'task.read'}).grantId, g.id);
});

test('close during asynchronous verification cannot issue a usable authority proof', async t => {
  let release, started;
  const gate = new Promise(resolve => {release = resolve;});
  const entered = new Promise(resolve => {started = resolve;});
  const r = await fixture(t, {fetchImpl: async () => {started(); await gate; return Response.json({keys: [jwk]});}});
  const pending = assert.rejects(r.authenticate(r.grant()), {code: 'service_closed'});
  await entered;
  r.authority.close(); r.authority.close(); release();
  await pending;
});

test('authority migration failure rolls back epoch and grant installation together', async t => {
  const r = await fixture(t, {install: false});
  r.db.exec(`CREATE TRIGGER test_fail_authority_version BEFORE INSERT ON schema_version
    WHEN NEW.component='agent-authority' BEGIN SELECT RAISE(ABORT,'injected_authority_registration'); END;`);
  const schema = () => r.db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY type,name').all();
  const before = schema();
  assert.throws(() => createAgentAuthority(r.options), /injected_authority_registration/);
  assert.deepEqual(schema(), before);
});
