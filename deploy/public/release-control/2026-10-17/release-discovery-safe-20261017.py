"""Private operational controller: preserve live data, bounded forward/recovery work."""
import hashlib
import hmac
import struct
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



# Frozen from the accepted 2026-10-18 isolated copy, not the candidate under test.
# Includes autoindexes (whose SQL is NULL), unlike the legacy strict digest.
AUTHORITY_V1_OBJECTS = tuple(tuple(row) for row in json.loads(r'''[["index","sqlite_autoindex_agent_authority_grants_1","agent_authority_grants",null],["index","sqlite_autoindex_agent_authority_grants_2","agent_authority_grants",null],["index","sqlite_autoindex_agent_membership_epochs_1","agent_membership_epochs",null],["table","agent_authority_grants","agent_authority_grants","CREATE TABLE agent_authority_grants (\n        id TEXT PRIMARY KEY, issuer TEXT NOT NULL, subject TEXT NOT NULL,\n        client_id TEXT NOT NULL, resource TEXT NOT NULL,\n        user_id TEXT NOT NULL REFERENCES users(id), workspace_id TEXT NOT NULL REFERENCES workspaces(id),\n        node_id TEXT NOT NULL, membership_epoch TEXT NOT NULL, scopes TEXT NOT NULL,\n        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,\n        UNIQUE(issuer,subject,client_id,workspace_id,node_id),\n        FOREIGN KEY(issuer,subject) REFERENCES external_identities(issuer,subject) ON DELETE CASCADE ON UPDATE CASCADE\n      )"],["table","agent_membership_epochs","agent_membership_epochs","CREATE TABLE agent_membership_epochs (\n        workspace_id TEXT NOT NULL,\n        user_id TEXT NOT NULL,\n        epoch TEXT NOT NULL CHECK(length(epoch)=32 AND epoch NOT GLOB '*[^0-9a-f]*'),\n        PRIMARY KEY(workspace_id,user_id),\n        FOREIGN KEY(workspace_id,user_id) REFERENCES memberships(workspace_id,user_id)\n          ON DELETE CASCADE ON UPDATE CASCADE\n      )"],["trigger","agent_authority_external_delete","external_identities","CREATE TRIGGER agent_authority_external_delete AFTER DELETE ON external_identities BEGIN\n        DELETE FROM agent_authority_grants WHERE issuer=OLD.issuer AND subject=OLD.subject;\n      END"],["trigger","agent_authority_external_insert","external_identities","CREATE TRIGGER agent_authority_external_insert AFTER INSERT ON external_identities BEGIN\n        DELETE FROM agent_authority_grants WHERE issuer=NEW.issuer AND subject=NEW.subject;\n      END"],["trigger","agent_authority_external_update","external_identities","CREATE TRIGGER agent_authority_external_update AFTER UPDATE ON external_identities BEGIN\n        DELETE FROM agent_authority_grants WHERE (issuer=OLD.issuer AND subject=OLD.subject)\n          OR (issuer=NEW.issuer AND subject=NEW.subject);\n      END"],["trigger","agent_membership_epochs_delete","memberships","CREATE TRIGGER agent_membership_epochs_delete\n      AFTER DELETE ON memberships BEGIN\n        DELETE FROM agent_membership_epochs WHERE workspace_id=OLD.workspace_id AND user_id=OLD.user_id;\n      END"],["trigger","agent_membership_epochs_insert","memberships","CREATE TRIGGER agent_membership_epochs_insert\n      AFTER INSERT ON memberships BEGIN\n        INSERT INTO agent_membership_epochs(workspace_id,user_id,epoch)\n        VALUES(NEW.workspace_id,NEW.user_id,lower(hex(randomblob(16))))\n        ON CONFLICT(workspace_id,user_id) DO UPDATE SET epoch=excluded.epoch;\n      END"],["trigger","agent_membership_epochs_update","memberships","CREATE TRIGGER agent_membership_epochs_update\n      AFTER UPDATE ON memberships BEGIN\n        DELETE FROM agent_membership_epochs WHERE workspace_id=OLD.workspace_id AND user_id=OLD.user_id;\n        INSERT INTO agent_membership_epochs(workspace_id,user_id,epoch)\n        VALUES(NEW.workspace_id,NEW.user_id,lower(hex(randomblob(16))))\n        ON CONFLICT(workspace_id,user_id) DO UPDATE SET epoch=excluded.epoch;\n      END"],["trigger","agent_membership_epochs_user_delete","users","CREATE TRIGGER agent_membership_epochs_user_delete\n      AFTER DELETE ON users BEGIN\n        DELETE FROM agent_membership_epochs WHERE user_id=OLD.id;\n      END"],["trigger","agent_membership_epochs_user_insert","users","CREATE TRIGGER agent_membership_epochs_user_insert\n      AFTER INSERT ON users BEGIN\n        INSERT INTO agent_membership_epochs(workspace_id,user_id,epoch)\n        SELECT workspace_id,user_id,lower(hex(randomblob(16))) FROM memberships WHERE user_id=NEW.id\n        ON CONFLICT(workspace_id,user_id) DO UPDATE SET epoch=excluded.epoch;\n      END"],["trigger","agent_membership_epochs_user_state","users","CREATE TRIGGER agent_membership_epochs_user_state\n      AFTER UPDATE OF disabled_at ON users WHEN OLD.disabled_at IS NOT NEW.disabled_at BEGIN\n        UPDATE agent_membership_epochs SET epoch=lower(hex(randomblob(16))) WHERE user_id=NEW.id;\n      END"],["trigger","agent_membership_epochs_workspace_delete","workspaces","CREATE TRIGGER agent_membership_epochs_workspace_delete\n      AFTER DELETE ON workspaces BEGIN\n        DELETE FROM agent_membership_epochs WHERE workspace_id=OLD.id;\n      END"],["trigger","agent_membership_epochs_workspace_insert","workspaces","CREATE TRIGGER agent_membership_epochs_workspace_insert\n      AFTER INSERT ON workspaces BEGIN\n        INSERT INTO agent_membership_epochs(workspace_id,user_id,epoch)\n        SELECT workspace_id,user_id,lower(hex(randomblob(16))) FROM memberships WHERE workspace_id=NEW.id\n        ON CONFLICT(workspace_id,user_id) DO UPDATE SET epoch=excluded.epoch;\n      END"],["trigger","agent_membership_epochs_workspace_state","workspaces","CREATE TRIGGER agent_membership_epochs_workspace_state\n      AFTER UPDATE OF disabled_at ON workspaces WHEN OLD.disabled_at IS NOT NEW.disabled_at BEGIN\n        UPDATE agent_membership_epochs SET epoch=lower(hex(randomblob(16))) WHERE workspace_id=NEW.id;\n      END"]]'''))
AUTHORITY_COMPONENTS = ('agent-authority', 'agent-membership-epochs')
AUTHORITY_TABLES = ('agent_authority_grants', 'agent_membership_epochs')
IDENTITY_DATABASE = 'db/identity.db'


