'use strict';
// Read-only evidence collection. No service, network, filesystem or account mutation.
const fs = require('node:fs');
const net = require('node:net');
const {spawnSync} = require('node:child_process');
const LIMIT = 131072;
const SERVICE_LIMIT = 32;
const REQUIRED_HEADROOM_KIB = (448 + 128 + 192) * 1024;
const serviceProperties = ['Id', 'LoadState', 'ActiveState', 'SubState', 'MainPID', 'NRestarts', 'MemoryCurrent', 'CPUUsageNSec', 'Result', 'ExecMainStatus'];
const standardUnits = ['tailscaled.service', 'chunlack.service', 'lack.service', 'chunlack-public.service', 'chunlack-https.service', 'caddy.service', 'nginx.service', 'apache2.service', 'haproxy.service'];

function parseOptions(args) {
  const names = new Map([['--web-host', 'webHost'], ['--agents-host', 'agentsHost'], ['--expected-ip', 'expectedIp'], ['--relay-port', 'relayPort']]);
  const values = Object.create(null);
  for (let i = 0; i < args.length; i += 2) {
    const name = names.get(args[i]), value = args[i + 1];
    if (!name || Object.hasOwn(values, name) || typeof value !== 'string' || !value || value.length > 253 || /[\x00-\x20\x7f]/.test(value)) throw new Error('invalid_preflight_options');
    values[name] = value;
  }
  const hostname = value => typeof value === 'string' && !net.isIP(value) && value === value.toLowerCase() && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/.test(value);
  const relayPort = values.relayPort === undefined ? 40000 : Number(values.relayPort);
  if (!hostname(values.webHost) || !hostname(values.agentsHost) || values.webHost === values.agentsHost || net.isIP(values.expectedIp || '') !== 4 || !Number.isInteger(relayPort) || relayPort < 1 || relayPort > 65535 || (values.relayPort !== undefined && !/^\d{1,5}$/.test(values.relayPort))) throw new Error('invalid_preflight_options');
  return {webHost: values.webHost, agentsHost: values.agentsHost, expectedIp: values.expectedIp, relayPort};
}

function command(command, args) {
  const result = spawnSync(command, args, {encoding: 'utf8', timeout: 2000, maxBuffer: LIMIT, shell: false,
    env: {PATH: process.env.PATH || '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C', LC_ALL: 'C'}});
  return {status: result.error ? null : result.status, stdout: result.stdout || '', stderr: result.stderr || ''};
}
function readText(file) {try {const stat = fs.statSync(file); if (!stat.isFile() || stat.size > LIMIT) return null; return fs.readFileSync(file, 'utf8').slice(0, LIMIT);} catch {return null;}}
function integer(value) {return typeof value === 'string' && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;}
function pressure(value) {const match = typeof value === 'string' && value.match(/^some\s+avg10=([\d.]+)/m); const number = match ? Number(match[1]) : NaN; return Number.isFinite(number) && number >= 0 && number <= 100 ? number : null;}
function result(run, name, args) {try {const value = run(name, args); if (!value || typeof value.stdout !== 'string' || value.stdout.length > LIMIT || typeof value.stderr !== 'string' || value.stderr.length > LIMIT) return {status: null, stdout: '', stderr: ''}; return value;} catch {return {status: null, stdout: '', stderr: ''};}}
function listeners(output, protocol) {
  if (output.status !== 0) return null;
  const values = [];
  for (const line of output.stdout.trim().split('\n').filter(Boolean)) {
    const parts = line.trim().split(/\s+/), match = parts[3]?.match(/:(\d{1,5})$/), port = match && integer(match[1]);
    if (!port || port > 65535) return null;
    const pid = line.match(/\bpid=(\d+)/);
    values.push({protocol, port, pid: pid ? integer(pid[1]) : null});
    if (values.length > 1024) return null;
  }
  return values;
}

