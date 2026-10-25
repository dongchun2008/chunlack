import hashlib
from contextlib import closing
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock


HERE = Path(__file__).resolve().parent
MODULE = HERE / 'i18n-release-gate.py'
LEGACY = HERE.parent / '2026-10-17' / 'test-release-discovery-safe-20261017.py'


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


class GateTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(MODULE.is_file(), 'missing independent i18n release gate')
        self.g = load(MODULE, 'i18n_gate_under_test')

    def fixture(self, root, fail=None):
        g = self.g
        legacy = load(LEGACY, 'i18n_legacy_fixture')

        class Fake(legacy.Fake):
            def check_candidate(self, mode):
                self.assert_listener(mode)
                assert all(self.active.values())
                assert (self.current / 'server.js').read_text() == 'new'

            def check_original(self):
                assert all(self.active.values())
                assert (self.current / 'server.js').read_text() == 'old'

        b = Fake(root, fail)
        b.release_profile = 'mcp-only'
        b.approved_agent_client_ids = ()
        b.migration_contract = None
        b.env = root / 'runtime.env'
        b.env.write_bytes(b'isolated environment fixture\n')
        for tree, content in ((b.current, 'old'), (b.staged, 'new')):
            (tree / 'version').unlink()
            for name in g.ALLOWED_FILES:
                path = tree / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content, encoding='utf-8')
            dependency = tree / 'node_modules' / 'synthetic' / 'index.js'
            dependency.parent.mkdir(parents=True)
            dependency.write_bytes(b'module.exports = 1;\n')
        value = {
            'agents': ['original'],
            'publicRuntime': {
                'nodeRestPublic': False,
                'agentOAuth': {
                    'enabled': True, 'discoveryOnly': False,
                    'issuer': 'https://pockid.chunclaw.top',
                    'resource': 'https://agents.chunclaw.top/mcp', 'clientIds': [],
                },
                'events': {'enabled': False},
            },
        }
        # Deliberately noncanonical: the new controller must not rewrite it.
        raw = b'  ' + json.dumps(value, separators=(',', ':')).encode() + b'\n\n'
        (b.data / 'config/lack.config.json').write_bytes(raw)
        b.new_config.write_bytes(raw)
        with closing(sqlite3.connect(b.data / 'db/identity.db')) as db, db:
            db.execute('CREATE TABLE agent_authority_grants(id TEXT PRIMARY KEY, status TEXT)')
            db.execute('CREATE TABLE agent_membership_epochs(id TEXT PRIMARY KEY, epoch INTEGER)')
        with closing(sqlite3.connect(b.data / 'db/collaboration.db')) as db, db:
            db.execute('CREATE TABLE tasks(id TEXT PRIMARY KEY)')
        b.caddy.write_bytes(g.OLD_ASSET_MATCH.encode() + b'\n' + g.OLD_HEADER.encode())
        b.final_caddy.write_bytes(g.expected_ingress(b.caddy.read_bytes()))
        b.local_caddy.write_bytes(b'loopback-caddy')
        manifests = {'previous': g.base.code_inventory(b.current), 'candidate': g.base.code_inventory(b.staged)}
        b.settings = {
            'payloadCommit': g.SOURCE_COMMIT, 'releaseProfile': 'mcp-only',
            'migrationContract': None, 'serviceAccountHandoff': 'systemd-v1',
            'approvedAgentClientIds': [], 'allowedChangedFiles': sorted(g.ALLOWED_FILES),
            'stageHashes': manifests['candidate'],
            'configHash': sha(raw), 'envHash': sha(b.env.read_bytes()),
            'caddyHash': sha(b.caddy.read_bytes()),
            'finalCaddyHash': sha(b.final_caddy.read_bytes()),
            'loopbackCaddyHash': sha(b.local_caddy.read_bytes()),
            'dependencyFingerprint': g.reference.dependency_fingerprint(b.current),
            'authorityFingerprint': g.reference.authority_fingerprint(b.data / 'db/identity.db'),
            'controllerFingerprint': g.controller_bindings(),
        }
        now = int(time.time() * 1000)
        proof = {
            'status': 'passed', 'databaseCount': 3, 'schemaPreserved': True,
            'networkIsolated': True, 'actualModelCalls': False,
            'rollbackBackup': False, 'applicationConsistentSnapshot': False,
            'serviceAccountHandoff': {'allBusinessNonRoot': True, 'identities': [
                {'uid': 996, 'gid': 987, 'noNewPrivileges': True},
                {'uid': 996, 'gid': 987, 'noNewPrivileges': True},
            ]},
            'boots': [{'runtime': runtime, 'cleanClose': True, 'privateNodeReadChecked': True,
                       'validForwardedNodeDenied': True} for runtime in ('candidate', 'previous')],
            'createdAtMs': now - 1000, 'expiresAtMs': now + 60000,
            'bindings': {
                'candidateSha256': g.reference.canonical_hash(manifests['candidate']),
                'previousSha256': g.reference.canonical_hash(manifests['previous']),
                'configSha256': b.settings['configHash'], 'payloadCommit': g.SOURCE_COMMIT,
                'dependencySha256': b.settings['dependencyFingerprint']['sha256'],
            },
            'i18nBindings': g.prepared_bindings(b.settings),
        }
        (root / 'expected-code.json').write_text(json.dumps(manifests))
        (root / 'schema-compatibility-report.json').write_text(json.dumps(proof))
        b.initial_config = raw
        return b

    def run_fixture(self, callback=None, fail=None):
        with tempfile.TemporaryDirectory(prefix='chunlack-i18n-gate-') as tmp:
            b = self.fixture(Path(tmp), fail)
            if callback:
                callback(b)
            return self.g.Transaction(b).execute()

    def test_preflight_is_readonly_and_binds_all_inputs(self):
        with tempfile.TemporaryDirectory() as tmp:
            b = self.fixture(Path(tmp))
            before = self.g.base.inventory(b.data)
            result = self.g.validate_prepared(b)
            self.assertEqual(result['changedFiles'], sorted(self.g.ALLOWED_FILES))
            self.assertEqual(self.g.base.inventory(b.data), before)
            self.assertFalse(b.backup.exists())

    def test_success_keeps_raw_configuration_credentials_and_cold_backup(self):
        with tempfile.TemporaryDirectory() as tmp:
            b = self.fixture(Path(tmp))
            env = b.env.read_bytes()
            result = self.g.Transaction(b).execute()
            self.assertEqual(result['status'], 'released', result)
            self.assertEqual((b.data / 'config/lack.config.json').read_bytes(), b.initial_config)
            self.assertEqual((b.backup / 'data/config/lack.config.json').read_bytes(), b.initial_config)
            self.assertEqual(b.env.read_bytes(), env)
            self.assertEqual((b.previous / 'server.js').read_text(), 'old')
            self.assertEqual((b.current / 'server.js').read_text(), 'new')
            self.assertFalse(result['liveDataRestoredFromBackup'])

    def test_each_checkpoint_recovers_without_overwriting_new_writes(self):
        for phase in ('https_stopped', 'application_stopped', 'consistent_backup_verified',
                      'old_code_preserved', 'candidate_code_installed',
                      'candidate_configuration_installed', 'loopback_https_acceptance_passed',
                      'public_discovery_acceptance_passed'):
            with self.subTest(phase=phase), tempfile.TemporaryDirectory() as tmp:
                b = self.fixture(Path(tmp), phase)
                result = self.g.Transaction(b).execute()
                self.assertEqual(result['status'], 'rolled_back', result)
                self.assertEqual((b.current / 'server.js').read_text(), 'old')
                self.assertTrue(all(b.active.values()))
                late = phase in ('loopback_https_acceptance_passed', 'public_discovery_acceptance_passed')
                self.assertEqual((b.data / 'new-upload').exists(), late)
                with closing(sqlite3.connect(b.data / 'db/test.db')) as db, db:
                    self.assertEqual(db.execute('SELECT value FROM evidence').fetchall(), [('new-write',)] if late else [])
                if late:
                    self.assertEqual(json.loads((b.data / 'config/lack.config.json').read_text())['agents'], ['user-changed-model'])
                else:
                    self.assertEqual((b.data / 'config/lack.config.json').read_bytes(), b.initial_config)

    def test_atomic_copy_interruption_before_or_after_replace_recovers(self):
        for after in (False, True):
            with self.subTest(after=after), tempfile.TemporaryDirectory() as tmp:
                b = self.fixture(Path(tmp))
                original = self.g.base.atomic_copy
                fired = [False]
                def interrupted(source, target, tick=lambda: None):
                    if Path(source) == b.local_caddy and not fired[0]:
                        fired[0] = True
                        if after:
                            original(source, target, tick)
                        raise OSError('simulated_copy_interruption')
                    return original(source, target, tick)
                with mock.patch.object(self.g.base, 'atomic_copy', side_effect=interrupted):
                    result = self.g.Transaction(b).execute()
                self.assertEqual(result['status'], 'rolled_back', result)
                self.assertEqual(b.caddy.read_bytes(), (b.backup / 'Caddyfile').read_bytes())

    def test_rename_completed_before_exception_recovers_by_inode(self):
        for which in ('current', 'staged'):
            with self.subTest(which=which), tempfile.TemporaryDirectory() as tmp:
                b = self.fixture(Path(tmp))
                original, fired = os.rename, [False]
                def interrupted(source, target):
                    original(source, target)
                    if Path(source) == getattr(b, which) and not fired[0]:
                        fired[0] = True
                        raise OSError('simulated_rename_interruption')
                with mock.patch.object(self.g.os, 'rename', side_effect=interrupted):
                    result = self.g.Transaction(b).execute()
                self.assertEqual(result['status'], 'rolled_back', result)
                self.assertEqual((b.current / 'server.js').read_text(), 'old')

    def test_failed_candidate_start_rolls_back_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            b = self.fixture(Path(tmp))
            original, calls = b.start, []
            def start(name, cap):
                calls.append(name)
                if name == self.g.base.APP and len(calls) == 1:
                    raise RuntimeError('simulated_start_failure')
                original(name, cap)
            b.start = start
            result = self.g.Transaction(b).execute()
            self.assertEqual(result['status'], 'rolled_back', result)
            self.assertEqual(calls.count(self.g.base.APP), 2)
            self.assertTrue(all(b.active.values()))

    def test_failed_recovery_is_not_success_or_retried(self):
        with tempfile.TemporaryDirectory() as tmp:
            b = self.fixture(Path(tmp), 'candidate_code_installed')
            calls = []
            def start(name, cap):
                calls.append(name)
                raise RuntimeError('simulated_recovery_failure')
            b.start = start
            result = self.g.Transaction(b).execute()
            self.assertEqual(result['status'], 'recovery_requires_attention', result)
            self.assertEqual(calls, [self.g.base.APP])
            self.assertEqual((b.data / 'config/lack.config.json').read_bytes(), b.initial_config)

    def test_config_changed_before_stop_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as tmp:
            b = self.fixture(Path(tmp))
            def checkpoint(phase):
                if phase == 'preflight_passed':
                    (b.data / 'config/lack.config.json').write_bytes(b'{"user":"new value"}\n')
            b.checkpoint = checkpoint
            result = self.g.Transaction(b).execute()
            self.assertEqual(result['status'], 'preflight_failed', result)
            self.assertTrue(all(b.active.values()))
            self.assertEqual((b.data / 'config/lack.config.json').read_bytes(), b'{"user":"new value"}\n')

    def test_unowned_ingress_change_is_not_overwritten_in_recovery(self):
        with tempfile.TemporaryDirectory() as tmp:
            b = self.fixture(Path(tmp))
            def checkpoint(phase):
                if phase == 'candidate_configuration_installed':
                    b.caddy.write_bytes(b'external ingress edit')
                    raise RuntimeError('interrupted_with_external_edit')
            b.checkpoint = checkpoint
            result = self.g.Transaction(b).execute()
            self.assertEqual(result['status'], 'recovery_requires_attention', result)
            self.assertEqual(b.caddy.read_bytes(), b'external ingress edit')

    def test_writer_lock_is_retained_without_override(self):
        with tempfile.TemporaryDirectory() as tmp:
            b = self.fixture(Path(tmp))
            lock = b.data / '.public-runtime.lock'
            lock.write_bytes(b'foreign lock')
            result = self.g.Transaction(b).execute()
            self.assertEqual(result['status'], 'recovery_requires_attention', result)
            self.assertEqual(lock.read_bytes(), b'foreign lock')

    def test_schema_drift_prevents_unsafe_recovery(self):
        with tempfile.TemporaryDirectory() as tmp:
            b = self.fixture(Path(tmp))
            def checkpoint(phase):
                if phase == 'candidate_configuration_installed':
                    with closing(sqlite3.connect(b.data / 'db/test.db')) as db, db:
                        db.execute('CREATE TABLE unapproved(value TEXT)')
                    raise RuntimeError('simulated_schema_change')
            b.checkpoint = checkpoint
            result = self.g.Transaction(b).execute()
            self.assertEqual(result['status'], 'recovery_requires_attention', result)
            with closing(sqlite3.connect(b.data / 'db/test.db')) as db, db:
                self.assertIsNotNone(db.execute("SELECT name FROM sqlite_master WHERE name='unapproved'").fetchone())

    def test_unexpected_code_or_deletion_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            b = self.fixture(Path(tmp))
            manifest = json.loads((b.root / 'expected-code.json').read_text())
            for changed in ('config/private.json', 'gateway/server.cjs', '../escape', 'node_modules/x'):
                with self.subTest(changed=changed):
                    copy = json.loads(json.dumps(manifest))
                    copy['candidate'][changed] = 'a' * 64
                    with self.assertRaises(RuntimeError):
                        self.g.validate_scope(copy, b.settings['allowedChangedFiles'])
            manifest['candidate'].pop('server.js')
            with self.assertRaises(RuntimeError):
                self.g.validate_scope(manifest, b.settings['allowedChangedFiles'])

    def test_dependency_authority_environment_and_raw_config_drift_rejected(self):
        for kind in ('dependency', 'authority', 'environment', 'configuration', 'candidate'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as tmp:
                b = self.fixture(Path(tmp))
                if kind == 'dependency':
                    (b.staged / 'node_modules/synthetic/index.js').write_bytes(b'changed')
                elif kind == 'authority':
                    with closing(sqlite3.connect(b.data / 'db/identity.db')) as db, db:
                        db.execute("INSERT INTO agent_authority_grants VALUES('new','active')")
                elif kind == 'environment':
                    b.env.write_bytes(b'external environment change')
                elif kind == 'configuration':
                    (b.data / 'config/lack.config.json').write_bytes(b.initial_config + b' ')
                else:
                    (b.staged / 'server.js').write_bytes(b'changed candidate')
                result = self.g.Transaction(b).execute()
                self.assertEqual(result['status'], 'preflight_failed', result)
                self.assertTrue(all(b.active.values()))

    def test_expired_proof_wrong_ingress_or_controller_binding_rejected(self):
        for kind in ('expired', 'ingress', 'controller'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as tmp:
                b = self.fixture(Path(tmp))
                path = b.root / 'schema-compatibility-report.json'
                proof = json.loads(path.read_text())
                if kind == 'expired':
                    proof['expiresAtMs'] = proof['createdAtMs']
                elif kind == 'ingress':
                    proof['i18nBindings']['finalCaddyHash'] = 'a' * 64
                else:
                    proof['i18nBindings']['controllerFingerprint'] = {}
                path.write_text(json.dumps(proof))
                self.assertEqual(self.g.Transaction(b).execute()['status'], 'preflight_failed')

    def test_ingress_permits_only_the_exact_asset_and_header_delta(self):
        old = self.g.OLD_ASSET_MATCH.encode() + b'\n' + self.g.OLD_HEADER.encode()
        new = self.g.expected_ingress(old)
        self.g.validate_ingress_transition(old, new)
        for changed in (new + b'\nextra route', new.replace(b'GET', b'POST'), new.replace(b'nosniff', b'off')):
            with self.subTest(changed=changed), self.assertRaises(RuntimeError):
                self.g.validate_ingress_transition(old, changed)
        with self.assertRaises(RuntimeError):
            self.g.expected_ingress(old + b'\n' + old)

    def test_deadline_and_signal_keep_original_window_limits(self):
        now = [10.0]
        w = self.g.base.Window(lambda: now[0])
        w.begin()
        now[0] = 65.001
        with self.assertRaises(RuntimeError):
            w.tick()
        w.recover()
        self.assertAlmostEqual(w.remaining(100), 64.999)
        now[0] = 130.0
        with self.assertRaises(RuntimeError):
            w.tick()
        with tempfile.TemporaryDirectory() as tmp:
            b = self.fixture(Path(tmp))
            b.checkpoint = lambda phase: setattr(b.w, 'interrupted', True) if phase == 'candidate_code_installed' else None
            self.assertEqual(self.g.Transaction(b).execute()['status'], 'rolled_back')

    def test_head_probe_uses_curl_head_instead_of_custom_method(self):
        b = self.g.Backend.__new__(self.g.Backend)
        b.w = self.g.base.Window()
        calls = []
        def command(args, cap):
            calls.append(args)
            return 'HTTP/2 200\r\nContent-Length: 20\r\n\r\n'
        b.command = command
        self.assertEqual(b.request('lack.chunclaw.top', '/identity/help/en.md', 'HEAD')[0], 200)
        self.assertIn('--head', calls[0])
        self.assertNotIn('-X', calls[0])

    def test_production_cli_is_disabled(self):
        result = subprocess.run([sys.executable, '-B', str(MODULE), '/var/lib/chunlack-release-0123456789ab'], capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 64)
        self.assertIn(b'local_candidate_only', result.stdout)


if __name__ == '__main__':
    unittest.main(verbosity=2)