def validate_migration_contract(profile, value):
    owned_config_fields(profile)
    require(value is None or (type(value) is str and value == 'agent-authority-v1'), 'migration_contract_invalid')
    require(value is None or profile == 'mcp-only', 'migration_profile_invalid')
    return value


def _database_files(root, tick):
    root = Path(root)
    directory = root / 'db'
    require(root.is_dir() and not root.is_symlink() and directory.is_dir() and not directory.is_symlink(),
            'runtime_database_directory_required')
    result, total = [], 0
    for path in sorted(directory.rglob('*')):
        tick()
        metadata = path.lstat()
        require(stat.S_ISDIR(metadata.st_mode) or stat.S_ISREG(metadata.st_mode), 'database_special_file_denied')
        if path.is_file() and path.suffix in ('.db', '.sqlite', '.sqlite3'):
            total += metadata.st_size
            require(total <= 64 * 1024 * 1024 and len(result) < 1000, 'database_inventory_limit')
            result.append(path)
    require(bool(result), 'database_inventory_empty')
    return result


def _readonly_database(path, tick, cold):
    tick()
    wal = Path(str(path) + '-wal')
    require(not wal.is_symlink(), 'database_wal_link_denied')
    if cold:
        require(not wal.exists() or wal.stat().st_size == 0, 'cold_database_wal_not_empty')
    db = sqlite3.connect(path.resolve().as_uri() + '?mode=ro' + ('&immutable=1' if cold else ''), uri=True, timeout=1)
    try:
        db.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, 8 * 1024 * 1024)
        db.setlimit(sqlite3.SQLITE_LIMIT_SQL_LENGTH, 1024 * 1024)
        db.execute('PRAGMA query_only=ON')
        db.execute('PRAGMA cache_size=-512')
        def progress():
            try:
                tick()
                return 0
            except RuntimeError:
                return 1
        db.set_progress_handler(progress, 1000)
        if cold:
            require(db.execute('PRAGMA quick_check').fetchall() == [('ok',)], 'database_integrity')
            require(not db.execute('PRAGMA foreign_key_check').fetchall(), 'database_foreign_keys')
        return db
    except BaseException:
        db.close()
        raise


