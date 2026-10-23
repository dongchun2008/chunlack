"""No network, production data or credentials are used by these regressions."""
import copy
import importlib.util
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import time
import types
import unittest
from unittest import mock


spec = importlib.util.spec_from_file_location('code_gate', Path(__file__).with_name('readonly-code-preflight.py'))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class CodeOnlyPreflightTests(unittest.TestCase):
    def setUp(self):
        self.manifests = {
            'candidate': dict(zip(gate.ALLOWED_FILES, ('a' * 64, 'b' * 64, 'c' * 64))),
            'previous': {'server.js': 'd' * 64, 'identity/workspace-shell.js': 'e' * 64},
        }
        self.config = {'publicRuntime': {
            'nodeRestPublic': False, 'events': {'enabled': False},
            'agentOAuth': {'enabled': True, 'discoveryOnly': False, 'clientIds': ['existing-client'],
                           'browserClientId': 'human-client', 'issuer': 'https://pockid.chunclaw.top',
                           'resource': 'https://agents.chunclaw.top/mcp'},
        }, 'agents': [{'name': 'existing-agent'}]}
        self.settings = {'releaseProfile': 'mcp-only', 'migrationContract': None,
                         'serviceAccountHandoff': 'systemd-v1', 'allowedChangedFiles': list(gate.ALLOWED_FILES),
                         'approvedAgentClientIds': ['existing-client'], 'payloadCommit': 'f' * 40,
                         'configHash': '0' * 64, 'dependencyFingerprint': {'sha256': '1' * 64}}
        self.proof = {
            'status': 'passed', 'databaseCount': 3, 'schemaPreserved': True,
            'networkIsolated': True, 'actualModelCalls': False, 'rollbackBackup': False,
            'applicationConsistentSnapshot': False,
            'serviceAccountHandoff': {'allBusinessNonRoot': True, 'identities': [
                {'uid': 996, 'gid': 987, 'noNewPrivileges': True},
                {'uid': 996, 'gid': 987, 'noNewPrivileges': True},
            ]},
            'boots': [{'runtime': name, 'cleanClose': True, 'privateNodeReadChecked': True,
                       'validForwardedNodeDenied': True} for name in ('candidate', 'previous')],
            'createdAtMs': 1000, 'expiresAtMs': 2000,
            'bindings': {'candidateSha256': gate.canonical_hash(self.manifests['candidate']),
                         'previousSha256': gate.canonical_hash(self.manifests['previous']),
                         'configSha256': self.settings['configHash'], 'payloadCommit': self.settings['payloadCommit'],
                         'dependencySha256': self.settings['dependencyFingerprint']['sha256']},
        }

    def test_exact_three_file_scope_accepts_new_search_module(self):
        original = copy.deepcopy(self.manifests)
        self.assertEqual(gate.validate_manifest_scope(self.manifests), list(gate.ALLOWED_FILES))
        self.assertEqual(self.manifests, original)

    def test_extra_product_file_and_deletion_are_rejected(self):
        for name in ('identity/passwords.cjs', 'integrations/mcp/pilot-server.cjs'):
            with self.subTest(name=name):
                value = copy.deepcopy(self.manifests)
                value['candidate'][name] = 'a' * 64
                with self.assertRaisesRegex(ValueError, 'research_code_scope_changed'):
                    gate.validate_manifest_scope(value)
        value = copy.deepcopy(self.manifests)
        del value['candidate']['server.js']
        with self.assertRaises(ValueError):
            gate.validate_manifest_scope(value)

    def test_missing_change_and_unchanged_payload_are_rejected(self):
        value = copy.deepcopy(self.manifests)
        value['candidate']['server.js'] = value['previous']['server.js']
        with self.assertRaises(ValueError):
            gate.validate_manifest_scope(value)

    def test_manifest_paths_and_digests_fail_closed(self):
        for name in ('/tmp/code', '../code', 'a/../b', 'a//b', 'C:/code', 'a\\b', 'a\x00b', 'node_modules/test'):
            with self.subTest(name=name):
                value = copy.deepcopy(self.manifests)
                value['candidate'][name] = 'a' * 64
                with self.assertRaises(ValueError):
                    gate.validate_manifest_scope(value)
        for digest in ('A' * 64, 'x', 1, None):
            value = copy.deepcopy(self.manifests)
            value['candidate']['server.js'] = digest
            with self.assertRaises(ValueError):
                gate.validate_manifest_scope(value)

    def test_existing_and_empty_client_lists_are_preserved_without_mutation(self):
        for clients in ([], ['existing-client']):
            config, settings = copy.deepcopy(self.config), copy.deepcopy(self.settings)
            config['publicRuntime']['agentOAuth']['clientIds'] = clients
            settings['approvedAgentClientIds'] = list(clients)
            before = copy.deepcopy((config, settings))
            self.assertEqual(gate.validate_configuration(copy.deepcopy(config), config, settings), len(clients))
            self.assertEqual((config, settings), before)

    def test_any_candidate_configuration_change_is_rejected(self):
        for field in ('agents', 'extra'):
            candidate = copy.deepcopy(self.config)
            candidate[field] = ['changed']
            with self.assertRaisesRegex(ValueError, 'configuration_must_remain_identical'):
                gate.validate_configuration(candidate, self.config, self.settings)

    def test_boundary_allowlist_and_migration_changes_are_rejected(self):
        for field, value in (('nodeRestPublic', True), ('nodeRestPublic', 0)):
            config = copy.deepcopy(self.config)
            config['publicRuntime'][field] = value
            with self.assertRaises(ValueError):
                gate.validate_configuration(config, config, self.settings)
        for field, value in (('enabled', False), ('discoveryOnly', True), ('issuer', 'https://other.test'),
                             ('clientIds', ['other-client']), ('clientIds', ['human-client']),
                             ('clientIds', ['existing-client', 'existing-client'])):
            config = copy.deepcopy(self.config)
            config['publicRuntime']['agentOAuth'][field] = value
            with self.assertRaises(ValueError):
                gate.validate_configuration(config, config, self.settings)
        for value in (True, 0, 1, 0.0, 1.0, -0.0, 'false', []):
            config = copy.deepcopy(self.config)
            config['publicRuntime']['events']['enabled'] = value
            with self.assertRaises(ValueError):
                gate.validate_configuration(config, config, self.settings)
        for field, value in (('migrationContract', 'agent-authority-v1'), ('serviceAccountHandoff', None),
                             ('releaseProfile', 'discovery-only'), ('allowedChangedFiles', ['server.js'])):
            settings = {**self.settings, field: value}
            with self.assertRaises(ValueError):
                gate.validate_configuration(self.config, self.config, settings)

    def test_bound_fresh_two_boot_proof_accepts_without_mutation(self):
        before = copy.deepcopy(self.proof)
        self.assertTrue(gate.validate_copy_proof(self.proof, self.settings, self.manifests, 1500))
        self.assertEqual(before, self.proof)

    def test_proof_freshness_and_every_binding_are_required(self):
        for moment in (999, 2001, True):
            with self.assertRaises(ValueError):
                gate.validate_copy_proof(self.proof, self.settings, self.manifests, moment)
        proof = copy.deepcopy(self.proof)
        proof['expiresAtMs'] = 3601001
        with self.assertRaises(ValueError):
            gate.validate_copy_proof(proof, self.settings, self.manifests, 1500)
        for field in self.proof['bindings']:
            proof = copy.deepcopy(self.proof)
            proof['bindings'][field] = 'changed'
            with self.assertRaisesRegex(ValueError, 'copy_proof_binding_changed'):
                gate.validate_copy_proof(proof, self.settings, self.manifests, 1500)

    def test_copy_proof_does_not_accept_root_skips_or_fake_backup(self):
        for field, value in (('status', 'failed'), ('databaseCount', 2), ('schemaPreserved', False),
                             ('networkIsolated', False), ('actualModelCalls', True), ('rollbackBackup', True),
                             ('applicationConsistentSnapshot', True)):
            proof = copy.deepcopy(self.proof)
            proof[field] = value
            with self.assertRaises(ValueError):
                gate.validate_copy_proof(proof, self.settings, self.manifests, 1500)
        for field, value in (('uid', 0), ('gid', 0), ('noNewPrivileges', False)):
            proof = copy.deepcopy(self.proof)
            proof['serviceAccountHandoff']['identities'][0][field] = value
            with self.assertRaises(ValueError):
                gate.validate_copy_proof(proof, self.settings, self.manifests, 1500)
        for field in ('cleanClose', 'privateNodeReadChecked', 'validForwardedNodeDenied'):
            proof = copy.deepcopy(self.proof)
            proof['boots'][0][field] = False
            with self.assertRaises(ValueError):
                gate.validate_copy_proof(proof, self.settings, self.manifests, 1500)
        proof = copy.deepcopy(self.proof)
        proof['boots'].reverse()
        with self.assertRaises(ValueError):
            gate.validate_copy_proof(proof, self.settings, self.manifests, 1500)

    def test_readonly_authority_fingerprint_includes_rows_without_changing_database(self):
        with tempfile.TemporaryDirectory(prefix='chunlack-code-gate-') as folder:
            path = Path(folder) / 'identity.db'
            database = sqlite3.connect(path)
            database.execute('CREATE TABLE agent_authority_grants(id TEXT, value BLOB)')
            database.execute('INSERT INTO agent_authority_grants VALUES(?, ?)', ('synthetic', b'test'))
            database.commit()
            database.close()
            before = path.read_bytes()
            first = gate.authority_fingerprint(path)
            self.assertEqual(first, gate.authority_fingerprint(path))
            self.assertEqual(path.read_bytes(), before)
            self.assertEqual(first['agent_authority_grants']['rows'], 1)
            database = sqlite3.connect(path)
            database.execute('UPDATE agent_authority_grants SET id=?', ('modified',))
            database.commit()
            database.close()
            self.assertNotEqual(first, gate.authority_fingerprint(path))

    def test_dependency_content_and_nested_node_modules_are_fingerprinted(self):
        with tempfile.TemporaryDirectory(prefix='chunlack-dependency-gate-') as folder:
            roots = [Path(folder) / name for name in ('current', 'candidate')]
            for root in roots:
                (root / 'node_modules/example').mkdir(parents=True)
                (root / 'node_modules/example/index.js').write_bytes(b'unchanged')
                (root / 'gateway/node_modules/other').mkdir(parents=True)
                (root / 'gateway/node_modules/other/index.js').write_bytes(b'nested')
            baseline = gate.dependency_fingerprint(roots[0])
            self.assertEqual(baseline, gate.dependency_fingerprint(roots[1]))
            (roots[1] / 'gateway/node_modules/other/index.js').write_bytes(b'tampered')
            self.assertNotEqual(baseline, gate.dependency_fingerprint(roots[1]))
            (roots[1] / 'gateway/node_modules/other/index.js').write_bytes(b'nested')
            (roots[1] / 'node_modules/example/index.js').unlink()
            self.assertNotEqual(baseline, gate.dependency_fingerprint(roots[1]))

    def test_config_byte_preservation_rejects_compact_unicode_and_changed_whitespace(self):
        config = {**self.config, 'title': '\u82cf\u5a73'}
        stable = (json.dumps(config, indent=2) + '\n').encode()
        self.assertTrue(gate.validate_config_bytes(config, stable))
        for raw in (json.dumps(config).encode(),
                    (json.dumps(config, indent=2, ensure_ascii=False) + '\n').encode(),
                    stable.rstrip(b'\n'), stable + b' '):
            with self.assertRaisesRegex(ValueError, 'publisher_would_change_configuration_bytes'):
                gate.validate_config_bytes(config, raw)

    def test_authority_schema_column_index_and_trigger_changes_are_fingerprinted(self):
        with tempfile.TemporaryDirectory(prefix='chunlack-authority-schema-') as folder:
            path = Path(folder) / 'identity.db'
            database = sqlite3.connect(path)
            try:
                database.execute('CREATE TABLE agent_authority_grants(id TEXT)')
                database.execute("INSERT INTO agent_authority_grants VALUES('synthetic')")
                database.commit()
                baseline = gate.authority_fingerprint(path)
                database.execute('ALTER TABLE agent_authority_grants RENAME COLUMN id TO subject')
                database.commit()
                renamed = gate.authority_fingerprint(path)
                self.assertNotEqual(baseline, renamed)
                database.execute('CREATE INDEX authority_subject ON agent_authority_grants(subject)')
                database.commit()
                indexed = gate.authority_fingerprint(path)
                self.assertNotEqual(renamed, indexed)
                database.execute('CREATE TRIGGER authority_insert AFTER INSERT ON agent_authority_grants BEGIN SELECT 1; END')
                database.commit()
                self.assertNotEqual(indexed, gate.authority_fingerprint(path))
            finally:
                database.close()

    def test_readonly_authority_fingerprint_preserves_main_and_live_wal_bytes(self):
        with tempfile.TemporaryDirectory(prefix='chunlack-authority-wal-') as folder:
            path = Path(folder) / 'identity.db'
            database = sqlite3.connect(path)
            try:
                database.execute('PRAGMA journal_mode=WAL')
                database.execute('CREATE TABLE agent_authority_grants(id TEXT)')
                database.execute("INSERT INTO agent_authority_grants VALUES('synthetic')")
                database.commit()
                wal = Path(str(path) + '-wal')
                before = path.read_bytes(), wal.read_bytes()
                self.assertEqual(gate.authority_fingerprint(path)['agent_authority_grants']['rows'], 1)
                self.assertEqual((path.read_bytes(), wal.read_bytes()), before)
            finally:
                database.close()

    def test_verified_source_ignores_poisoned_cache_and_does_not_create_cache(self):
        with tempfile.TemporaryDirectory(prefix='chunlack-source-loader-') as folder:
            path = Path(folder) / 'release.py'
            path.write_bytes(b'VALUE = 7\n')
            cache = Path(folder) / '__pycache__'
            cache.mkdir()
            poison = cache / ('release.' + sys.implementation.cache_tag + '.pyc')
            poison.write_bytes(b'poisoned-cache')
            before = {item.name: item.read_bytes() for item in cache.iterdir()}
            old = sys.dont_write_bytecode
            sys.dont_write_bytecode = False
            try:
                module = gate.load_controller(path, hashlib.sha256(path.read_bytes()).hexdigest())
            finally:
                sys.dont_write_bytecode = old
            self.assertEqual(module.VALUE, 7)
            self.assertEqual({item.name: item.read_bytes() for item in cache.iterdir()}, before)
            with self.assertRaisesRegex(ValueError, 'controller_source_hash_changed'):
                gate.load_controller(path, '0' * 64)

    def test_actual_run_is_readonly_and_rejects_dependency_and_config_drift_in_sandbox(self):
        # OS identity, service queries and native permission checks are simulated here.
        # The real run(), hashing, source loader, SQLite reads and proof checks execute.
        with tempfile.TemporaryDirectory(prefix='chunlack-code-run-') as directory:
            folder = Path(directory)
            tag = 'abcdef012345'
            root = folder / ('chunlack-release-' + tag)
            current, stage = folder / 'current', folder / 'staged/current'
            data, etc = folder / 'data', folder / 'etc'
            for path in (root, data / 'db', data / 'config', etc):
                path.mkdir(parents=True, exist_ok=True)
            for tree, version in ((current, 'old'), (stage, 'new')):
                (tree / 'identity').mkdir(parents=True)
                (tree / 'gateway').mkdir()
                (tree / 'server.js').write_text(version)
                (tree / 'identity/workspace-shell.js').write_text(version)
                (tree / 'node_modules/example').mkdir(parents=True)
                (tree / 'node_modules/example/index.js').write_bytes(b'unchanged dependency')
                if version == 'new':
                    (tree / 'gateway/research-search.cjs').write_text('new search')
            control_path = Path(__file__).resolve().parent.parent / '2026-10-17/release-discovery-safe-20261017.py'
            (root / 'release.py').write_bytes(control_path.read_bytes())
            for name in ('launch.py', 'preflight.py'):
                (root / name).write_bytes(b'pass\n')
            control = gate.load_controller(root / 'release.py', gate.digest(root / 'release.py'))
            manifests = {'candidate': control.code_inventory(stage), 'previous': control.code_inventory(current)}
            raw = (json.dumps(self.config, indent=2) + '\n').encode()
            (data / 'config/lack.config.json').write_bytes(raw)
            (root / 'candidate-config.json').write_bytes(raw)
            (etc / 'Caddyfile').write_bytes(b'unchanged caddy')
            (etc / 'runtime.env').write_bytes(b'SYNTHETIC_ONLY=1\n')
            (root / 'Caddyfile.final').write_bytes((etc / 'Caddyfile').read_bytes())
            (root / 'Caddyfile.loopback').write_bytes(b'isolated loopback fixture')
            (root / 'expected-code.json').write_text(json.dumps(manifests))
            identity_path = data / 'db/identity.db'
            database = sqlite3.connect(identity_path)
            database.execute('CREATE TABLE agent_authority_grants(id TEXT)')
            database.commit()
            database.close()
            settings = {**self.settings, 'tag': tag, 'stageHashes': manifests['candidate'], 'stageLinks': {},
                        'configHash': gate.digest(data / 'config/lack.config.json'),
                        'caddyHash': gate.digest(etc / 'Caddyfile'), 'envHash': gate.digest(etc / 'runtime.env'),
                        'dependencyFingerprint': gate.dependency_fingerprint(current),
                        'authorityFingerprint': gate.authority_fingerprint(identity_path)}
            proof = copy.deepcopy(self.proof)
            proof.update(createdAtMs=int(time.time() * 1000) - 1000, expiresAtMs=int(time.time() * 1000) + 60000)
            proof['bindings'] = {'candidateSha256': gate.canonical_hash(manifests['candidate']),
                                 'previousSha256': gate.canonical_hash(manifests['previous']),
                                 'configSha256': settings['configHash'], 'payloadCommit': settings['payloadCommit'],
                                 'dependencySha256': settings['dependencyFingerprint']['sha256']}
            (root / 'schema-compatibility-report.json').write_text(json.dumps(proof))
            names = ('release.py', 'launch.py', 'preflight.py', 'schema-compatibility-report.json',
                     'candidate-config.json', 'expected-code.json', 'Caddyfile.final', 'Caddyfile.loopback')
            settings['preparedHashes'] = {name: gate.digest(root / name) for name in names}
            (root / 'settings.json').write_text(json.dumps(settings))
            (folder / 'meminfo').write_text('MemAvailable: 999999 kB\n')
            mapping = {
                '/var/lib/chunlack-release-' + tag: root,
                '/opt/chunlack-public/current': current,
                '/opt/chunlack-public/staged-' + tag: stage.parent,
                '/var/lib/chunlack-public': data,
                '/etc/chunlack-public': etc,
                '/var/backups/chunlack-release-' + tag: folder / 'absent-backup',
                '/opt/chunlack-public/previous-' + tag: folder / 'absent-previous',
                '/opt/chunlack-public/failed-' + tag: folder / 'absent-failed',
                '/proc/meminfo': folder / 'meminfo',
            }
            concrete = type(folder)
            class SandboxPath(concrete):
                def stat(self, *, follow_symlinks=True):
                    value = super().stat(follow_symlinks=follow_symlinks)
                    if str(self) == str(root):
                        return types.SimpleNamespace(st_uid=0, st_mode=0o40700)
                    return value
            def mapped_path(value):
                text = str(value)
                for prefix in sorted(mapping, key=len, reverse=True):
                    if text == prefix or text.startswith(prefix + '/'):
                        return SandboxPath(str(mapping[prefix]) + text[len(prefix):])
                return SandboxPath(value)
            real_loader = gate.load_controller
            def load_without_native_permission_checks(path, expected):
                loaded = real_loader(path, expected)
                loaded.validate_staged_entry = lambda *args: None
                return loaded
            fake_os = mock.Mock(wraps=os)
            fake_os.name = 'posix'
            fake_os.geteuid = mock.Mock(return_value=0)
            snapshot = {name: {'MainPID': '123', 'ActiveState': 'active', 'NRestarts': '0'} for name in gate.SERVICES}
            trusted = {name: gate.digest(root / name) for name in ('release.py', 'launch.py', 'preflight.py')}
            def inventory():
                return {p.relative_to(folder).as_posix(): p.read_bytes() for p in folder.rglob('*') if p.is_file()}
            with mock.patch.object(gate, 'Path', side_effect=mapped_path), \
                    mock.patch.object(gate, 'os', fake_os), \
                    mock.patch.object(gate, 'private_json', side_effect=lambda path: json.loads(path.read_bytes())), \
                    mock.patch.object(gate, 'service_snapshot', return_value=snapshot), \
                    mock.patch.object(gate, 'load_controller', side_effect=load_without_native_permission_checks), \
                    mock.patch.object(gate.shutil, 'disk_usage', return_value=types.SimpleNamespace(free=2 * 1024 ** 3)):
                before = inventory()
                result = gate.run('/var/lib/chunlack-release-' + tag, trusted)
                self.assertEqual(result['status'], 'passed')
                self.assertTrue(result['dependenciesUnchanged'])
                self.assertEqual(inventory(), before)
                (stage / 'node_modules/example/index.js').write_bytes(b'drifted dependency')
                with self.assertRaisesRegex(ValueError, 'dependency_content_changed'):
                    gate.run('/var/lib/chunlack-release-' + tag, trusted)
                (stage / 'node_modules/example/index.js').write_bytes(b'unchanged dependency')
                (data / 'config/lack.config.json').write_bytes(json.dumps(self.config).encode())
                with self.assertRaisesRegex(ValueError, 'publisher_would_change_configuration_bytes'):
                    gate.run('/var/lib/chunlack-release-' + tag, trusted)


if __name__ == '__main__':
    unittest.main()
