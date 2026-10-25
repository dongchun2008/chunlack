"""Independent, local-only i18n release candidate; production CLI is disabled."""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import types


SOURCE_COMMIT = 'b2620ac3a5733a815d0e008175661eec7fa81ec6'
BASE_SHA256 = '63ed0731c21411dbe91fbb7a4a7e2f5330df80a49f490f29c47342b7098cdcc1'
REFERENCE_SHA256 = '5c9cf83f7c763a7e216feb865849c7eba761efa7f9dc40b990f1f67f0e69b18d'
ALLOWED_FILES = (
    'server.js', 'public/index.html', 'identity/login.html',
    'identity/workspace-shell.js', 'identity/workspace-ui.js', 'identity/i18n.js',
    'identity/messages.js', 'identity/chat-messages.js', 'identity/help.js',
    'identity/display.js', 'identity/help-assets.cjs',
    'identity/help/zh-CN.md', 'identity/help/en.md', 'deploy/public/Caddyfile.template',
)
# Reviewed against the read-only production inventory on 2026-10-26.
# These are exact source transitions, not additional wildcard permissions.
RESEARCH_FILES = (
    'collaboration/capacity.cjs', 'collaboration/model-transport.cjs',
    'collaboration/task-control.cjs',
)
FORMAT_ONLY_FILES = ('gateway/admin.html', 'package.json', 'package-lock.json')
EXTRA_FILE_BINDINGS = {
    'collaboration/capacity.cjs': (
        '1be6bf242dea364a74871e23dab81b8b46bfc82f224d184005641a904d97f90f',
        'fdfc0fbe3798c737ad5fdcb42b7d36fa901ad03e53d92db2a7050db827fd6710'),
    'collaboration/model-transport.cjs': (
        '44d751a8851bd29f0a03f419391097f11b1a819dd2c61282cec8549588e9352a',
        'fee1b40325786e2e71ae176d7766725da02eb6c7b762d79929b38a78a4b6119a'),
    'collaboration/task-control.cjs': (
        '77a725a7db30e316de075f430d045e05cc1a109f44f07cb2fe27ae1deaa399d2',
        '6f31471c99f35ad6ca5ae406cff8f5b0dbeae70c8d6c8c1876939c36f809e7a3'),
    'gateway/admin.html': (
        '95d6d56fed3c2c08448b059d7634fbbb043dc93d4ed9e56d25704a89cf533a62',
        '651a7d5195645262cd9ecea394ae7831b512b8cc1907c1996cc39e9078ff652e'),
    'package.json': (
        'd6635cd11cf97ad7cfa2e904a75cb33be28bbb8714098460fd8881bb4151b09f',
        'e79f7668fcd9078fc913ebf15a41587fbd8ce1d0fb13806ba94ff633474d39b9'),
    'package-lock.json': (
        '04c40836a08ed99f77c85f8297e11c55e0797fd35485dc04056d00942dedc3b5',
        '255e393fe99249f578c6f910a501b2b490a070f34784509b760c4042304bfacc'),
}
ASSETS = (
    '/identity/i18n.js', '/identity/messages.js', '/identity/chat-messages.js',
    '/identity/help.js', '/identity/display.js',
    '/identity/help/zh-CN.md', '/identity/help/en.md',
)
OLD_ASSET_MATCH = (
    'method GET HEAD\n            path_regexp human_read '
    '^(/|/login|/health|/[A-Za-z0-9_-]+[.](js|css|svg|png|ico|html)|'
    '/identity/(runtime-mode|workspace-ui|workspace-shell)[.]js|/auth/'
)
NEW_ASSET_MATCH = OLD_ASSET_MATCH.replace(
    '/identity/(runtime-mode|workspace-ui|workspace-shell)[.]js|/auth/',
    '/identity/(runtime-mode|workspace-ui|workspace-shell|i18n|messages|chat-messages|help|display)[.]js|'
    '/identity/help/(zh-CN|en)[.]md|/auth/',
)
OLD_HEADER = '    header {\n        X-Content-Type-Options nosniff\n'
NEW_HEADER = '    header >X-Content-Type-Options nosniff\n    header {\n'


def require(value, code):
    if not value:
        raise RuntimeError(code)


