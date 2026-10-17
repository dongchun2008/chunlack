'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createOwnedFixture } = require('./helpers/owned-fixture-lifecycle.cjs');
const { stopOwnedChild } = require('./helpers/owned-child-cleanup.cjs');
const { createPackagedIngressFixture } = require('./helpers/packaged-ingress-fixture.cjs');
const { createPackagedAgentScenario } = require('./helpers/packaged-agent-scenario.cjs');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('fixture ownership registers cleanup before initialization and rejects pre-cancellation', async () => {
  const controller = new AbortController();
  controller.abort();
  let hook, allocations = 0;
  await assert.rejects(createOwnedFixture({ signal: controller.signal, testContext: { after(fn) { hook = fn; } } }, async () => {
    allocations++;
  }), { name: 'AbortError' });
  assert.equal(typeof hook, 'function');
  await hook();
  assert.equal(allocations, 0);
});

test('cancellation drains a late real listener and prevents the next allocation', { timeout: 5000 }, async () => {
  const controller = new AbortController(), started = deferred(), release = deferred();
  const server = net.createServer();
  let nextAllocation = false, hook;
  const pending = createOwnedFixture({ signal: controller.signal, testContext: { after(fn) { hook = fn; } } }, async signal => {
    assert.equal(typeof hook, 'function');
    try {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      started.resolve();
      await release.promise;
      signal.throwIfAborted();
      nextAllocation = true;
      return { close: () => new Promise(resolve => server.close(resolve)) };
    } catch (error) {
      if (server.listening) await new Promise(resolve => server.close(resolve));
      throw error;
    }
  });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  try {
    await started.promise;
    assert.equal(server.listening, true);
    controller.abort();
    const closing = hook();
    assert.equal(closing, hook());
    release.resolve();
    await rejected;
    await closing;
    assert.equal(server.listening, false);
    assert.equal(nextAllocation, false);
  } finally {
    release.resolve();
    await pending.catch(() => {});
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
});

test('cancellation owns and reaps a real child returned by in-flight initialization', { timeout: 10000 }, async () => {
  const controller = new AbortController(), ready = deferred(), release = deferred();
  let child, exited, closes = 0, hook;
  const pending = createOwnedFixture({ signal: controller.signal, testContext: { after(fn) { hook = fn; } } }, async () => {
    child = spawn(process.execPath, ['-e', "process.stdin.setEncoding('utf8');process.stdin.on('data',s=>{if(s.includes('STOP'))process.exit(0)});process.send('ready');"], {
      windowsHide: true, stdio: ['pipe', 'ignore', 'pipe', 'ipc']
    });
    exited = once(child, 'exit');
    await once(child, 'message');
    ready.resolve();
    await release.promise;
    return { async close() { closes++; await stopOwnedChild(child, exited, { graceMs: 1000, forceMs: 1000 }); } };
  });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  try {
    await ready.promise;
    controller.abort();
    release.resolve();
    await rejected;
    await hook();
    assert.equal(closes, 1);
    assert.equal(child.exitCode, 0);
  } finally {
    release.resolve();
    await pending.catch(() => {});
    if (child) await stopOwnedChild(child, exited, { graceMs: 1000, forceMs: 1000 });
  }
});

test('ready fixture cancellation closes once and preserves cleanup errors', async () => {
  const controller = new AbortController();
  const failure = new Error('owned cleanup failed');
  let closes = 0;
  const fixture = await createOwnedFixture({ signal: controller.signal }, async () => ({
    async close() { closes++; throw failure; }
  }));
  controller.abort();
  assert.equal(fixture.close(), fixture.close());
  await assert.rejects(fixture.close(), error => error === failure);
  assert.equal(closes, 1);
});

test('packaged ingress and scenario reject pre-cancellation without starting services', { timeout: 5000 }, async () => {
  const controller = new AbortController();
  controller.abort();
  const options = { signal: controller.signal, caddyBin: 'must-not-run-after-cancellation' };
  await assert.rejects(createPackagedIngressFixture(options), { name: 'AbortError' });
  await assert.rejects(createPackagedAgentScenario(options), { name: 'AbortError' });
});

test('actual packaged TLS fixture closes on cancellation and refuses restart and WSS', { skip: !process.env.CADDY_TEST_BIN, timeout: 30000 }, async t => {
  const controller = new AbortController();
  const fixture = await createPackagedIngressFixture({ caddyBin: process.env.CADDY_TEST_BIN, signal: controller.signal, testContext: t });
  assert.equal((await fixture.request('web', '/health')).status, 200);
  const account = await fixture.login();
  const socket = await fixture.connect({ cookie: account.cookie, workspaceId: fixture.workspaceId });
  const socketClosed = once(socket, 'close');
  controller.abort();
  await fixture.close();
  await socketClosed;
  await assert.rejects(async () => fixture.request('web', '/health'), { name: 'AbortError' });
  await assert.rejects(async () => fixture.connect({ cookie: account.cookie, workspaceId: fixture.workspaceId }), { name: 'AbortError' });
  await assert.rejects(async () => fixture.restart(), { name: 'AbortError' });
});