def _schema_rows(db):
    rows = db.execute('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').fetchmany(1001)
    require(len(rows) <= 1000, 'schema_object_limit')
    require(sum(len(row[3] or '') for row in rows) <= 1024 * 1024, 'schema_definition_limit')
    return rows


def schema_details(root, tick=lambda: None, cold=True):
    root = Path(root)
    result = {}
    for path in _database_files(root, tick):
        db = _readonly_database(path, tick, cold)
        try:
            result[path.relative_to(root).as_posix()] = _schema_rows(db)
        finally:
            db.close()
    return result


def _object_map(rows):
    require(type(rows) in (tuple, list), 'schema_rows_invalid')
    result = {}
    for row in rows:
        require(type(row) in (tuple, list) and len(row) == 4 and
                all(type(value) is str for value in row[:3]) and (row[3] is None or type(row[3]) is str),
                'schema_row_invalid')
        key = (row[0], row[1])
        require(key not in result, 'schema_duplicate_object')
        result[key] = tuple(row)
    return result


def verify_schema_transition(before, after, contract, allow_baseline=False):
    require(type(before) is dict and type(after) is dict and before and set(before) == set(after), 'schema_database_changed')
    old = {name: _object_map(rows) for name, rows in before.items()}
    new = {name: _object_map(rows) for name, rows in after.items()}
    if contract is None:
        require(old == new, 'schema_changed_without_contract')
        return 'unchanged'
    require(type(contract) is str and contract == 'agent-authority-v1', 'migration_contract_invalid')
    require(IDENTITY_DATABASE in old, 'migration_identity_required')
    expected = _object_map(AUTHORITY_V1_OBJECTS)
    reserved = {row[1] for row in AUTHORITY_V1_OBJECTS}
    require(not any(row[1] in reserved for row in old[IDENTITY_DATABASE].values()), 'migration_source_not_pristine')
    if allow_baseline and old == new:
        return 'unchanged'
    target = dict(old[IDENTITY_DATABASE])
    target.update(expected)
    require(new[IDENTITY_DATABASE] == target, 'migration_schema_not_exact')
    require(all(old[name] == new[name] for name in old if name != IDENTITY_DATABASE), 'migration_other_database_changed')
    return 'agent-authority-v1'


def _quote_identifier(value):
    return '"' + value.replace('"', '""') + '"'