def checked_bytes(path, maximum=4 * 1024 * 1024):
    path = Path(path)
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and
            before.st_size <= maximum, 'input_not_regular_bounded_file')
    descriptor = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    with os.fdopen(descriptor, 'rb') as stream:
        opened = os.fstat(stream.fileno())
        require((before.st_dev, before.st_ino) == (opened.st_dev, opened.st_ino),
                'input_identity_changed')
        value = stream.read(maximum + 1)
    require(len(value) <= maximum, 'input_size_changed')
    return value


def load_pinned(path, expected, name):
    source = checked_bytes(path)
    require(hashlib.sha256(source).hexdigest() == expected, 'reference_source_changed')
    module = types.ModuleType(name)
    module.__file__ = str(path)
    exec(compile(source, str(path), 'exec'), module.__dict__)
    return module


ROOT = Path(__file__).resolve().parent.parent
base = load_pinned(ROOT / '2026-10-17/release-discovery-safe-20261017.py', BASE_SHA256,
                   'i18n_reference_controller')
reference = load_pinned(ROOT / '2026-10-23/readonly-code-preflight.py', REFERENCE_SHA256,
                        'i18n_reference_readonly')


def controller_bindings():
    return {'baseSha256': BASE_SHA256, 'readonlySha256': REFERENCE_SHA256,
            'candidateSha256': hashlib.sha256(checked_bytes(__file__)).hexdigest()}


def load_json(path):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, 'duplicate_json_key')
            result[key] = value
        return result
    return json.loads(checked_bytes(path, 1024 * 1024), object_pairs_hook=unique)


def validate_scope(manifests, approved):
    require(type(manifests) is dict and set(manifests) == {'candidate', 'previous'},
            'manifest_sections_required')
    for section in ('candidate', 'previous'):
        table = manifests[section]
        require(type(table) is dict and 1 <= len(table) <= 1000, 'manifest_count_invalid')
        for name, digest in table.items():
            try:
                reference.relative_name(name)
            except ValueError as error:
                raise RuntimeError(str(error)) from error
            require(type(digest) is str and re.fullmatch('[0-9a-f]{64}', digest),
                    'manifest_digest_invalid')
    before, after = manifests['previous'], manifests['candidate']
    require(set(before) <= set(after) and set(ALLOWED_FILES) <= set(after), 'code_deletion_denied')
    changed = sorted(name for name in set(before) | set(after) if before.get(name) != after.get(name))
    require(type(approved) is list and changed == approved and bool(changed) and
            set(changed) <= set(ALLOWED_FILES) | set(EXTRA_FILE_BINDINGS), 'i18n_code_scope_changed')
    research_present = (set(before) | set(after)) & set(RESEARCH_FILES)
    research_changed = set(changed) & set(RESEARCH_FILES)
    if research_present:
        require(set(RESEARCH_FILES) <= set(before) & set(after) and
                (not research_changed or research_changed == set(RESEARCH_FILES)),
                'research_runtime_incomplete')
        if not research_changed:
            require(all(after[name] == EXTRA_FILE_BINDINGS[name][1] for name in RESEARCH_FILES),
                    'research_runtime_incomplete')
    for name in set(changed) & set(EXTRA_FILE_BINDINGS):
        require((before.get(name), after[name]) == EXTRA_FILE_BINDINGS[name],
                'reviewed_extra_source_changed')
    return changed


def validate_format_only(previous, candidate):
    require(type(previous) is bytes and type(candidate) is bytes and
            previous.replace(b'\r\n', b'\n') == candidate and b'\r' not in candidate,
            'non_line_ending_change')
    return True


def expected_ingress(previous):
    require(type(previous) is bytes, 'ingress_bytes_required')
    result = previous
    for before, after in ((OLD_ASSET_MATCH.encode(), NEW_ASSET_MATCH.encode()),
                          (OLD_HEADER.encode(), NEW_HEADER.encode())):
        require(result.count(before) == 1 and result.count(after) == 0,
                'ingress_baseline_not_exact')
        result = result.replace(before, after, 1)
    return result


def validate_ingress_transition(previous, candidate):
    require(type(candidate) is bytes and candidate == expected_ingress(previous),
            'ingress_change_outside_exact_assets_and_header')
    return True


def prepared_bindings(settings):
    return {name: settings[name] for name in (
        'configHash', 'envHash', 'caddyHash', 'finalCaddyHash', 'loopbackCaddyHash',
        'authorityFingerprint', 'controllerFingerprint',
    )}


