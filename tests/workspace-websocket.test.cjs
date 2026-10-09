'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {setTimeout: delay} = require('node:timers/promises');
const {once} = require('node:events');
const {transportFixture} = require('./helpers/workspace-transport-fixture.cjs');
const fs = require('node:fs');
const path = require('node:path');
const {websocketActions, slashActions, httpRules} = require('../collaboration/transport.cjs');
test('real verified WSS checks Origin, session, workspace and refuses credential-bearing query URLs', async t => {
  const f = await transportFixture(t); const alice = await f.login();
  for (const options of [{}, {auth: alice, requestOrigin: null}, {auth: alice, requestOrigin: 'https://evil.example'}, {auth: alice, workspaceId: f.workspaces.b.id}, {auth: alice, url: f.origin.replace('https:', 'wss:') + '/ws/workspaces/' + f.workspaces.a.id + '?token=' + alice.token}]) await assert.rejects(f.open(options));
  const peer = await f.open({auth: alice});
  assert.equal(peer.ws.readyState, 1);
  await assert.rejects(f.open({auth: alice, ca: []}), /certificate|self.signed/i);
});
test('WSS frame privilege and username spoofing never change the authenticated sender', async t => {
  const f = await transportFixture(t); const bob = await f.login('bob'); const peer = await f.open({auth: bob});
  await f.send(peer, {type: 'join', channelId: 'general'});
  const rename = await f.send(peer, {type: 'set_username', username: 'admin', userId: f.users.alice.id, role: 'owner'});
  assert.equal(rename.username, 'bob'); assert.equal(rename.userId, f.users.bob.id);
  const message = await f.send(peer, {type: 'message', content: 'hello', userId: f.users.alice.id, username: 'admin'});
  assert.equal(message.userId, f.users.bob.id);
  assert.equal((await f.send(peer, {type: 'spawn_agent', name: 'admin', model: 'm', provider: 'ollama', channels: ['general']})).type, 'denied');
  assert.equal(f.calls.filter(call => call.kind === 'spawn_agent').length, 0);
});
test('viewer may subscribe but cannot send messages, slash commands, research, reactions or agent mutations', async t => {
  const f = await transportFixture(t); const carol = await f.login('carol'); const peer = await f.open({auth: carol, workspaceId: f.workspaces.b.id});
  assert.equal((await f.send(peer, {type: 'join', channelId: 'general'})).type, 'accepted');
  for (const frame of [{type: 'message', content: '/research source'}, {type: 'message', content: '/ground'}, {type: 'message', content: 'ordinary'}, {type: 'reply_in_thread', parentId: 'same-thread', content: '/ground'}, {type: 'add_reaction', messageId: 'same-thread', emoji: '+'}, {type: 'spawn_agent', name: 'X'}, {type: 'update_agent', id: 'moderator'}]) assert.equal((await f.send(peer, frame)).type, 'denied');
  assert.equal(f.calls.length, 0);
});
test('same channel and open thread IDs never receive another workspace broadcasts', async t => {
  const f = await transportFixture(t); const bob = await f.login('bob');
  const a = await f.open({auth: bob}); const b = await f.open({auth: bob, workspaceId: f.workspaces.b.id});
  for (const peer of [a, b]) {await f.send(peer, {type: 'join', channelId: 'general'}); await f.send(peer, {type: 'open_thread', threadId: 'same-thread'}); peer.messages.length = 0;}
  for (const type of ['new_message', 'agents_list', 'ralph_status', 'thread_update']) f.transport.broadcast({workspaceId: f.workspaces.a.id, channelId: type === 'agents_list' ? null : 'general', threadId: type === 'thread_update' ? 'same-thread' : null, payload: {type, content: 'a-only'}});
  await delay(50);
  assert.deepEqual(a.messages.map(message => message.type), ['new_message', 'agents_list', 'ralph_status', 'thread_update']);
  assert.deepEqual(b.messages, []);
});
test('private channels, unknown frames and cross-channel thread identifiers fail closed', async t => {
  const f = await transportFixture(t); const bob = await f.login('bob'); const peer = await f.open({auth: bob});
  assert.equal((await f.send(peer, {type: 'join', channelId: 'private'})).type, 'denied');
  await f.send(peer, {type: 'join', channelId: 'general'});
  for (const frame of [{type: 'arbitrary_shell', command: 'forbidden'}, {type: 'open_thread', threadId: 'private-root'}, {type: 'message', content: '/unknown'}, {type: 'message', content: '/bash forbidden'}, {type: 'reply_in_thread', storeId: 'private', parentId: 'same-thread', content: 'x'}]) assert.equal((await f.send(peer, frame)).type, 'denied');
  assert.equal(f.calls.length, 0);
});
test('membership revocation closes only the affected workspace and prevents reconnection', async t => {
  const f = await transportFixture(t); const bob = await f.login('bob');
  const a = await f.open({auth: bob}); const b = await f.open({auth: bob, workspaceId: f.workspaces.b.id});
  const closed = once(a.ws, 'close');
  f.store.removeMembership(f.actor('alice', 'a'), {workspaceId: f.workspaces.a.id, userId: f.users.bob.id});
  assert.equal((await closed)[0], 1008);
  assert.equal(b.ws.readyState, 1);
  await assert.rejects(f.open({auth: bob}));
  assert.equal((await f.send(b, {type: 'join', channelId: 'general'})).type, 'accepted');
});
test('logout closes existing sockets and passive broadcasts cannot extend idle expiry', async t => {
  const f = await transportFixture(t); const alice = await f.login(); const peer = await f.open({auth: alice});
  const closed = once(peer.ws, 'close'); f.sessions.logout(alice.token);
  assert.equal((await closed)[0], 1008); await assert.rejects(f.open({auth: alice}));
  f.advance(61000);
  const next = await f.login(); const idle = await f.open({auth: next});
  await f.send(idle, {type: 'join', channelId: 'general'});
  for (let i = 0; i < 2; i++) {f.advance(10 * 60 * 1000); f.transport.broadcast({workspaceId: f.workspaces.a.id, channelId: 'general', payload: {type: 'tick'}});}
  const expired = once(idle.ws, 'close'); f.advance(10 * 60 * 1000); f.sessions.sweep();
  assert.equal((await expired)[0], 1008); await assert.rejects(f.open({auth: next}));
});
test('transport bounds connections and rejects manually fabricated upgrade principals', async t => {
  const f = await transportFixture(t, {maxConnections: 1}); const alice = await f.login();
  await f.open({auth: alice}); await assert.rejects(f.open({auth: alice}));
  assert.throws(() => f.transport.attach({close() {}}, {userId: f.users.alice.id, workspaceId: f.workspaces.a.id}), error => error.code === 'unauthorized');
});

