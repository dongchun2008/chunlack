'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

test('reviewed full i18n and research payload stays inside exact local rehearsal scope', {timeout: 90000}, () => {
  const root = path.resolve(__dirname, '..');
  const result = spawnSync(process.env.PYTHON || 'python3', ['-X', 'utf8', '-B',
    path.join(root, 'deploy/public/release-control/2026-10-25/test-i18n-release-scope.py')],
  {cwd: root, env: {...process.env, PYTHONDONTWRITEBYTECODE: '1'}, encoding: 'utf8', timeout: 80000, windowsHide: true});
  const output = (result.stdout || '') + (result.stderr || '');
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, output);
  assert.match(output, /Ran 10 tests/);
  assert.match(output, /\nOK\s*$/);
  assert.doesNotMatch(output, /skipped|expected failures|unexpected successes/i);
});
