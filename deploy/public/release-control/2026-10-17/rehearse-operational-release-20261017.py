"""Real private fixture units; aggregate limits 192 MiB/10% CPU/32 tasks."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import sys
import time

def select_rehearsal_cases(selector):
    cases=(('success',None),('rollback','loopback_https_acceptance_passed'))
    if selector=='all':return cases
    if selector not in ('success','rollback'):raise ValueError('invalid_rehearsal_scenario')
    return tuple(case for case in cases if case[0]==selector)


def select_rehearsal_clients(profile, policy):
    if profile not in ('discovery-only', 'mcp-only') or policy not in ('configured', 'empty'):
        raise ValueError('invalid_rehearsal_client_policy')
    if policy == 'empty':
        if profile != 'mcp-only':
            raise ValueError('empty_rehearsal_requires_mcp_only')
        return ()
    return ('isolated-rehearsal-client',) if profile == 'mcp-only' else ()


root = Path(sys.argv[1]).resolve(strict=True)
tag = root.name.removeprefix('chunlack-ops-test-')
assert re.fullmatch('[0-9a-f]{12}', tag) and root == Path('/var/lib/chunlack-ops-test-' + tag)
spec = importlib.util.spec_from_file_location('fixture_tests', root / 'code/test-release-discovery-safe-20261017.py')
tests = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tests)
r = tests.r
real_protected = ('chunlack.service', 'tailscaled.service', 'chunlack-public.service', 'chunlack-https.service')
r.PROTECTED = real_protected
created = []
active = [None]
release_profile = sys.argv[2] if len(sys.argv) > 2 else 'discovery-only'
r.owned_config_fields(release_profile)

# Optional migration is exercised in these private HTTP fixtures only.
migration_contract = r.validate_migration_contract(release_profile, sys.argv[3] if len(sys.argv) > 3 else None)
scenario_selector = sys.argv[4] if len(sys.argv) > 4 else 'all'
selected_cases = select_rehearsal_cases(scenario_selector)
client_policy = sys.argv[5] if len(sys.argv) > 5 else 'configured'
selected_clients = select_rehearsal_clients(release_profile, client_policy)

FIXTURE = r'''
import http.server,json,os,re,signal,sqlite3,sys,urllib.request
from pathlib import Path
role,case,port,upstream=sys.argv[1:];case=Path(case)
assert re.fullmatch('chunlack-ops-test-[0-9a-f]{12}',case.parent.name) and case.name in ('success','rollback')
db=None;lock=case/'data/.public-runtime.lock'
class Handler(http.server.BaseHTTPRequestHandler):
 def do_GET(self):
  if role=='app':data=json.dumps({'version':(case/'current/version').read_text()}).encode()
  else:
   opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
   with opener.open('http://127.0.0.1:'+upstream+'/health',timeout=3) as response:data=response.read()
  self.send_response(200);self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
 def log_message(self,*args):pass
def stop(signum,frame):raise SystemExit(0)
signal.signal(signal.SIGTERM,stop)
try:
 if role=='app':
  db=sqlite3.connect(case/'data/db/test.db');fd=os.open(lock,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
  with os.fdopen(fd,'w') as stream:json.dump({'pid':os.getpid()},stream)

  if (case/'current/version').read_text()=='new' and (case.parent/'migration-fixture.json').exists():
   migrated=sqlite3.connect(case/'data/db/identity.db')
   try:
    if not migrated.execute("SELECT 1 FROM sqlite_master WHERE name='agent_authority_grants'").fetchone():
     catalog=json.loads((case.parent/'migration-fixture.json').read_text())
     for kind,name,table,sql in catalog:
      if kind=='table':migrated.execute(sql)
     for kind,name,table,sql in catalog:
      if kind=='trigger':migrated.execute(sql)
     migrated.execute('INSERT INTO agent_membership_epochs SELECT workspace_id,user_id,lower(hex(randomblob(16))) FROM memberships')
     import time
     migrated.executemany('INSERT INTO schema_version VALUES(?,1,?)',[(name,int(time.time()*1000)) for name in ('agent-authority','agent-membership-epochs')]);migrated.commit()
   finally:migrated.close()
 server=http.server.HTTPServer(('127.0.0.1',int(port)),Handler);server.serve_forever(poll_interval=.1)
finally:
 if db:db.close()
 if role=='app' and lock.exists() and json.loads(lock.read_text())['pid']==os.getpid():lock.unlink()
'''


def run(args, cap=6):
    result = subprocess.run(args, capture_output=True, timeout=cap)
    if result.returncode:
        raise RuntimeError('fixture_command_failed_' + Path(args[0]).name)
    return result.stdout.decode()


def real_state():
    return {name: run(['systemctl', 'show', name, '-p', 'MainPID', '-p', 'NRestarts', '-p', 'ActiveState']) for name in real_protected}


class Operational(tests.Fake, r.LinuxBackend):
    def __init__(self, case, fail, app_port, https_port):
        tests.Fake.__init__(self, case, fail)
        self.release_profile = release_profile

        self.migration_contract = migration_contract
        if migration_contract:
            seed = case / 'migration-seed'
            seed.mkdir()
            tests.MigrationContractTests().fixture(seed)
            for path in (seed / 'db').iterdir():
                os.rename(path, self.data / 'db' / path.name)
        self.approved_agent_client_ids = selected_clients
        if release_profile == 'mcp-only':
            prepared = json.loads(self.new_config.read_text())
            prepared['publicRuntime']['agentOAuth']['discoveryOnly'] = False
            prepared['publicRuntime']['agentOAuth']['clientIds'] = list(self.approved_agent_client_ids)
            prepared['publicRuntime']['nodeRestPublic'] = False
            self.new_config.write_text(json.dumps(prepared))
        self.app_port, self.https_port = app_port, https_port
        self.probe_latencies = []
        self.env = case / 'runtime.env'
        self.env.write_text('FIXTURE_ONLY=1\n')
        self.env.chmod(0o600)
        self.settings = {'envHash': r.digest(self.env), 'stageLinks': {}, 'releaseProfile': release_profile, 'approvedAgentClientIds': list(self.approved_agent_client_ids)}
        for base in (self.current, self.staged):
            (base / 'gateway').mkdir()
            (base / 'gateway/public-runtime.cjs').write_text('module.exports={};\n')
            for path in [base, *base.rglob('*')]:
                os.chown(path, 0, 987)
                os.chmod(path, 0o750 if path.is_dir() else 0o640)
        for path in [self.data, *self.data.rglob('*')]:
            os.chown(path, 996, 987)
            os.chmod(path, 0o700 if path.is_dir() else 0o600)
        os.chown(self.caddy, 0, 986)
        self.caddy.chmod(0o640)


        if migration_contract:
            self.settings['migrationContract'] = migration_contract
            self.settings['stageHashes'] = r.code_inventory(self.staged)
            self.settings['preparedHashes'] = {}
            baseline = r.schema_details(self.data)
            now = int(time.time() * 1000)
            self.compatibility_proof = {'version': 1, 'status': 'passed', 'releaseProfile': release_profile,
                'migrationContract': migration_contract, 'createdAtMs': now, 'expiresAtMs': now + 3600000,
                'baselineSchemaDetails': baseline,
                'bindings': {'catalogSHA256': r._canonical_hash(tests.GATE_EXPECTED_OBJECTS),
                             'candidate': r.code_inventory(self.staged), 'previous': r.code_inventory(self.current),
                             'baselineSchemaSHA256': r._canonical_hash(baseline),
                             'policySHA256': r._canonical_hash(r._public_policy(json.loads(self.new_config.read_text()))),
                             'stageHashesSHA256': r._canonical_hash(self.settings['stageHashes']),
                             'preparedHashesSHA256': r._canonical_hash({})},
                'boots': [{'runtime': name, 'cleanClose': True, 'dataVerified': True} for name in ('candidate', 'previous', 'candidate-repeat')],
                'validations': {name: True for name in ('exactSchema', 'dataPreserved', 'epochsBackfilled', 'zeroGrants', 'faultAtomic', 'integrityAndForeignKeys', 'idempotent')},
                'networkIsolated': True, 'rollbackBackup': False, 'actualModelCalls': False}

    def command(self, args, cap=3):
        if args[0] == 'systemctl':
            assert args[1] in ('show', 'start', 'stop')
            names = [item for item in args[2:] if item.endswith('.service')]
            assert names and all(name in (r.APP, r.HTTPS) or args[1] == 'show' and name in real_protected for name in names)
        args = [item.replace('http://127.0.0.1:13721/health', 'http://127.0.0.1:' + str(self.app_port) + '/health') for item in args]
        return r.LinuxBackend.command(self, args, cap)

    def preflight(self):
        self.baseline = self.protected()
        self.original_inode, self.staged_inode = r.inode(self.current), r.inode(self.staged)
        self.check_identity_and_permissions()
        if migration_contract:
            r.verify_compatibility_proof_content(self.compatibility_proof, self.settings, self.staged, self.current,
                                                 json.loads(self.new_config.read_text()))
        self.check_original()
        self.backup.mkdir(mode=0o700)

    def stop(self, name, cap):
        if absent(name):
            return
        try:
            return r.LinuxBackend.stop(self, name, cap)
        except RuntimeError:
            if not absent(name):
                raise

    def start(self, name, cap):
        for attempt in range(2):
            if absent(name):
                launch(name, 'chunlack-public' if name == r.APP else 'chunlack-https',
                       'app' if name == r.APP else 'https', self.root,
                       self.app_port if name == r.APP else self.https_port, self.app_port)
            try:
                return r.LinuxBackend.start(self, name, cap)
            except RuntimeError:
                if attempt or not absent(name):
                    raise

    def request(self, host, path, method='GET'):
        started = time.monotonic()
        completed = False
        try:
            output = self.command(['curl', '--noproxy', '*', '--silent', '--fail', '--max-time', str(self.w.remaining(3)),
                                   'http://127.0.0.1:' + str(self.https_port) + '/health'], cap=4)
            completed = True
            return 200, '', output
        finally:
            self.probe_latencies.append({'seconds': round(time.monotonic() - started, 3), 'completed': completed})

    def assert_listener(self, mode):
        r.validate_listeners(r.inspect_listeners(self.https_port), int(self.unit(r.HTTPS)['MainPID']), 'loopback')
        expected = 'loopback-caddy' if mode == 'loopback' else 'final-caddy'
        assert self.caddy.read_text() in (expected, 'old-caddy' if mode == 'public' else expected)

    def check_candidate(self, mode):
        r.validate_release_config(json.loads((self.data / 'config/lack.config.json').read_text()), self.release_profile, self.approved_agent_client_ids)
        self.assert_listener(mode)
        assert json.loads(self.request('', '')[2])['version'] == 'new'
        self.check_protected()

    def check_original(self):
        assert json.loads(self.request('', '')[2])['version'] == 'old'

    def check_protected(self):
        return r.LinuxBackend.check_protected(self)

    def set_live_modes(self):
        return r.LinuxBackend.set_live_modes(self)


def free_port():
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        return listener.getsockname()[1]


def launch(name, user, role, case, port, upstream):
    assert name.startswith('chunlack-ops-' + tag + '-') and name.endswith('.service')
    args = ['systemd-run', '--quiet', '--unit=' + name, '--property=Type=exec', '--property=User=' + user,
            '--property=Group=' + user, '--property=MemoryMax=48M', '--property=MemoryHigh=40M', '--property=MemorySwapMax=0',
            '--property=CPUQuota=2.5%', '--property=TasksMax=8', '--property=RuntimeMaxSec=90', '--property=TimeoutStopSec=3',
            '--property=NoNewPrivileges=yes', '--property=PrivateTmp=yes', '--property=ProtectSystem=strict', '--property=ProtectHome=yes',
            '--property=UMask=0077', '--property=IPAddressDeny=any', '--property=IPAddressAllow=localhost',
            '--property=ReadWritePaths=' + str(case / 'data'), '--property=StandardOutput=append:' + str(root / (role + '.log')),
            '--property=StandardError=append:' + str(root / (role + '.log')), '--setenv=PYTHONDONTWRITEBYTECODE=1',
            '/usr/bin/python3', str(root / 'fixture.py'), role, str(case), str(port), str(upstream)]
    run(args)
    if name not in created:
        created.append(name)


def absent(name):
    assert name in (r.APP, r.HTTPS) or name in created
    value = subprocess.run(['systemctl', 'show', name, '-p', 'LoadState', '--value'], capture_output=True, timeout=3)
    if value.stdout.decode().strip() != 'not-found':
        assert value.returncode == 0
        return False
    procs = Path('/sys/fs/cgroup/system.slice') / name / 'cgroup.procs'
    assert not procs.exists() or not procs.read_text().strip()
    return True


def cleanup(names):
    errors = []
    for name in names:
        try:
            assert name in created
            if absent(name):
                continue
            run(['systemctl', 'stop', name])
            if absent(name):
                continue
            value = run(['systemctl', 'show', name, '-p', 'MainPID', '-p', 'ControlGroup'])
            assert 'MainPID=0' in value
            group = dict(line.split('=', 1) for line in value.splitlines())['ControlGroup']
            if group:
                procs = Path('/sys/fs/cgroup' + group) / 'cgroup.procs'
                assert not procs.exists() or not procs.read_text().strip()
        except BaseException:
            errors.append(name)
    return errors


def interrupted(signum, frame):
    if active[0] is not None:
        active[0].w.interrupted = True


signal.signal(signal.SIGTERM, interrupted)
(root / 'fixture.py').write_text(FIXTURE)
(root / 'fixture.py').chmod(0o644)
if migration_contract:
    (root / 'migration-fixture.json').write_text(json.dumps(tests.GATE_EXPECTED_OBJECTS))
    (root / 'migration-fixture.json').chmod(0o644)
before = real_state()
results = []
cleanup_errors = []
try:
    for name, fail in selected_cases:
        case = root / name
        case.mkdir(mode=0o755)
        case.chmod(0o755)
        r.APP = 'chunlack-ops-' + tag + '-' + name + '-app.service'
        r.HTTPS = 'chunlack-ops-' + tag + '-' + name + '-https.service'
        app_port, https_port = free_port(), free_port()
        assert app_port != https_port
        backend = Operational(case, fail, app_port, https_port)
        backend.w = r.Window()
        launch(r.APP, 'chunlack-public', 'app', case, app_port, app_port)
        backend.start(r.APP, 16)
        launch(r.HTTPS, 'chunlack-https', 'https', case, https_port, app_port)
        backend.start(r.HTTPS, 12)
        transaction = r.Transaction(backend)
        active[0] = transaction
        result = transaction.execute()
        active[0] = None
        assert result['status'] == ('released' if fail is None else 'rolled_back'), result
        assert result.get('outageSeconds', result.get('elapsedSeconds')) < 120
        value = json.loads((backend.data / 'config/lack.config.json').read_text())
        if fail:
            assert 'nodeRestPublic' not in value['publicRuntime']
            assert value['agents'] == ['user-changed-model'] and not value['publicRuntime']['agentOAuth']['enabled']
            assert (backend.data / 'new-upload').read_text() == 'keep'
        else:
            r.validate_release_config(value, release_profile, backend.approved_agent_client_ids)
        results.append({'case': name, 'result': result, 'probeLatencies': backend.probe_latencies})
        errors = cleanup([r.HTTPS, r.APP])
        assert not errors, errors
        created.remove(r.HTTPS)
        created.remove(r.APP)
    assert tuple(item['case'] for item in results) == tuple(name for name, _ in selected_cases)
    assert before == real_state()
    report = {'status': 'passed', 'releaseProfile': release_profile, 'migrationContract': migration_contract, 'scenarioSelector': scenario_selector,
              'expectedCases': [name for name, _ in selected_cases], 'completedCases': [item['case'] for item in results],
              'clientPolicy': client_policy, 'approvedClientCount': len(selected_clients),
              'cases': results, 'realServiceLifecycle': True,
              'fixtureNetwork': 'loopback HTTP high ports; TLS covered by existing native product tests',
              'aggregateMemoryMax': 201326592, 'aggregateCpuPercent': 10, 'aggregateTasksMax': 32,
              'protectedUnitsUnchanged': True,
              'controllerSha256': hashlib.sha256((root / 'code/release-discovery-safe-20261017.py').read_bytes()).hexdigest()}
except BaseException as error:
    report = {'status': 'failed', 'errorType': type(error).__name__, 'error': str(error) if isinstance(error, (AssertionError, RuntimeError)) else '', 'cases': results}
finally:
    cleanup_errors = cleanup(created)
    report['cleanupErrors'] = cleanup_errors
    report['allOwnFixtureUnitsStoppedAndEmpty'] = not cleanup_errors
    r.atomic_write((json.dumps(report, indent=2) + '\n').encode(), root / 'report.json')
print(json.dumps({'status': report['status'], 'allOwnFixtureUnitsStoppedAndEmpty': not cleanup_errors}), flush=True)
sys.exit(0 if report['status'] == 'passed' and not cleanup_errors else 1)
