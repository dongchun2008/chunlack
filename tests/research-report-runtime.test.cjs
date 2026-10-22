'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
const Database = require('better-sqlite3');
const {createPackagedIngressFixture} = require('./helpers/packaged-ingress-fixture.cjs');
const {readResearchReport} = require('../deploy/public/acceptance/research-report.cjs');
test('actual HTTPS research REST renders the workspace panel, rejects foreign readers and pull, and retains the full report after restart', {timeout: 90000, skip: !process.env.CADDY_TEST_BIN}, async t => {
  const abort = new AbortController(); t.after(() => abort.abort());
  const f = await createPackagedIngressFixture({signal: abort.signal, caddyBin: process.env.CADDY_TEST_BIN}); t.after(() => f.close());
  const session = {id: 'research-report-fixture', topic: 'Synthetic evidence only', phase: 'Review complete with gaps', evidenceStatus: 'reviewed_with_gaps', logs: [], notes: [],
    sources: [{sourceId: 'S1', url: 'https://example.com/original?a=1&b=2', status: 'retrieved', excerpt: 'Original synthetic quote.'}],
    evidence: [{claimId: 'C1', text: 'Synthetic claim', sourceId: 'S1', status: 'supported', verification: {verifierId: 'synthetic-verifier', reason: 'Synthetic review', evidence: [{sourceId: 'S1', quote: 'Original synthetic quote.'}]}},
      {claimId: 'C2', text: 'Missing evidence claim', status: 'insufficient_evidence'}], summary: {status: 'complete', claimIds: ['C1']}};
  const context = require(path.join(f.codeRoot, 'collaboration/context.cjs'));
  const {createCollaborationStore} = require(path.join(f.codeRoot, 'collaboration/store.cjs'));
  const db = new Database(path.join(path.dirname(f.codeRoot), 'data/db/lack.db'));
  const store = createCollaborationStore({db, identity: f.runtime.identity});
  try {
    const actor = f.runtime.identity.requireMembership(f.ownerId, f.workspaceId);
    context.runWithWorkspace(actor, () => store.forWorkspace(actor).saveResearch(session.id, session));
  } finally {store.close(); db.close();}
  await f.restart();
  const owner = await f.login(), other = await f.login(f.accounts.other);
  const headers = {Cookie: owner.cookie, Origin: f.webOrigin, 'X-CSRF-Token': owner.csrfToken, 'X-Workspace-Id': f.workspaceId};
  const detailPath = '/api/research/session/' + session.id;
  assert.equal((await f.request('web', detailPath)).status, 401);
  assert.equal((await f.request('web', detailPath, {headers: {...headers, Cookie: other.cookie, 'X-CSRF-Token': other.csrfToken}})).status, 404);
  assert.equal((await f.request('web', detailPath, {headers: {...headers, Cookie: other.cookie, 'X-CSRF-Token': other.csrfToken, 'X-Workspace-Id': f.otherWorkspaceId}})).status, 404);
  const requests = [], state = {status: 'ready', user: {id: f.ownerId, login: 'tls-owner'}, workspace: {id: f.workspaceId, name: 'Fixture', role: 'viewer'}, workspaces: [], generation: 1};
  const client = {snapshot: () => state, can: action => action === 'read', request: async path => {requests.push(path); const response = await f.request('web', path, {headers}); assert.equal(response.status, 200); return JSON.parse(response.text);}};
  const mount = require(path.join(f.codeRoot, 'identity/workspace-shell.js')).mountWorkspaceShell;
  const before = await readResearchReport({client, session, mount}); assert.equal(before.claimCount, 2); assert.ok(before.text.includes('缺证'));
  const socket = await f.connect({cookie: owner.cookie, workspaceId: f.workspaceId});
  socket.send(JSON.stringify({type: 'join', channelId: 'general'})); await f.frame(socket, frame => frame.type === 'history');
  socket.send(JSON.stringify({type: 'message', channelId: 'general', content: '/pull ' + session.id}));
  assert.equal((await f.frame(socket, frame => frame.type === 'error')).code, 'forbidden');
  await f.restart();
  const restored = await f.request('web', detailPath, {headers}); assert.equal(restored.status, 200); assert.deepEqual(JSON.parse(restored.text), session);
  const after = await readResearchReport({client, session, mount}); assert.deepEqual(after, before);
  assert.deepEqual(requests, [detailPath, detailPath]);
});
