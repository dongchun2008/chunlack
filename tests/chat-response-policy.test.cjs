'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const {workspaceFixture} = require('./helpers/workspace-fixture.cjs');
const {createWorkspaceStateRegistry, createScopedMap} = require('../collaboration/state.cjs');
const {runWithWorkspace, requireWorkspaceContext} = require('../collaboration/context.cjs');

const source = JSON.parse(execFileSync(process.env.PYTHON || 'python', ['-c',
  'import json,runpy; print(json.dumps(runpy.run_path("scripts/materialize.py")["embedded_sources"]()))'],
{cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 30000})).SERVER_JS;
const nodes = require('./helpers/embedded-server-ast.cjs').runtimeStatements(source);
const required = ['agentRespondBody', 'onHumanMessageBody', 'generateReflection', 'triggerProactiveQuestions', 'stopLoop', 'stopRalphLoop', 'workspaceMap'];
const optional = ['chatEnhancementsEnabled', 'selectChatRecipients', 'normalizeChatSystemPrompt', 'chatWorkflowGeneration', 'invalidateChatWorkflow'];
const baseNode = nodes.find(item => item.type === 'VariableDeclaration' && item.declarations.some(x => x.id.name === 'BASE_SYSTEM_PROMPT'));
assert.ok(baseNode);
const flagsNode = nodes.find(item => item.type === 'VariableDeclaration' && item.declarations.some(x => x.id.name === 'chatWorkflowFlags'));
const functions = source.slice(...baseNode.range) + '\n' + (flagsNode ? source.slice(...flagsNode.range) : '') + '\n' + [...required, ...optional].map(name => {
  const node = nodes.find(item => item.type === 'FunctionDeclaration' && item.id.name === name);
  if (!node) {assert.ok(optional.includes(name), name); return '';}
  return source.slice(...node.range);
}).join('\n');

function setup(t, {legacy = false} = {}) {
  const f = workspaceFixture(t);
  const registry = createWorkspaceStateRegistry({identity: f.store});
  t.after(() => registry.close());
  const maps = Object.fromEntries(['agents', 'channels', 'projectStates', 'ralphActive', 'proactiveThrottle', 'runtimeFlags', 'ralphTimers', 'ralphCancel']
    .map(name => [name, legacy ? new Map() : createScopedMap(name, {registry})]));
  const main = [], extra = [], replies = [], notices = [], plans = [], timers = [], errors = [];
  const actor = () => requireWorkspaceContext();
  const inA = fn => runWithWorkspace(f.actor('alice', 'a'), fn);
  const inB = fn => runWithWorkspace(f.actor('bob', 'b'), fn);
  function seed() {
    maps.channels.set('general', {name: 'general', messages: []});
    for (const name of ['Alpha', 'Beta']) maps.agents.set(name, {id: name, name,
      model: 'synthetic-model', systemPrompt: 'Return only MARKER.', channels: ['general'],
      strictChannel: 'general', lastResponseTime: new Map()});
  }
  inA(seed); if (!legacy) inB(seed);
  const context = vm.createContext({...maps, console,
    ENABLE_MUSING: false, ENABLE_TRIANGULATION: false, JSPACE_ENABLED: false,
    getProjectState: id => maps.projectStates.get(id) || {active: false},
    setProjectState: (id, state) => maps.projectStates.set(id, {...state}),
    workspaceServices: () => legacy ? null : {registry},
    require: name => {assert.equal(name, './collaboration/state.cjs'); return {createScopedMap};},
    clearTimeout() {},
    broadcastRalphStatus() {}, persistRalphState() {}, scheduleLoopRound() {},
    getChannelPersonality: () => ({temperature: 0, systemBonus: ''}),
    buildConversationContext: () => '', retrievePrivateMemory: async () => '',
    broadcastAgents() {}, broadcastToStore() {},
    logError: error => errors.push(error), judgeAndReweight: async () => {},
    queryOllamaWithRetry: async (...args) => {
      main.push({workspaceId: actor().workspaceId, agentId: args[4], systemPrompt: args[2]}); return 'MARKER';
    },
    queryOllama: async (...args) => {
      extra.push({workspaceId: actor().workspaceId, agentId: args[4]}); return 'UNREQUESTED_FOLLOWUP';
    },
    handleAgentResponse: async (agent, storeId, content) => {
      replies.push({workspaceId: actor().workspaceId, agentId: agent.id, storeId, content});
    },
    addMessage: (storeId, sender, senderType, content) => {
      const value = {workspaceId: actor().workspaceId, storeId, sender, senderType, content};
      notices.push(value); return value;
    },
    uuidv4: () => 'synthetic-message',
    agentPlanAndAct: async agent => plans.push({workspaceId: actor().workspaceId, agentId: agent.id}),
    setTimeout: callback => {const current = actor(); timers.push(() => runWithWorkspace(current, callback));},
  });
  vm.runInContext(functions, context, {timeout: 1000});
  context.agentRespond = (...args) => context.agentRespondBody(...args);
  const send = content => context.onHumanMessageBody('general', {id: 'synthetic-human', sender: 'Human', content}, {send() {}});
  const drain = async () => {for (const callback of timers.splice(0)) {await callback(); await new Promise(setImmediate);}};
  const clean = () => assert.deepEqual(errors, [], 'runtime must not swallow an unexpected fixture error');
  return {...f, ...maps, context, inA, inB, main, extra, replies, notices, plans, timers, send, drain, clean};
}