function collectBaseline(options, {run = command, read = readText} = {}) {
  const cpu = result(run, 'getconf', ['_NPROCESSORS_ONLN']);
  const memoryText = read('/proc/meminfo'), fields = Object.create(null);
  if (typeof memoryText === 'string') for (const match of memoryText.matchAll(/^([A-Za-z]+):\s+(\d+)\s+kB$/gm)) fields[match[1]] = integer(match[2]);
  const loadText = read('/proc/loadavg'), load = typeof loadText === 'string' ? Number(loadText.trim().split(/\s+/)[0]) : NaN;
  const disk = result(run, 'df', ['-Pk', '/var/lib']), diskFields = disk.stdout.trim().split('\n').at(-1)?.trim().split(/\s+/);
  const tcp = listeners(result(run, 'ss', ['-H', '-ltnp']), 'tcp'), udp = listeners(result(run, 'ss', ['-H', '-lunp']), 'udp');
  const units = result(run, 'systemctl', ['list-units', '--type=service', '--all', '--no-legend', '--plain', '--no-pager']);
  const names = new Set(standardUnits); let inventoryKnown = units.status === 0;
  for (const line of units.stdout.trim().split('\n').filter(Boolean)) {
    const parts = line.trim().split(/\s+/), name = parts[0];
    // systemd emits literal C-style hex escapes in path-based instance names.
    // Preserve those bytes as one argv value; never unescape or invoke a shell.
    if (!/^(?:[A-Za-z0-9_.@:-]|\\x[0-9A-Fa-f]{2})+\.service$/.test(name || '')) {inventoryKnown = false; continue;}
    if (/tailscale|relay|lack|caddy|nginx|apache2|haproxy/i.test(name) || parts[2] === 'failed') names.add(name);
  }
  if (names.size > SERVICE_LIMIT) inventoryKnown = false;
  const services = [];
  for (const name of [...names].slice(0, SERVICE_LIMIT)) {
    const output = result(run, 'systemctl', ['show', name, '--no-pager', '--property=' + serviceProperties.join(',')]);
    const props = Object.create(null);
    for (const line of output.stdout.split('\n')) {const at = line.indexOf('='); if (at > 0 && serviceProperties.includes(line.slice(0, at))) props[line.slice(0, at)] = line.slice(at + 1);}
    const known = output.status === 0 && props.Id === name && ['loaded', 'not-found', 'masked'].includes(props.LoadState);
    services.push({id: name, known, load: known ? props.LoadState : null, active: known ? props.ActiveState : null,
      substate: known ? props.SubState : null, pid: integer(props.MainPID), restarts: integer(props.NRestarts),
      memoryBytes: integer(props.MemoryCurrent), cpuUsageNs: integer(props.CPUUsageNSec), result: known ? props.Result : null, exitStatus: integer(props.ExecMainStatus)});
  }
  const journal = result(run, 'journalctl', ['-k', '--since', '-1 hour', '-n', '1000', '--no-pager', '--output=cat', '--grep=oom-kill|Out of memory|Killed process']);
  // --grep follows grep's no-match status. Errors/diagnostics stay unknown.
  const journalNoMatches = journal.status === 1 && !journal.stderr.trim() && ['', '-- No entries --'].includes(journal.stdout.trim());
  const vmstat = read('/proc/vmstat'), oomCounter = typeof vmstat === 'string' ? vmstat.match(/^oom_kill\s+(\d+)$/m) : null;
  const dns = [];
  for (const host of [options.webHost, options.agentsHost]) {
    const v4 = result(run, 'getent', ['ahostsv4', host]), v6 = result(run, 'getent', ['ahostsv6', host]);
    const addresses = (output, family) => [...new Set(output.stdout.trim().split('\n').map(line => line.trim().split(/\s+/)[0]).filter(address => net.isIP(address) === family && !address.startsWith('::ffff:')))];
    dns.push({host, ipv4Known: v4.status === 0, ipv4: addresses(v4, 4), ipv6Known: [0, 2].includes(v6.status), ipv6: addresses(v6, 6)});
  }
  const controllers = read('/sys/fs/cgroup/cgroup.controllers');
  return {schema: 1, checkedAt: new Date().toISOString(), nodeVersion: process.versions.node,
    cores: cpu.status === 0 ? integer(cpu.stdout.trim()) : null, load1m: Number.isFinite(load) && load >= 0 ? load : null,
    memory: {totalKiB: fields.MemTotal ?? null, availableKiB: fields.MemAvailable ?? null, swapTotalKiB: fields.SwapTotal ?? null, swapFreeKiB: fields.SwapFree ?? null},
    diskAvailableKiB: disk.status === 0 && diskFields?.length >= 6 ? integer(diskFields[3]) : null,
    listenersKnown: tcp !== null && udp !== null, listeners: [...(tcp || []), ...(udp || [])], servicesInventoryKnown: inventoryKnown, services,
    pressure: {cpu: pressure(read('/proc/pressure/cpu')), memory: pressure(read('/proc/pressure/memory')), io: pressure(read('/proc/pressure/io'))},
    oom: {historicalCounter: oomCounter ? integer(oomCounter[1]) : null, recentCount: journal.status === 0 && !journal.stderr.trim() ? (journal.stdout.match(/oom-kill|Out of memory|Killed process/g) || []).length : journalNoMatches ? 0 : null},
    cgroupControllers: typeof controllers === 'string' ? controllers.trim().split(/\s+/).filter(value => /^[a-z_]+$/.test(value)) : [], dns};
}

