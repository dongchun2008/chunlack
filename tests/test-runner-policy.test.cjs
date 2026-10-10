'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {scripts} = require('../package.json');
test('default regression runs every test file with bounded process concurrency and a per-file deadline', () => {
  assert.equal(scripts.test, 'node --test --test-concurrency=1 --test-timeout=90000 tests/*.test.cjs');
});