test('legacy workflow generation remains stable until explicitly invalidated', t => {
  const f = setup(t, {legacy: true});
  f.inA(() => {
    const first = f.context.chatWorkflowGeneration('general');
    assert.equal(f.context.chatWorkflowGeneration('general'), first);
    f.context.stopRalphLoop('general');
    assert.notEqual(f.context.chatWorkflowGeneration('general'), first);
  });
  f.clean();
});

test('legacy explicit planning retains its valid delayed follow-up', async t => {
  const f = setup(t, {legacy: true});
  await f.inA(async () => {
    f.projectStates.set('general', {active: true});
    await f.send('Continue the selected plan');
  });
  assert.equal(f.timers.length, 1);
  await f.drain(); f.clean();
  assert.equal(f.extra.length, 2);
  assert.equal(f.notices.filter(x => x.senderType === 'agent').length, 2);
});

test('legacy stop and restart invalidate only the prior workflow callback', async t => {
  const f = setup(t, {legacy: true});
  await f.inA(async () => {
    f.projectStates.set('general', {active: true});
    await f.send('Continue the selected plan');
    await f.send('/stop');
    await f.send('/abstract');
  });
  await f.drain(); f.clean();
  assert.equal(f.extra.length, 0);
  assert.equal(f.notices.filter(x => x.senderType === 'agent').length, 0);
  await f.inA(() => f.context.triggerProactiveQuestions('general', {content: 'New workflow'}));
  f.clean(); assert.equal(f.extra.length, 2);
});

test('ordinary embedded response generates one reply without a reflection request', async t => {
  const f = setup(t);
  await f.inA(() => f.context.agentRespondBody(f.agents.get('Alpha'), 'general', {sender: 'Human', content: 'Only MARKER'}));
  f.clean(); assert.equal(f.main.length, 1); assert.equal(f.extra.length, 0);
  assert.deepEqual(f.replies.map(x => x.content), ['MARKER']);
});

test('ordinary unaddressed chat preserves channel collaboration without automatic follow-up work', async t => {
  const f = setup(t); await f.inA(() => f.send('Only MARKER'));
  f.clean(); assert.equal(f.main.length, 2); assert.equal(f.replies.length, 2);
  assert.equal(f.extra.length, 0); assert.equal(f.timers.length, 0);
});

test('one explicit mention selects only that Agent and one generation', async t => {
  const f = setup(t); await f.inA(() => f.send('@Alpha Only MARKER'));
  f.clean(); assert.deepEqual(f.main.map(x => x.agentId), ['Alpha']);
  assert.equal(f.extra.length, 0); assert.equal(f.timers.length, 0); assert.equal(f.replies.length, 1);
});

test('multiple mentions retain explicitly selected multi-Agent collaboration', async t => {
  const f = setup(t); await f.inA(() => f.send('@Beta @Alpha collaborate'));
  f.clean(); assert.deepEqual(f.main.map(x => x.agentId), ['Beta', 'Alpha']);
  assert.equal(f.extra.length, 0); assert.equal(f.replies.length, 2);
});

test('repeated mentions do not duplicate a selected Agent invocation', async t => {
  const f = setup(t); await f.inA(() => f.send('@Alpha @Alpha Only MARKER'));
  f.clean(); assert.deepEqual(f.main.map(x => x.agentId), ['Alpha']); assert.equal(f.replies.length, 1);
});

for (const message of ['@Unknown Only MARKER', '@Alpha @Unknown Only MARKER']) {
  test(`unresolved mention fails closed without channel fan-out: ${message}`, async t => {
    const f = setup(t); await f.inA(() => f.send(message)); f.clean();
    assert.equal(f.main.length, 0); assert.equal(f.extra.length, 0); assert.equal(f.timers.length, 0);
    assert.equal(f.notices.length, 1); assert.match(f.notices[0].content, /mention/i);
  });
}

test('Unicode display names with spaces and punctuation are matched literally', async t => {
  const f = setup(t);
  await f.inA(async () => {
    f.agents.get('Alpha').name = '1Cat \u9a8c\u6536\u52a9\u624b';
    f.agents.get('Beta').name = 'A.[B]+(C)';
    await f.send('@1Cat \u9a8c\u6536\u52a9\u624b\uff0cOnly MARKER');
  });
  f.clean(); assert.deepEqual(f.main.map(x => x.agentId), ['Alpha']);
});