def _row_hmac(row, key):
    value = hmac.new(key, b'chunlack-typed-row-v1\x00', hashlib.sha256)
    value.update(struct.pack('>I', len(row)))
    for cell in row:
        if cell is None:
            kind, data = b'n', b''
        elif type(cell) is int:
            kind, data = b'i', str(cell).encode('ascii')
        elif type(cell) is float:
            kind, data = b'f', struct.pack('>d', cell)
        elif type(cell) is str:
            kind, data = b't', cell.encode('utf-8')
        elif type(cell) is bytes:
            kind, data = b'b', cell
        else:
            raise RuntimeError('fingerprint_sqlite_value_invalid')
        value.update(kind)
        value.update(struct.pack('>Q', len(data)))
        for offset in range(0, len(data), 65536):
            value.update(memoryview(data)[offset:offset + 65536])
    return value.digest()


def _table_fingerprint(db, table, key, spill, tick, budget, where=''):
    # Sorting fixed-size HMACs on private disk preserves duplicate rows exactly,
    # without retaining raw user values or an unbounded Python Counter in RAM.
    spill.execute('DELETE FROM row_hashes')
    query = 'SELECT * FROM ' + _quote_identifier(table) + where
    cursor = db.execute(query)
    columns = [description[0] for description in cursor.description]
    count = 0
    for row in cursor:
        tick()
        budget[0] += 1
        budget[1] += sum(len(cell.encode('utf-8')) if type(cell) is str else len(cell) if type(cell) is bytes else 8 for cell in row)
        require(budget[0] <= 250000 and budget[1] <= 64 * 1024 * 1024, 'fingerprint_data_limit')
        spill.execute('INSERT INTO row_hashes VALUES(?)', (_row_hmac(row, key),))
        count += 1
    value = hmac.new(key, b'chunlack-row-multiset-v1\x00', hashlib.sha256)
    value.update(json.dumps(columns, ensure_ascii=True, separators=(',', ':')).encode('ascii'))
    for (row_hash,) in spill.execute('SELECT digest FROM row_hashes ORDER BY digest'):
        tick()
        value.update(row_hash)
    return {'rows': count, 'hmac': value.hexdigest()}


def copy_data_fingerprint(root, key, tick=lambda: None):
    require(type(key) is bytes and len(key) >= 32, 'fingerprint_private_key_required')
    root = Path(root)
    started = int(time.time() * 1000)
    result = {'startedAtMs': started, 'schemas': {}, 'tables': {}, 'authorityVersions': [], 'epoch': None}
    budget = [0, 0]
    with tempfile.TemporaryDirectory(prefix='chunlack-fingerprint-') as tmp:
        scratch = Path(tmp) / 'row-hashes.sqlite'
        with scratch.open('xb'):
            os.chmod(scratch, 0o600)
        spill = sqlite3.connect(scratch)
        try:
            spill.execute('PRAGMA journal_mode=OFF')
            spill.execute('PRAGMA synchronous=OFF')
            spill.execute('PRAGMA cache_size=-512')
            spill.execute('PRAGMA temp_store=FILE')
            spill.execute('CREATE TABLE row_hashes(digest BLOB NOT NULL)')
            for path in _database_files(root, tick):
                tick()
                name = path.relative_to(root).as_posix()
                db = _readonly_database(path, tick, True)
                try:
                    rows = _schema_rows(db)
                    result['schemas'][name] = rows
                    tables = [row[1] for row in rows if row[0] == 'table' and not row[1].startswith('sqlite_')]
                    result['tables'][name] = {}
                    for table in tables:
                        where = " WHERE component IS NULL OR component NOT IN ('agent-authority','agent-membership-epochs')" if name == IDENTITY_DATABASE and table == 'schema_version' else ''
                        result['tables'][name][table] = _table_fingerprint(db, table, key, spill, tick, budget, where)
                    if name == IDENTITY_DATABASE:
                        require('schema_version' in tables and 'memberships' in tables, 'migration_identity_tables_missing')
                        result['authorityVersions'] = db.execute("SELECT component,version,applied_at FROM schema_version WHERE component IN ('agent-authority','agent-membership-epochs') ORDER BY component").fetchall()
                        if 'agent_membership_epochs' in tables:
                            missing = db.execute('SELECT count(*) FROM memberships m LEFT JOIN agent_membership_epochs e ON e.workspace_id=m.workspace_id AND e.user_id=m.user_id WHERE e.epoch IS NULL').fetchone()[0]
                            orphan = db.execute('SELECT count(*) FROM agent_membership_epochs e LEFT JOIN memberships m ON e.workspace_id=m.workspace_id AND e.user_id=m.user_id WHERE m.user_id IS NULL').fetchone()[0]
                            invalid = db.execute("SELECT count(*) FROM agent_membership_epochs WHERE typeof(epoch)!='text' OR length(epoch)!=32 OR epoch GLOB '*[^0-9a-f]*'").fetchone()[0]
                            result['epoch'] = {'missing': missing, 'orphan': orphan, 'invalid': invalid}
                finally:
                    db.close()
        finally:
            spill.close()
    result['finishedAtMs'] = int(time.time() * 1000)
    require(result['finishedAtMs'] >= started, 'fingerprint_clock_reversed')
    return result


