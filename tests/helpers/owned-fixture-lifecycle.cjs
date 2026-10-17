'use strict';

// Test-only ownership: register teardown before initialization can allocate.
async function createOwnedFixture({ signal, testContext } = {}, initialize) {
  const controller = new AbortController();
  const parents = [...new Set([signal, testContext?.signal].filter(Boolean))];
  let resource, closing, finishInitialization;
  const initialized = new Promise(resolve => { finishInitialization = resolve; });
  const cancel = () => { void close().catch(() => {}); };
  function close() {
    if (!closing) {
      controller.abort();
      closing = initialized.then(async () => {
        try { if (resource) await resource.close(); }
        finally { for (const parent of parents) parent.removeEventListener('abort', cancel); }
      });
    }
    return closing;
  }
  testContext?.after(close);
  for (const parent of parents) {
    parent.addEventListener('abort', cancel, { once: true });
    if (parent.aborted) controller.abort();
  }
  let failure;
  try {
    controller.signal.throwIfAborted();
    resource = await initialize(controller.signal);
    controller.signal.throwIfAborted();
  } catch (error) { failure = error; }
  finally { finishInitialization(); }
  if (failure) {
    try { await close(); }
    catch (cleanupError) { throw new AggregateError([failure, cleanupError], 'Fixture initialization and cleanup failed'); }
    throw failure;
  }
  return { ...resource, close };
}

module.exports = { createOwnedFixture };
