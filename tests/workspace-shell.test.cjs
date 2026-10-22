'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {mountWorkspaceShell} = require('../identity/workspace-shell.js');
const {documentFixture} = require('./helpers/workspace-document.cjs');
function setup(t, {role = 'viewer', login = '<img src=x onerror=alert(1)>', response = {}} = {}) {
  const f = documentFixture(), requests = [], account = {id: 'user-fixture', login};
  const state = {status: 'ready', user: account, workspace: {id: 'workspace-a', name: '<script>workspace</script>', role}, workspaces: [{id: 'workspace-a', name: 'A', role}], generation: 1};
  const client = {snapshot: () => state, can: action => action === 'read' || (action === 'execute' && role !== 'viewer') || (['manage', 'cancel'].includes(action) && role === 'owner'),
    request: async (path, options) => {requests.push({path, options}); return response;}, login: async () => {throw Object.assign(new Error('unauthorized'), {code: 'unauthorized'});}, logout: async () => {}, selectWorkspace: async () => {}};
  const view = mountWorkspaceShell({client, document: f.document}); t.after(() => view.close()); view.render(state);
  return {...f, view, requests, state, client};
}
test('account/workspace strings render as text, with no dynamic HTML or secret fields; viewer controls are disabled', t => {
  const f = setup(t);
  assert.equal(f.document.getElementById('workspaceAccount').textContent, '<img src=x onerror=alert(1)>');
  assert.equal(f.document.getElementById('messageInput').disabled, true); assert.equal(f.document.getElementById('studioSpawnBtn').disabled, true);
  assert.ok(!f.walk().some(node => node.tagName === 'img' || node.tagName === 'script'));
  assert.ok(f.walk().every(node => !String(node.textContent).includes('csrfToken')));
});
test('node revocation uses the actual public-node boolean and never offers manage actions on a revoked node', async t => {
  const f = setup(t, {role: 'owner', response: {nodes: [{id: 'node-fixture', name: 'Revoked fixture', revoked: true, paused: false}]}});
  await f.view.openNodes(); assert.ok(f.walk().some(node => node.textContent === '已撤销'));
  assert.ok(!f.walk().some(node => node.tagName === 'button' && ['暂停', '恢复', '撤销'].includes(node.textContent)));
});
test('an external succeeded task does not offer cancellation as if it were still running', async t => {
  const f = setup(t, {role: 'owner', response: {localTasks: [], externalTasks: [{taskId: 'done-fixture', state: 'succeeded', createdBy: 'user-fixture'}]}});
  await f.view.openTasks(); assert.ok(!f.walk().some(node => node.tagName === 'button' && node.textContent === '取消'));
});
test('login clears the typed password before the request and reports failure without revealing it', async t => {
  const f = setup(t); f.view.render({...f.state, status: 'login', user: null, workspace: null, workspaces: []});
  const form = f.document.getElementById('workspaceLoginForm'), password = f.document.getElementById('workspacePassword'); password.value = 'synthetic-private-password';
  f.client.login = async () => {assert.equal(password.value, ''); throw Object.assign(new Error('unauthorized'), {code: 'unauthorized'});};
  await form.onsubmit({preventDefault() {}}); assert.equal(password.value, '');
  assert.ok(!f.walk().some(node => String(node.textContent).includes('synthetic-private-password')));
});
test('evidence panel retains original source URLs and excerpts, and marks a conclusion with no matching source as missing evidence', async t => {
  const url = 'https://example.com/original?a=1&b=2', excerpt = '<img src=x onerror=alert(1)> original excerpt';
  const f = setup(t, {response: {session: {topic: 'Source fixture', evidenceStatus: 'insufficient_evidence', sources: [{sourceId: 'S1', url, excerpt}], claims: [{text: 'Unsupported conclusion', sourceId: 'S9'}]}}});
  await f.view.openResearch('research-fixture');
  assert.equal(f.requests[0].path, '/api/research/session/research-fixture');
  assert.ok(f.walk().some(node => node.textContent === excerpt));
  const link = f.walk().find(node => node.tagName === 'a'); assert.equal(link.textContent, url); assert.equal(link.href, url); assert.equal(link.rel, 'noopener noreferrer');
  assert.ok(f.walk().some(node => String(node.textContent).includes('缺证')));
});
test('unsafe source URLs do not become clickable links and closing the panel clears its private DOM', async t => {
  const f = setup(t, {response: {sources: [{sourceId: 'S1', url: 'javascript:alert(1)', excerpt: 'private-excerpt-fixture'}], claims: []}});
  await f.view.openResearch('unsafe-source'); assert.ok(!f.walk().some(node => node.tagName === 'a'));
  f.view.clear(); assert.ok(!f.walk().some(node => String(node.textContent).includes('private-excerpt-fixture')));
});
test('member removal requires an in-page confirmation, and workspace reset cancels a pending confirmation without issuing a mutation', async t => {
  const f = setup(t, {role: 'owner', response: {members: [{userId: 'member-fixture', login: 'member', role: 'member'}]}});
  f.document.defaultView.confirm = () => {throw new Error('Native dialogs must not be required');};
  await f.view.openMembers();
  const remove = f.walk().find(node => node.tagName === 'button' && node.textContent === '移除');
  const pending = remove.onclick();
  assert.ok(f.walk().some(node => node.tagName === 'button' && node.textContent === '确认操作'));
  assert.equal(f.requests.length, 1);
  f.view.clear(); await pending; assert.equal(f.requests.length, 1);
});

