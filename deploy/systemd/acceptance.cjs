'use strict';
// Run only against the disposable five-worker fixture described in README.md.
const assert = require('node:assert/strict');
const http = require('node:http');
const {once} = require('node:events');
const WebSocket = require('ws');
const base = 'http://127.0.0.1:3722';
const marker = 'LACK_ACCEPTANCE_PERSIST_20260914';
const sockets = [];
const traffic = [];
let mock, active = 0, peak = 0;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  for (let i = 0; i < 300; i++) {
    const value = predicate();
    if (value) return value;
    await delay(100);
  }
  throw new Error('Timeout: ' + label);
}
async function connect() {
  const socket = new WebSocket(base.replace('http:', 'ws:'));
  const messages = [];
  sockets.push(socket);
  socket.on('message', data => messages.push(JSON.parse(data)));
  await once(socket, 'open');
  await until(() => messages.find(m => m.type === 'agents_list'), 'initial agents');
  socket.send(JSON.stringify({type: 'join', channelId: 'general'}));
  await until(() => messages.find(m => m.type === 'history'), 'channel history');
  return {socket, messages};
}
async function main() {
  const client = await connect();
  const initial = client.messages.find(m => m.type === 'agents_list');
  for (let i = 1; i <= 5; i++) assert.equal(initial.agents.find(a => a.id === 'worker-' + i).provider, 'mock-' + i);
  if (process.argv[2] === 'persisted') {
    assert.equal(initial.agents.find(a => a.id === 'worker-5').name, 'Worker5Saved');
    assert.ok(JSON.stringify(client.messages.find(m => m.type === 'history')).includes(marker));
    console.log(JSON.stringify({pass: true, phase: 'persisted', checks: ['agent edit', 'provider assignment', 'chat history']}));
    return;
  }
  assert.equal(process.argv[2], 'exercise');
  mock = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      if (req.url.endsWith('/models')) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({data: [{id: 'mock-model'}]}));
        return;
      }
      traffic.push({url: req.url, body: JSON.parse(body)});
      active++; peak = Math.max(peak, active);
      setTimeout(() => {
        active--;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({choices: [{message: {content: 'Synthetic acceptance reply from ' + req.url.split('/')[1] + '.'}}]}));
      }, 250);
    });
  });
  mock.listen(13870, '127.0.0.1');
  await once(mock, 'listening');
  assert.equal((await fetch(base + '/')).status, 200);
  assert.equal((await fetch(base + '/health')).status, 200);
  assert.equal((await fetch(base + '/api/tree?root=../')).status, 400);
  assert.equal((await fetch(base + '/api/models?provider=unknown')).status, 400);
  assert.deepEqual((await (await fetch(base + '/api/models?provider=mock-3')).json()).models, ['mock-model']);
  client.socket.send(JSON.stringify({type: 'update_agent', id: 'worker-5', name: 'Worker5Saved', provider: 'mock-5', model: 'mock-model', systemPrompt: 'Be brief.', channels: ['general']}));
  await until(() => client.messages.some(m => m.type === 'agents_list' && m.agents.some(a => a.id === 'worker-5' && a.name === 'Worker5Saved')), 'agent update');
  client.socket.send(JSON.stringify({type: 'message', content: '@Worker1 ' + marker + ' Give a brief initial assessment.'}));
  await until(() => client.messages.some(m => JSON.stringify(m).includes('Synthetic acceptance reply from worker-1.')), 'first worker reply');
  const others = await Promise.all(Array.from({length: 4}, () => connect()));
  others.forEach((other, index) => {
    const n = index + 2;
    other.socket.send(JSON.stringify({type: 'message', content: '@' + (n === 5 ? 'Worker5Saved' : 'Worker' + n) + ' Review Worker1 response briefly.'}));
  });
  for (let n = 2; n <= 5; n++) {
    await until(() => client.messages.some(m => JSON.stringify(m).includes('Synthetic acceptance reply from worker-' + n + '.')), 'worker reply ' + n);
    const call = traffic.find(t => t.url === '/worker-' + n + '/v1/chat/completions');
    assert.ok(call, 'correct provider endpoint ' + n);
    assert.ok(JSON.stringify(call.body).includes('Synthetic acceptance reply from worker-1.'), 'shared prior context ' + n);
  }
  const started = Date.now();
  await Promise.all(Array.from({length: 5}, async () => {
    for (let i = 0; i < 20; i++) assert.equal((await fetch(base + '/health', {signal: AbortSignal.timeout(5000)})).status, 200);
  }));
  console.log(JSON.stringify({pass: true, phase: 'exercise', agents: 5, websocketClients: sockets.length, generationCalls: traffic.length, peakMockRequests: peak, healthRequests: 100, healthDurationMs: Date.now() - started, checks: ['five provider routes', 'five actual replies', 'shared channel context', 'agent edit', 'path rejection']}));
}
main().catch(error => {console.error(error); process.exitCode = 1;}).finally(async () => {
  sockets.forEach(socket => socket.terminate());
  if (mock) {mock.closeAllConnections(); await new Promise(resolve => mock.close(resolve));}
});
