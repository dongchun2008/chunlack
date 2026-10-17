import importlib.util
import json
import os
from pathlib import Path
import socket
import sqlite3
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('release_safe', Path(__file__).with_name('release-discovery-safe-20261017.py'))
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)


def config(oauth=False):
    return {'agents': ['original'], 'publicRuntime': {'agentOAuth': {'enabled': oauth, 'discoveryOnly': oauth}}}


class Fake:
    def __init__(self, root, fail=None):
        self.root = root
        for name in ('current', 'previous', 'staged', 'failed_code', 'data', 'backup'):
            setattr(self, name, root / name)
        for name in ('caddy', 'new_config', 'local_caddy', 'final_caddy'):
            setattr(self, name, root / name)
        self.current.mkdir()
        (self.current / 'version').write_text('old')
        self.staged.mkdir()
        (self.staged / 'version').write_text('new')
        (self.data / 'config').mkdir(parents=True)
        (self.data / 'config' / 'lack.config.json').write_text(json.dumps(config()))
        (self.data / 'db').mkdir()
        db = sqlite3.connect(self.data / 'db/test.db')
        db.execute('CREATE TABLE evidence(value TEXT)')
        db.commit()
        db.close()
        self.caddy.write_text('old-caddy')
        self.new_config.write_text(json.dumps(config(True)))
        self.local_caddy.write_text('loopback-caddy')
        self.final_caddy.write_text('final-caddy')
        self.active = {r.APP: True, r.HTTPS: True}
        self.fail = fail
        self.failed = False
        self.result = None
        self.w = None
        self.listener_mode = 'public'
        self.original_inode = r.inode(self.current)
        self.staged_inode = r.inode(self.staged)

    def preflight(self):
        self.backup.mkdir()

    def checkpoint(self, phase):
        if self.fail == phase and not self.failed:
            self.failed = True
            if phase in ('loopback_https_acceptance_passed', 'public_discovery_acceptance_passed'):
                db = sqlite3.connect(self.data / 'db/test.db')
                db.execute("INSERT INTO evidence VALUES('new-write')")
                db.commit()
                db.close()
                path = self.data / 'config' / 'lack.config.json'
                value = json.loads(path.read_text())
                value['agents'] = ['user-changed-model']
                path.write_text(json.dumps(value))
                (self.data / 'new-upload').write_text('keep')
            raise RuntimeError('injected_' + phase)

    def stop(self, name, cap):
        self.w.remaining(cap)
        self.active[name] = False

    def start(self, name, cap):
        self.w.remaining(cap)
        self.active[name] = True
        if name == r.HTTPS:
            self.listener_mode = 'loopback' if self.caddy.read_text() == 'loopback-caddy' else 'public'

    def report(self, value):
        self.result = value

    def manifest(self, value):
        self.saved_manifest = value

    def set_live_modes(self):
        pass

    def check_candidate(self, mode):
        self.assert_listener(mode)
        assert all(self.active.values())
        assert (self.current / 'version').read_text() == 'new'

    def assert_listener(self, mode):
        assert self.listener_mode == mode

    def check_original(self):
        assert all(self.active.values())
        assert (self.current / 'version').read_text() == 'old'

    def check_protected(self):
        pass


