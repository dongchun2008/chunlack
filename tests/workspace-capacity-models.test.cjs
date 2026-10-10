'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {runWithWorkspace}=require('../collaboration/context.cjs');
const {createCapacityCoordinator}=require('../collaboration/capacity.cjs');
const actor=workspaceId=>({workspaceId,userId:'owner-'+workspaceId,role:'owner',version:1});
const turn=()=>new Promise(resolve=>setImmediate(resolve));
test('provider-neutral transport shares inference capacity across workspaces and reauthorizes before and after queued execution',async t=>{
  const {createWorkspaceModelTransport}=require('../collaboration/model-transport.cjs');
  const capacity=createCapacityCoordinator();t.after(()=>capacity.close());let active=0,peak=0,calls=0,checks=0;
  const transport=createWorkspaceModelTransport({capacity,authorize:()=>{checks++;},transport:{post:async(_url,data,options)=>{calls++;assert.ok(options.signal);active++;peak=Math.max(peak,active);await turn();active--;return {data};}}});
  const work=workspaceId=>runWithWorkspace(actor(workspaceId),()=>transport.request({providerId:'neutral',modelId:'model',kind:'model.generate',method:'post',url:'https://provider.invalid/v1/chat/completions',data:{fixture:workspaceId},options:{timeout:1000}}));
  const results=await Promise.all([work('a'),work('b'),work('a')]);assert.equal(peak,1);assert.equal(calls,3);assert.equal(checks,9);assert.deepEqual(results.map(value=>value.data.fixture),['a','b','a']);
});
test('membership removed while waiting prevents model traffic; removed while executing prevents returning private output',async t=>{
  const {createWorkspaceModelTransport}=require('../collaboration/model-transport.cjs');
  const capacity=createCapacityCoordinator();t.after(()=>capacity.close());let release,revoked=false,hits=0;
  const blocker=capacity.submit({workspaceId:'b',taskId:'blocker',deadlineAt:Date.now()+10000,kind:'model.generate',run:()=>new Promise(resolve=>{release=resolve;})});await turn();
  const transport=createWorkspaceModelTransport({capacity,authorize:()=>{if(revoked)throw Object.assign(new Error('revoked'),{code:'not_found'});},transport:{post:async()=>{hits++;return {data:'private result'};}}});
  const pending=runWithWorkspace(actor('a'),()=>transport.request({providerId:'neutral',modelId:'model',kind:'model.generate',method:'post',url:'https://provider.invalid/v1/chat/completions',data:{fixture:true},options:{timeout:1000}}));
  const denial=assert.rejects(pending,/revoked/);revoked=true;release();await blocker;await denial;assert.equal(hits,0);
  revoked=false;const delayed=createWorkspaceModelTransport({capacity,authorize:()=>{if(revoked)throw new Error('revoked');},transport:{post:async()=>{revoked=true;return {data:'must not return'};}}});
  await assert.rejects(runWithWorkspace(actor('a'),()=>delayed.request({providerId:'neutral',modelId:'model',kind:'model.generate',method:'post',url:'https://provider.invalid/v1/chat/completions',data:{fixture:true},options:{timeout:1000}})),/revoked/);
});
test('scoped root cancellation reaches model HTTP transport and does not allow next inference before it settles',async t=>{
  const {createWorkspaceModelTransport}=require('../collaboration/model-transport.cjs');
  const capacity=createCapacityCoordinator();t.after(()=>capacity.close());let started=false;
  const transport=createWorkspaceModelTransport({capacity,authorize:()=>{},transport:{post:(_url,_data,options)=>new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>setImmediate(()=>reject(options.signal.reason)),{once:true});})}});
  const root=runWithWorkspace(actor('a'),()=>capacity.withTaskScope({workspaceId:'a',taskId:'root',createdBy:'owner-a'},()=>transport.request({providerId:'neutral',modelId:'model',kind:'model.generate',method:'post',url:'https://provider.invalid/v1/chat/completions',data:{},options:{timeout:1000}})));
  const cancellation=assert.rejects(root,e=>e.code==='task_cancelled');await turn();
  const following=capacity.submit({workspaceId:'b',taskId:'next',deadlineAt:Date.now()+10000,kind:'model.generate',run:()=>{started=true;return 1;}});
  capacity.cancel('root');assert.equal(started,false);await cancellation;assert.equal(await following,1);
});
test('embedded task scopes use bounded public defaults when workspace settings intentionally omit legacy configuration',async t=>{
  const {execFileSync}=require('node:child_process'),vm=require('node:vm'),path=require('node:path'),espree=require('espree');
  const source=JSON.parse(execFileSync('python',['-c','import json,runpy; print(json.dumps(runpy.run_path("scripts/materialize.py")["embedded_sources"]()))'],{cwd:path.resolve(__dirname,'..'),encoding:'utf8'})).SERVER_JS;
  const fn=require('./helpers/embedded-server-ast.cjs').runtimeStatements(source).find(node=>node.type==='FunctionDeclaration'&&node.id.name==='workspaceTaskScope');assert.ok(fn);
  const capacity=createCapacityCoordinator();t.after(()=>capacity.close());const services={capacity,identity:{requireMembership:()=>actor('a')}};
  const box={workspaceServices:()=>services,workspaceSetting:()=>null,require:require('node:module').createRequire(path.resolve(__dirname,'..','server.js'))};vm.createContext(box);vm.runInContext(source.slice(...fn.range),box);
  assert.equal(await runWithWorkspace(actor('a'),()=>box.workspaceTaskScope('root',()=>42)),42);
});
