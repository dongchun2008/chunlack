"""Private operational controller: preserve live data, bounded forward/recovery work."""
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import sqlite3
import stat
import subprocess
import sys
import tempfile
import time

APP = 'chunlack-public.service'
HTTPS = 'chunlack-https.service'
PROTECTED = ('chunlack.service', 'tailscaled.service')


def require(value, code):
    if not value:
        raise RuntimeError(code)


class Window:
    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.started = None
        self.recovering = False
        self.interrupted = False

    def begin(self):
        require(self.started is None, 'window_already_started')
        self.started = self.clock()

    def recover(self):
        self.recovering = True

    def remaining(self, cap=20):
        if not self.recovering:
            require(not self.interrupted, 'controller_interrupted')
        if self.started is None:
            return cap
        left = self.started + (120 if self.recovering else 55) - self.clock()
        require(left > 0, 'recovery_deadline' if self.recovering else 'forward_deadline')
        return min(cap, left)

    def tick(self):
        self.remaining()

    def elapsed(self):
        return 0 if self.started is None else self.clock() - self.started


def inode(path):
    value = path.lstat()
    require(not stat.S_ISLNK(value.st_mode), 'linked_path_denied')
    return value.st_dev, value.st_ino


def digest(path, tick=lambda: None):
    value = hashlib.sha256()
    with open(path, 'rb') as stream:
        while True:
            tick()
            chunk = stream.read(262144)
            if not chunk:
                return value.hexdigest()
            value.update(chunk)


def atomic_write(data, target, tick=lambda: None):
    target = Path(target)
    prior = target.stat() if target.exists() else None
    require(not target.is_symlink(), 'atomic_target_link_denied')
    fd, name = tempfile.mkstemp(prefix='.' + target.name + '.release-', dir=target.parent)
    temporary = Path(name)
    try:
        with os.fdopen(fd, 'wb') as stream:
            for offset in range(0, len(data), 262144):
                tick()
                stream.write(data[offset:offset + 262144])
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, stat.S_IMODE(prior.st_mode) if prior else 0o600)
        if prior and hasattr(os, 'chown') and (temporary.stat().st_uid, temporary.stat().st_gid) != (prior.st_uid, prior.st_gid):
            os.chown(temporary, prior.st_uid, prior.st_gid)
        tick()
        os.replace(temporary, target)
    finally:
        if temporary.exists():
            temporary.unlink()


def atomic_copy(source, target, tick=lambda: None):
    require(Path(source).stat().st_size <= 4 * 1024 * 1024, 'atomic_file_size_limit')
    atomic_write(Path(source).read_bytes(), target, tick)


def inventory(root, tick=lambda: None):
    result, total = {}, 0
    for path in sorted(root.rglob('*')):
        tick()
        value = path.lstat()
        require(stat.S_ISDIR(value.st_mode) or stat.S_ISREG(value.st_mode), 'data_special_file_denied')
        if stat.S_ISREG(value.st_mode):
            total += value.st_size
            require(value.st_size <= 64 * 1024 * 1024 and total <= 64 * 1024 * 1024, 'cold_backup_size_limit')
            result[path.relative_to(root).as_posix()] = digest(path, tick)
            require(len(result) <= 1000, 'cold_backup_count_limit')
    return result


def private_copy_tree(source, target, tick):
    require(not target.exists(), 'backup_destination_exists')
    target.mkdir(mode=0o700)
    for path in sorted(source.rglob('*')):
        tick()
        require(not path.is_symlink(), 'backup_link_denied')
        dest = target / path.relative_to(source)
        if path.is_dir():
            dest.mkdir(mode=0o700)
        else:
            require(path.is_file(), 'backup_special_file_denied')
            with path.open('rb') as src, dest.open('xb') as dst:
                os.chmod(dest, 0o600)
                while True:
                    tick()
                    chunk = src.read(262144)
                    if not chunk:
                        break
                    dst.write(chunk)
                dst.flush()
                os.fsync(dst.fileno())


