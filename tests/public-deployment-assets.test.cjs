'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'deploy', 'public');

function fixture(overrides = {}) {
  const commands = [], reads = [];
  const files = {
    '/proc/meminfo': 'MemTotal: 1651712 kB\nMemAvailable: 900000 kB\nSwapTotal: 1048576 kB\nSwapFree: 1048576 kB\n',
    '/proc/loadavg': '0.12 0.08 0.04 1/123 455\n',
    '/proc/vmstat': 'oom_kill 0\n',
    '/proc/pressure/cpu': 'some avg10=0.00 avg60=0.00 avg300=0.00 total=0\n',
    '/proc/pressure/memory': 'some avg10=0.00 avg60=0.00 avg300=0.00 total=0\n',
    '/proc/pressure/io': 'some avg10=0.00 avg60=0.00 avg300=0.00 total=0\n',
    '/sys/fs/cgroup/cgroup.controllers': 'cpuset cpu io memory hugetlb pids rdma misc\n',
    ...overrides.files,
  };
  const run = (command, args) => {
    commands.push([command, [...args]]);
    const ok = stdout => ({status: 0, stdout, stderr: ''});
    if (command === 'getconf') return ok('2\n');
    if (command === 'df') return ok('Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/vda1 8388608 4194304 4194304 50% /\n');
    if (command === 'ss') return ok(args.includes('-ltnp') ? 'LISTEN 0 511 127.0.0.1:3721 0.0.0.0:* users:(("node",pid=11,fd=21))\n' + (overrides.occupied ? 'LISTEN 0 4096 *:443 *:* users:(("unrelated",pid=77,fd=9))\n' : '') : 'UNCONN 0 0 0.0.0.0:40000 0.0.0.0:* users:(("tailscaled",pid=9,fd=4))\n');
    if (command === 'systemctl' && args[0] === 'list-units') return ok('tailscaled.service loaded active running Tailscale\nchunlack.service loaded active running Existing LACK\n' + (overrides.failed ? 'other.service loaded failed failed Existing fault\n' : '') + (overrides.proxy ? 'nginx.service loaded active running Existing proxy\n' : ''));
    if (command === 'systemctl' && args[0] === 'show') {
      const unit = args[1], loaded = ['tailscaled.service', 'chunlack.service', ...(overrides.failed ? ['other.service'] : []), ...(overrides.proxy ? ['nginx.service'] : [])].includes(unit);
      return ok('Id=' + unit + '\nLoadState=' + (loaded ? 'loaded' : 'not-found') + '\nActiveState=' + (unit === 'other.service' ? 'failed' : loaded ? 'active' : 'inactive') + '\nSubState=' + (unit === 'other.service' ? 'failed' : loaded ? 'running' : 'dead') + '\nMainPID=' + (loaded ? '9' : '0') + '\nNRestarts=0\nMemoryCurrent=' + (loaded ? '52428800' : '0') + '\nCPUUsageNSec=0\nResult=' + (unit === 'other.service' ? 'exit-code' : 'success') + '\nExecMainStatus=' + (unit === 'other.service' ? '1' : '0') + '\n');
    }
    if (command === 'journalctl') return overrides.journalUnknown ? {status: 1, stdout: '', stderr: 'Access denied'} : ok(overrides.oom ? 'oom-kill: constraint=CONSTRAINT_NONE\n' : '-- No entries --\n');
    if (command === 'getent') return args[0] === 'ahostsv6' ? overrides.ipv6 ? ok('2001:db8::1 STREAM ' + args[1] + '\n') : {status: 2, stdout: '', stderr: ''} : ok((overrides.dnsMismatch ? '203.0.113.10' : '47.108.217.178') + ' STREAM ' + args[1] + '\n');
    throw new Error('Unexpected command: ' + command + ' ' + args.join(' '));
  };
  return {commands, reads, run, read(file) {reads.push(file); assert.ok(Object.hasOwn(files, file), 'Unexpected read: ' + file); return files[file];}};
}