test('regex punctuation in an Agent name does not alter matching', async t => {
  const f = setup(t);
  await f.inA(async () => {f.agents.get('Beta').name = 'A.[B]+(C)'; await f.send('@A.[B]+(C): Only MARKER');});
  f.clean(); assert.deepEqual(f.main.map(x => x.agentId), ['Beta']);
});

test('longest complete display name wins over a name prefix', async t => {
  const f = setup(t);
  await f.inA(async () => {f.agents.get('Beta').name = 'Alpha Plus'; await f.send('@Alpha Plus Only MARKER');});
  f.clean(); assert.deepEqual(f.main.map(x => x.agentId), ['Beta']);
});

test('duplicate display names are ambiguous and do not broadcast', async t => {
  const f = setup(t);
  await f.inA(async () => {f.agents.get('Beta').name = 'Alpha'; await f.send('@Alpha Only MARKER');});
  f.clean(); assert.equal(f.main.length, 0); assert.equal(f.notices.length, 1);
});

test('email addresses are not interpreted as explicit Agent mentions', async t => {
  const f = setup(t); await f.inA(() => f.send('Explain user@example.com'));
  f.clean(); assert.equal(f.main.length, 2); assert.equal(f.extra.length, 0); assert.equal(f.timers.length, 0);
});

test('a name existing only in another workspace cannot be selected', async t => {
  const f = setup(t); f.inB(() => {f.agents.get('Alpha').name = 'Foreign Agent';});
  await f.inA(() => f.send('@Foreign Agent Only MARKER'));
  f.clean(); assert.equal(f.main.length, 0); assert.equal(f.extra.length, 0);
});

test('concurrent identical mentions use the real workspace-scoped registries', async t => {
  const f = setup(t);
  await Promise.all([f.inA(() => f.send('@Alpha Only MARKER')), f.inB(() => f.send('@Alpha Only MARKER'))]);
  f.clean(); assert.equal(f.main.length, 2); assert.equal(f.replies.length, 2); assert.equal(f.extra.length, 0);
  assert.deepEqual(f.main.map(x => x.workspaceId).sort(), [f.workspaces.a.id, f.workspaces.b.id].sort());
  assert.ok(f.main.every(x => x.agentId === 'Alpha'));
});

test('an explicit mention in a started plan selects only the named planning Agent', async t => {
  const f = setup(t);
  await f.inA(async () => {f.projectStates.set('general', {active: true}); await f.send('@Alpha plan');});
  f.clean(); assert.deepEqual(f.plans.map(x => x.agentId), ['Alpha']); assert.equal(f.timers.length, 0);
});

test('explicitly started unaddressed planning preserves collaboration and proactive behavior', async t => {
  const f = setup(t);
  await f.inA(async () => {f.projectStates.set('general', {active: true}); await f.send('Continue the selected plan');});
  assert.equal(f.plans.length, 2); assert.equal(f.timers.length, 1);
  await f.drain(); f.clean(); assert.equal(f.extra.length, 2); assert.equal(f.notices.length, 2);
});

test('stopping a plan before its pending follow-up prevents late generation', async t => {
  const f = setup(t);
  await f.inA(async () => {
    f.projectStates.set('general', {active: true}); await f.send('Continue the selected plan');
    f.projectStates.set('general', {active: false});
  });
  await f.drain(); f.clean(); assert.equal(f.extra.length, 0); assert.equal(f.notices.length, 0);
});

test('ordinary direct proactive invocation cannot bypass the opt-in check', async t => {
  const f = setup(t);
  await f.inA(() => f.context.triggerProactiveQuestions('general', {content: 'Only MARKER'}));
  f.clean(); assert.equal(f.extra.length, 0); assert.equal(f.notices.length, 0);
});

test('explicit loop response retains its selected reflection behavior', async t => {
  const f = setup(t);
  await f.inA(() => f.context.agentRespondBody(f.agents.get('Alpha'), 'general', {sender: 'Human', content: 'Continue the selected loop'}, true));
  f.clean(); assert.equal(f.main.length, 1); assert.equal(f.extra.length, 1);
  assert.deepEqual(f.replies.map(x => x.content), ['MARKER\n\nUNREQUESTED_FOLLOWUP']);
});

test('mentions cannot bypass strict-channel eligibility', async t => {
  const f = setup(t);
  await f.inA(async () => {f.agents.get('Beta').strictChannel = 'code'; await f.send('@Beta Only MARKER');});
  f.clean(); assert.equal(f.main.length, 0); assert.equal(f.timers.length, 0); assert.equal(f.notices.length, 1);
});

