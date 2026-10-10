'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {mountWorkspaceShell} = require('../identity/workspace-shell.js');
// A unit DOM deliberately forbids HTML parsing. Real browser/layout acceptance
// is a separate gate; this checks text rendering and menu behavior, not pixels.
class Element {
  constructor(tag) {this.tagName = tag; this.children = []; this.style = {}; this.dataset = {}; this.hidden = false; this.disabled = false; this.value = ''; this.textContent = ''; this.attributes = {};}
  set innerHTML(value) {throw new Error('Dynamic HTML must not be used by the workspace shell');}
  append(...nodes) {for (const node of nodes) {this.children.push(node); node.parentNode = this;}}
  prepend(node) {this.children.unshift(node); node.parentNode = this;}
  replaceChildren(...nodes) {this.children = []; this.append(...nodes); this.textContent = '';}
  setAttribute(key, value) {this.attributes[key] = String(value);}
  remove() {if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(node => node !== this);}
  focus() {}
}
function documentFixture() {
  const body = new Element('body'), head = new Element('head');
  const walk = root => [root, ...root.children.flatMap(walk)];
  const document = {body, head, createElement: tag => new Element(tag), getElementById: id => walk(body).find(node => node.id === id), defaultView: {confirm: () => true, navigator: {clipboard: {writeText: async () => {}}}}};
  for (const id of ['messageInput', 'sendBtn', 'studioSpawnBtn', 'groundBtn', 'moderatorBtn', 'fileInput', 'sendThreadReply']) {const node = new Element('button'); node.id = id; body.append(node);}
  return {document, walk: () => walk(body)};
}
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