const options = Object.freeze({webHost: 'lack.chunclaw.top', agentsHost: 'agents.chunclaw.top', expectedIp: '47.108.217.178', relayPort: 40000});
function inspect(overrides) {
  const {collectBaseline, assessBaseline} = require('../deploy/public/preflight.cjs');
  const input = fixture(overrides), baseline = collectBaseline(options, input);
  return {input, baseline, report: assessBaseline(baseline, options)};
}

test('a clear read-only baseline includes service PID/restart, TCP/UDP, pressure, OOM and resource evidence, not deployment permission', () => {
  const {baseline, report} = inspect();
  assert.equal(report.status, 'BASELINE_CLEAR_NOT_DEPLOY_AUTHORIZATION');
  assert.equal(report.deploymentAuthorized, false); assert.deepEqual(report.gates, []);
  assert.equal(baseline.services.find(item => item.id === 'tailscaled.service').pid, 9);
  assert.equal(baseline.services.find(item => item.id === 'tailscaled.service').restarts, 0);
  assert.ok(baseline.listeners.some(item => item.protocol === 'udp' && item.port === 40000));
  assert.ok(baseline.listeners.some(item => item.protocol === 'tcp' && item.port === 3721));
  assert.equal(baseline.memory.availableKiB, 900000);
  assert.equal(baseline.pressure.memory, 0); assert.equal(baseline.oom.recentCount, 0);
  assert.ok(report.unverified.includes('relay_functional_health'));
  assert.ok(report.unverified.includes('production_dns_ownership_and_caa'));
});

test('occupied HTTPS, existing failed services and active unreviewed proxy sites gate deployment without changing any service', () => {
  const {input, report} = inspect({occupied: true, failed: true, proxy: true});
  assert.equal(report.status, 'BLOCKED_OR_REVIEW_REQUIRED');
  assert.ok(report.gates.includes('tcp_443_occupied'));
  assert.ok(report.gates.includes('existing_service_failed:other.service'));
  assert.ok(report.gates.includes('existing_proxy_inventory_requires_review:nginx.service'));
  assert.ok(input.commands.every(([command, args]) => command !== 'systemctl' || ['show', 'list-units'].includes(args[0])));
  assert.ok(input.commands.every(([command]) => ['getconf', 'df', 'ss', 'systemctl', 'journalctl', 'getent'].includes(command)));
  assert.ok(!input.reads.some(file => /(?:ssh|\.env|config|credential|token|key)/i.test(file)));
});

test('insufficient spare memory, pressure, recent OOM and mismatched DNS are independent review gates', () => {
  const {report} = inspect({dnsMismatch: true, oom: true, files: {
    '/proc/meminfo': 'MemTotal: 1651712 kB\nMemAvailable: 500000 kB\nSwapTotal: 1048576 kB\nSwapFree: 900000 kB\n',
    '/proc/pressure/memory': 'some avg10=2.50 avg60=0.00 avg300=0.00 total=0\n',
  }});
  for (const gate of ['insufficient_memory_headroom', 'swap_pressure', 'memory_pressure', 'recent_kernel_oom', 'dns_ipv4_mismatch:lack.chunclaw.top', 'dns_ipv4_mismatch:agents.chunclaw.top']) assert.ok(report.gates.includes(gate), gate);
  assert.equal(report.deploymentAuthorized, false);
});

test('unknown health data, unreviewed IPv6 DNS and unavailable cgroup limits cannot become a clear baseline', () => {
  const {report} = inspect({journalUnknown: true, ipv6: true, files: {'/proc/pressure/io': null, '/sys/fs/cgroup/cgroup.controllers': 'cpu pids\n'}});
  for (const gate of ['kernel_oom_history_unknown', 'io_pressure_unknown', 'cgroup_v2_resource_controls_unavailable', 'dns_ipv6_requires_review:lack.chunclaw.top', 'dns_ipv6_requires_review:agents.chunclaw.top']) assert.ok(report.gates.includes(gate), gate);
});