test('private channel reactions stay inside their channel and oversized network frames close with a limit error', async t => {
  const f = await transportFixture(t); const alice = await f.login(); const bob = await f.login('bob');
  const privatePeer = await f.open({auth: alice}); const generalPeer = await f.open({auth: bob});
  await f.send(privatePeer, {type: 'join', channelId: 'private'}); await f.send(generalPeer, {type: 'join', channelId: 'general'});
  privatePeer.messages.length = 0; generalPeer.messages.length = 0;
  f.transport.broadcast({workspaceId: f.workspaces.a.id, channelId: 'private', payload: {type: 'reaction_update', messageId: 'private-id', emoji: '+'}});
  await delay(50);
  assert.equal(privatePeer.messages.length, 1); assert.deepEqual(generalPeer.messages, []);
  const closed = once(generalPeer.ws, 'close'); generalPeer.ws.send(JSON.stringify({type: 'message', content: 'x'.repeat(70000)}));
  assert.equal((await closed)[0], 1009);
});

test('passive sweep detects account disable through a different SQLite connection', async t => {
  const f = await transportFixture(t); const carol = await f.login('carol');
  const peer = await f.open({auth: carol, workspaceId: f.workspaces.b.id});
  const closed = once(peer.ws, 'close');
  f.openStore().disableUser(f.users.carol.id);
  f.transport.sweep();
  assert.equal((await closed)[0], 1008);
});

test('embedded server has a complete action inventory and no unscoped client broadcast iteration', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'lack.py'), 'utf8').match(/SERVER_JS\s*=\s*r?'''([\s\S]*?)'''/)[1];
  const ws = source.slice(source.indexOf("wss.on('connection'"), source.indexOf('// ==================== MESSAGE HANDLERS'));
  const types = [...ws.matchAll(/case '([^']+)'/g)].map(match => match[1]);
  assert.deepEqual(types.sort(), Object.keys(websocketActions).sort());
  const humanStart = source.indexOf('async function onHumanMessage(');
  const human = source.slice(humanStart);
  const humanEnd = human.slice(1).search(/\n(?:async )?function \w+\(/);
  assert.ok(humanStart >= 0 && humanEnd > 0);
  for (const match of human.slice(0, humanEnd + 1).matchAll(/\bcmd === '([^']+)'/g)) assert.ok(Object.hasOwn(slashActions, match[1]), `missing slash policy: ${match[1]}`);
  for (const match of source.matchAll(/app\.(get|post|delete)\('(\/api\/[^']+)'/g)) {
    const route = match[2].replace(/:[A-Za-z]+/g, 'resource-id');
    assert.ok(httpRules.some(rule => rule[0] === match[1].toUpperCase() && rule[1].test(route)), `missing HTTP policy: ${route}`);
  }
  assert.ok(!source.includes('clients.entries()'), 'business loops must use scoped connection registry');
  assert.match(ws, /authorizeMessage/);
  assert.match(ws, /runWithWorkspace/);
  assert.ok(/transport\.broadcast\(\{workspaceId: client\.workspaceId, channelId: client\.channelId, payload: \{type: 'reaction_update'/.test(ws), 'reaction adapter must supply workspace and channel');
});
