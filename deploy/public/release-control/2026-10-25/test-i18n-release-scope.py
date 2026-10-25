import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]

def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

class ScopeTests(unittest.TestCase):
    def setUp(self):
        self.g = load(HERE / 'i18n-release-gate.py', 'scope_gate_under_test')
        self.fixture = json.loads((ROOT / 'tests/fixtures/i18n-release-scope-20261026.json').read_text(encoding='utf8'))
        self.manifests = {key: self.fixture[key] for key in ('previous', 'candidate')}

    def changed(self, manifests):
        return sorted(name for name in set(manifests['previous']) | set(manifests['candidate'])
                      if manifests['previous'].get(name) != manifests['candidate'].get(name))

    def test_complete_observed_twenty_file_payload_is_accepted(self):
        error, actual = None, None
        try:
            actual = self.g.validate_scope(self.manifests, self.fixture['expectedChanges'])
        except RuntimeError as caught:
            error = str(caught)
        self.assertIsNone(error, 'complete reviewed payload must not be rejected: ' + str(error))
        self.assertEqual(actual, self.fixture['expectedChanges'])
        self.assertEqual(len(actual), 20)

    def test_reviewed_extra_pairs_match_independent_observed_manifest(self):
        expected = {name: (self.manifests['previous'][name], self.manifests['candidate'][name])
                    for name in self.fixture['researchFiles'] + self.fixture['lineEndingOnlyFiles']}
        self.assertEqual(self.g.EXTRA_FILE_BINDINGS, expected)
        self.assertEqual(set(self.g.RESEARCH_FILES), set(self.fixture['researchFiles']))
        self.assertEqual(set(self.g.FORMAT_ONLY_FILES), set(self.fixture['lineEndingOnlyFiles']))
        self.assertEqual(len(self.g.ALLOWED_FILES), 14)

    def test_partial_research_runtime_cannot_pass(self):
        for omitted in self.fixture['researchFiles']:
            with self.subTest(omitted=omitted):
                value = copy.deepcopy(self.manifests)
                value['candidate'][omitted] = value['previous'][omitted]
                with self.assertRaisesRegex(RuntimeError, 'research_runtime_incomplete'):
                    self.g.validate_scope(value, self.changed(value))

    def test_every_extra_previous_hash_is_bound(self):
        for name in self.fixture['researchFiles'] + self.fixture['lineEndingOnlyFiles']:
            with self.subTest(path=name):
                value = copy.deepcopy(self.manifests)
                value['previous'][name] = 'a' * 64
                with self.assertRaisesRegex(RuntimeError, 'reviewed_extra_source_changed'):
                    self.g.validate_scope(value, self.changed(value))

    def test_every_extra_candidate_hash_is_bound(self):
        for name in self.fixture['researchFiles'] + self.fixture['lineEndingOnlyFiles']:
            with self.subTest(path=name):
                value = copy.deepcopy(self.manifests)
                value['candidate'][name] = 'b' * 64
                with self.assertRaisesRegex(RuntimeError, 'reviewed_extra_source_changed'):
                    self.g.validate_scope(value, self.changed(value))

    def test_format_only_allows_exact_crlf_to_lf(self):
        for previous in (b'first\r\nsecond\r\n', b'{"dependencies":{"synthetic":"1.0.0"}}\r\n', b'<html>same</html>\r\n'):
            with self.subTest(previous=previous):
                self.assertTrue(self.g.validate_format_only(previous, previous.replace(b'\r\n', b'\n')))

    def test_format_only_rejects_content_dependency_and_encoding_changes(self):
        for previous, candidate in (
            (b'<html>old</html>\r\n', b'<html>new</html>\n'),
            (b'{"version":"1"}\r\n', b'{"version":"2"}\n'),
            (b'{"a":1}\r\n', b'{"a":true}\n'),
            (b'text\r\n', b'\xef\xbb\xbftext\n'),
            (b'text\r\n', b'text\r\n'),
            (b'text\r\n', b'text\nextra'),
        ):
            with self.subTest(candidate=candidate), self.assertRaises(RuntimeError):
                self.g.validate_format_only(previous, candidate)
        with self.assertRaises(RuntimeError):
            self.g.validate_format_only('text', b'text')

    def test_unknown_file_and_deletion_still_fail_closed(self):
        for path in ('gateway/server.cjs', 'config/private.json', '../escape', 'node_modules/package/index.js'):
            with self.subTest(path=path):
                value = copy.deepcopy(self.manifests)
                value['candidate'][path] = 'c' * 64
                with self.assertRaises(RuntimeError):
                    self.g.validate_scope(value, self.changed(value))
        value = copy.deepcopy(self.manifests)
        del value['candidate']['server.js']
        with self.assertRaises(RuntimeError):
            self.g.validate_scope(value, self.changed(value))

    def test_approval_must_match_exact_sorted_changes(self):
        expected = self.fixture['expectedChanges']
        for approved in (None, expected[:-1], list(reversed(expected)), expected + [expected[-1]]):
            with self.subTest(approved=approved), self.assertRaises(RuntimeError):
                self.g.validate_scope(self.manifests, approved)

    def test_original_fourteen_file_transaction_remains_compatible(self):
        legacy = load(HERE / 'test-i18n-release-gate.py', 'scope_original_simulations')
        case = legacy.GateTests()
        case.g = self.g
        with tempfile.TemporaryDirectory(prefix='chunlack-scope-') as tmp:
            backend = case.fixture(Path(tmp))
            raw = backend.initial_config
            result = self.g.Transaction(backend).execute()
            self.assertEqual(result['status'], 'released', result)
            self.assertEqual((backend.data / 'config/lack.config.json').read_bytes(), raw)
            self.assertFalse(result['liveDataRestoredFromBackup'])
        # Exercise the real preflight call site, not only the pure formatter.
        # Synthetic hash pins let the negative control reach that second guard.
        for semantic_change in (False, True):
            with self.subTest(semantic_change=semantic_change), tempfile.TemporaryDirectory(prefix='chunlack-format-scope-') as tmp:
                backend = case.fixture(Path(tmp))
                bindings = dict(self.g.EXTRA_FILE_BINDINGS)
                for index, name in enumerate(self.g.FORMAT_ONLY_FILES):
                    previous = b'{"synthetic":1}\r\n'
                    candidate = b'{"synthetic":2}\n' if semantic_change and index == 0 else b'{"synthetic":1}\n'
                    for tree, raw in ((backend.current, previous), (backend.staged, candidate)):
                        target = tree / name
                        target.parent.mkdir(parents=True, exist_ok=True)
                        target.write_bytes(raw)
                    bindings[name] = tuple(hashlib.sha256(raw).hexdigest() for raw in (previous, candidate))
                manifests = {'previous': self.g.base.code_inventory(backend.current),
                             'candidate': self.g.base.code_inventory(backend.staged)}
                backend.settings['stageHashes'] = manifests['candidate']
                backend.settings['allowedChangedFiles'] = self.changed(manifests)
                (backend.root / 'expected-code.json').write_text(json.dumps(manifests), encoding='utf8')
                proof_path = backend.root / 'schema-compatibility-report.json'
                proof = json.loads(proof_path.read_text(encoding='utf8'))
                for key in ('previous', 'candidate'):
                    proof['bindings'][key + 'Sha256'] = self.g.reference.canonical_hash(manifests[key])
                proof_path.write_text(json.dumps(proof), encoding='utf8')
                with mock.patch.object(self.g, 'EXTRA_FILE_BINDINGS', bindings), \
                        mock.patch.object(self.g, 'validate_format_only', wraps=self.g.validate_format_only) as formatter, \
                        mock.patch.object(backend, 'stop', wraps=backend.stop) as stop:
                    result = self.g.Transaction(backend).execute()
                if semantic_change:
                    self.assertEqual(result['status'], 'preflight_failed', result)
                    self.assertEqual(result['error'], 'non_line_ending_change')
                    formatter.assert_called_once()
                    stop.assert_not_called()
                    self.assertTrue(all(backend.active.values()))
                else:
                    self.assertEqual(result['status'], 'released', result)
                    self.assertEqual(formatter.call_count, 6)
                    self.assertTrue(stop.called)

if __name__ == '__main__':
    unittest.main(verbosity=2)
