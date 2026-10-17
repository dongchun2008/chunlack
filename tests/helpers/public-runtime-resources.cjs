'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {once} = require('node:events');
const {stopOwnedChild} = require('./owned-child-cleanup.cjs');

// Test-only resource ordering. Never selects processes by name or external PID.
function createPublicRuntimeResources({root, testContext, stopChild = stopOwnedChild,
  removeRoot = directory => fs.rmSync(directory, {recursive: true, force: true})}) {
  if (!path.isAbsolute(root) || path.dirname(root) !== os.tmpdir() ||
      !path.basename(root).startsWith('lack-public-runtime-') || fs.lstatSync(root).isSymbolicLink()) {
    throw new Error('fixture_root_not_owned');
  }
  const canonical = fs.realpathSync(root), children = [], cleanups = [];
  const signal = testContext?.signal;
  let closed = false, closing;
  const running = child => child.exitCode === null && child.signalCode === null;
  const assertOpen = () => {if (closed || signal?.aborted) throw new Error('fixture_closed');};
  function close() {
    if (!closing) {
      closed = true;
      signal?.removeEventListener('abort', cancel);
      closing = Promise.resolve().then(async () => {
        const errors = [];
        for (const item of [...children].reverse()) {
          try {await stopChild(item.child, item.exited);} catch (error) {errors.push(error);}
        }
        for (const cleanup of [...cleanups].reverse()) {
          try {await cleanup();} catch (error) {errors.push(error);}
        }
        if (children.some(item => running(item.child))) {
          errors.push(new Error('fixture_root_retained_for_live_child'));
        } else {
          try {
            if (fs.existsSync(root)) {
              if (fs.lstatSync(root).isSymbolicLink() || fs.realpathSync(root) !== canonical) {
                throw new Error('fixture_root_identity_changed');
              }
              await removeRoot(root);
            }
          } catch (error) {errors.push(error);}
        }
        if (errors.length) throw new AggregateError(errors, 'Owned runtime fixture cleanup failed');
      });
    }
    return closing;
  }
  const cancel = () => {void close().catch(() => {});};
  testContext?.after(close);
  signal?.addEventListener('abort', cancel, {once: true});
  if (signal?.aborted) cancel();
  return Object.freeze({assertOpen, close,
    defer(cleanup) {assertOpen(); cleanups.push(cleanup);},
    spawn(file, args, options) {
      assertOpen();
      const child = spawn(file, args, options), exited = once(child, 'exit');
      exited.catch(() => {});
      const item = {child, exited};
      children.push(item);
      return item;
    }
  });
}

module.exports = {createPublicRuntimeResources};