def schemas(root, tick=lambda: None, cold=True):
    result = {}
    database_root = root / 'db'
    require(database_root.is_dir() and not database_root.is_symlink(), 'runtime_database_directory_required')
    for path in sorted(database_root.rglob('*')):
        tick()
        if not path.is_file() or path.suffix not in ('.db', '.sqlite', '.sqlite3'):
            continue
        wal = Path(str(path) + '-wal')
        if cold:
            require(not wal.exists() or wal.stat().st_size == 0, 'cold_database_wal_not_empty')
        url = path.as_uri() + '?mode=ro' + ('&immutable=1' if cold else '')
        db = sqlite3.connect(url, uri=True, timeout=1)
        def progress():
            try:
                tick()
                return 0
            except RuntimeError:
                return 1
        db.set_progress_handler(progress, 1000)
        try:
            db.execute('PRAGMA query_only=ON')
            if cold:
                require(db.execute('PRAGMA quick_check').fetchall() == [('ok',)], 'database_integrity')
                require(not db.execute('PRAGMA foreign_key_check').fetchall(), 'database_foreign_keys')
            rows = db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").fetchall()
            result[path.relative_to(root).as_posix()] = hashlib.sha256(json.dumps(rows).encode()).hexdigest()
        finally:
            db.close()
    require(bool(result), 'database_inventory_empty')
    return result


def revert_owned_config(original, current):
    result = json.loads(json.dumps(current))
    previous = original.get('publicRuntime', {})
    if 'agentOAuth' in previous:
        result.setdefault('publicRuntime', {})['agentOAuth'] = previous['agentOAuth']
    else:
        result.setdefault('publicRuntime', {}).pop('agentOAuth', None)
    return result


def apply_owned_config(prepared, current):
    result = json.loads(json.dumps(current))
    result.setdefault('publicRuntime', {})['agentOAuth'] = prepared['publicRuntime']['agentOAuth']
    return result


def parse_listeners(output):
    result = []
    for line in output.splitlines():
        values = line.split()
        require(len(values) >= 5, 'listener_output_invalid')
        address = values[3].rsplit(':', 1)[0].strip('[]')
        result.append((address, {int(pid) for pid in re.findall(r'pid=(\d+)', line)}))
    return result


def validate_listeners(rows, pid, mode):
    require(mode in ('loopback', 'public') and rows and pid > 0, 'listener_missing')
    require(all(owners == {pid} for _, owners in rows), 'listener_process_mismatch')
    addresses = {address for address, _ in rows}
    if mode == 'loopback':
        require(addresses == {'127.0.0.1'}, 'listener_not_loopback_only')
    else:
        require(addresses <= {'*', '0.0.0.0', '::'} and bool(addresses), 'listener_not_public')


def inspect_listeners(port=443):
    require(isinstance(port, int) and 1 <= port <= 65535, 'invalid_listener_port')
    output = subprocess.run(['ss', '-ltnpH', 'sport', '=', ':' + str(port)], capture_output=True, timeout=2, check=True).stdout.decode()
    return parse_listeners(output)


def validate_staged_entry(base, path, uid, gid, links):
    value = path.lstat()
    require(value.st_uid == uid and value.st_gid == gid, 'staged_ownership')
    if path.is_symlink():
        name = path.relative_to(base).as_posix()
        require(name in links and os.readlink(path) == links[name] and path.resolve().is_relative_to(base), 'staged_link_changed')
    else:
        require(not value.st_mode & 0o022, 'staged_write_access')
        require(value.st_mode & stat.S_IRGRP and (not path.is_dir() or value.st_mode & stat.S_IXGRP), 'staged_service_read_access')


def validate_caddy_document(value, expected):
    require(value.get('admin', {}).get('disabled') is True, 'caddy_admin_not_disabled')
    servers = value['apps']['http']['servers']
    require(bool(servers), 'caddy_servers_missing')
    for server in servers.values():
        require(server['listen'] == [expected] and server.get('automatic_https', {}).get('disable_redirects') is True, 'caddy_listening_contract')
        require(set(server.get('protocols', [])) <= {'h1', 'h2'} and server.get('protocols'), 'caddy_protocol_contract')