test('member starts a public browser pilot only after an in-page confirmation and submits only the selected node id', async t => {
  const eligible = {id: 'browser-node', name: '<img src=x> browser', capabilities: ['browser.public_read'], scopes: ['public'], paused: false, revoked: false};
  const f = setup(t, {role: 'member', response: {nodes: [eligible]}});
  f.client.request = async (path, options) => {f.requests.push({path, options}); return options?.method === 'POST' ? {task: {taskId: 'created-public-pilot'}} : {nodes: [eligible]};};
  await f.view.openNodes();
  const start = f.walk().find(node => node.tagName === 'button' && node.textContent === '公开浏览试点'); assert.ok(start);
  const pending = start.onclick();
  assert.equal(f.requests.filter(item => item.options?.method === 'POST').length, 0);
  const confirm = f.walk().find(node => node.tagName === 'button' && node.textContent === '确认操作'); assert.ok(confirm); confirm.onclick(); await pending;
  const sent = f.requests.filter(item => item.options?.method === 'POST');
  assert.deepEqual(sent, [{path: '/api/tasks', options: {method: 'POST', body: {targetNodeId: 'browser-node'}}}]);
  assert.ok(f.walk().some(node => String(node.textContent).includes('created-public-pilot')));
  assert.ok(!f.walk().some(node => node.tagName === 'img'));
});

test('public pilot action is absent for viewers and for paused, revoked, mixed-capability or non-public nodes', async t => {
  const browser = {id: 'browser-node', capabilities: ['browser.public_read'], scopes: ['public']};
  const viewer = setup(t, {response: {nodes: [browser]}}); await viewer.view.openNodes();
  assert.ok(!viewer.walk().some(node => node.tagName === 'button' && node.textContent === '公开浏览试点'));
  const owner = setup(t, {role: 'owner', response: {nodes: [{...browser, paused: true}, {...browser, revoked: true}, {...browser, capabilities: ['research.verify']}, {...browser, capabilities: ['browser.public_read', 'research.verify']}, {...browser, scopes: ['private']}]}});
  await owner.view.openNodes();
  assert.ok(!owner.walk().some(node => node.tagName === 'button' && node.textContent === '公开浏览试点'));
});

test('closing the panel cancels a pending public pilot confirmation without creating work in a new workspace', async t => {
  const f = setup(t, {role: 'member', response: {nodes: [{id: 'old-workspace-node', capabilities: ['browser.public_read'], scopes: ['public']}]}});
  await f.view.openNodes(); const start = f.walk().find(node => node.tagName === 'button' && node.textContent === '公开浏览试点'); assert.ok(start);
  const pending = start.onclick(); f.view.clear(); await pending;
  assert.equal(f.requests.filter(item => item.options?.method === 'POST').length, 0);
});