def validate_prepared(backend):
    b, settings = backend, backend.settings
    require(type(settings) is dict and settings.get('payloadCommit') == SOURCE_COMMIT and
            settings.get('releaseProfile') == 'mcp-only' and settings.get('migrationContract') is None and
            settings.get('serviceAccountHandoff') == 'systemd-v1', 'i18n_release_policy_changed')
    require(settings.get('controllerFingerprint') == controller_bindings(), 'controller_binding_changed')
    manifests = load_json(b.root / 'expected-code.json')
    changed = validate_scope(manifests, settings.get('allowedChangedFiles'))
    require(base.code_inventory(b.current) == manifests['previous'] and
            base.code_inventory(b.staged) == manifests['candidate'] == settings.get('stageHashes'),
            'executable_manifest_changed')
    dependencies = reference.dependency_fingerprint(b.current)
    require(dependencies == reference.dependency_fingerprint(b.staged) == settings.get('dependencyFingerprint'),
            'dependency_content_changed')
    for name in FORMAT_ONLY_FILES:
        if name in changed:
            validate_format_only(checked_bytes(b.current / name), checked_bytes(b.staged / name))
    raw = checked_bytes(b.data / 'config/lack.config.json', 1024 * 1024)
    require(raw == checked_bytes(b.new_config, 1024 * 1024) and
            hashlib.sha256(raw).hexdigest() == settings.get('configHash'), 'configuration_bytes_changed')
    config = json.loads(raw)
    base.validate_release_config(config, 'mcp-only', settings.get('approvedAgentClientIds'))
    runtime = config['publicRuntime']
    oauth = runtime['agentOAuth']
    require(oauth.get('issuer') == 'https://pockid.chunclaw.top' and
            oauth.get('resource') == 'https://agents.chunclaw.top/mcp', 'oauth_identity_changed')
    events = runtime.get('events', {})
    require(type(events) is dict and (events.get('enabled') is None or events.get('enabled') is False),
            'events_must_remain_disabled')
    for path, key in ((b.env, 'envHash'), (b.caddy, 'caddyHash'),
                      (b.final_caddy, 'finalCaddyHash'), (b.local_caddy, 'loopbackCaddyHash')):
        require(hashlib.sha256(checked_bytes(path)).hexdigest() == settings.get(key), 'prepared_bytes_changed')
    validate_ingress_transition(checked_bytes(b.caddy), checked_bytes(b.final_caddy))
    authority = reference.authority_fingerprint(b.data / 'db/identity.db')
    require(authority == settings.get('authorityFingerprint'), 'authority_changed')
    require(len(base.schemas(b.data, cold=False)) == 3, 'database_copy_scope_changed')
    proof = load_json(b.root / 'schema-compatibility-report.json')
    reference.validate_copy_proof(proof, settings, manifests)
    require(proof.get('i18nBindings') == prepared_bindings(settings), 'i18n_copy_proof_binding_changed')
    return {'changedFiles': changed, 'configurationBytesUnchanged': True,
            'authorityUnchanged': True, 'dependenciesUnchanged': True,
            'configurationSha256': settings['configHash'], 'environmentSha256': settings['envHash'],
            'ingressHashes': tuple(settings[key] for key in ('caddyHash', 'finalCaddyHash', 'loopbackCaddyHash'))}


