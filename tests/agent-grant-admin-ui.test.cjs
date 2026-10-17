'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {mountWorkspaceShell} = require('../identity/workspace-shell.js');
const workspaceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const nodeId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const grantId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const subject = '11111111-1111-4111-8111-111111111111';
const route = `/api/workspaces/${workspaceId}/agent-grants`;
// Unit DOM deliberately rejects HTML parsing. Browser/layout acceptance is separate.
class Element {
  constructor(tag) {this.tagName = tag; this.children = []; this.style = {}; this.dataset = {}; this.hidden = false; this.disabled = false; this.value = ''; this.textContent = ''; this.attributes = {};}
  set innerHTML(_) {throw Error('HTML parsing forbidden');}
  append(...nodes) {for (const node of nodes) {this.children.push(node); node.parentNode = this;}}
  prepend(node) {this.children.unshift(node); node.parentNode = this;}
  replaceChildren(...nodes) {this.children = []; this.textContent = ''; this.append(...nodes);}
  setAttribute(key, value) {this.attributes[key] = String(value);}
  remove() {if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(node => node !== this);}
  focus() {}
}
function fixture(t, {role = 'owner', grants = []} = {}) {
  const body = new Element('body'), head = new Element('head');
  const walk = root => [root, ...root.children.flatMap(walk)];
  const document = {body, head, createElement: tag => new Element(tag), getElementById: id => walk(body).find(node => node.id === id),
    defaultView: {confirm() {throw Error('Native confirmation forbidden');}}};
  let state = {status: 'ready', user: {id: 'owner', login: 'Owner'}, workspace: {id: workspaceId, name: 'Private workspace', role},
    workspaces: [{id: workspaceId, name: 'Private workspace', role}], generation: 1};
  const requests = [];
  const metadata = {issuer: 'https://pocket.example.test', resource: 'https://agents.example.test/mcp', clientIds: ['native-client'], grants};
  const nodes = [{id: nodeId, workspaceId, name: '<img src=x onerror=alert(1)>', revoked: false, paused: false}];
  const client = {snapshot: () => state, can: action => action === 'read' || action === 'manage' && state.workspace?.role === 'owner',
    request: async (path, options) => {
      requests.push({path, options});
      if (options?.method === 'POST') return {grant: {id: grantId}};
      if (options?.method === 'DELETE') return {ok: true};
      return path === '/api/nodes' ? {nodes} : metadata;
    }};
  const view = mountWorkspaceShell({client, document}); t.after(() => view.close());
  const select = (id, value) => {const input = document.getElementById(id); assert.ok(input, id); input.value = value;};
  function fill() {
    select('agentGrantSubject', subject); select('agentGrantClient', 'native-client'); select('agentGrantNode', nodeId);
    return document.getElementById('agentGrantForm');
  }
  const button = text => walk(body).find(node => node.tagName === 'button' && node.textContent === text);
  function switchWorkspace() {
    state = {...state, workspace: {...state.workspace, id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'}, generation: state.generation + 1};
    view.clear(); view.render(state);
  }
  return {view, document, client, requests, metadata, nodes, fill, select, button, switchWorkspace, walk: () => walk(body)};
}

test('grant administration entry is owner-only and invoking it as a viewer makes no request', async t => {
  const owner = fixture(t), viewer = fixture(t, {role: 'viewer'});
  assert.equal(owner.document.getElementById('workspaceAgentGrants')?.hidden, false);
  assert.equal(viewer.document.getElementById('workspaceAgentGrants')?.hidden, true);
  await viewer.view.openAgentGrants(); assert.deepEqual(viewer.requests, []);
});

test('grant form defaults to read-only and renders node labels as text without credential inputs', async t => {
  const f = fixture(t); await f.view.openAgentGrants();
  assert.ok(f.document.getElementById('agentGrantForm'));
  assert.equal(f.document.getElementById('agentGrantScope_task_read').checked, true);
  for (const scope of ['task_claim', 'task_result', 'events_read', 'events_subscribe']) assert.equal(f.document.getElementById('agentGrantScope_' + scope).checked, false);
  assert.equal(f.document.getElementById('agentGrantDuration').value, '3600000');
  assert.equal(f.document.getElementById('agentGrantNode').value, '');
  assert.ok(f.walk().some(node => String(node.textContent).includes('<img src=x onerror=alert(1)>')));
  assert.ok(!f.walk().some(node => ['img', 'script'].includes(node.tagName)));
  assert.ok(!f.walk().some(node => node.tagName === 'input' && node.type === 'password'));
});

test('unavailable grant administration shows explicit status without a form or node request', async t => {
  const f = fixture(t);
  f.metadata.available = false;
  await f.view.openAgentGrants();
  assert.equal(f.document.getElementById('agentGrantForm'), undefined);
  assert.equal(f.document.getElementById('agentGrantSubmit'), undefined);
  assert.ok(f.walk().some(node => String(node.textContent).includes('授权管理尚未启用')));
  assert.deepEqual(f.requests, [{path: route, options: undefined}]);
});

test('create requires in-page confirmation and duplicate submission cannot send a second mutation', async t => {
  const f = fixture(t); await f.view.openAgentGrants(); const form = f.fill();
  const before = Date.now(), pending = form.onsubmit({preventDefault() {}});
  assert.equal(f.requests.filter(item => item.options?.method === 'POST').length, 0);
  await form.onsubmit({preventDefault() {}});
  assert.ok(f.button('确认操作')); f.button('确认操作').onclick(); await pending;
  const mutations = f.requests.filter(item => item.options?.method === 'POST');
  assert.equal(mutations.length, 1); assert.equal(mutations[0].path, route);
  const input = mutations[0].options.body;
  assert.deepEqual(Object.keys(input).sort(), ['clientId', 'expiresAt', 'nodeId', 'scopes', 'subject']);
  assert.equal(input.subject, subject); assert.equal(input.clientId, 'native-client'); assert.equal(input.nodeId, nodeId);
  assert.deepEqual(input.scopes, ['task.read']);
  assert.ok(input.expiresAt >= before + 3600000 && input.expiresAt <= Date.now() + 3600000);
});

test('workspace switch cancels pending creation without sending the captured old-workspace form', async t => {
  const f = fixture(t); await f.view.openAgentGrants(); const pending = f.fill().onsubmit({preventDefault() {}});
  assert.ok(f.button('确认操作')); f.switchWorkspace(); await pending;
  assert.equal(f.requests.filter(item => item.options?.method === 'POST').length, 0);
  assert.equal(f.document.getElementById('agentGrantForm'), undefined);
});

test('late listing responses after workspace switch are not rendered into the new workspace', async t => {
  const f = fixture(t); let release;
  f.client.request = path => path === route ? new Promise(resolve => {release = resolve;}) : Promise.resolve({nodes: f.nodes});
  const pending = f.view.openAgentGrants(); f.switchWorkspace(); release(f.metadata); await pending;
  assert.equal(f.document.getElementById('agentGrantForm'), undefined);
  assert.ok(!f.walk().some(node => String(node.textContent).includes('<img src=x')));
});

test('revocation requires confirmation and sends only an empty body to the exact grant path', async t => {
  const f = fixture(t, {grants: [{id: grantId, workspaceId, nodeId, subject, clientId: 'native-client', scopes: ['task.read'], expiresAt: Date.now() - 1000}]});
  await f.view.openAgentGrants();
  assert.ok(f.walk().some(node => String(node.textContent).includes('已过期')));
  const pending = f.button('撤销授权').onclick();
  assert.equal(f.requests.filter(item => item.options?.method === 'DELETE').length, 0);
  f.button('确认操作').onclick(); await pending;
  assert.deepEqual(f.requests.filter(item => item.options?.method === 'DELETE'), [{path: route + '/' + grantId, options: {method: 'DELETE', body: {}}}]);
});

test('load failure, foreign records and revoked nodes never produce an enabled grant submission', async t => {
  const f = fixture(t);
  f.client.request = async () => {throw Object.assign(Error('offline'), {code: 'request_failed'});};
  await f.view.openAgentGrants(); assert.equal(f.document.getElementById('agentGrantForm'), undefined);
  const other = fixture(t, {grants: [{id: grantId, workspaceId: 'other-workspace', nodeId, clientId: 'native-client', scopes: ['task.read'], expiresAt: Date.now() + 60000}]});
  await other.view.openAgentGrants(); assert.equal(other.document.getElementById('agentGrantForm'), undefined);
  const revoked = fixture(t); revoked.nodes[0].revoked = true;
  await revoked.view.openAgentGrants();
  assert.equal(revoked.document.getElementById('agentGrantSubmit')?.disabled, true);
});