def verify_copy_migration(before, after, contract, phase):
    require(type(contract) is str and contract == 'agent-authority-v1', 'migration_contract_invalid')
    require(phase in ('candidate', 'previous', 'repeat', 'fault'), 'migration_phase_invalid')
    if phase != 'candidate':
        verify_schema_transition(before['schemas'], after['schemas'], None)
        require(before['tables'] == after['tables'] and before['authorityVersions'] == after['authorityVersions'] and
                before['epoch'] == after['epoch'], 'migration_repeat_or_fault_changed_data')
        return
    verify_schema_transition(before['schemas'], after['schemas'], contract)
    require(not before['authorityVersions'], 'migration_source_versions_exist')
    old, new = before['tables'], after['tables']
    require(set(old) == set(new), 'migration_database_inventory_changed')
    for database, tables in old.items():
        additions = set(AUTHORITY_TABLES) if database == IDENTITY_DATABASE else set()
        require(set(new[database]) == set(tables) | additions, 'migration_table_inventory_changed')
        require(all(new[database][table] == value for table, value in tables.items()), 'migration_original_rows_changed')
    versions = after['authorityVersions']
    require(len(versions) == 2 and [row[0] for row in versions] == list(AUTHORITY_COMPONENTS), 'migration_component_versions_invalid')
    require(all(type(row[1]) is int and row[1] == 1 and type(row[2]) is int and
                before['finishedAtMs'] <= row[2] <= after['startedAtMs'] for row in versions), 'migration_component_version_or_time_invalid')
    require(new[IDENTITY_DATABASE]['agent_authority_grants']['rows'] == 0, 'migration_unexpected_grant')
    require(after['epoch'] == {'missing': 0, 'orphan': 0, 'invalid': 0} and
            new[IDENTITY_DATABASE]['agent_membership_epochs']['rows'] == old[IDENTITY_DATABASE]['memberships']['rows'],
            'migration_epoch_backfill_invalid')



def _canonical_hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=True, separators=(',', ':')).encode()).hexdigest()


def code_inventory(root):
    root = Path(root)
    require(root.is_dir() and not root.is_symlink(), 'proof_code_directory_invalid')
    result, total = {}, 0
    for directory, dirs, files in os.walk(root, followlinks=False):
        base = Path(directory)
        dirs[:] = sorted(name for name in dirs if name != 'node_modules')
        require(not any((base / name).is_symlink() for name in dirs), 'proof_code_link_denied')
        for name in sorted(files):
            path = base / name
            relative = path.relative_to(root).as_posix()
            if relative == 'config/lack.config.json':
                continue  # Generated deployment configuration is not executable source.
            metadata = path.lstat()
            require(stat.S_ISREG(metadata.st_mode), 'proof_code_special_file_denied')
            total += metadata.st_size
            require(metadata.st_size <= 4 * 1024 * 1024 and total <= 64 * 1024 * 1024 and len(result) < 1000,
                    'proof_code_inventory_limit')
            result[relative] = digest(path)
    require(bool(result), 'proof_code_inventory_empty')
    return result