class ReleaseTests(unittest.TestCase):
    def test_success_retains_verified_cold_backup(self):
        with tempfile.TemporaryDirectory(prefix='chunlack-safe-') as tmp:
            b = Fake(Path(tmp))
            result = r.Transaction(b).execute()
            self.assertEqual(result['status'], 'released', result)
            self.assertEqual((b.previous / 'version').read_text(), 'old')
            self.assertEqual(json.loads((b.backup / 'data/config/lack.config.json').read_text()), config())
            self.assertTrue(b.saved_manifest['applicationStopped'])

    def test_forward_install_keeps_configuration_changed_during_preflight(self):
        for fail in (None, 'candidate_configuration_installed'):
            with self.subTest(fail=fail), tempfile.TemporaryDirectory(prefix='chunlack-safe-') as tmp:
                b = Fake(Path(tmp), fail)
                original_checkpoint = b.checkpoint
                def change(phase):
                    if phase == 'preflight_passed':
                        path = b.data / 'config/lack.config.json'
                        value = json.loads(path.read_text())
                        value['agents'] = ['late-user-change']
                        path.write_text(json.dumps(value))
                    original_checkpoint(phase)
                b.checkpoint = change
                result = r.Transaction(b).execute()
                self.assertEqual(result['status'], 'rolled_back' if fail else 'released', result)
                value = json.loads((b.data / 'config/lack.config.json').read_text())
                self.assertEqual(value['agents'], ['late-user-change'])
                self.assertEqual(value['publicRuntime']['agentOAuth']['enabled'], not bool(fail))

    def test_all_checkpoints_restore_code_and_preserve_every_new_write(self):
        phases = ['https_stopped', 'application_stopped', 'consistent_backup_verified',
                  'old_code_preserved', 'candidate_code_installed', 'candidate_configuration_installed',
                  'loopback_https_acceptance_passed', 'public_discovery_acceptance_passed']
        for phase in phases:
            with self.subTest(phase=phase), tempfile.TemporaryDirectory(prefix='chunlack-safe-') as tmp:
                b = Fake(Path(tmp), phase)
                result = r.Transaction(b).execute()
                self.assertEqual(result['status'], 'rolled_back', result)
                self.assertEqual((b.current / 'version').read_text(), 'old')
                value = json.loads((b.data / 'config/lack.config.json').read_text())
                self.assertEqual(value['publicRuntime'], config()['publicRuntime'])
                written = phase in phases[-2:]
                self.assertEqual(value['agents'], ['user-changed-model'] if written else ['original'])
                self.assertEqual((b.data / 'new-upload').exists(), written)
                db = sqlite3.connect(b.data / 'db/test.db')
                try:
                    self.assertEqual(db.execute('SELECT value FROM evidence').fetchall(), [('new-write',)] if written else [])
                finally:
                    db.close()
                self.assertEqual(b.caddy.read_text(), 'old-caddy')
                self.assertTrue(all(b.active.values()))

    def test_recovery_uses_filesystem_state_when_rename_completed_before_exception(self):
        original = os.rename
        for which in ('current', 'staged'):
            with self.subTest(which=which), tempfile.TemporaryDirectory(prefix='chunlack-safe-') as tmp:
                b = Fake(Path(tmp))
                fired = False
                def injected(source, target):
                    nonlocal fired
                    original(source, target)
                    if Path(source) == getattr(b, which) and not fired:
                        fired = True
                        raise RuntimeError('interrupted_after_rename')
                with mock.patch.object(r.os, 'rename', side_effect=injected):
                    result = r.Transaction(b).execute()
                self.assertEqual(result['status'], 'rolled_back', result)
                self.assertEqual((b.current / 'version').read_text(), 'old')

    def test_atomic_copy_failure_cannot_poison_rollback_and_keeps_unowned_file(self):
        with tempfile.TemporaryDirectory(prefix='chunlack-safe-') as tmp:
            root = Path(tmp)
            source, target = root / 'source', root / 'target'
            source.write_text('new')
            target.write_text('old')
            unowned = root / 'target.release-new'
            unowned.write_text('do-not-delete')
            with mock.patch.object(r.os, 'fsync', side_effect=OSError('injected_write_failure')):
                with self.assertRaises(OSError):
                    r.atomic_copy(source, target)
            self.assertEqual(target.read_text(), 'old')
            self.assertEqual(sorted(p.name for p in root.iterdir()), ['source', 'target', 'target.release-new'])
            r.atomic_copy(source, target)
            self.assertEqual(target.read_text(), 'new')
            self.assertEqual(unowned.read_text(), 'do-not-delete')

    def test_global_deadline_reserves_recovery_and_bounds_each_operation(self):
        now = [100.0]
        w = r.Window(clock=lambda: now[0])
        w.begin()
        now[0] = 154
        self.assertEqual(w.remaining(20), 1)
        now[0] = 156
        with self.assertRaisesRegex(RuntimeError, 'forward_deadline'):
            w.remaining(20)
        w.recover()
        self.assertEqual(w.remaining(100), 64)
        now[0] = 220
        with self.assertRaisesRegex(RuntimeError, 'recovery_deadline'):
            w.remaining(1)

    def test_signal_request_is_observed_only_at_safe_boundary(self):
        with tempfile.TemporaryDirectory(prefix='chunlack-safe-') as tmp:
            b = Fake(Path(tmp))
            original_checkpoint = b.checkpoint
            def request(phase):
                original_checkpoint(phase)
                if phase == 'candidate_code_installed':
                    b.w.interrupted = True
            b.checkpoint = request
            result = r.Transaction(b).execute()
            self.assertEqual(result['status'], 'rolled_back', result)
            self.assertEqual((b.current / 'version').read_text(), 'old')

    def test_old_lock_is_preserved_and_unmodified_service_is_recovered(self):
        with tempfile.TemporaryDirectory(prefix='chunlack-safe-') as tmp:
            b = Fake(Path(tmp))
            lock = b.data / '.public-runtime.lock'
            lock.write_text('foreign-writer')
            result = r.Transaction(b).execute()
            self.assertEqual(result['status'], 'recovery_requires_attention')
            self.assertEqual(lock.read_text(), 'foreign-writer')
            self.assertEqual((b.current / 'version').read_text(), 'old')

    def test_preflight_failure_leaves_services_running(self):
        with tempfile.TemporaryDirectory(prefix='chunlack-safe-') as tmp:
            b = Fake(Path(tmp), 'preflight_passed')
            self.assertEqual(r.Transaction(b).execute()['status'], 'preflight_failed')
            self.assertTrue(all(b.active.values()))

    def test_failed_stop_does_not_prevent_recovery_attempt(self):
        with tempfile.TemporaryDirectory(prefix='chunlack-safe-') as tmp:
            b = Fake(Path(tmp))
            real_stop = b.stop
            once = [False]
            def stop(name, cap):
                real_stop(name, cap)
                if name == r.APP and not once[0]:
                    once[0] = True
                    raise RuntimeError('injected_stop_error')
            b.stop = stop
            result = r.Transaction(b).execute()
            self.assertEqual(result['status'], 'rolled_back', result)
            self.assertTrue(all(b.active.values()))

    def test_listeners_require_correct_process_and_binding(self):
        rows = r.parse_listeners('LISTEN 0 4096 127.0.0.1:443 0.0.0.0:* users:(("caddy",pid=42,fd=7))')
        r.validate_listeners(rows, 42, 'loopback')
        for pid, mode in ((43, 'loopback'), (42, 'public')):
            with self.assertRaises(RuntimeError):
                r.validate_listeners(rows, pid, mode)
        rows = r.parse_listeners('LISTEN 0 4096 *:443 *:* users:(("caddy",pid=42,fd=7))')
        r.validate_listeners(rows, 42, 'public')
        with self.assertRaises(RuntimeError):
            r.validate_listeners(rows, 42, 'loopback')

    def test_caddy_adapter_contract_preserves_tls_listener_and_protocol_limits(self):
        valid = {'admin': {'disabled': True}, 'apps': {'http': {'servers': {'srv0': {
            'listen': ['127.0.0.1:443'], 'automatic_https': {'disable_redirects': True}, 'protocols': ['h1', 'h2']}}}}}
        r.validate_caddy_document(valid, '127.0.0.1:443')
        for field, value in (('listen', [':443']), ('protocols', ['h1', 'h2', 'h3']), ('automatic_https', {})):
            changed = json.loads(json.dumps(valid))
            changed['apps']['http']['servers']['srv0'][field] = value
            with self.assertRaises(RuntimeError):
                r.validate_caddy_document(changed, '127.0.0.1:443')

    def test_historical_databases_are_preserved_without_becoming_runtime_databases(self):
        with tempfile.TemporaryDirectory(prefix='chunlack-safe-') as tmp:
            b = Fake(Path(tmp))
            archive = b.data / 'historical-backup/archive.db'
            archive.parent.mkdir()
            archive.write_bytes(b'opaque-historical-file')
            self.assertEqual(list(r.schemas(b.data)), ['db/test.db'])
            result = r.Transaction(b).execute()
            self.assertEqual(result['status'], 'released', result)
            self.assertEqual((b.backup / 'data/historical-backup/archive.db').read_bytes(), b'opaque-historical-file')

    @unittest.skipUnless(os.name == 'posix', 'requires Linux socket inspection')
    def test_real_linux_listener_boundaries(self):
        for host, mode in (('127.0.0.1', 'loopback'), ('0.0.0.0', 'public')):
            with socket.socket() as listener:
                listener.bind((host, 0))
                listener.listen(1)
                rows = r.inspect_listeners(listener.getsockname()[1])
                r.validate_listeners(rows, os.getpid(), mode)
                with self.assertRaises(RuntimeError):
                    r.validate_listeners(rows, os.getpid(), 'public' if mode == 'loopback' else 'loopback')

    @unittest.skipUnless(os.name == 'posix', 'requires POSIX symlink metadata')
    def test_symlink_mode_is_not_treated_as_target_write_permission(self):
        with tempfile.TemporaryDirectory(prefix='chunlack-safe-') as tmp:
            root = Path(tmp)
            target, link = root / 'tool', root / 'alias'
            target.write_text('code')
            target.chmod(0o640)
            link.symlink_to('tool')
            r.validate_staged_entry(root, link, os.getuid(), os.getgid(), {'alias': 'tool'})
            r.validate_staged_entry(root, target, os.getuid(), os.getgid(), {})
            target.chmod(0o660)
            with self.assertRaisesRegex(RuntimeError, 'staged_write_access'):
                r.validate_staged_entry(root, target, os.getuid(), os.getgid(), {})
            with self.assertRaisesRegex(RuntimeError, 'staged_link_changed'):
                r.validate_staged_entry(root, link, os.getuid(), os.getgid(), {'alias': 'elsewhere'})


if __name__ == '__main__':
    unittest.main(verbosity=2)