function assessBaseline(baseline, options) {
  const gates = [], add = value => gates.push(value), memory = baseline.memory;
  if (Number(baseline.nodeVersion.split('.')[0]) < 24) add('dedicated_node_24_runtime_required');
  if (baseline.cores === null || baseline.cores < 2) add('cpu_baseline_insufficient_or_unknown');
  if (baseline.load1m === null) add('cpu_load_unknown'); else if (baseline.cores && baseline.load1m > baseline.cores * 0.75) add('existing_cpu_load_requires_review');
  if (memory.totalKiB === null || memory.totalKiB < 1536 * 1024) add('memory_baseline_insufficient_or_unknown');
  if (memory.availableKiB === null || memory.availableKiB < REQUIRED_HEADROOM_KIB) add('insufficient_memory_headroom');
  if (memory.swapTotalKiB === null || memory.swapFreeKiB === null || memory.swapFreeKiB > memory.swapTotalKiB) add('swap_state_unknown');
  else if (memory.swapTotalKiB - memory.swapFreeKiB >= 64 * 1024) add('swap_pressure');
  if (baseline.diskAvailableKiB === null || baseline.diskAvailableKiB < 1024 * 1024) add('disk_headroom_insufficient_or_unknown');
  if (!['cpu', 'memory', 'pids'].every(value => baseline.cgroupControllers.includes(value))) add('cgroup_v2_resource_controls_unavailable');
  if (!baseline.listenersKnown) add('listener_inventory_unknown');
  if (baseline.listeners.some(value => value.protocol === 'tcp' && value.port === 443)) add('tcp_443_occupied');
  if (!baseline.listeners.some(value => value.protocol === 'udp' && value.port === options.relayPort)) add('expected_relay_udp_listener_missing');
  if (!baseline.servicesInventoryKnown) add('service_inventory_unknown_or_exceeds_bound');
  for (const service of baseline.services) {
    if (!service.known) add('service_health_unknown:' + service.id);
    if (service.active === 'failed' || (service.load === 'loaded' && service.result && service.result !== 'success')) add('existing_service_failed:' + service.id);
    if (service.active === 'active' && /^(?:caddy|nginx|apache2|haproxy)\.service$/.test(service.id)) add('existing_proxy_inventory_requires_review:' + service.id);
    if (service.load === 'loaded' && service.active === 'active' && (service.pid === null || !service.pid || service.restarts === null)) add('service_process_evidence_unknown:' + service.id);
  }
  const relay = baseline.services.find(value => value.id === 'tailscaled.service');
  if (!relay || relay.active !== 'active' || relay.substate !== 'running') add('tailscaled_not_confirmed_running');
  for (const [name, ceiling] of [['cpu', 10], ['memory', 1], ['io', 10]]) {
    if (baseline.pressure[name] === null) add(name + '_pressure_unknown'); else if (baseline.pressure[name] >= ceiling) add(name + '_pressure');
  }
  if (baseline.oom.recentCount === null) add('kernel_oom_history_unknown'); else if (baseline.oom.recentCount > 0) add('recent_kernel_oom');
  for (const dns of baseline.dns) {
    if (!dns.ipv4Known || dns.ipv4.length !== 1 || dns.ipv4[0] !== options.expectedIp) add('dns_ipv4_mismatch:' + dns.host);
    if (!dns.ipv6Known) add('dns_ipv6_unknown:' + dns.host); else if (dns.ipv6.length) add('dns_ipv6_requires_review:' + dns.host);
  }
  return {status: gates.length ? 'BLOCKED_OR_REVIEW_REQUIRED' : 'BASELINE_CLEAR_NOT_DEPLOY_AUTHORIZATION', deploymentAuthorized: false, gates,
    budget: {appMemoryMiB: 448, httpsMemoryMiB: 128, spareMemoryMiB: 192, appCpuCores: 0.5, httpsCpuCores: 0.1},
    unverified: ['relay_functional_health', 'production_dns_ownership_and_caa', 'all_existing_proxy_sites', 'production_acme_tls', 'linux_unit_and_signal_acceptance', 'reviewed_migration_backup_and_rollback', 'sustained_real_model_and_agent_capacity'], baseline};
}

if (require.main === module) {
  if (process.argv.length === 3 && process.argv[2] === '--help') {
    console.log('Read-only: preflight.cjs --web-host HOST --agents-host HOST --expected-ip IPV4 [--relay-port PORT]. Exit 0 is a clear snapshot, never deployment permission; exit 2 requires review.');
  } else {
    try {
      const options = parseOptions(process.argv.slice(2));
      if (process.platform !== 'linux') throw new Error('linux_host_required');
      const report = assessBaseline(collectBaseline(options), options);
      console.log(JSON.stringify(report, null, 2)); process.exitCode = report.gates.length ? 2 : 0;
    } catch (error) {
      const code = ['invalid_preflight_options', 'linux_host_required'].includes(error.message) ? error.message : 'preflight_collection_failed';
      console.log(JSON.stringify({status: 'BLOCKED_OR_REVIEW_REQUIRED', deploymentAuthorized: false, gates: [code]})); process.exitCode = 2;
    }
  }
}
module.exports = {parseOptions, collectBaseline, assessBaseline};