test('preflight options reject credential-shaped, ambiguous or unknown inputs before running collectors', () => {
  const {parseOptions} = require('../deploy/public/preflight.cjs');
  assert.deepEqual(parseOptions(['--web-host', options.webHost, '--agents-host', options.agentsHost, '--expected-ip', options.expectedIp, '--relay-port', '40000']), options);
  for (const args of [[], ['--token', 'not-a-real-secret'], ['--web-host', 'https://lack.chunclaw.top'], ['--web-host', 'lack.chunclaw.top\nrestart'], ['--web-host', 'lack.chunclaw.top', '--web-host', 'other.example'], ['--relay-port', '0']]) assert.throws(() => parseOptions(args), /invalid_preflight_options/);
  const child = spawnSync(process.execPath, [path.join(publicDir, 'preflight.cjs'), '--token', 'not-a-real-secret'], {cwd: root, encoding: 'utf8', timeout: 3000, windowsHide: true});
  assert.equal(child.status, 2); assert.ok(!child.stdout.includes('not-a-real-secret')); assert.ok(!child.stderr.includes('not-a-real-secret'));
});

function unit(file) {
  const sections = Object.create(null); let current;
  for (const value of fs.readFileSync(path.join(publicDir, file), 'utf8').split('\n')) {
    const line = value.trim(); if (!line || line.startsWith('#')) continue;
    if (/^\[.*\]$/.test(line)) {current = line.slice(1, -1); sections[current] = Object.create(null); continue;}
    const equal = line.indexOf('='); assert.ok(current && equal > 0, 'Invalid unit line');
    const key = line.slice(0, equal); assert.ok(!Object.hasOwn(sections[current], key), 'Unexpected duplicate unit key: ' + key); sections[current][key] = line.slice(equal + 1);
  }
  return sections;
}

test('candidate units bound one shared application and one HTTPS process without depending on or reloading existing Relay/proxy services', () => {
  const app = unit('chunlack-public.service'), https = unit('chunlack-https.service');
  assert.equal(app.Service.MemoryMax, '448M'); assert.equal(app.Service.CPUQuota, '50%'); assert.equal(app.Service.TasksMax, '64');
  assert.equal(https.Service.MemoryMax, '128M'); assert.equal(https.Service.CPUQuota, '10%'); assert.equal(https.Service.TasksMax, '64');
  assert.equal(app.Service.User, 'chunlack-public'); assert.equal(https.Service.User, 'chunlack-https');
  assert.equal(app.Service.Restart, 'no'); assert.equal(https.Service.Restart, 'on-failure');
  assert.equal(https.Unit.Requires, 'chunlack-public.service');
  assert.ok(app.Service.ExecStart.startsWith('/opt/chunlack-public/runtime/node/bin/node '));
  assert.ok(https.Service.ExecStart.startsWith('/opt/chunlack-public/runtime/caddy/caddy run '));
  assert.equal(app.Service.EnvironmentFile, '/etc/chunlack-public/runtime.env');
  for (const config of [app, https]) {
    assert.equal(config.Service.NoNewPrivileges, 'true'); assert.equal(config.Service.ProtectSystem, 'strict');
    assert.equal(config.Service.ProtectHome, 'true'); assert.equal(config.Service.UMask, '0077');
    assert.equal(config.Service.KillMode, 'control-group');
    assert.ok(!Object.keys(config.Service).some(key => /^Exec(?:StartPre|StartPost|StopPost|Reload)$/.test(key)));
    assert.ok(!JSON.stringify(config).match(/tailscale|nginx|apache|haproxy|--environ|funnel|\b(?:3721|40000)\b/i));
  }
  assert.equal(https.Service.AmbientCapabilities, 'CAP_NET_BIND_SERVICE');
  assert.equal(https.Service.CapabilityBoundingSet, 'CAP_NET_BIND_SERVICE');
  assert.equal(app.Service.CapabilityBoundingSet, '');
});

test('canonical shell entry delegates to the bounded collector and the deployment guide distinguishes caps from measured capacity', () => {
  const shell = fs.readFileSync(path.join(publicDir, 'preflight.sh'), 'utf8');
  assert.match(shell, /preflight\.cjs/); assert.ok(!/\b(?:eval|sudo|apt|ufw|iptables|tailscale)\b/.test(shell));
  const doc = fs.readFileSync(path.join(publicDir, 'README.md'), 'utf8');
  for (const phrase of ['448', '128', '0.5', '0.1', '192', '3721', 'Peer Relay', '验收', '不代表']) assert.ok(doc.includes(phrase), phrase);
});
