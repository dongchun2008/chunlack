'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const {createRequire} = require('node:module');
const {execFileSync} = require('node:child_process');
const {workspaceFixture} = require('./helpers/workspace-fixture.cjs');
const {createCapacityCoordinator} = require('../collaboration/capacity.cjs');
const {runWithWorkspace, requireWorkspaceContext} = require('../collaboration/context.cjs');
const {createWorkspaceResources} = require('../collaboration/resources.cjs');
const source = JSON.parse(execFileSync(process.env.PYTHON || 'python', ['-c', 'import json,runpy; print(json.dumps(runpy.run_path("scripts/materialize.py")["embedded_sources"]()))'], {cwd: path.resolve(__dirname, '..'), encoding: 'utf8'})).SERVER_JS;
const nodes = require('espree').parse(source, {ecmaVersion: 'latest', sourceType: 'script', range: true}).body;
const functions = ['workspaceInferenceRequest', 'workspaceTaskScope'].map(name => {
  const node = nodes.find(item => item.type === 'FunctionDeclaration' && item.id.name === name);
  assert.ok(node, name); return source.slice(...node.range);
}).join('\n');
function setup(t) {
  const f = workspaceFixture(t), capacity = f.own(createCapacityCoordinator()); let requests = 0;
  const resources = createWorkspaceResources({dataRoot: f.dir, identity: f.store, providerCatalog: [{id: 'fixture', local: true,
    grants: {[f.workspaces.a.id]: {models: ['model-a']}, [f.workspaces.b.id]: {models: ['model-b']}}}]});
  const services = {identity: f.store, capacity}; t.after(() => services.taskControl?.close());
  const context = vm.createContext({require: createRequire(path.resolve(__dirname, '..', 'server.js')),
    workspaceServices: () => services, workspaceSetting: () => null,
    workspaceAuthorizeModel: (provider, model) => resources.authorizeProvider(requireWorkspaceContext(), provider, model),
    axios: {post: async () => {requests++; return {data: 'synthetic-background-output'};}, get: async () => {requests++; return {data: ['model-b']};}}});
  vm.runInContext(functions, context);
  return {...f, services, context, requests: () => requests};
}
test('actual embedded background inference without an existing task gets a bounded server-owned root', async t => {
  const f = setup(t);
  const response = await runWithWorkspace(f.actor('alice', 'a'), () => f.context.workspaceInferenceRequest('fixture', 'model-a', 'model.generate', 'post', 'http://127.0.0.1:9/fixture', {}, {timeout: 1000}));
  assert.equal(response.data, 'synthetic-background-output'); assert.equal(f.requests(), 1);
  runWithWorkspace(f.actor('alice', 'a'), () => {
    assert.ok(f.services.taskControl, 'model helper must not bypass root ownership for background work');
    const list = f.services.taskControl.listTasks(); assert.equal(list.length, 1);
    assert.equal(list[0].createdBy, f.users.alice.id); assert.equal(list[0].state, 'completed');
    assert.ok(list[0].deadlineAt - list[0].createdAt <= 300000);
    assert.ok(!JSON.stringify(list).includes('synthetic-background-output'));
  });
});
test('viewer model metadata stays readable, but direct background generation cannot gain execution permission', async t => {
  const f = setup(t);
  await runWithWorkspace(f.actor('carol', 'b'), async () => {
    const response = await f.context.workspaceInferenceRequest('fixture', null, 'model.discover', 'get', 'http://127.0.0.1:9/fixture', {timeout: 1000});
    assert.deepEqual(response.data, ['model-b']);
    await assert.rejects(() => f.context.workspaceInferenceRequest('fixture', 'model-b', 'model.generate', 'post', 'http://127.0.0.1:9/fixture', {}, {timeout: 1000}), error => error.code === 'forbidden' || error.code === 'model_not_authorized');
  });
  assert.equal(f.requests(), 1);
});