test('human screenshot is workspace-fetched, text-rendered and owner acceptance requires decoded image and explicit confirmation', async t => {
  const f = setup(t, {role: 'owner'}), created = [], revoked = [];
  f.document.defaultView.URL = {createObjectURL: blob => {assert.equal(blob.type, 'image/png'); created.push('blob:owned-image'); return 'blob:owned-image';}, revokeObjectURL: value => revoked.push(value)};
  const receipt = {task: {taskId: 'pilot', taskType: 'browser.public_read', state: 'succeeded'}, acceptance: {state: 'evidence_checked', acceptedAt: null},
    artifact: {width: 1, height: 1, sizeBytes: 2, sha256: 'a'.repeat(64)}, output: {url: 'https://example.com/', title: '<script>title</script>', executedAt: '2026-10-11T00:00:00Z', activityEvidence: 'Synthetic only'}};
  f.client.request = async (path, options) => {f.requests.push({path, options}); return options?.method === 'POST' ? {acceptance: {state: 'accepted', acceptedAt: 1}} : receipt;};
  f.client.fetch = async path => {f.requests.push({path}); return {headers: new Headers({'Content-Type': 'image/png'}), blob: async () => new Blob([Buffer.from([1, 2])], {type: 'image/png'})};};
  assert.equal(typeof f.view.openTaskEvidence, 'function'); await f.view.openTaskEvidence('pilot');
  assert.ok(f.walk().some(node => node.textContent === '<script>title</script>'));
  assert.ok(!f.walk().some(node => node.tagName === 'script'));
  const image = f.walk().find(node => node.tagName === 'img'), approve = f.walk().find(node => node.textContent === '确认人工验收');
  assert.ok(image); assert.equal(image.src, 'blob:owned-image'); assert.equal(approve.disabled, true);
  image.onload(); assert.equal(approve.disabled, false);
  const pending = approve.onclick(); assert.equal(f.requests.filter(item => item.options?.method === 'POST').length, 0);
  f.walk().find(node => node.textContent === '确认操作').onclick(); await pending;
  assert.deepEqual(f.requests.filter(item => item.options?.method === 'POST'), [{path: '/api/tasks/pilot/acceptance', options: {method: 'POST', body: {confirm: true}}}]);
  assert.equal(approve.disabled, true); f.view.clear(); assert.deepEqual(revoked, created);
});

test('viewer evidence has no approval and a panel reset discards a late image without creating a blob URL', async t => {
  const f = setup(t), created = [];
  f.document.defaultView.URL = {createObjectURL: () => {created.push('leaked-image'); return 'blob:bad';}, revokeObjectURL: () => {}};
  f.client.request = async () => ({task: {taskId: 'pilot', taskType: 'browser.public_read', state: 'succeeded'}, acceptance: {state: 'evidence_checked'}, artifact: {width: 1, height: 1}, output: {title: 'Old private title'}});
  let release;
  f.client.fetch = async () => ({headers: new Headers({'Content-Type': 'image/png'}), blob: () => new Promise(resolve => {release = resolve;})});
  assert.equal(typeof f.view.openTaskEvidence, 'function'); const pending = f.view.openTaskEvidence('pilot');
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(!f.walk().some(node => node.textContent === '确认人工验收'));
  f.view.clear(); release(new Blob([Buffer.from([1])], {type: 'image/png'})); await pending;
  assert.deepEqual(created, []); assert.ok(!f.walk().some(node => node.textContent === 'Old private title'));
});

