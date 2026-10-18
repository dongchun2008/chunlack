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
        self.approved_agent_client_ids = ('isolated-rehearsal-client',) if release_profile == 'mcp-only' else ()
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
before = real_state()
results = []
cleanup_errors = []
try:
    for name, fail in (('success', None), ('rollback', 'loopback_https_acceptance_passed')):
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
    assert before == real_state()
    report = {'status': 'passed', 'releaseProfile': release_profile, 'cases': results, 'realServiceLifecycle': True,
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