function oldBasePrompt(context) {
  const current = vm.runInContext('BASE_SYSTEM_PROMPT', context);
  const old = current.replace(
    '- Follow the user\'s requested answer format. Ordinary chat does not require reflection or a follow-up question.\n- Suggest further investigations only when requested or working in an explicitly started collaboration workflow.\n- For an explicitly requested investigation, you may use the format:',
    '- After solving or responding, ALWAYS reflect and generate 2-5 concrete "things worth a closer look".\n- End most responses with: "A few things worth a closer look \u2014 want me to dig into any of these next?" or a direct question to another agent/user.\n- Use the format:');
  assert.match(old, /ALWAYS reflect/); return old;
}

test('known old base prompt is normalized at use without mutating stored Agent data', async t => {
  const f = setup(t), old = oldBasePrompt(f.context);
  await f.inA(async () => {f.agents.get('Alpha').systemPrompt = old; await f.send('@Alpha Only MARKER');
    assert.equal(f.agents.get('Alpha').systemPrompt, old);});
  f.clean(); assert.equal(f.main.length, 1); assert.doesNotMatch(f.main[0].systemPrompt, /ALWAYS reflect/);
});

test('known old base prompt preserves an appended custom instruction exactly', async t => {
  const f = setup(t), custom = '\n\nCustom instruction: keep filenames exactly as supplied.';
  await f.inA(async () => {f.agents.get('Alpha').systemPrompt = oldBasePrompt(f.context) + custom; await f.send('@Alpha Only MARKER');});
  f.clean(); assert.doesNotMatch(f.main[0].systemPrompt, /ALWAYS reflect/);
  assert.ok(f.main[0].systemPrompt.includes(custom));
});

test('custom prompts resembling only the old prefix are not rewritten', async t => {
  const f = setup(t), custom = oldBasePrompt(f.context).slice(0, 50) + '\nCustom rule: ALWAYS reflect when I request it.';
  await f.inA(async () => {f.agents.get('Alpha').systemPrompt = custom; await f.send('@Alpha Only MARKER');});
  f.clean(); assert.ok(f.main[0].systemPrompt.startsWith(custom));
});

test('an unavailable longer workspace name cannot route to its eligible shorter prefix', async t => {
  const f = setup(t);
  await f.inA(async () => {const beta = f.agents.get('Beta'); beta.name = 'Alpha Plus'; beta.channels = ['code']; beta.strictChannel = 'code';
    await f.send('@Alpha Plus Only MARKER');});
  f.clean(); assert.equal(f.main.length, 0); assert.equal(f.notices.length, 1);
});

test('duplicate workspace names remain ambiguous even when only one is channel-eligible', async t => {
  const f = setup(t);
  await f.inA(async () => {const beta = f.agents.get('Beta'); beta.name = 'Alpha'; beta.channels = ['code']; beta.strictChannel = 'code';
    await f.send('@Alpha Only MARKER');});
  f.clean(); assert.equal(f.main.length, 0); assert.equal(f.notices.length, 1);
});

test('stop then abstract restart cannot revive a pending prior-workflow follow-up', async t => {
  const f = setup(t);
  await f.inA(async () => {f.projectStates.set('general', {active: true}); await f.send('Original workflow');
    await f.send('/stop'); await f.send('/abstract');});
  await f.drain(); f.clean(); assert.equal(f.extra.length, 0);
  assert.equal(f.notices.filter(x => x.senderType === 'agent').length, 0);
});

test('stop and restart during follow-up generation discards the old result and remaining calls', async t => {
  const f = setup(t); let begun, release, calls = 0;
  const started = new Promise(resolve => {begun = resolve;}), blocked = new Promise(resolve => {release = resolve;});
  f.context.queryOllama = async () => {calls++; begun(); await blocked; return 'OLD_WORKFLOW_RESULT';};
  const pending = f.inA(async () => {f.projectStates.set('general', {active: true});
    await f.context.triggerProactiveQuestions('general', {content: 'Original workflow'});});
  await started;
  await f.inA(async () => {await f.send('/stop'); await f.send('/abstract');});
  release(); await pending; f.clean(); assert.equal(calls, 1);
  assert.equal(f.notices.filter(x => x.senderType === 'agent').length, 0);
});

test('stopping another workspace does not cancel a valid pending local follow-up', async t => {
  const f = setup(t);
  await f.inA(async () => {f.projectStates.set('general', {active: true}); await f.send('Workspace A workflow');});
  await f.inB(() => f.send('/stop'));
  await f.drain(); f.clean(); assert.equal(f.extra.length, 2);
  assert.ok(f.extra.every(x => x.workspaceId === f.workspaces.a.id));
  assert.equal(f.notices.filter(x => x.senderType === 'agent').length, 2);
});