def _public_policy(config):
    runtime = config.get('publicRuntime', {})
    selected = {key: runtime[key] for key in ('webOrigin', 'agentsOrigin', 'mcpPort', 'nodeRestPublic') if key in runtime}
    if 'agentOAuth' in runtime:
        oauth = runtime['agentOAuth']
        selected['agentOAuth'] = {key: oauth[key] for key in
            ('enabled', 'discoveryOnly', 'issuer', 'resource', 'jwksUri', 'browserClientId', 'clientIds') if key in oauth}
    if 'events' in runtime:
        selected['events'] = {'enabled': runtime['events'].get('enabled')}
    return {'httpPort': config.get('httpPort'), 'agentGatewayPort': config.get('agentGateway', {}).get('port'), 'runtime': selected}


def _prepared_binding(settings):
    return {name: value for name, value in settings.get('preparedHashes', {}).items() if name != 'schema-compatibility-report.json'}


def verify_compatibility_proof_content(proof, settings, candidate, current, prepared, now=None):
    contract = validate_migration_contract(settings.get('releaseProfile', 'discovery-only'), settings.get('migrationContract'))
    require(contract == 'agent-authority-v1', 'proof_contract_required')
    require(type(proof) is dict and proof.get('version') == 1 and proof.get('status') == 'passed' and
            proof.get('migrationContract') == contract and proof.get('releaseProfile') == 'mcp-only', 'proof_header_invalid')
    created, expires = proof.get('createdAtMs'), proof.get('expiresAtMs')
    moment = int(time.time() * 1000) if now is None else now
    require(type(created) is int and type(expires) is int and created <= moment <= expires and
            0 < expires - created <= 3600000, 'proof_expired_or_invalid_time')
    validate_release_config(prepared, 'mcp-only', settings.get('approvedAgentClientIds'))
    baseline = proof.get('baselineSchemaDetails')
    verify_schema_transition(baseline, baseline, contract, allow_baseline=True)
    expected = {'catalogSHA256': _canonical_hash(AUTHORITY_V1_OBJECTS),
                'candidate': code_inventory(candidate), 'previous': code_inventory(current),
                'baselineSchemaSHA256': _canonical_hash(baseline), 'policySHA256': _canonical_hash(_public_policy(prepared)),
                'stageHashesSHA256': _canonical_hash(settings.get('stageHashes', {})),
                'preparedHashesSHA256': _canonical_hash(_prepared_binding(settings))}
    require(proof.get('bindings') == expected, 'proof_binding_drift')
    boots = proof.get('boots')
    require(type(boots) is list and len(boots) == 3 and
            [boot.get('runtime') for boot in boots if type(boot) is dict] == ['candidate', 'previous', 'candidate-repeat'] and
            all(boot.get('cleanClose') is True and boot.get('dataVerified') is True for boot in boots), 'proof_boots_incomplete')
    validations = proof.get('validations')
    required = {'exactSchema', 'dataPreserved', 'epochsBackfilled', 'zeroGrants', 'faultAtomic', 'integrityAndForeignKeys', 'idempotent'}
    require(type(validations) is dict and set(validations) == required and all(value is True for value in validations.values()),
            'proof_validations_incomplete')
    require(proof.get('networkIsolated') is True and proof.get('rollbackBackup') is False and proof.get('actualModelCalls') is False,
            'proof_scope_invalid')
    return proof


def verify_compatibility_proof(report, settings, candidate, current):
    report = Path(report)
    require(os.name == 'posix', 'proof_private_metadata_requires_posix')
    for parent in (report.parent, *report.parent.parents):
        require(not parent.is_symlink(), 'proof_parent_link_denied')
    parent_metadata = report.parent.lstat()
    require(parent_metadata.st_uid == 0 and stat.S_IMODE(parent_metadata.st_mode) == 0o700, 'proof_parent_not_private')
    require(report.name == 'schema-compatibility-report.json', 'proof_filename_invalid')
    descriptor = os.open(report, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, 'rb') as stream:
        metadata = os.fstat(stream.fileno())
        require(stat.S_ISREG(metadata.st_mode) and metadata.st_uid == 0 and metadata.st_nlink == 1 and
                stat.S_IMODE(metadata.st_mode) == 0o600 and metadata.st_size <= 1024 * 1024, 'proof_file_not_private')
        payload = stream.read(1024 * 1024 + 1)
    require(len(payload) <= 1024 * 1024 and settings.get('preparedHashes', {}).get(report.name) == hashlib.sha256(payload).hexdigest(),
            'proof_prepared_hash_missing_or_changed')
    prepared = json.loads((report.parent / 'candidate-config.json').read_text())
    return verify_compatibility_proof_content(json.loads(payload), settings, candidate, current, prepared)