class Transaction:
    def __init__(self, backend, window=None):
        self.b = backend
        self.w = window or Window()
        backend.w = self.w
        self.records = []
        self.backed_up = False
        self.schema_before = None

    def record(self, phase):
        self.records.append({'phase': phase, 'seconds': round(self.w.elapsed(), 3)})
        self.b.report({'status': 'running', 'records': self.records})
        self.b.checkpoint(phase)
        self.w.tick()

    def backup(self):
        b = self.b
        require(not (b.data / '.public-runtime.lock').exists(), 'writer_lock_remains')
        self.schema_before = schemas(b.data, self.w.tick)
        before = inventory(b.data, self.w.tick)
        private_copy_tree(b.data, b.backup / 'data', self.w.tick)
        require(before == inventory(b.data, self.w.tick) == inventory(b.backup / 'data', self.w.tick), 'backup_content_mismatch')
        require(self.schema_before == schemas(b.backup / 'data', self.w.tick), 'backup_schema_mismatch')
        atomic_copy(b.caddy, b.backup / 'Caddyfile', self.w.tick)
        b.manifest({'files': before, 'schemas': self.schema_before, 'applicationStopped': True})
        self.backed_up = True

    def execute(self):
        b = self.b
        try:
            b.preflight()
            self.record('preflight_passed')
            self.w.begin()
            b.stop(HTTPS, 6)
            self.record('https_stopped')
            b.stop(APP, 20)
            self.record('application_stopped')
            self.backup()
            self.record('consistent_backup_verified')
            os.rename(b.current, b.previous)
            self.record('old_code_preserved')
            os.rename(b.staged, b.current)
            self.record('candidate_code_installed')
            config_path = b.data / 'config/lack.config.json'
            updated = apply_owned_config(json.loads(b.new_config.read_text()), json.loads(config_path.read_text()))
            atomic_write((json.dumps(updated, indent=2) + '\n').encode(), config_path, self.w.tick)
            atomic_copy(b.local_caddy, b.caddy, self.w.tick)
            b.set_live_modes()
            self.record('candidate_configuration_installed')
            b.start(APP, 16)
            b.start(HTTPS, 10)
            b.check_candidate('loopback')
            require(schemas(b.data, self.w.tick, cold=False) == self.schema_before, 'candidate_schema_changed')
            self.record('loopback_https_acceptance_passed')
            b.stop(HTTPS, 6)
            atomic_copy(b.final_caddy, b.caddy, self.w.tick)
            b.set_live_modes()
            b.start(HTTPS, 10)
            b.check_candidate('public')
            b.check_protected()
            self.record('public_discovery_acceptance_passed')
            result = {'status': 'released', 'records': self.records, 'outageSeconds': round(self.w.elapsed(), 3),
                      'agentBusinessAccess': False, 'credentialsChanged': False,
                      'liveDataRestoredFromBackup': False}
        except BaseException as error:
            code = str(error) if isinstance(error, RuntimeError) else type(error).__name__
            try:
                if self.w.started is not None:
                    self.w.recover()
                    self.rollback()
                result = {'status': 'rolled_back' if self.w.started is not None else 'preflight_failed',
                          'error': code, 'records': self.records, 'elapsedSeconds': round(self.w.elapsed(), 3)}
            except BaseException as recovery:
                result = {'status': 'recovery_requires_attention', 'error': code,
                          'recoveryError': str(recovery) if isinstance(recovery, RuntimeError) else type(recovery).__name__,
                          'records': self.records, 'elapsedSeconds': round(self.w.elapsed(), 3)}
        try:
            b.report(result)
        except BaseException:
            print(json.dumps({'status': result['status'], 'reportWriteFailed': True}), flush=True)
        return result

    def rollback(self):
        b = self.b
        b.stop(HTTPS, 6)
        b.stop(APP, 20)
        require(not (b.data / '.public-runtime.lock').exists(), 'rollback_writer_lock_remains_no_override')
        if self.backed_up:
            require(schemas(b.data, self.w.tick) == self.schema_before, 'rollback_schema_incompatible')
        if b.previous.exists():
            require(inode(b.previous) == b.original_inode, 'original_code_identity_changed')
            if b.current.exists():
                require(inode(b.current) == b.staged_inode, 'candidate_code_identity_changed')
                os.rename(b.current, b.failed_code)
            os.rename(b.previous, b.current)
        require(inode(b.current) == b.original_inode, 'original_code_not_recovered')
        if self.backed_up:
            original = json.loads((b.backup / 'data/config/lack.config.json').read_text())
            path = b.data / 'config/lack.config.json'
            updated = revert_owned_config(original, json.loads(path.read_text()))
            atomic_write((json.dumps(updated, indent=2) + '\n').encode(), path, self.w.tick)
            atomic_copy(b.backup / 'Caddyfile', b.caddy, self.w.tick)
            b.set_live_modes()
        b.start(APP, 18)
        b.start(HTTPS, 12)
        b.check_original()
        b.assert_listener('public')
        b.check_protected()


