'use strict';
const {generateKeyPairSync, sign} = require('node:crypto');
const path = require('node:path');
const Database = require('better-sqlite3');
const {workspaceFixture} = require('./workspace-fixture.cjs');
const {runWithWorkspace} = require('../../collaboration/context.cjs');
const {createGatewayStore} = require('../../gateway/store.cjs');
const {createWorkspaceGatewayAccess} = require('../../gateway/workspace-access.cjs');
const {createAgentAccessVerifier} = require('../../identity/agent-access.cjs');
const {createAgentAuthority} = require('../../identity/agent-authority.cjs');

const issuer = 'https://pocket.example.test', resource = 'https://agents.example.test/mcp';
const subject = '11111111-1111-4111-8111-111111111111';
let keys;
async function agentAuthorityFixture(t) {
  keys ||= generateKeyPairSync('rsa', {modulusLength: 2048});
  const jwk = {...keys.publicKey.export({format: 'jwk'}), kid: 'gateway-test', alg: 'RS256', use: 'sig'};
  const r = workspaceFixture(t);
  const db = new Database(r.dbPath); r.own({close() {if (db.open) db.close();}});
  let authority;
  const gateway = r.own(createGatewayStore({dbPath: path.join(r.dir, 'gateway.sqlite'), multiUser: true, now: r.now,
    agentAuthority: {assert: (proof, options) => authority.assert(proof, options)}}));
  const access = createWorkspaceGatewayAccess({store: gateway, identity: r.store});
  const human = (user, workspace, fn) => {
    const actor = r.actor(user, workspace);
    return runWithWorkspace(actor, () => fn(access.forHuman(actor)));
  };
  const nodes = {};
  for (const [workspace, user] of [['a', 'alice'], ['b', 'bob']]) {
    nodes[workspace] = human(user, workspace, h => h.createNode({name: workspace,
      capabilities: ['research.retrieve'], scopes: ['public']}));
  }
  const config = {enabled: true, issuer, resource, jwksUri: issuer + '/.well-known/jwks.json',
    clientIds: ['native-client'], browserClientId: 'human-login-client'};
  r.store.linkExternalIdentity({issuer, sub: subject, userId: r.users.alice.id});
  const verifier = await createAgentAccessVerifier({config, now: r.now,
    fetchImpl: async () => Response.json({keys: [jwk]})});
  t.after(() => verifier.close());
  authority = r.own(createAgentAuthority({db, identity: r.store, workspaceAccess: access, verifier, config, now: r.now}));
  const allScopes = ['task.read', 'task.claim', 'task.result', 'events.read', 'events.subscribe'];
  function token(scopes = allScopes) {
    const at = Math.floor(r.now() / 1000);
    const header = Buffer.from(JSON.stringify({alg: 'RS256', typ: 'at+jwt', kid: 'gateway-test'})).toString('base64url');
    const payload = Buffer.from(JSON.stringify({iss: issuer, sub: subject, aud: resource, iat: at, exp: at + 600,
      jti: 'gateway-test-token', client_id: 'native-client', scope: ['openid', ...scopes].join(' ')})).toString('base64url');
    const input = header + '.' + payload;
    return input + '.' + sign('RSA-SHA256', Buffer.from(input), keys.privateKey).toString('base64url');
  }
  async function agent(scopes = allScopes, initialScope = scopes[0]) {
    const grant = authority.grant(r.actor('alice', 'a'), {subject, clientId: 'native-client',
      workspaceId: r.workspaces.a.id, nodeId: nodes.a.id, scopes, expiresAt: r.now() + 3600000});
    const proof = await authority.authenticate(token(scopes), {grantId: grant.id, scope: initialScope});
    const principal = gateway.authenticateAgent(proof, {scope: initialScope});
    return {grant, proof, principal, node: access.forNode(principal)};
  }
  const enqueue = (workspace = 'a') => human(workspace === 'a' ? 'alice' : 'bob', workspace,
    h => h.enqueueTask({targetNodeId: nodes[workspace].id, scopeId: 'public', taskType: 'research.retrieve',
      input: {query: 'synthetic public research'}, deadlineAt: r.now() + 120000}));
  return {...r, db, gateway, access, human, nodes, authority, token, agent, enqueue};
}
module.exports = {agentAuthorityFixture};
