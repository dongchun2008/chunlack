'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {once} = require('node:events');
const {stopOwnedChild} = require('./helpers/owned-child-cleanup.cjs');

async function cleanupTestResources(owned, remove) {
  const errors = [];
  for (const item of owned) {
    try {await stopOwnedChild(item.child, item.exited);} catch (error) {errors.push(error);}
  }
  if (owned.some(item => item.child.exitCode === null && item.child.signalCode === null)) {
    errors.push(new Error('test_root_retained_for_live_child'));
  } else {
    try {remove();} catch (error) {errors.push(error);}
  }
  if (errors.length) throw new AggregateError(errors, 'Test fallback cleanup failed');
}

function setup(t, options = {}) {
  const {createPublicRuntimeResources} = require('./helpers/public-runtime-resources.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-public-runtime-'));
  const canonical = fs.realpathSync(root), owned = [], hooks = [];
  const remove = () => {
    if (!fs.existsSync(root)) return;
    assert.equal(fs.realpathSync(root), canonical);
    assert.equal(fs.lstatSync(root).isSymbolicLink(), false);
    fs.rmSync(root, {recursive: true, force: true});
  };
  t.after(() => cleanupTestResources(owned, remove));
  const controller = new AbortController();
  if (options.preCancelled) controller.abort();
  const resources = createPublicRuntimeResources({root,
    testContext: {signal: controller.signal, after(fn) {hooks.push(fn);}},
    ...(options.removeRoot ? {removeRoot: () => options.removeRoot({root, owned, remove})} : {}),
    ...(options.stopChild ? {stopChild: options.stopChild} : {})});
  async function child(program) {
    const item = resources.spawn(process.execPath, ['-e', program ||
      "process.stdin.on('data',s=>{if(s.toString().includes('STOP'))process.exit(0)});process.send({kind:'boot'});"],
    {windowsHide: true, stdio: ['pipe', 'ignore', 'pipe', 'ipc']});
    owned.push(item);
    await once(item.child, 'message');
    return item;
  }
  return {root, owned, hooks, controller, resources, child, remove};
}

test('runtime fixture stops its owned child before root removal and closes idempotently', {timeout: 30000}, async t => {
  let removed = false;
  const f = setup(t, {removeRoot({owned, remove}) {
    assert.equal(owned.length, 1);
    assert.equal(owned[0].child.exitCode, 0);
    removed = true; remove();
  }});
  await f.child();
  assert.equal(f.hooks.length, 1);
  const closing = f.resources.close();
  assert.equal(closing, f.resources.close());
  await closing;
  await f.hooks[0]();
  assert.equal(removed, true);
  assert.equal(fs.existsSync(f.root), false);
  assert.throws(() => f.resources.spawn(process.execPath, ['-e', 'process.exit(0)']), /fixture_closed/);
});

test('directory cleanup failure cannot skip either owned child and remains a failure', {timeout: 30000}, async t => {
  const failure = Object.assign(new Error('synthetic_directory_cleanup_failure'), {code: 'EPERM'});
  const f = setup(t, {removeRoot({owned}) {
    assert.equal(owned.length, 2);
    for (const item of owned) assert.equal(item.child.exitCode, 0);
    throw failure;
  }});
  await f.child(); await f.child();
  await assert.rejects(f.resources.close(), error => error instanceof AggregateError && error.errors.includes(failure));
  for (const item of f.owned) assert.equal(item.child.exitCode, 0);
  assert.equal(fs.existsSync(f.root), true);
});

test('one child cleanup error does not skip remaining children or erase the failure', {timeout: 30000}, async t => {
  let stops = 0;
  const failure = new Error('synthetic_child_cleanup_failure');
  const f = setup(t, {async stopChild(child, exited) {
    await stopOwnedChild(child, exited);
    if (++stops === 1) throw failure;
  }});
  const deferred = [], secondary = new Error('synthetic_other_resource_cleanup_failure');
  f.resources.defer(() => {deferred.push('remaining');});
  f.resources.defer(() => {deferred.push('failing'); throw secondary;});
  await f.child(); await f.child();
  await assert.rejects(f.resources.close(), error => error instanceof AggregateError &&
    error.errors.includes(failure) && error.errors.includes(secondary));
  assert.equal(stops, 2);
  assert.deepEqual(deferred, ['failing', 'remaining']);
  for (const item of f.owned) assert.equal(item.child.exitCode, 0);
  assert.equal(fs.existsSync(f.root), false);
});

test('startup cancellation drains a late-ready child before removing its directory', {timeout: 30000}, async t => {
  const f = setup(t);
  const item = await f.child(`
    const net=require('node:net'); let complete;
    const starting=new Promise(resolve=>{complete=resolve});
    process.stdin.on('data',data=>{if(data.toString().includes('STOP')) {
      process.send({kind:'stopping'});
      starting.then(server=>server.close(()=>process.exit(0)));
    }});
    process.on('message',message=>{if(message==='GO') {
      const server=net.createServer();
      server.listen(0,'127.0.0.1',()=>{process.send({kind:'late-ready'});complete(server)});
    }});
    process.send({kind:'boot'});
  `);
  const stopped = once(item.child, 'message');
  f.controller.abort(new Error('synthetic_startup_timeout'));
  assert.equal((await stopped)[0].kind, 'stopping');
  const closing = f.resources.close();
  assert.equal(fs.existsSync(f.root), true);
  assert.throws(() => f.resources.assertOpen(), /fixture_closed/);
  const late = once(item.child, 'message');
  item.child.send('GO');
  assert.equal((await late)[0].kind, 'late-ready');
  await closing;
  assert.equal(item.child.exitCode, 0);
  assert.equal(fs.existsSync(f.root), false);
});

test('an unreaped owned child retains the root while other owned children are cleaned', {timeout: 30000}, async t => {
  let calls = 0;
  const failure = new Error('synthetic_unresponsive_child');
  const f = setup(t, {async stopChild(child, exited) {
    if (++calls === 1) throw failure;
    await stopOwnedChild(child, exited);
  }});
  await f.child(); await f.child();
  await assert.rejects(f.resources.close(), error => error instanceof AggregateError &&
    error.errors.includes(failure) && error.errors.some(value => value.message === 'fixture_root_retained_for_live_child'));
  assert.equal(calls, 2);
  assert.equal(f.owned.filter(item => item.child.exitCode === null && item.child.signalCode === null).length, 1);
  assert.equal(fs.existsSync(f.root), true);
});

test('pre-cancelled runtime fixture rejects allocation and still owns its cleanup', async t => {
  const f = setup(t, {preCancelled: true});
  assert.equal(f.hooks.length, 1);
  assert.throws(() => f.resources.spawn(process.execPath, ['-e', 'process.exit(0)']), /fixture_closed/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fs.existsSync(f.root), false);
  await f.hooks[0]();
});

test('test fallback cleans the next real child after forced cleanup and reports the failure', {timeout: 30000}, async t => {
  const f = setup(t);
  await f.child("process.stdin.resume();setInterval(()=>{},1000);process.send({kind:'boot'});");
  await f.child();
  await assert.rejects(cleanupTestResources(f.owned, f.remove), error => error instanceof AggregateError &&
    error.errors.some(value => value.code === 'TEST_CHILD_FORCED_CLEANUP'));
  assert.ok(f.owned[0].child.exitCode !== null || f.owned[0].child.signalCode !== null);
  assert.equal(f.owned[1].child.exitCode, 0);
  assert.equal(fs.existsSync(f.root), false);
  await f.resources.close();
});