class LinuxBackend:
    def __init__(self, root):
        self.root = Path(root).resolve(strict=True)
        self.settings = json.loads((self.root / 'settings.json').read_text())
        self.tag = self.settings['tag']
        require(re.fullmatch('[0-9a-f]{12}', self.tag) and self.root == Path('/var/lib/chunlack-release-' + self.tag), 'invalid_release_root')
        self.current = Path('/opt/chunlack-public/current')
        self.previous = self.current.parent / ('previous-' + self.tag)
        self.staged = self.current.parent / ('staged-' + self.tag) / 'current'
        self.failed_code = self.current.parent / ('failed-' + self.tag)
        self.data = Path('/var/lib/chunlack-public')
        self.backup = Path('/var/backups/chunlack-release-' + self.tag)
        self.caddy = Path('/etc/chunlack-public/Caddyfile')
        self.env = Path('/etc/chunlack-public/runtime.env')
        self.new_config = self.root / 'candidate-config.json'
        self.local_caddy = self.root / 'Caddyfile.loopback'
        self.final_caddy = self.root / 'Caddyfile.final'
        self.w = None

    def command(self, args, cap=3):
        timeout = self.w.remaining(cap)
        result = subprocess.run(args, capture_output=True, timeout=timeout)
        require(result.returncode == 0, 'command_failed_' + Path(args[0]).name)
        require(len(result.stdout) <= 512 * 1024, 'output_limit')
        self.w.tick()
        return result.stdout.decode()

    def unit(self, name):
        output = self.command(['systemctl', 'show', name, '-p', 'MainPID', '-p', 'ActiveState', '-p', 'NRestarts', '-p', 'ControlGroup', '-p', 'Result'])
        return dict(line.split('=', 1) for line in output.splitlines() if '=' in line)

    def protected(self):
        return {name: self.unit(name) for name in PROTECTED}

    def check_protected(self):
        require(self.protected() == self.baseline, 'protected_service_changed')
        require(digest(self.env, self.w.tick) == self.settings['envHash'], 'credentials_changed')

    def check_identity_and_permissions(self):
        import grp
        import pwd
        self.app_uid = pwd.getpwnam('chunlack-public').pw_uid
        self.app_gid = grp.getgrnam('chunlack-public').gr_gid
        self.https_gid = grp.getgrnam('chunlack-https').gr_gid
        for name, user in ((APP, 'chunlack-public'), (HTTPS, 'chunlack-https')):
            require(self.command(['systemctl', 'show', name, '-p', 'User', '--value']).strip() == user, 'unit_user_mismatch')
            require(self.command(['systemctl', 'show', name, '-p', 'Group', '--value']).strip() == user, 'unit_group_mismatch')
        for path, uid, gid, mode in ((self.data, self.app_uid, self.app_gid, 0o700),
                                    (self.data / 'config/lack.config.json', self.app_uid, self.app_gid, 0o600),
                                    (self.caddy, 0, self.https_gid, 0o640), (self.env, 0, 0, 0o600)):
            value = path.lstat()
            require((value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode)) == (uid, gid, mode), 'live_permission_mismatch')
        for path in [self.staged, *self.staged.rglob('*')]:
            self.w.tick()
            validate_staged_entry(self.staged, path, 0, self.app_gid, self.settings['stageLinks'])
        self.command(['runuser', '-u', 'chunlack-public', '--', '/opt/chunlack-public/runtime/node/bin/node', '-e',
                      "require(process.argv[1]);console.log('readable')", str(self.staged / 'gateway/public-runtime.cjs')], cap=15)

    def validate_ingress(self):
        binary = '/opt/chunlack-public/runtime/caddy/caddy'
        for path, expected in ((self.local_caddy, '127.0.0.1:443'), (self.final_caddy, ':443')):
            value = json.loads(self.command([binary, 'adapt', '--config', str(path), '--adapter', 'caddyfile'], cap=10))
            validate_caddy_document(value, expected)

    def preflight(self):
        require(os.geteuid() == 0, 'root_controller_required')
        import fcntl
        fd = os.open('/run/lock/chunlack-public-release.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        self.lock = os.fdopen(fd, 'a')
        metadata = os.fstat(fd)
        require(stat.S_ISREG(metadata.st_mode) and metadata.st_uid == 0 and metadata.st_nlink == 1 and stat.S_IMODE(metadata.st_mode) == 0o600, 'release_lock_metadata_invalid')
        fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        for path in (self.current, self.staged, self.data, self.caddy, self.env, self.root):
            inode(path)
        for path in (self.previous, self.failed_code, self.backup):
            require(not path.exists(), 'release_destination_occupied')
        for name, path in (('configHash', self.data / 'config/lack.config.json'), ('envHash', self.env), ('caddyHash', self.caddy)):
            require(digest(path) == self.settings[name], 'release_input_drift_' + name)
        for relative, expected in self.settings['preparedHashes'].items():
            require(digest(self.root / relative) == expected, 'prepared_input_drift')
        for relative, expected in self.settings['stageHashes'].items():
            require(digest(self.staged / relative) == expected, 'staged_code_drift')
        self.original_inode, self.staged_inode = inode(self.current), inode(self.staged)
        self.check_identity_and_permissions()
        self.validate_ingress()
        self.baseline = self.protected()
        require(all(row['ActiveState'] == 'active' and int(row['MainPID']) > 0 for row in self.baseline.values()), 'protected_service_not_active')
        require(all(self.unit(unit)['ActiveState'] == 'active' for unit in (APP, HTTPS)), 'target_service_not_active')
        self.assert_listener('public')
        values = dict(line.split(':', 1) for line in Path('/proc/meminfo').read_text().splitlines())
        require(int(values['MemAvailable'].split()[0]) >= 384 * 1024, 'insufficient_memory')
        import shutil
        require(shutil.disk_usage('/var/lib').free >= 1024 ** 3, 'insufficient_disk')
        inventory(self.data)
        self.check_original()
        self.backup.mkdir(mode=0o700)

    def report(self, value):
        atomic_write((json.dumps(value, indent=2) + '\n').encode(), self.root / 'result.json')

    def manifest(self, value):
        atomic_write((json.dumps(value, indent=2) + '\n').encode(), self.backup / 'manifest.json', self.w.tick)

    def checkpoint(self, phase):
        pass

    def set_live_modes(self):
        for path, uid, gid, mode in ((self.data / 'config/lack.config.json', self.app_uid, self.app_gid, 0o600),
                                    (self.caddy, 0, self.https_gid, 0o640)):
            value = path.stat()
            require((value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode)) == (uid, gid, mode), 'installed_permission_mismatch')

    def stop(self, name, cap):
        require(name in (APP, HTTPS), 'stop_target_denied')
        end = time.monotonic() + self.w.remaining(cap)
        self.command(['systemctl', 'stop', '--no-block', name])
        while time.monotonic() < end:
            self.w.tick()
            value = self.unit(name)
            group = value.get('ControlGroup', '')
            require(not group or group == '/system.slice/' + name, 'unexpected_service_cgroup')
            procs = Path('/sys/fs/cgroup' + group) / 'cgroup.procs' if group else None
            if value['MainPID'] == '0' and value['ActiveState'] in ('inactive', 'failed') and (not procs or not procs.exists() or not procs.read_text().strip()):
                return
            time.sleep(min(.15, self.w.remaining(.15)))
        raise RuntimeError('stop_timeout_' + name)

    def request(self, host, path, method='GET'):
        timeout = self.w.remaining(2)
        output = self.command(['curl', '--noproxy', '*', '--silent', '--show-error', '--max-time', str(timeout),
                               '--connect-timeout', str(min(1, timeout)), '--resolve', host + ':443:127.0.0.1',
                               '-D', '-', '-X', method, '-H', 'Authorization: Bearer discovery-denial-probe', 'https://' + host + path], cap=3)
        head, _, body = output.partition('\r\n\r\n')
        if not body and '\n\n' in output:
            head, _, body = output.partition('\n\n')
        return int(head.splitlines()[0].split()[1]), head.lower(), body

    def assert_listener(self, mode):
        pid = int(self.unit(HTTPS)['MainPID'])
        output = self.command(['ss', '-ltnpH', 'sport', '=', ':443'])
        validate_listeners(parse_listeners(output), pid, mode)

    def start(self, name, cap):
        require(name in (APP, HTTPS), 'start_target_denied')
        end = time.monotonic() + self.w.remaining(cap)
        self.command(['systemctl', 'start', '--no-block', name])
        while time.monotonic() < end:
            self.w.tick()
            value = self.unit(name)
            require(value['ActiveState'] != 'failed', 'start_failed_' + name)
            if value['ActiveState'] == 'active':
                try:
                    if name == APP:
                        self.command(['curl', '--noproxy', '*', '--silent', '--fail', '--max-time', str(self.w.remaining(1)), 'http://127.0.0.1:13721/health'], cap=2)
                    else:
                        require(self.request('lack.chunclaw.top', '/health')[0] == 200, 'https_not_ready')
                    return
                except (RuntimeError, subprocess.TimeoutExpired):
                    self.w.tick()
            time.sleep(min(.15, self.w.remaining(.15)))
        raise RuntimeError('start_timeout_' + name)

    def check_original(self):
        require(self.request('lack.chunclaw.top', '/health')[0] == 200, 'original_https_unhealthy')
        self.command(['curl', '--noproxy', '*', '--silent', '--fail', '--max-time', str(self.w.remaining(2)), 'http://127.0.0.1:3721/health'])

    def check_candidate(self, mode):
        self.assert_listener(mode)
        require(self.request('lack.chunclaw.top', '/health')[0] == 200, 'candidate_https_unhealthy')
        for path in ('/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'):
            status, _, body = self.request('agents.chunclaw.top', path)
            metadata = json.loads(body)
            require(status == 200 and metadata.get('resource') == 'https://agents.chunclaw.top/mcp' and metadata.get('authorization_servers') == ['https://pockid.chunclaw.top'], 'discovery_identity')
        for method in ('GET', 'POST'):
            status, head, _ = self.request('agents.chunclaw.top', '/mcp', method)
            require(status == 401 and 'resource_metadata=' in head, 'mcp_not_denied')
            for path in ('/v1', '/v1/manifest', '/v1/pair/complete', '/v1/events', '/v1/tasks/claim', '/v1/future-route'):
                require(self.request('agents.chunclaw.top', path, method)[0] == 404, 'rest_not_denied')
        self.check_protected()


if __name__ == '__main__':
    backend = LinuxBackend(sys.argv[1])
    transaction = Transaction(backend)
    signal.signal(signal.SIGTERM, lambda signum, frame: setattr(transaction.w, 'interrupted', True))
    signal.signal(signal.SIGINT, lambda signum, frame: setattr(transaction.w, 'interrupted', True))
    result = transaction.execute()
    print(json.dumps({'status': result['status']}), flush=True)
    sys.exit(0 if result['status'] == 'released' else 1)
