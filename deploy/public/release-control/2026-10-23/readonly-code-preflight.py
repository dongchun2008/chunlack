"""Read-only gate for the bounded three-file research code release."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import stat
import subprocess
import sys
import time
import types


ALLOWED_FILES = (
    'gateway/research-search.cjs', 'identity/workspace-shell.js', 'server.js',
)
SERVICES = (
    'chunlack.service', 'tailscaled.service',
    'chunlack-public.service', 'chunlack-https.service',
)


def require(value, code):
    if not value:
        raise ValueError(code)


def canonical_hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def relative_name(value):
    require(type(value) is str and 0 < len(value) <= 512, 'invalid_relative_name')
    require(not any(char in value for char in ('\\', ':', '\x00')) and
            not value.startswith('/') and
            all(part not in ('', '.', '..') for part in value.split('/')) and
            value.split('/')[0] != 'node_modules', 'invalid_relative_name')
    return value


def validate_manifest_scope(value):
    require(type(value) is dict and set(value) == {'candidate', 'previous'}, 'manifest_sections_required')
    for section in ('candidate', 'previous'):
        table = value[section]
        require(type(table) is dict and 1 <= len(table) <= 1000, 'invalid_manifest_section')
        for name, digest in table.items():
            relative_name(name)
            require(type(digest) is str and re.fullmatch('[0-9a-f]{64}', digest) is not None,
                    'invalid_manifest_digest')
    before, after = value['previous'], value['candidate']
    changed = sorted(name for name in set(before) | set(after) if before.get(name) != after.get(name))
    require(changed == list(ALLOWED_FILES) and all(name in after for name in ALLOWED_FILES),
            'research_code_scope_changed')
    return changed


def validate_configuration(candidate, live, settings):
    require(type(candidate) is dict and type(live) is dict and candidate == live,
            'configuration_must_remain_identical')
    require(settings.get('releaseProfile') == 'mcp-only' and settings.get('migrationContract') is None and
            settings.get('serviceAccountHandoff') == 'systemd-v1' and
            settings.get('allowedChangedFiles') == list(ALLOWED_FILES), 'release_scope_changed')
    require(type(settings.get('payloadCommit')) is str and
            re.fullmatch('[0-9a-f]{40}', settings['payloadCommit']) is not None, 'payload_commit_invalid')
    runtime = live.get('publicRuntime')
    require(type(runtime) is dict, 'runtime_policy_required')
    oauth = runtime.get('agentOAuth')
    require(type(oauth) is dict and oauth.get('enabled') is True and
            oauth.get('discoveryOnly') is False and runtime.get('nodeRestPublic') is False,
            'public_boundary_changed')
    require(oauth.get('issuer') == 'https://pockid.chunclaw.top' and
            oauth.get('resource') == 'https://agents.chunclaw.top/mcp', 'oauth_identity_changed')
    events = runtime.get('events', {})
    require(type(events) is dict and (events.get('enabled') is None or events.get('enabled') is False),
            'events_must_remain_disabled')
    clients = oauth.get('clientIds')
    require(type(clients) is list and len(clients) <= 32 and
            all(type(value) is str and 0 < len(value) <= 256 and
                not any(ord(char) <= 32 or ord(char) == 127 for char in value) and
                value != oauth.get('browserClientId') for value in clients) and
            len(set(clients)) == len(clients) and settings.get('approvedAgentClientIds') == clients,
            'existing_client_boundary_changed')
    return len(clients)


def validate_config_bytes(config, raw):
    require(type(raw) is bytes and raw == (json.dumps(config, indent=2) + '\n').encode(),
            'publisher_would_change_configuration_bytes')
    return True


def validate_copy_proof(proof, settings, manifests, now_ms=None):
    require(type(proof) is dict and proof.get('status') == 'passed' and
            type(proof.get('databaseCount')) is int and proof['databaseCount'] == 3 and
            proof.get('schemaPreserved') is True and proof.get('networkIsolated') is True and
            proof.get('actualModelCalls') is False and proof.get('rollbackBackup') is False and
            proof.get('applicationConsistentSnapshot') is False, 'copy_proof_scope_invalid')
    identities = proof.get('serviceAccountHandoff', {})
    require(type(identities) is dict and identities.get('allBusinessNonRoot') is True and
            type(identities.get('identities')) is list and len(identities['identities']) == 2 and
            all(type(row) is dict and type(row.get('uid')) is int and row['uid'] == 996 and
                type(row.get('gid')) is int and row['gid'] == 987 and row.get('noNewPrivileges') is True
                for row in identities['identities']), 'copy_business_identity_invalid')
    boots = proof.get('boots')
    require(type(boots) is list and len(boots) == 2 and
            all(type(row) is dict for row in boots) and
            [row.get('runtime') for row in boots] == ['candidate', 'previous'] and
            all(row.get('cleanClose') is True and row.get('privateNodeReadChecked') is True and
                row.get('validForwardedNodeDenied') is True for row in boots), 'copy_boots_incomplete')
    created, expires = proof.get('createdAtMs'), proof.get('expiresAtMs')
    moment = int(time.time() * 1000) if now_ms is None else now_ms
    require(type(created) is int and type(expires) is int and type(moment) is int and
            created <= moment <= expires and 0 < expires - created <= 3600000, 'copy_proof_expired')
    require(proof.get('bindings') == {
        'candidateSha256': canonical_hash(manifests['candidate']),
        'previousSha256': canonical_hash(manifests['previous']),
        'configSha256': settings['configHash'], 'payloadCommit': settings['payloadCommit'],
        'dependencySha256': settings['dependencyFingerprint']['sha256'],
    }, 'copy_proof_binding_changed')
    return True


def digest(path):
    value = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(262144), b''):
            value.update(chunk)
    return value.hexdigest()


def dependency_fingerprint(root):
    root = Path(root)
    require(root.is_dir() and not root.is_symlink(), 'dependency_root_invalid')
    resolved = root.resolve(strict=True)
    records, size = {}, 0
    for directory, dirs, files in os.walk(root, followlinks=False):
        base = Path(directory)
        for name in dirs:
            path = base / name
            if 'node_modules' in path.relative_to(root).parts:
                require(not path.is_symlink(), 'dependency_directory_link_denied')
        for name in files:
            path = base / name
            relative = path.relative_to(root)
            if 'node_modules' not in relative.parts:
                continue
            metadata = path.lstat()
            link = None
            if stat.S_ISLNK(metadata.st_mode):
                target = path.resolve(strict=True)
                require(target.is_relative_to(resolved) and target.is_file(), 'dependency_link_denied')
                link = os.readlink(path)
                metadata = target.stat()
            require(stat.S_ISREG(metadata.st_mode) and metadata.st_size <= 32 * 1024 * 1024,
                    'dependency_file_invalid')
            size += metadata.st_size
            require(size <= 128 * 1024 * 1024 and len(records) < 20000, 'dependency_inventory_budget')
            records[relative.as_posix()] = {'bytes': metadata.st_size, 'sha256': digest(path), 'link': link}
    require(bool(records), 'dependency_inventory_empty')
    return {'files': len(records), 'bytes': size, 'sha256': canonical_hash(records)}


def load_controller(path, expected):
    path = Path(path)
    require(not path.is_symlink(), 'controller_source_link_denied')
    source = path.read_bytes()
    require(type(expected) is str and hashlib.sha256(source).hexdigest() == expected,
            'controller_source_hash_changed')
    module = types.ModuleType('readonly_research_release')
    module.__file__ = str(path)
    exec(compile(source, str(path), 'exec'), module.__dict__)
    return module


def private_json(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, 'rb') as stream:
        metadata = os.fstat(stream.fileno())
        require(stat.S_ISREG(metadata.st_mode) and metadata.st_uid == 0 and metadata.st_nlink == 1 and
                stat.S_IMODE(metadata.st_mode) == 0o600 and metadata.st_size <= 1024 * 1024,
                'prepared_json_not_private')
        return json.loads(stream.read(1024 * 1024 + 1))


def authority_fingerprint(path):
    database = sqlite3.connect(Path(path).resolve().as_uri() + '?mode=ro', uri=True, timeout=2)
    try:
        database.execute('PRAGMA query_only=ON')
        database.execute('BEGIN')
        names = [row[0] for row in database.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND "
            "(name LIKE '%grant%' OR name LIKE '%authorit%' OR name LIKE '%epoch%') ORDER BY name")]
        require(0 < len(names) <= 32, 'authority_tables_required')
        schema = [list(row) for row in database.execute(
            'SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name,tbl_name')]
        result, size = {'_schemaSha256': canonical_hash(schema)}, 0
        for name in names:
            require(re.fullmatch('[A-Za-z_][A-Za-z_0-9]*', name) is not None, 'authority_table_invalid')
            encoded = []
            for row in database.execute('SELECT * FROM "' + name + '"'):
                text = json.dumps(list(row), sort_keys=True, separators=(',', ':'),
                                  default=lambda value: {'blob': value.hex()} if isinstance(value, bytes) else str(value))
                size += len(text.encode())
                require(size <= 4 * 1024 * 1024 and len(encoded) < 20000, 'authority_probe_budget')
                encoded.append(text)
            result[name] = {'rows': len(encoded), 'sha256': canonical_hash(sorted(encoded))}
        return result
    finally:
        database.close()


def service_snapshot():
    result = {}
    for name in SERVICES:
        text = subprocess.check_output(
            ['systemctl', 'show', name, '-p', 'MainPID', '-p', 'ActiveState', '-p', 'NRestarts'],
            text=True, timeout=3)
        result[name] = dict(line.split('=', 1) for line in text.splitlines() if '=' in line)
    return result


def run(root_string, trusted):
    require(os.name == 'posix' and os.geteuid() == 0, 'readonly_gate_requires_posix_root')
    require(type(root_string) is str and
            re.fullmatch('/var/lib/chunlack-release-[0-9a-f]{12}', root_string) is not None,
            'release_root_invalid')
    root = Path(root_string)
    require(not root.is_symlink() and root.resolve(strict=True) == root and root.stat().st_uid == 0 and
            stat.S_IMODE(root.stat().st_mode) == 0o700, 'release_root_not_private')
    require(type(trusted) is dict and {'release.py', 'launch.py', 'preflight.py'} <= set(trusted),
            'trusted_sources_required')
    for name, expected in trusted.items():
        relative_name(name)
        require(type(expected) is str and re.fullmatch('[0-9a-f]{64}', expected) is not None and
                not (root / name).is_symlink() and digest(root / name) == expected,
                'trusted_source_changed')
    before = service_snapshot()
    require(all(row.get('ActiveState') == 'active' and int(row.get('MainPID', '0')) > 0
                for row in before.values()), 'production_service_not_active')
    settings = private_json(root / 'settings.json')
    manifests = private_json(root / 'expected-code.json')
    changed = validate_manifest_scope(manifests)
    tag = root.name.removeprefix('chunlack-release-')
    require(settings.get('tag') == tag, 'release_tag_changed')
    current = Path('/opt/chunlack-public/current')
    stage = Path('/opt/chunlack-public/staged-' + tag) / 'current'
    gate = load_controller(root / 'release.py', trusted['release.py'])
    require(gate.code_inventory(current) == manifests['previous'] and
            gate.code_inventory(stage) == manifests['candidate'] == settings.get('stageHashes'),
            'executable_manifest_changed')
    dependencies = dependency_fingerprint(current)
    require(dependencies == dependency_fingerprint(stage) == settings.get('dependencyFingerprint'),
            'dependency_content_changed')
    prepared_hashes = settings.get('preparedHashes')
    require(type(prepared_hashes) is dict and
            {'release.py', 'launch.py', 'preflight.py', 'schema-compatibility-report.json',
             'candidate-config.json', 'expected-code.json', 'Caddyfile.final', 'Caddyfile.loopback'} <= set(prepared_hashes),
            'prepared_hashes_incomplete')
    for name, expected in prepared_hashes.items():
        relative_name(name)
        require(not (root / name).is_symlink() and digest(root / name) == expected, 'prepared_input_changed')
    live_path = Path('/var/lib/chunlack-public/config/lack.config.json')
    candidate = private_json(root / 'candidate-config.json')
    live_bytes = live_path.read_bytes()
    live = json.loads(live_bytes)
    client_count = validate_configuration(candidate, live, settings)
    validate_config_bytes(live, live_bytes)
    gate.validate_release_config(live, 'mcp-only', settings['approvedAgentClientIds'])
    for path, key in ((live_path, 'configHash'), (Path('/etc/chunlack-public/runtime.env'), 'envHash'),
                      (Path('/etc/chunlack-public/Caddyfile'), 'caddyHash')):
        require(digest(path) == settings.get(key), 'live_input_changed')
    require(digest(root / 'candidate-config.json') == settings['configHash'] and
            digest(root / 'Caddyfile.final') == settings['caddyHash'], 'code_only_configuration_bytes_changed')
    authority = authority_fingerprint('/var/lib/chunlack-public/db/identity.db')
    require(authority == settings.get('authorityFingerprint'), 'authority_changed')
    proof = private_json(root / 'schema-compatibility-report.json')
    validate_copy_proof(proof, settings, manifests)
    for path in [stage, *stage.rglob('*')]:
        gate.validate_staged_entry(stage, path, 0, 987, settings['stageLinks'])
    for path in (Path('/var/backups/chunlack-release-' + tag),
                 Path('/opt/chunlack-public/previous-' + tag), Path('/opt/chunlack-public/failed-' + tag),
                 root / 'result.json'):
        require(not path.exists() and not path.is_symlink(), 'release_already_attempted_or_destination_occupied')
    available = int(next(line.split()[1] for line in Path('/proc/meminfo').read_text().splitlines()
                         if line.startswith('MemAvailable:')))
    require(available >= 384 * 1024 and shutil.disk_usage('/var/lib').free >= 1024 ** 3,
            'resource_headroom_insufficient')
    require(service_snapshot() == before and
            authority_fingerprint('/var/lib/chunlack-public/db/identity.db') == authority,
            'readonly_baseline_changed')
    return {'status': 'passed', 'changedExecutableFiles': changed, 'approvedClientCount': client_count,
            'configurationBytesUnchanged': True, 'authorityUnchanged': True,
            'dependenciesUnchanged': True, 'controllerLoadedFromVerifiedSource': True,
            'copyProofBoundAndFresh': True, 'productionMutated': False,
            'modelCalls': 0, 'forwardSeconds': 55, 'recoverySeconds': 120}


if __name__ == '__main__':
    try:
        require(len(sys.argv) == 3, 'root_and_trusted_hashes_required')
        result = run(sys.argv[1], json.loads(sys.argv[2]))
    except Exception as error:
        result = {'status': 'failed', 'error': str(error) if isinstance(error, ValueError) else type(error).__name__,
                  'productionMutated': False}
    print(json.dumps(result), flush=True)
    sys.exit(0 if result['status'] == 'passed' else 1)
