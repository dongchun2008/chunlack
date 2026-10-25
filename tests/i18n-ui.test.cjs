'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createI18n} = require('../identity/i18n.js');
const catalogs = require('../identity/messages.js');
const {mountWorkspaceShell} = require('../identity/workspace-shell.js');
const {documentFixture} = require('./helpers/workspace-document.cjs');
const workspaceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const nodeId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const grantId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const subject = '11111111-1111-4111-8111-111111111111';
const route = '/api/workspaces/' + workspaceId + '/agent-grants';
const submitEvent = {preventDefault() {}};
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};}
// Reuse the existing HTML-forbidding fixture, with browser-like textContent
// replacement semantics so a translated label cannot silently delete its input.
function bindingDocument() {
  const fixture = documentFixture(), create = fixture.document.createElement;
  fixture.document.createElement = tag => {
    const element = create(tag); let ownText = '';
    Object.defineProperty(element, 'textContent', {configurable: true,
      get() {return ownText + this.children.map(child => child.textContent).join('');},
      set(value) {ownText = String(value); for (const child of this.children) child.parentNode = null; this.children = [];}
    });
    element.append = function(...children) {for (const child of children) {if (child.parentNode) child.remove(); this.children.push(child); child.parentNode = this;}};
    element.replaceChildren = function(...children) {this.textContent = ''; this.append(...children);};
    element.remove = function() {if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null;};
    return element;
  };
  return fixture;
}
function researchSession() {
  const quote = '成员\n<script>literal quote</script> {untouched}';
  return {topic: '成员', phase: 'verifying', evidenceStatus: 'reviewed_with_gaps',
    sources: [{sourceId: 'S1', url: 'https://example.com/original?a=1&b=2', status: 'retrieved', excerpt: quote + '\n原始摘录', truncated: true}],
    evidence: ['supported', 'partially_supported', 'conflicting', 'insufficient_evidence', 'unverified'].map((status, index) => ({claimId: 'C' + (index + 1), text: '成员', sourceId: 'S1', status,
      verification: {verifierId: '成员', reviewedAt: '成员', reason: '成员 {literal}', evidence: [{sourceId: 'S1', quote}]}})),
    summary: {status: 'complete', summarizerId: '成员', claimIds: ['C1', 'C99']},
    notes: [{question: '成员', status: 'fetch_failed', answer: '成员 {answer}'}]};
}
function fixture(t, options = {}) {
  const f = bindingDocument(), requests = [], actions = [], values = new Map(options.preferences || []), storageHandlers = new Set();
  const storage = {getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value)};
  const events = {addEventListener: (name, fn) => storageHandlers.add(fn), removeEventListener: (name, fn) => storageHandlers.delete(fn)};
  const i18n = createI18n({catalogs, storage, events, document: f.document, navigator: {languages: [options.locale || 'zh-CN']}});
  let state = {status: 'ready', user: {id: 'human-a', login: '成员'}, workspace: {id: workspaceId, name: '成员', role: options.role || 'owner'},
    workspaces: [{id: workspaceId, name: '成员', role: options.role || 'owner'}], generation: 1};
  const metadata = {clientIds: ['native-client'], grants: options.grants || []};
  const nodes = options.nodes || [{id: nodeId, workspaceId, name: '成员', capabilities: ['browser.public_read'], scopes: ['public'], paused: false, revoked: false}];
  let response = options.response || (async url => url === '/api/nodes' ? {nodes} : url === route ? metadata : url.endsWith('/members') ? {members: [{userId: 'human-b', login: '成员', role: 'member'}]} : {session: researchSession()});
  const client = {snapshot: () => state,
    can: action => action === 'read' || action === 'execute' && state.workspace?.role !== 'viewer' || ['manage', 'cancel'].includes(action) && state.workspace?.role === 'owner',
    request: async (url, requestOptions) => {requests.push({url, options: requestOptions}); return response(url, requestOptions);},
    fetch: async url => {actions.push({fetch: url}); throw Error('unexpected_fetch');},
    login: async (...args) => {actions.push({login: args}); throw Object.assign(Error('synthetic failure'), {code: 'invalid_credentials'});},
    logout: async () => {actions.push({logout: true});}, selectWorkspace: async id => {actions.push({selectWorkspace: id});},
    acceptInvite: async (...args) => {actions.push({acceptInvite: args});}
  };
  const shell = mountWorkspaceShell({client, document: f.document, i18n: options.inject === false ? null : i18n});
  t.after(() => {shell.close(); i18n.close();});
  const button = text => f.walk().find(element => element.tagName === 'button' && element.textContent === text);
  const has = text => f.walk().some(element => element.textContent === text);
  const choose = locale => {const picker = f.document.getElementById('workspaceLanguage'); assert.ok(picker); picker.value = locale; picker.onchange();};
  return {...f, shell, i18n, client, requests, actions, values, storageHandlers, metadata, nodes, button, has, choose,
    state: () => state, render(next) {state = next; shell.render(next);}, setResponse(fn) {response = fn;}};
}
test('paired static catalog is frozen and every translation preserves named placeholders', () => {
  assert.deepEqual(Object.keys(catalogs), ['zh-CN', 'en']);
  assert.ok(Object.isFrozen(catalogs)); assert.ok(Object.isFrozen(catalogs.en)); assert.ok(Object.isFrozen(catalogs['zh-CN']));
  assert.deepEqual(Object.keys(catalogs.en), Object.keys(catalogs['zh-CN']));
  const names = value => [...new Set([...value.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map(match => match[1]))].sort();
  for (const [id, translated] of Object.entries(catalogs.en)) {assert.deepEqual(names(id), names(translated), id); assert.deepEqual(names(id), names(catalogs['zh-CN'][id]), id);}
});
test('actual toolbar, roles and accessibility captions switch while account and workspace names stay literal', async t => {
  const f = fixture(t); assert.ok(f.button('成员')); assert.equal(f.document.getElementById('workspaceRole').textContent, '所有者');
  const picker = f.document.getElementById('workspaceLanguage'); assert.deepEqual(picker.children.map(node => node.textContent), ['中文', 'English']);
  assert.equal(picker.attributes['aria-label'], '界面语言');
  f.choose('en'); assert.ok(f.button('Members')); assert.ok(f.button('Nodes')); assert.ok(f.button('Tasks')); assert.ok(f.button('Agent grants')); assert.ok(f.button('Sign out'));
  assert.equal(f.document.getElementById('workspaceRole').textContent, 'Owner'); assert.equal(picker.attributes['aria-label'], 'Interface language'); assert.equal(picker.attributes.title, 'Interface language');
  assert.equal(f.document.getElementById('workspaceSelector').attributes['aria-label'], 'Current workspace');
  assert.equal(f.document.getElementById('workspaceAccount').textContent, '成员'); assert.equal(f.document.getElementById('workspaceSelector').children[0].textContent, '成员');
  await f.shell.openMembers(); assert.ok(f.has('Workspace members')); assert.ok(f.has('Member'));
  assert.ok(f.walk().some(node => node.tagName === 'strong' && node.textContent === '成员'));
  const permission = f.walk().find(node => node.tagName === 'select' && node.attributes['aria-label'] === 'Member permissions');
  assert.deepEqual(permission.children.map(node => node.textContent), ['Owner', 'Member', 'Read-only member']);
  f.choose('zh-CN'); assert.equal(permission.attributes['aria-label'], '成员权限'); assert.deepEqual(permission.children.map(node => node.textContent), ['所有者', '成员', '只读成员']);
  assert.equal(f.requests.length, 1); assert.deepEqual(f.actions, []);
});
test('without an injected controller the shell keeps Chinese controls and has no language selector', async t => {
  const f = fixture(t, {locale: 'en', inject: false}); assert.ok(f.button('成员')); assert.equal(f.document.getElementById('workspaceRole').textContent, '所有者');
  assert.equal(f.document.getElementById('workspaceLanguage'), undefined); await f.shell.openNodes(); assert.ok(f.has('协作节点')); assert.ok(f.button('登记节点'));
});
test('login and invite dialogs preserve unsent passwords, fields and handlers during locale changes', async t => {
  const f = fixture(t); f.render({...f.state(), status: 'login', user: null, workspace: null, workspaces: [], generation: 2});
  const form = f.document.getElementById('workspaceLoginForm'), login = f.document.getElementById('workspaceLogin'), password = f.document.getElementById('workspacePassword'), handler = form.onsubmit;
  login.value = '成员'; password.value = 'synthetic-unsent-password'; f.choose('en');
  assert.equal(f.document.getElementById('workspaceLoginForm'), form); assert.equal(f.document.getElementById('workspacePassword'), password); assert.equal(form.onsubmit, handler);
  assert.equal(login.value, '成员'); assert.equal(password.value, 'synthetic-unsent-password'); assert.ok(f.button('Sign in')); assert.ok(f.has('Account')); assert.ok(f.has('Password')); assert.ok(f.has('Sign in with Pocket ID'));
  assert.equal(f.walk().find(node => node.tagName === 'a').href, '/auth/oidc/login');
  await f.button('Use an invitation code').onclick();
  const code = f.document.getElementById('workspaceInviteCode'), invitePassword = f.document.getElementById('workspaceInvitePassword'); code.value = 'synthetic-invite'; invitePassword.value = 'synthetic-new-password';
  const dialog = f.walk().find(node => node.attributes.role === 'dialog'); assert.equal(dialog.attributes['aria-label'], 'Accept a workspace invitation');
  f.choose('zh-CN'); assert.equal(code.value, 'synthetic-invite'); assert.equal(invitePassword.value, 'synthetic-new-password'); assert.equal(f.document.getElementById('workspaceInviteCode'), code); assert.ok(f.button('接受邀请'));
  assert.equal(dialog.attributes['aria-label'], '接受工作区邀请'); assert.deepEqual(f.requests, []); assert.deepEqual(f.actions, []);
});
test('all controlled error codes and fallback render independently specified Chinese and English messages', t => {
  const f = fixture(t);
  const cases = [
    ['unauthorized', '登录失效，请重新登录。', 'Your session has expired. Please sign in again.'],
    ['forbidden', '当前账号没有这项权限。', 'This account does not have permission for this action.'],
    ['membership_revoked', '工作区成员资格已失效。', 'Your workspace membership is no longer valid.'],
    ['invalid_credentials', '账号或密码不正确。', 'The account or password is incorrect.'],
    ['invalid_invite', '邀请码无效或已失效。', 'The invitation code is invalid or has expired.'],
    ['rate_limited', '请求过于频繁，请稍后重试。', 'Too many requests. Please try again later.'],
    ['logout_pending', '退出尚未确认，请重试退出。', 'Sign-out has not been confirmed. Please retry.'],
    ['gateway_unavailable', '节点服务暂不可用。', 'The node service is temporarily unavailable.'],
    ['stale_workspace', '工作区已切换，请重新操作。', 'The workspace has changed. Please try the action again.'],
    ['unknown-synthetic-code', '操作未完成，请检查权限和连接后重试。', 'The action could not be completed. Check your permissions and connection, then try again.']
  ];
  for (const [code, chinese, english] of cases) {f.choose('zh-CN'); f.shell.notify({code, message: 'private error detail'}); const notice = f.document.getElementById('workspaceNotice'); assert.equal(notice.textContent, chinese); f.choose('en'); assert.equal(notice.textContent, english);}
  assert.ok(!f.walk().some(node => node.textContent.includes('private error detail'))); assert.deepEqual(f.requests, []); assert.deepEqual(f.actions, []);
});
test('failed login keeps password clearing and request arguments unchanged and localizes the actual error', async t => {
  const f = fixture(t, {locale: 'en'}); f.render({...f.state(), status: 'login', user: null, workspace: null, workspaces: []});
  f.document.getElementById('workspaceLogin').value = '  成员  '; const password = f.document.getElementById('workspacePassword'); password.value = 'synthetic-password';
  await f.document.getElementById('workspaceLoginForm').onsubmit(submitEvent);
  assert.equal(password.value, ''); assert.deepEqual(f.actions, [{login: ['成员', 'synthetic-password']}]); assert.equal(f.document.getElementById('workspaceNotice').textContent, 'The account or password is incorrect.');
  f.choose('zh-CN'); assert.equal(f.document.getElementById('workspaceNotice').textContent, '账号或密码不正确。');
  assert.ok(!f.walk().some(node => node.textContent.includes('synthetic-password')));
});
test('member draft and pending confirmation survive locale switches without extra requests or mutations', async t => {
  const f = fixture(t); await f.shell.openMembers(); const draft = f.document.getElementById('workspaceNewMember'); draft.value = '成员 {draft}';
  const form = f.walk().find(node => node.tagName === 'form'), handler = form.onsubmit, removal = f.button('移除'), pending = removal.onclick();
  const confirmation = f.walk().find(node => node.attributes.role === 'alertdialog'); assert.ok(confirmation); assert.equal(f.requests.length, 1);
  f.choose('en'); assert.equal(f.document.getElementById('workspaceNewMember'), draft); assert.equal(draft.value, '成员 {draft}'); assert.equal(form.onsubmit, handler);
  assert.equal(f.walk().find(node => node.attributes.role === 'alertdialog'), confirmation); assert.equal(confirmation.attributes['aria-label'], 'Confirm action');
  assert.ok(f.has('Remove this member? Active sessions and subsequent actions will lose access.')); assert.ok(f.button('Create one-time invitation'));
  f.choose('zh-CN'); f.choose('en'); assert.equal(f.requests.length, 1); f.button('Cancel action').onclick(); await pending;
  assert.equal(f.requests.length, 1); assert.deepEqual(f.actions, []); assert.equal(f.walk().filter(node => node.attributes.role === 'alertdialog').length, 0);
});
test('node statuses and task captions switch in place while protocol codes, ids and raw names remain unchanged', async t => {
  const f = fixture(t, {nodes: [{id: nodeId, workspaceId, name: '成员', paused: true}, {id: 'revoked-id', name: '节点', revoked: true}]});
  await f.shell.openNodes(); const draft = f.document.getElementById('workspaceNodeName'); draft.value = '节点 {draft}'; f.choose('en');
  assert.ok(f.has('Paused')); assert.ok(f.has('Revoked')); assert.ok(f.button('Resume')); assert.equal(f.document.getElementById('workspaceNodeName'), draft); assert.equal(draft.value, '节点 {draft}');
  assert.ok(f.walk().some(node => node.tagName === 'strong' && node.textContent === '节点')); assert.ok(f.has('browser.public_read'));
  const tasks = {localTasks: [{taskId: '成员', state: 'running', originalGoal: '成员'}], externalTasks: [{taskId: '任务', state: 'succeeded', taskType: 'browser.public_read'}]}; const before = JSON.stringify(tasks);
  f.setResponse(async () => tasks); await f.shell.openTasks(); assert.ok(f.has('Orchestration · Running')); assert.ok(f.has('External node · Succeeded')); assert.ok(f.button('View evidence'));
  f.choose('zh-CN'); assert.ok(f.has('编排 · 运行中')); assert.ok(f.has('外部节点 · 已成功')); assert.equal(JSON.stringify(tasks), before);
  assert.equal(f.requests.length, 2); assert.ok(f.requests.every(request => !request.options)); assert.deepEqual(f.actions, []);
});
test('grant form, paused node label and pending explicit confirmation keep their DOM and scopes', async t => {
  const f = fixture(t, {nodes: [{id: nodeId, workspaceId, name: '成员', paused: true, revoked: false}]}); await f.shell.openAgentGrants();
  const form = f.document.getElementById('agentGrantForm'); f.document.getElementById('agentGrantSubject').value = subject; f.document.getElementById('agentGrantClient').value = 'native-client'; f.document.getElementById('agentGrantNode').value = nodeId;
  const pending = form.onsubmit(submitEvent), submit = f.document.getElementById('agentGrantSubmit'); assert.equal(submit.disabled, true);
  f.choose('en'); assert.equal(f.document.getElementById('agentGrantForm'), form); assert.equal(f.document.getElementById('agentGrantSubject').value, subject);
  assert.ok(f.has('成员 (paused)')); assert.ok(f.button('Create grant')); assert.ok(f.has('1 hour')); assert.ok(f.has('24 hours')); assert.ok(f.has('7 days'));
  assert.equal(f.document.getElementById('agentGrantScope_task_read').checked, true); assert.ok(!f.document.getElementById('agentGrantScope_task_claim').checked);
  const confirmation = f.walk().find(node => node.attributes.role === 'alertdialog'); assert.ok(confirmation.textContent.includes('Scopes: task.read; expires:')); assert.ok(confirmation.textContent.includes('access to node 成员?'));
  await form.onsubmit(submitEvent); assert.equal(f.requests.length, 2); f.button('Cancel action').onclick(); await pending; assert.equal(submit.disabled, false);
  assert.equal(f.requests.length, 2); assert.ok(f.requests.every(request => !request.options)); assert.deepEqual(f.actions, []);
});
test('grant availability, permission denial and expiry labels remain display-only in English', async t => {
  const viewer = fixture(t, {locale: 'en', role: 'viewer'}); await viewer.shell.openAgentGrants(); assert.equal(viewer.document.getElementById('workspaceAgentGrants').hidden, true); assert.deepEqual(viewer.requests, []);
  const f = fixture(t, {locale: 'en', grants: [{id: grantId, workspaceId, nodeId, clientId: '成员', scopes: ['task.read'], expiresAt: 1}]});
  await f.shell.openAgentGrants(); assert.ok(f.has('Expired')); assert.ok(f.has('Node: ' + nodeId));
  const pending = f.button('Revoke grant').onclick(); assert.ok(f.has('Revoke this grant for client 成员 on node ' + nodeId + '? Permissions will be checked again for subsequent tasks and events. Data already sent cannot be recalled.'));
  f.choose('zh-CN'); assert.ok(f.has('已过期')); f.button('取消操作').onclick(); await pending;
  f.metadata.available = false; await f.shell.openAgentGrants(); f.choose('en'); assert.ok(f.has('External Agent grant management is not enabled. This page only displays status and cannot create or revoke grants. Ask an administrator to complete integration setup, then try again.'));
  assert.equal(f.document.getElementById('agentGrantForm'), undefined); assert.ok(f.requests.every(request => !request.options));
});
test('research captions and nested fallbacks react while model statements, quotes, URLs and source bytes stay raw', async t => {
  const session = researchSession(), original = JSON.stringify(session), f = fixture(t, {response: async () => ({session})});
  await f.shell.openResearch('成员'); const summary = f.walk().find(node => node.className === 'workspace-research-summary'); const claims = f.walk().filter(node => node.className === 'workspace-research-claim');
  assert.ok(f.has('证据摘要')); assert.ok(f.has('模型核验理由：成员 {literal}')); f.choose('en');
  assert.equal(f.walk().find(node => node.className === 'workspace-research-summary'), summary); assert.ok(f.has('Evidence summary')); assert.ok(f.has('All statements and model verification')); assert.ok(f.has('Original sources and excerpts'));
  assert.ok(f.has('Research status: Verifying / Reviewed with evidence gaps')); assert.ok(f.has('Summary status: Completed')); assert.ok(f.has('Summarizing Agent: 成员')); assert.ok(f.has('Verifying Agent: 成员')); assert.ok(f.has('Reviewed at: 成员'));
  assert.ok(f.has('Model verification reason: 成员 {literal}')); assert.ok(f.has('Verbatim quote source: S1')); assert.ok(f.has('Retrieval status: Retrieved')); assert.ok(f.has('Subquestion status: Retrieval failed')); assert.ok(f.has('Subquestion record (not an additional verified conclusion): 成员 {answer}'));
  assert.ok(f.has('[C99] Missing evidence: the statement cited by the summary does not exist'));
  for (const text of ['Model verification: Model considers supported (supported)', 'Model verification: Model considers partially supported (partially_supported)', 'Model verification: Conflicting evidence (conflicting)', 'Model verification: Insufficient evidence (insufficient_evidence)', 'Model verification: Unverified (unverified)']) assert.ok(f.has(text), text);
  for (const claim of claims) assert.ok(claim.children.some(child => child.tagName === 'p' && child.textContent === '成员'));
  assert.ok(f.walk().filter(node => node.tagName === 'blockquote').every(node => node.textContent === session.sources[0].excerpt || node.textContent === session.evidence[0].verification.evidence[0].quote));
  assert.ok(f.walk().filter(node => node.tagName === 'a').every(node => node.href === session.sources[0].url && node.textContent === session.sources[0].url && node.rel === 'noopener noreferrer'));
  assert.ok(!f.walk().some(node => ['script', 'img'].includes(node.tagName))); assert.deepEqual(claims.map(node => node.dataset.status), ['supported', 'partially_supported', 'conflicting', 'insufficient_evidence', 'unverified']);
  f.choose('zh-CN'); assert.ok(f.has('模型核验理由：成员 {literal}')); assert.ok(f.has('[C99] 缺证：摘要引用的陈述不存在')); assert.equal(JSON.stringify(session), original);
  assert.deepEqual(f.requests, [{url: '/api/research/session/%E6%88%90%E5%91%98', options: undefined}]); assert.deepEqual(f.actions, []);
});
test('missing evidence and unsafe-source notices switch without restoring legacy verification', async t => {
  const session = {topic: '成员', evidenceStatus: 'verified', sources: [{sourceId: 'S2', url: 'javascript:alert(1)', status: 'fetch_failed'}], claims: [{claimId: 'C1', text: '成员', sourceIds: ['S2']}]};
  const f = fixture(t, {response: async () => ({session})}); await f.shell.openResearch('legacy'); f.choose('en');
  assert.ok(f.has('Legacy data: not reverified. The old verified flag is not treated as proof of a fact.')); assert.ok(f.has('Model verification: Unverified (unverified)'));
  assert.ok(f.has('Summary status: Missing evidence: no summary has been generated')); assert.ok(f.has('Missing evidence: the source URL is missing or unsafe; no clickable link is provided.')); assert.ok(f.has('Missing evidence: no original excerpt provided.'));
  assert.ok(!f.walk().some(node => node.tagName === 'a')); assert.ok(f.has('Legacy citations: S2')); assert.equal(session.evidenceStatus, 'verified');
});
test('anonymous and two human ids have separate preferences and same-account workspace switches preserve locale', t => {
  const f = fixture(t); f.choose('en');
  const a = f.state(); f.render({...a, workspace: {...a.workspace, id: 'workspace-b'}, generation: 2}); assert.equal(f.i18n.getLocale(), 'en'); assert.ok(f.button('Members'));
  f.render({...f.state(), user: {id: 'human-b', login: '成员'}, generation: 3}); assert.equal(f.i18n.getLocale(), 'zh-CN'); assert.ok(f.button('成员')); f.choose('zh-CN');
  f.render({...f.state(), user: a.user, generation: 4}); assert.equal(f.i18n.getLocale(), 'en'); assert.ok(f.button('Members'));
  f.render({...f.state(), status: 'login', user: null, workspace: null, workspaces: [], generation: 5}); assert.equal(f.i18n.getLocale(), 'zh-CN'); f.choose('en');
  f.render({...a, user: {id: 'human-b', login: '成员'}, generation: 6}); assert.equal(f.i18n.getLocale(), 'zh-CN');
  assert.equal(f.values.get('chunlack.ui.locale.v1.user:human-a'), 'en'); assert.equal(f.values.get('chunlack.ui.locale.v1.user:human-b'), 'zh-CN'); assert.equal(f.values.get('chunlack.ui.locale.v1.anonymous'), 'en');
  assert.ok([...f.values.values()].every(value => ['zh-CN', 'en'].includes(value))); assert.deepEqual(f.requests, []); assert.deepEqual(f.actions, []);
});
test('stored account preference applies before first display and cross-tab locale events preserve a draft', async t => {
  const key = 'chunlack.ui.locale.v1.user:human-a'; const f = fixture(t, {preferences: [[key, 'en']]}); assert.ok(f.button('Members')); assert.equal(f.document.getElementById('workspaceLanguage').value, 'en');
  await f.shell.openMembers(); const draft = f.document.getElementById('workspaceNewMember'); draft.value = '成员';
  for (const handler of f.storageHandlers) handler({key, newValue: 'zh-CN'});
  assert.equal(f.i18n.getLocale(), 'zh-CN'); assert.equal(f.document.getElementById('workspaceLanguage').value, 'zh-CN'); assert.equal(f.document.getElementById('workspaceNewMember'), draft); assert.equal(draft.value, '成员'); assert.ok(f.button('创建一次性邀请')); assert.equal(f.requests.length, 1);
});
test('released panels, removed confirmations and login covers stop reacting before DOM replacement', async t => {
  const f = fixture(t); await f.shell.openMembers(); const oldHeading = f.walk().find(node => node.tagName === 'h2' && node.textContent === '工作区成员');
  const pending = f.button('移除').onclick(), oldConfirm = f.button('确认操作'); f.button('取消操作').onclick(); await pending;
  await f.shell.openNodes(); f.choose('en'); assert.equal(oldHeading.textContent, '工作区成员'); assert.equal(oldConfirm.textContent, '确认操作'); assert.ok(f.has('Collaboration nodes'));
  f.render({...f.state(), status: 'login', user: null, workspace: null, workspaces: [], generation: 2}); const oldLogin = f.walk().find(node => node.tagName === 'h2' && node.textContent === '登录私有工作区'); assert.ok(oldLogin);
  f.render({...f.state(), status: 'unavailable', generation: 3}); f.choose('en'); assert.equal(oldLogin.textContent, '登录私有工作区'); assert.ok(f.has('Unable to connect at the moment. Previous workspace content has been hidden.'));
});
test('closed shell releases its view and picker subscription while leaving the caller controller usable', async t => {
  const f = fixture(t); await f.shell.openMembers(); const picker = f.document.getElementById('workspaceLanguage'), member = f.button('成员'), oldDialog = f.walk().find(node => node.attributes.role === 'dialog');
  const pending = f.button('移除').onclick(); f.shell.close(); await pending;
  assert.equal(f.i18n.setLocale('en'), true); assert.equal(member.textContent, '成员'); assert.equal(picker.value, 'zh-CN'); assert.equal(f.storageHandlers.size, 1);
  picker.value = 'zh-CN'; picker.onchange(); assert.equal(f.i18n.getLocale(), 'en'); f.shell.notify({code: 'forbidden'}); await f.shell.openResearch('late');
  assert.ok(!f.walk().some(node => node.className === 'workspace-bar' || node.attributes.role === 'dialog')); assert.equal(oldDialog.children.some(node => node.id === 'workspaceNotice'), false);
  assert.equal(f.requests.length, 1); assert.ok(f.requests.every(request => !request.options));
});
test('late research success and stale request failure cannot populate a released or closed panel', async t => {
  const result = deferred(), f = fixture(t, {response: () => result.promise}); const pending = f.shell.openResearch('private-report');
  const oldDialog = f.walk().find(node => node.attributes.role === 'dialog'), count = oldDialog.children.length; f.shell.close(); result.resolve({session: researchSession()}); await pending;
  assert.equal(oldDialog.children.length, count); assert.ok(!f.walk().some(node => node.textContent === '成员')); assert.equal(f.requests.length, 1);
  const failure = deferred(), other = fixture(t, {response: () => failure.promise}); const read = other.shell.openResearch('stale'); other.shell.clear(); failure.reject(Object.assign(Error('private failure'), {code: 'forbidden'})); await read;
  assert.equal(other.document.getElementById('workspaceNotice'), undefined); assert.equal(other.requests.length, 1);
});
test('screenshot captions and alt text react without changing artifact bytes or granting human acceptance', async t => {
  const f = fixture(t, {role: 'viewer'}), created = [], revoked = [], receipt = {task: {taskId: 'pilot', taskType: 'browser.public_read', state: 'succeeded'}, acceptance: {state: 'evidence_checked', acceptedAt: 1}, artifact: {width: 1, height: 2, sha256: 'a'.repeat(64)}, output: {title: '成员', executedAt: '成员', activityEvidence: '成员', url: 'https://example.com/'}};
  const original = JSON.stringify(receipt); f.setResponse(async () => receipt);
  f.document.defaultView.URL = {createObjectURL: blob => {created.push(blob.size); return 'blob:synthetic';}, revokeObjectURL: url => revoked.push(url)};
  f.client.fetch = async url => {f.actions.push({fetch: url}); return {headers: new Headers({'content-type': 'image/png'}), blob: async () => new Blob([Buffer.from([1, 2])], {type: 'image/png'})};};
  await f.shell.openTaskEvidence('pilot'); const image = f.walk().find(node => node.tagName === 'img'); assert.equal(image.attributes.alt, '任务截图（节点提交）'); f.choose('en');
  assert.equal(image.attributes.alt, 'Task screenshot (submitted by the node)'); assert.ok(f.has('Fields and files checked; awaiting human acceptance')); assert.ok(f.has('Screenshot: 1 × 2; SHA-256: ' + 'a'.repeat(64))); assert.ok(f.has('Accepted at: 1970-01-01T00:00:00.001Z'));
  assert.ok(f.walk().some(node => node.tagName === 'blockquote' && node.textContent === '成员')); assert.ok(!f.button('Confirm human acceptance')); assert.equal(JSON.stringify(receipt), original); assert.equal(f.requests.length, 1); assert.deepEqual(f.actions, [{fetch: '/api/tasks/pilot/artifact'}]);
  f.shell.clear(); assert.deepEqual(created, [2]); assert.deepEqual(revoked, ['blob:synthetic']);
});
test('late screenshot bytes after close create no blob URL and do not touch the released image panel', async t => {
  const f = fixture(t), bytes = deferred(), created = []; f.setResponse(async () => ({task: {taskId: 'pilot', taskType: 'browser.public_read'}, acceptance: {state: 'received'}, artifact: {width: 1, height: 1}, output: {title: '成员'}}));
  f.document.defaultView.URL = {createObjectURL: () => {created.push(true); return 'blob:late';}, revokeObjectURL() {}};
  f.client.fetch = async () => ({headers: new Headers({'content-type': 'image/png'}), blob: () => bytes.promise});
  const pending = f.shell.openTaskEvidence('pilot'); await tick(); const oldDialog = f.walk().find(node => node.attributes.role === 'dialog'), count = oldDialog.children.length;
  f.shell.close(); bytes.resolve(new Blob([Buffer.from([1])], {type: 'image/png'})); await pending; assert.deepEqual(created, []); assert.equal(oldDialog.children.length, count);
});
test('late clipboard completion cannot relabel a released button or append a secret notice', async t => {
  const f = fixture(t), copied = deferred(); f.setResponse(async (url, options) => options?.method === 'POST' ? {token: 'synthetic-one-time-code'} : {members: []});
  f.document.defaultView.navigator.clipboard.writeText = async value => {assert.equal(value, 'synthetic-one-time-code'); return copied.promise;};
  await f.shell.openMembers(); const form = f.walk().find(node => node.tagName === 'form'); f.document.getElementById('workspaceNewMember').value = '成员'; await form.onsubmit(submitEvent);
  const copy = f.button('复制一次性邀请码'), oldDialog = f.walk().find(node => node.attributes.role === 'dialog'), count = oldDialog.children.length; assert.ok(copy);
  const pending = copy.onclick(); f.shell.clear(); f.choose('en'); copied.resolve(); await pending;
  assert.equal(copy.textContent, '复制一次性邀请码'); assert.equal(copy.disabled, true); assert.equal(oldDialog.children.length, count); assert.equal(f.requests.length, 2);
  assert.ok(!f.walk().some(node => node.textContent.includes('synthetic-one-time-code')));
});

test('public pilot confirmation and result template change language without another task request', async t => {
  const f = fixture(t, {role: 'member'}); f.setResponse(async (url, options) => options?.method === 'POST' ? {task: {taskId: 'pilot-fixture'}} : {nodes: f.nodes});
  await f.shell.openNodes(); const start = f.button('公开浏览试点'), pending = start.onclick(); assert.equal(start.disabled, true);
  f.choose('en'); assert.ok(f.has('Send this node an example.com browsing and screenshot pilot? The task expires in five minutes. Execution completion does not mean human acceptance.')); assert.equal(f.requests.length, 1);
  f.button('Confirm action').onclick(); await pending; assert.ok(f.has('Public browsing pilot created: pilot-fixture')); assert.equal(start.disabled, false);
  f.choose('zh-CN'); assert.ok(f.has('已创建公开浏览试点：pilot-fixture')); f.choose('en'); assert.ok(f.has('Public browsing pilot created: pilot-fixture'));
  assert.deepEqual(f.requests.filter(request => request.options), [{url: '/api/tasks', options: {method: 'POST', body: {targetNodeId: nodeId}}}]); assert.deepEqual(f.actions, []);
});