def require_pristine_authority_versions(root, tick=lambda: None, cold=True):
    path = Path(root) / IDENTITY_DATABASE
    db = _readonly_database(path, tick, cold)
    try:
        require(not db.execute("SELECT 1 FROM schema_version WHERE component IN ('agent-authority','agent-membership-epochs') LIMIT 1").fetchone(),
                'migration_source_versions_exist')
    finally:
        db.close()


def owned_config_fields(profile):
    require(type(profile) is str and profile in ('discovery-only', 'mcp-only'), 'release_profile_invalid')
    return ('agentOAuth', 'nodeRestPublic') if profile == 'mcp-only' else ('agentOAuth',)


def validate_release_config(config, profile='discovery-only', approved_client_ids=None):
    owned_config_fields(profile)
    require(isinstance(config, dict) and isinstance(config.get('publicRuntime'), dict), 'release_policy_runtime')
    runtime = config['publicRuntime']
    oauth = runtime.get('agentOAuth')
    require(isinstance(oauth, dict) and oauth.get('enabled') is True, 'release_policy_oauth_enabled')
    require(oauth.get('discoveryOnly') is (profile == 'discovery-only'), 'release_policy_discovery_mode')
    if 'nodeRestPublic' in runtime:
        require(type(runtime['nodeRestPublic']) is bool, 'release_policy_rest_boolean')
    if profile == 'mcp-only':
        require(runtime.get('nodeRestPublic') is False, 'release_policy_public_rest')
        clients = oauth.get('clientIds')
        require(type(clients) is list and 1 <= len(clients) <= 32 and
                all(type(value) is str and 1 <= len(value) <= 256 and
                    not any(ord(char) <= 32 or ord(char) == 127 for char in value) and value != oauth.get('browserClientId') for value in clients) and
                len(set(clients)) == len(clients), 'release_policy_agent_clients')
        require(type(approved_client_ids) in (list, tuple) and list(approved_client_ids) == clients,
                'release_policy_client_approval')


def revert_owned_config(original, current, profile='discovery-only'):
    result = json.loads(json.dumps(current))
    previous = original.get('publicRuntime', {})
    for field in owned_config_fields(profile):
        if field in previous:
            result.setdefault('publicRuntime', {})[field] = json.loads(json.dumps(previous[field]))
        else:
            result.setdefault('publicRuntime', {}).pop(field, None)
    return result


