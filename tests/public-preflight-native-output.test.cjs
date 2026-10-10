'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {collectBaseline, assessBaseline} = require('../deploy/public/preflight.cjs');
const options = {webHost: 'lack.chunclaw.top', agentsHost: 'agents.chunclaw.top', expectedIp: '47.108.217.178', relayPort: 40000};

function fixture({unit = 'systemd-fsck@dev-disk-by\\x2duuid-0669\\x2d1E9B.service', journal = {status: 0, stdout: '', stderr: ''}, failed = false} = {}) {
  const shown = [];
  const read = file => ({
    '/proc/meminfo': 'MemTotal: 1651808 kB\nMemAvailable: 1118824 kB\nSwapTotal: 2097148 kB\nSwapFree: 2097148 kB\n',
    '/proc/loadavg': '0.00 0.00 0.00 1/100 1', '/proc/vmstat': 'oom_kill 62\n',
    '/sys/fs/cgroup/cgroup.controllers': 'cpuset cpu io memory pids',
    '/proc/pressure/cpu': 'some avg10=0.18 avg60=0.00 avg300=0.00 total=10',
    '/proc/pressure/memory': 'some avg10=0.00 avg60=0.00 avg300=0.00 total=0',
    '/proc/pressure/io': 'some avg10=0.00 avg60=0.00 avg300=0.00 total=0'
  })[file] ?? null;
  const run = (name, args) => {
    const result = stdout => ({status: 0, stdout, stderr: ''});
    if (name === 'getconf') return result('2\n');
    if (name === 'df') return result('Filesystem 1024-blocks Used Available Capacity Mounted\nfixture 40000000 1000000 32371192 3% /var/lib\n');
    if (name === 'ss') return result(args.includes('-ltnp') ? 'LISTEN 0 511 127.0.0.1:3721 0.0.0.0:* users:(("node",pid=234963,fd=22))\n' : 'UNCONN 0 0 0.0.0.0:40000 0.0.0.0:* users:(("tailscaled",pid=859,fd=1))\n');
    if (name === 'journalctl') return journal;
    if (name === 'getent') return args[0] === 'ahostsv4' ? result('47.108.217.178 STREAM fixture\n') : {status: 2, stdout: '', stderr: ''};
    if (name === 'systemctl' && args[0] === 'list-units') return result(`${unit} loaded ${failed ? 'failed failed' : 'active exited'} Fixture\ntailscaled.service loaded active running Fixture\nchunlack.service loaded active running Fixture\n`);
    if (name === 'systemctl' && args[0] === 'show') {
      const id = args[1]; shown.push(id);
      const active = ['tailscaled.service', 'chunlack.service'].includes(id), isFailed = failed && id === unit;
      return result(`Id=${id}\nLoadState=${active || isFailed ? 'loaded' : 'not-found'}\nActiveState=${isFailed ? 'failed' : active ? 'active' : 'inactive'}\nSubState=${isFailed ? 'failed' : active ? 'running' : 'dead'}\nMainPID=${active ? 859 : 0}\nNRestarts=0\nMemoryCurrent=1000000\nCPUUsageNSec=10\nResult=${isFailed ? 'exit-code' : 'success'}\nExecMainStatus=${isFailed ? 1 : 0}\n`);
    }
    throw new Error('unexpected_or_mutating_command');
  };
  const baseline = collectBaseline(options, {run, read});
  return {baseline, shown, assessment: assessBaseline(baseline, options)};
}

test('native systemd hex-escaped filesystem unit names do not invalidate the bounded service inventory', () => {
  const {baseline, assessment} = fixture();
  assert.equal(baseline.servicesInventoryKnown, true);
  assert.equal(baseline.oom.historicalCounter, 62);
  assert.equal(assessment.status, 'BASELINE_CLEAR_NOT_DEPLOY_AUTHORIZATION');
  assert.equal(assessment.deploymentAuthorized, false);
});

test('malformed names and raw path syntax still make service inventory unknown', () => {
  for (const unit of ['bad\\xGG.service', 'bad\\x2.service', '../bad.service', 'bad;start.service']) {
    const {baseline, shown} = fixture({unit});
    assert.equal(baseline.servicesInventoryKnown, false, unit);
    assert.equal(shown.includes(unit), false, unit);
  }
});

test('a failed escaped relay unit is queried literally and remains an explicit deployment blocker', () => {
  const unit = 'custom-relay\\x2dcheck.service';
  const {baseline, shown, assessment} = fixture({unit, failed: true});
  assert.equal(baseline.servicesInventoryKnown, true);
  assert.equal(shown.includes(unit), true);
  assert.equal(assessment.gates.includes('existing_service_failed:' + unit), true);
  assert.equal(assessment.deploymentAuthorized, false);
});

test('native journal grep status one with silent no-match output reports zero matching entries', () => {
  assert.equal(fixture({journal: {status: 1, stdout: '', stderr: ''}}).baseline.oom.recentCount, 0);
});

test('journal grep status one with its standard no-entries marker reports zero matching entries', () => {
  assert.equal(fixture({journal: {status: 1, stdout: '-- No entries --\n', stderr: ''}}).baseline.oom.recentCount, 0);
});

test('journal errors, timeouts, permission diagnostics and unexpected output remain unknown', () => {
  for (const journal of [
    {status: null, stdout: '', stderr: ''}, {status: 2, stdout: '', stderr: ''},
    {status: 1, stdout: '', stderr: 'Permission denied'}, {status: 1, stdout: '', stderr: 'No journal files were found'},
    {status: 1, stdout: 'unexpected output', stderr: ''}, {status: 0, stdout: '', stderr: 'diagnostic'}
  ]) {
    const {baseline, assessment} = fixture({journal});
    assert.equal(baseline.oom.recentCount, null);
    assert.equal(assessment.gates.includes('kernel_oom_history_unknown'), true);
  }
});

test('matching OOM records still block the baseline and never grant deployment authorization', () => {
  const {baseline, assessment} = fixture({journal: {status: 0, stdout: 'oom-kill: fixture\nKilled process 123 fixture\n', stderr: ''}});
  assert.equal(baseline.oom.recentCount, 2);
  assert.equal(assessment.gates.includes('recent_kernel_oom'), true);
  assert.equal(assessment.deploymentAuthorized, false);
});