function currentResearchSession() {
  const excerpt = '<script>not executable</script> Exact original quote.';
  const states = ['supported', 'partially_supported', 'conflicting', 'insufficient_evidence', 'unverified'];
  return {id: 'report-current', topic: 'Current evidence', phase: 'Review complete with gaps', evidenceStatus: 'reviewed_with_gaps',
    sources: [{sourceId: 'S1', url: 'https://example.com/original?a=1&b=2', status: 'retrieved', excerpt, truncated: true}],
    evidence: states.map((status, index) => ({claimId: 'C' + (index + 1), text: 'Claim ' + status, sourceId: 'S1', status,
      ...(status === 'unverified' ? {} : {verification: {verifierId: '<img verifier>', reviewedAt: '2026-10-22T00:00:00Z', reason: 'Reason ' + status, evidence: [{sourceId: 'S1', quote: excerpt}]}})})),
    summary: {status: 'complete', summarizerId: 'summary-agent', claimIds: ['C2', 'C1']},
    notes: [{question: 'Question without evidence', status: 'fetch_failed', answer: 'Unverified note only'}]};
}
test('current evidence report renders every decision, ordered summary, original links, verbatim quotes and missing-evidence notes as text', async t => {
  const session = currentResearchSession(), f = setup(t, {response: {session}});
  await f.view.openResearch(session.id);
  const text = f.walk().map(n => n.textContent).join('\n');
  for (const claim of session.evidence) {assert.ok(text.includes(claim.text), claim.claimId); assert.ok(text.includes(claim.status));}
  assert.ok(text.includes('模型核验不等于事实已获人工确认'));
  assert.ok(text.includes(session.sources[0].excerpt)); assert.ok(text.includes('摘录已截断'));
  assert.ok(text.includes('Question without evidence')); assert.ok(text.includes('Unverified note only'));
  assert.ok(text.includes('summary-agent')); assert.ok(text.includes('<img verifier>'));
  assert.ok(!f.walk().some(n => ['img', 'script'].includes(n.tagName)));
  const summary = f.walk().find(n => n.className === 'workspace-research-summary');
  assert.ok(summary); assert.deepEqual(summary.children.filter(n => n.className === 'workspace-summary-claim').map(n => n.dataset.claimId), ['C2', 'C1']);
  assert.equal(f.walk().filter(n => n.className === 'workspace-research-claim').length, 5);
  assert.ok(f.walk().filter(n => n.tagName === 'a').every(n => n.href === session.sources[0].url && n.rel === 'noopener noreferrer'));
});
test('report exposes absent citations, nonverbatim quotes, failed sources and unknown summary references without promoting them', async t => {
  const session = currentResearchSession();
  session.evidence[0].verification.evidence = [{sourceId: 'S9', quote: 'Invented quote'}, {sourceId: 'S1', quote: 'Not in original'}];
  session.sources.push({sourceId: 'S2', url: 'https://user:password@example.com/', status: 'fetch_failed', excerpt: ''});
  session.summary.claimIds = ['C5', 'C99'];
  const f = setup(t, {response: session}); await f.view.openResearch(session.id);
  const text = f.walk().map(n => n.textContent).join('\n');
  assert.ok(text.includes('缺证：引用来源不存在或引文与原始摘录不匹配'));
  assert.ok(text.includes('缺证：摘要条目未获完整模型支持或引用无效'));
  assert.ok(text.includes('C99')); assert.ok(text.includes('fetch_failed'));
  assert.ok(!f.walk().some(n => n.tagName === 'a' && n.href.includes('password')));
});
test('legacy verified flag remains unverified and current empty evidence does not silently revive legacy claims', async t => {
  const legacy = {topic: 'Legacy', evidenceStatus: 'verified', sources: [], claims: [{text: 'Old claim', sourceIds: ['S9']}]};
  const f = setup(t, {response: legacy}); await f.view.openResearch('legacy');
  let text = f.walk().map(n => n.textContent).join('\n'); assert.ok(text.includes('Old claim')); assert.ok(text.includes('旧数据：未重新核验'));
  f.client.request = async () => ({...legacy, evidence: []}); await f.view.openResearch('current-empty');
  text = f.walk().map(n => n.textContent).join('\n'); assert.ok(!text.includes('Old claim')); assert.ok(text.includes('缺证：没有可展示的陈述'));
});
test('late research response is discarded after workspace switch and report read never sends a command or mutation', async t => {
  const f = setup(t); let release;
  f.client.request = async (path, options) => {f.requests.push({path, options}); return new Promise(resolve => {release = resolve;});};
  const pending = f.view.openResearch('private-id'); f.state.workspace = {...f.state.workspace, id: 'workspace-b'}; f.state.generation++; f.view.render(f.state);
  release(currentResearchSession()); await pending;
  assert.ok(!f.walk().some(n => n.textContent === 'Current evidence'));
  assert.deepEqual(f.requests, [{path: '/api/research/session/private-id', options: undefined}]);
});
test('research panel without current workspace read permission makes no request', async t => {
  const f = setup(t); f.client.can = () => false; await f.view.openResearch('denied'); assert.equal(f.requests.length, 0);
});