def apply_owned_config(prepared, current, profile='discovery-only', approved_client_ids=None):
    validate_release_config(prepared, profile, approved_client_ids)
    result = json.loads(json.dumps(current))
    for field in owned_config_fields(profile):
        result.setdefault('publicRuntime', {})[field] = json.loads(json.dumps(prepared['publicRuntime'][field]))
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
        self.profile = getattr(backend, 'release_profile', 'discovery-only')
        approved = getattr(backend, 'approved_agent_client_ids', None)
        self.approved_clients = tuple(approved) if type(approved) in (list, tuple) else None
        self.w = window or Window()
        backend.w = self.w
        self.records = []
        self.backed_up = False
        self.schema_before = None
        self.schema_details_before = None
        self.migration_contract = None

    def record(self, phase):
        self.records.append({'phase': phase, 'seconds': round(self.w.elapsed(), 3)})
        self.b.report({'status': 'running', 'records': self.records})
        self.b.checkpoint(phase)
        self.w.tick()

    def backup(self):
        b = self.b
        require(not (b.data / '.public-runtime.lock').exists(), 'writer_lock_remains')
        self.schema_before = schemas(b.data, self.w.tick)
        if self.migration_contract:
            self.schema_details_before = schema_details(b.data, self.w.tick)
            verify_schema_transition(b.compatibility_proof['baselineSchemaDetails'], self.schema_details_before, None)
            require_pristine_authority_versions(b.data, self.w.tick)
            verify_compatibility_proof_content(b.compatibility_proof, b.settings, b.staged, b.current,
                                               json.loads(b.new_config.read_text()))
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
            self.migration_contract = validate_migration_contract(self.profile, getattr(b, 'migration_contract', None))
            b.preflight()
            if self.migration_contract:
                require(type(getattr(b, 'compatibility_proof', None)) is dict, 'migration_proof_required')
            prepared = json.loads(b.new_config.read_text())
            validate_release_config(prepared, self.profile, self.approved_clients)
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
            updated = apply_owned_config(prepared, json.loads(config_path.read_text()), self.profile, self.approved_clients)
            atomic_write((json.dumps(updated, indent=2) + '\n').encode(), config_path, self.w.tick)
            atomic_copy(b.local_caddy, b.caddy, self.w.tick)
            b.set_live_modes()
            self.record('candidate_configuration_installed')
            b.start(APP, 16)
            b.start(HTTPS, 10)
            b.check_candidate('loopback')
            if self.migration_contract:
                verify_schema_transition(self.schema_details_before, schema_details(b.data, self.w.tick, cold=False), self.migration_contract)
            else:
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
                      'releaseProfile': self.profile, 'agentBusinessAccess': False, 'credentialsChanged': False,
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
            if self.migration_contract:
                verify_schema_transition(self.schema_details_before, schema_details(b.data, self.w.tick), self.migration_contract, allow_baseline=True)
            else:
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
            updated = revert_owned_config(original, json.loads(path.read_text()), self.profile)
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
        self.release_profile = self.settings.get('releaseProfile', 'discovery-only')
        self.migration_contract = self.settings.get('migrationContract')
        approved = self.settings.get('approvedAgentClientIds')
        self.approved_agent_client_ids = tuple(approved) if type(approved) is list else None
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

    def check_migration_preflight(self):
        if validate_migration_contract(self.release_profile, self.migration_contract):
            self.compatibility_proof = verify_compatibility_proof(self.root / 'schema-compatibility-report.json', self.settings, self.staged, self.current)
            verify_schema_transition(self.compatibility_proof['baselineSchemaDetails'], schema_details(self.data, cold=False), None)
            require_pristine_authority_versions(self.data, self.w.tick, cold=False)

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
        self.check_migration_preflight()
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

    def check_backend_rest(self, config):
        port = config.get('agentGateway', {}).get('port', 13722)
        require(type(port) is int and 1 <= port <= 65535, 'release_policy_gateway_port')
        for method in ('GET', 'POST'):
            for path in ('/v1/manifest', '/v1/tasks/claim'):
                timeout = self.w.remaining(1)
                status = self.command(['curl', '--noproxy', '*', '--silent', '--show-error',
                                       '--max-time', str(timeout), '--connect-timeout', str(min(1, timeout)),
                                       '-o', '/dev/null', '-w', '%{http_code}', '-X', method,
                                       '-H', 'Authorization: Bearer discovery-denial-probe',
                                       '-H', 'X-Forwarded-Proto: https',
                                       '-H', 'X-Chunlack-Agent-Mode: ' + self.release_profile,
                                       'http://127.0.0.1:' + str(port) + path], cap=2)
                require(status.strip() == '404', 'backend_rest_not_denied')

    def check_candidate(self, mode):
        config = json.loads((self.data / 'config/lack.config.json').read_text())
        validate_release_config(config, self.release_profile, self.approved_agent_client_ids)
        self.assert_listener(mode)
        self.check_backend_rest(config)
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