class Transaction(base.Transaction):
    """Code and ingress only; never restores data or writes configuration JSON."""
    def unchanged_configuration(self):
        require(base.digest(self.b.data / 'config/lack.config.json', self.w.tick) ==
                self.inputs['configurationSha256'], 'configuration_changed_externally')
        self.unchanged_environment()

    def unchanged_environment(self):
        require(base.digest(self.b.env, self.w.tick) == self.inputs['environmentSha256'],
                'environment_changed_externally')

    def owned_ingress(self):
        require(base.digest(self.b.caddy, self.w.tick) in self.inputs['ingressHashes'],
                'ingress_changed_externally_no_override')

    def execute(self):
        b = self.b
        try:
            self.inputs = validate_prepared(b)
            b.preflight()
            require(validate_prepared(b) == self.inputs, 'preflight_inputs_changed')
            self.record('preflight_passed')
            self.unchanged_configuration()
            self.w.begin()
            b.stop(base.HTTPS, 6)
            self.record('https_stopped')
            b.stop(base.APP, 20)
            self.record('application_stopped')
            self.unchanged_configuration()
            self.backup()
            self.record('consistent_backup_verified')
            os.rename(b.current, b.previous)
            self.record('old_code_preserved')
            os.rename(b.staged, b.current)
            self.record('candidate_code_installed')
            self.unchanged_configuration()
            self.owned_ingress()
            base.atomic_copy(b.local_caddy, b.caddy, self.w.tick)
            b.set_live_modes()
            self.record('candidate_configuration_installed')
            self.unchanged_configuration()
            b.start(base.APP, 16)
            b.start(base.HTTPS, 10)
            b.check_candidate('loopback')
            require(base.schemas(b.data, self.w.tick, cold=False) == self.schema_before,
                    'candidate_schema_changed')
            self.unchanged_configuration()
            self.record('loopback_https_acceptance_passed')
            self.owned_ingress()
            b.stop(base.HTTPS, 6)
            base.atomic_copy(b.final_caddy, b.caddy, self.w.tick)
            b.set_live_modes()
            b.start(base.HTTPS, 10)
            b.check_candidate('public')
            self.unchanged_configuration()
            b.check_protected()
            self.record('public_discovery_acceptance_passed')
            result = {'status': 'released', 'records': self.records,
                      'outageSeconds': round(self.w.elapsed(), 3), 'releaseProfile': 'mcp-only',
                      'configurationWritten': False, 'credentialsChanged': False,
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
        b.stop(base.HTTPS, 6)
        b.stop(base.APP, 20)
        require(not (b.data / '.public-runtime.lock').exists(), 'rollback_writer_lock_remains_no_override')
        if self.backed_up:
            require(base.schemas(b.data, self.w.tick) == self.schema_before, 'rollback_schema_incompatible')
        if b.previous.exists():
            require(base.inode(b.previous) == b.original_inode, 'original_code_identity_changed')
            if b.current.exists():
                require(base.inode(b.current) == b.staged_inode, 'candidate_code_identity_changed')
                os.rename(b.current, b.failed_code)
            os.rename(b.previous, b.current)
        require(base.inode(b.current) == b.original_inode, 'original_code_not_recovered')
        if self.backed_up:
            self.owned_ingress()
            base.atomic_copy(b.backup / 'Caddyfile', b.caddy, self.w.tick)
            b.set_live_modes()
        b.start(base.APP, 18)
        b.start(base.HTTPS, 12)
        b.check_original()
        b.assert_listener('public')
        self.unchanged_environment()
        b.check_protected()


class Backend(base.LinuxBackend):
    """Operational adapter for later authorized rehearsal, never invoked by CLI."""
    def preflight(self):
        metadata = self.root.lstat()
        require(metadata.st_uid == 0 and stat.S_IMODE(metadata.st_mode) == 0o700,
                'release_root_not_private')
        for name in ('settings.json', 'expected-code.json', 'schema-compatibility-report.json'):
            reference.private_json(self.root / name)
        validate_prepared(self)
        super().preflight()
        validate_prepared(self)

    def request(self, host, path, method='GET'):
        if method != 'HEAD':
            return super().request(host, path, method)
        timeout = self.w.remaining(2)
        output = self.command([
            'curl', '--noproxy', '*', '--silent', '--show-error', '--head',
            '--max-time', str(timeout), '--connect-timeout', str(min(1, timeout)),
            '--resolve', host + ':443:127.0.0.1', 'https://' + host + path,
        ], cap=3)
        return int(output.splitlines()[0].split()[1]), output.lower(), ''

    def check_candidate(self, mode):
        super().check_candidate(mode)
        for path in ASSETS:
            status, head, body = self.request('lack.chunclaw.top', path)
            require(status == 200 and bool(body), 'display_asset_unavailable')
            values = [line.partition(':')[2].strip() for line in head.splitlines()
                      if line.partition(':')[0].strip() == 'x-content-type-options']
            require(values == ['nosniff'], 'display_asset_nosniff_not_single')
            require(hashlib.sha256(body.encode()).hexdigest() == self.settings['stageHashes'][path[1:]],
                    'display_asset_content_changed')
            require(self.request('lack.chunclaw.top', path, 'HEAD')[0] == 200,
                    'display_asset_head_unavailable')
            for method in ('GET', 'HEAD'):
                require(self.request('agents.chunclaw.top', path, method)[0] == 404,
                        'agent_host_exposed_display_asset')
            for method in ('POST', 'PATCH', 'DELETE'):
                require(self.request('lack.chunclaw.top', path, method)[0] == 404,
                        'display_asset_write_method_exposed')


if __name__ == '__main__':
    print(json.dumps({'status': 'local_candidate_only', 'productionExecuted': False}), flush=True)
    sys.exit(64)
