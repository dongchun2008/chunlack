import importlib.util
from contextlib import closing
import json
import os
from pathlib import Path
import socket
import sys
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



class McpOnlyReleaseTests(unittest.TestCase):
    def prepare(self, root, fail=None, prior='absent'):
        b = Fake(root, fail)
        b.release_profile = 'mcp-only'
        b.approved_agent_client_ids = ('fixture-agent',)
        path = b.data / 'config/lack.config.json'
        original = config(True)
        original['publicRuntime']['keep'] = {'user': 'original'}
        if prior != 'absent':
            original['publicRuntime']['nodeRestPublic'] = prior
        path.write_text(json.dumps(original))
        prepared = config(True)
        prepared['publicRuntime']['agentOAuth']['discoveryOnly'] = False
        prepared['publicRuntime']['agentOAuth']['clientIds'] = ['fixture-agent']
        prepared['publicRuntime']['nodeRestPublic'] = False
        b.new_config.write_text(json.dumps(prepared))
        return b, original

    def test_success_installs_mcp_flag_and_preserves_nonowned_configuration(self):
        for prior in ('absent', True, False):
            with self.subTest(prior=prior), tempfile.TemporaryDirectory(prefix='chunlack-mcp-') as tmp:
                b, original = self.prepare(Path(tmp), prior=prior)
                result = r.Transaction(b).execute()
                self.assertEqual(result['status'], 'released', result)
                value = json.loads((b.data / 'config/lack.config.json').read_text())
                self.assertIs(value['publicRuntime'].get('nodeRestPublic'), False)
                self.assertIs(value['publicRuntime']['agentOAuth']['discoveryOnly'], False)
                self.assertEqual(value['publicRuntime']['keep'], original['publicRuntime']['keep'])
                self.assertEqual(value['agents'], original['agents'])
                self.assertEqual(json.loads((b.backup / 'data/config/lack.config.json').read_text()), original)
                self.assertEqual(result.get('releaseProfile'), 'mcp-only')
                self.assertIs(result['agentBusinessAccess'], False)

    def test_mcp_rollback_restores_prior_flag_presence_and_preserves_every_new_write(self):
        phases = ['https_stopped', 'application_stopped', 'consistent_backup_verified',
                  'old_code_preserved', 'candidate_code_installed', 'candidate_configuration_installed',
                  'loopback_https_acceptance_passed', 'public_discovery_acceptance_passed']
        for prior in ('absent', True, False):
            for phase in phases:
                with self.subTest(prior=prior, phase=phase), tempfile.TemporaryDirectory(prefix='chunlack-mcp-') as tmp:
                    b, original = self.prepare(Path(tmp), phase, prior)
                    result = r.Transaction(b).execute()
                    self.assertEqual(result['status'], 'rolled_back', result)
                    value = json.loads((b.data / 'config/lack.config.json').read_text())
                    self.assertEqual(value['publicRuntime'], original['publicRuntime'])
                    written = phase in phases[-2:]
                    self.assertEqual(value['agents'], ['user-changed-model'] if written else ['original'])
                    self.assertEqual((b.data / 'new-upload').exists(), written)
                    if written:
                        self.assertEqual((b.data / 'new-upload').read_text(), 'keep')
                    db = sqlite3.connect(b.data / 'db/test.db')
                    try:
                        self.assertEqual(db.execute('SELECT value FROM evidence').fetchall(), [('new-write',)] if written else [])
                    finally:
                        db.close()
                    self.assertEqual((b.current / 'version').read_text(), 'old')
                    self.assertEqual(b.caddy.read_text(), 'old-caddy')
                    self.assertTrue(all(b.active.values()))

    def test_invalid_mcp_policy_fails_before_stopping_services(self):
        changes = [('enabled', False), ('enabled', 1), ('enabled', 'true'),
                   ('discoveryOnly', True), ('discoveryOnly', 0), ('discoveryOnly', 'false'),
                   ('nodeRestPublic', True), ('nodeRestPublic', 0), ('nodeRestPublic', None),
                   ('nodeRestPublic', 'false'), ('nodeRestPublic', 'missing'),
                   ('clientIds', ['not-approved'])]
        for field, value in changes:
            with self.subTest(field=field, value=value), tempfile.TemporaryDirectory(prefix='chunlack-mcp-') as tmp:
                b, original = self.prepare(Path(tmp))
                prepared = json.loads(b.new_config.read_text())
                target = prepared['publicRuntime'] if field == 'nodeRestPublic' else prepared['publicRuntime']['agentOAuth']
                if value == 'missing':
                    target.pop(field, None)
                else:
                    target[field] = value
                b.new_config.write_text(json.dumps(prepared))
                stops = []
                b.stop = lambda name, cap: stops.append(name)
                result = r.Transaction(b).execute()
                self.assertEqual(result['status'], 'preflight_failed', result)
                self.assertEqual(stops, [])
                self.assertTrue(all(b.active.values()))
                self.assertEqual(json.loads((b.data / 'config/lack.config.json').read_text()), original)
                self.assertFalse(b.previous.exists())

    def test_unknown_release_profile_fails_before_stopping_services(self):
        for profile in ('normal', '', True, {'mode': 'mcp-only'}):
            with self.subTest(profile=profile), tempfile.TemporaryDirectory(prefix='chunlack-mcp-') as tmp:
                b, _ = self.prepare(Path(tmp))
                b.release_profile = profile
                stops = []
                b.stop = lambda name, cap: stops.append(name)
                self.assertEqual(r.Transaction(b).execute()['status'], 'preflight_failed')
                self.assertEqual(stops, [])

    def test_default_discovery_profile_does_not_take_ownership_of_rest_flag(self):
        with tempfile.TemporaryDirectory(prefix='chunlack-mcp-') as tmp:
            b = Fake(Path(tmp))
            path = b.data / 'config/lack.config.json'
            original = config()
            original['publicRuntime']['nodeRestPublic'] = True
            path.write_text(json.dumps(original))
            prepared = config(True)
            prepared['publicRuntime']['nodeRestPublic'] = False
            b.new_config.write_text(json.dumps(prepared))
            result = r.Transaction(b).execute()
            self.assertEqual(result['status'], 'released', result)
            self.assertIs(json.loads(path.read_text())['publicRuntime']['nodeRestPublic'], True)

    def backend(self, b, backend_status=404, public_status=404):
        backend = object.__new__(r.LinuxBackend)
        backend.data, backend.w = b.data, r.Window()
        backend.release_profile = 'mcp-only'
        backend.approved_agent_client_ids = ('fixture-agent',)
        backend.probes = []
        backend.assert_listener = lambda mode: None
        backend.check_protected = lambda: None
        def request(host, path, method='GET'):
            if path == '/health':
                return 200, '', '{}'
            if path.startswith('/.well-known/'):
                return 200, '', json.dumps({'resource': 'https://agents.chunclaw.top/mcp',
                                          'authorization_servers': ['https://pockid.chunclaw.top']})
            if path == '/mcp':
                return 401, 'www-authenticate: bearer resource_metadata="https://agents.chunclaw.top/.well-known/oauth-protected-resource/mcp"', ''
            return public_status, '', ''
        def command(args, cap=3):
            backend.probes.append(args)
            return str(backend_status)
        backend.request, backend.command = request, command
        return backend

    def test_candidate_checks_backend_and_public_ingress_independently(self):
        with tempfile.TemporaryDirectory(prefix='chunlack-mcp-') as tmp:
            b, _ = self.prepare(Path(tmp))
            path = b.data / 'config/lack.config.json'
            path.write_text(b.new_config.read_text())
            backend = self.backend(b)
            backend.check_candidate('loopback')
            backend.check_candidate('public')
            self.assertGreaterEqual(len(backend.probes), 4)
            for args in backend.probes:
                self.assertIn('--noproxy', args)
                self.assertIn('X-Chunlack-Agent-Mode: mcp-only', args)
                self.assertIn('X-Forwarded-Proto: https', args)
                self.assertTrue(any(arg.startswith('http://127.0.0.1:13722/v1') for arg in args))

    def test_public_denial_cannot_mask_backend_mode_mismatch(self):
        for status in (200, 401, 503):
            with self.subTest(status=status), tempfile.TemporaryDirectory(prefix='chunlack-mcp-') as tmp:
                b, _ = self.prepare(Path(tmp))
                (b.data / 'config/lack.config.json').write_text(b.new_config.read_text())
                with self.assertRaisesRegex(RuntimeError, 'backend_rest_not_denied'):
                    self.backend(b, backend_status=status).check_candidate('loopback')

    def test_backend_denial_cannot_mask_public_ingress_mismatch(self):
        with tempfile.TemporaryDirectory(prefix='chunlack-mcp-') as tmp:
            b, _ = self.prepare(Path(tmp))
            (b.data / 'config/lack.config.json').write_text(b.new_config.read_text())
            with self.assertRaisesRegex(RuntimeError, 'rest_not_denied'):
                self.backend(b, public_status=401).check_candidate('public')

    def test_live_configuration_mismatch_fails_candidate_acceptance(self):
        with tempfile.TemporaryDirectory(prefix='chunlack-mcp-') as tmp:
            b, _ = self.prepare(Path(tmp))
            with self.assertRaisesRegex(RuntimeError, 'release_policy'):
                self.backend(b).check_candidate('loopback')

ACTUAL_CORRECTION_NODE_TEST = "'use strict';\nconst test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');\nconst input=JSON.parse(process.env.CHUNLACK_CORRECTION_CASE);\nconst productRoot=process.env.CHUNLACK_TEST_PRODUCT_ROOT;\nconst {publicAgentFixture}=require(path.join(productRoot,'tests/helpers/public-agent-fixture.cjs'));\ntest('actual schema runner proves private success and catches reject-all regression',{timeout:80000},async t=>{\n const f=await publicAgentFixture(t,{nodeRestPublic:false});\n const jwks=await fetch(f.config.publicRuntime.agentOAuth.jwksUri).then(r=>r.json());\n await f.runtime.close();\n const config={...f.config,publicRuntime:{...f.config.publicRuntime,...(input.targetRuntime||{})}};\n fs.mkdirSync(path.join(f.root,'config'),{recursive:true});\n fs.writeFileSync(path.join(f.root,'config/lack.config.json'),JSON.stringify(config),{mode:0o600});\n fs.writeFileSync(path.join(f.root,'oidc-public.json'),JSON.stringify({[config.publicRuntime.agentOAuth.jwksUri]:jwks}),{mode:0o600});\n const modulePath=path.join(f.root,'package/gateway/public-runtime.cjs'),runnerPath=path.join(f.root,'compatibility-runner.cjs');\n const baseRequire=require('node:module').createRequire(runnerPath),actual=require(modulePath),actualFetch=globalThis.fetch;\n async function execute(denyPrivate){let runtime,resolveExit;const lines=[],requests=[];\n  const completion=new Promise(resolve=>{resolveExit=resolve;});\n  const sandbox={__dirname:f.root,Buffer,URL,Request,Response,AbortSignal,setTimeout,clearTimeout,\n   process:{argv:['node',runnerPath,modulePath,f.root],env:{FIXTURE_GATEWAY_TOKEN:'x'.repeat(43),FIXTURE_EVENTS_KEY:Buffer.alloc(32,42).toString('hex')},exit:resolveExit},\n   console:{log:(...values)=>lines.push(values.join(' '))},\n   require:name=>name===modulePath?{...actual,startPublicRuntime:async options=>{runtime=await actual.startPublicRuntime(options);return runtime;}}:baseRequire(name),\n   fetch:async(url,options={})=>{const address=new URL(String(url));if(address.pathname==='/v1/manifest'){const h=new Headers(options.headers),forwarded=h.has('x-forwarded-proto');requests.push({forwarded,invalid:h.get('authorization')==='Bearer compatibility-denial-probe'});if(denyPrivate&&!forwarded)return new Response('{}',{status:401});}if(address.protocol==='http:'&&address.hostname==='127.0.0.1'){const headers=new Headers(options.headers);headers.set('Connection','close');return actualFetch(url,{...options,headers});}return actualFetch(url,options);}};\n  let timer;try{new vm.Script(input.runner,{filename:runnerPath}).runInNewContext(sandbox);const exit=await Promise.race([completion,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('actual_runner_timeout')),40000);})]);return{exit,lines,requests};}finally{clearTimeout(timer);await runtime?.close();}\n }\n\n const codeRequire=require('node:module').createRequire(modulePath),Database=codeRequire('better-sqlite3');\n const gatewayPath=path.join(f.root,'db/agent-gateway.db');\n function rows(){const db=new Database(gatewayPath);try{return db.prepare('SELECT * FROM nodes ORDER BY id').all();}finally{db.close();}}\n for(const state of ['active-full','total-full']){\n  const original=rows(),added=[];const db=new Database(gatewayPath);\n  try{const template=original[0];const wanted=state==='active-full'?5:100;\n   for(let n=original.length;n<wanted;n++){const id=require('node:crypto').randomUUID();added.push(id);db.prepare('INSERT INTO nodes(id,name,capabilities,scopes,revoked,created_at,workspace_id,created_by) VALUES(?,?,?,?,?,?,?,?)').run(id,'Synthetic capacity fixture','[\"browser.public_read\"]','[\"public\"]',state==='total-full'?1:0,Date.now(),template.workspace_id,template.created_by);}\n  }finally{db.close();}\n  try{\n   const snapshot=rows();assert.equal(snapshot.length,state==='active-full'?5:100);\n   const store=codeRequire('./store.cjs').createGatewayStore({dbPath:gatewayPath,multiUser:true});\n   try{assert.throws(()=>store.withWorkspace({workspaceId:f.workspaces.a.id,userId:f.user.id},()=>store.createNode({name:'Capacity must remain enforced',capabilities:['browser.public_read'],scopes:['public']})),error=>error.code==='node_capacity');}finally{store.close();}\n   const saturated=await execute(false);assert.equal(saturated.exit,0,state+': '+JSON.stringify(saturated.lines));\n   const proof=saturated.lines.map(line=>JSON.parse(line)).find(row=>row.compatibilityBoot==='passed');assert.equal(proof.privateNodeReadChecked,true);assert.equal(proof.validForwardedNodeDenied,true);\n   assert.deepEqual(rows(),snapshot,state+' must retain every existing node and remove only the probe');\n  }finally{const clean=new Database(gatewayPath);try{for(const id of added)clean.prepare('DELETE FROM nodes WHERE id=?').run(id);}finally{clean.close();}}\n  assert.deepEqual(rows(),original,'capacity fixture must clean only its own rows');\n }\n const beforeNormal=rows();\n const good=await execute(false);assert.equal(good.exit,0,JSON.stringify(good.lines));\n assert.ok(good.requests.some(x=>!x.forwarded&&!x.invalid),'must actually submit a valid isolated node credential');\n assert.ok(good.requests.some(x=>x.forwarded&&!x.invalid),'must deny forwarding of that same valid node credential');\n const proof=good.lines.map(line=>JSON.parse(line)).find(row=>row.compatibilityBoot==='passed');assert.equal(proof.privateNodeReadChecked,true);assert.equal(proof.validForwardedNodeDenied,true);\n assert.deepEqual(rows(),beforeNormal,'successful probe must preserve all original node rows');\n assert.equal(fs.existsSync(path.join(f.root,'.public-runtime.lock')),false);\n const denied=await execute(true);assert.equal(denied.exit,1,'rejecting every private credential must fail compatibility');\n assert.ok(denied.requests.some(x=>!x.forwarded&&!x.invalid),'negative control must reach the valid-credential check');\n assert.deepEqual(rows(),beforeNormal,'failed probe must also clean only its own row');\n assert.equal(fs.existsSync(path.join(f.root,'.public-runtime.lock')),false);\n});"


class CorrectionContractTests(unittest.TestCase):
    def test_explicit_approved_nonempty_clients_can_be_installed(self):
        with tempfile.TemporaryDirectory(prefix='chunlack-client-contract-') as tmp:
            b = Fake(Path(tmp))
            b.release_profile = 'mcp-only'
            b.approved_agent_client_ids = ('fixture-agent',)
            prepared = config(True)
            prepared['publicRuntime'].update(nodeRestPublic=False)
            prepared['publicRuntime']['agentOAuth'].update(discoveryOnly=False, clientIds=['fixture-agent'])
            b.new_config.write_text(json.dumps(prepared))
            result = r.Transaction(b).execute()
            self.assertEqual(result['status'], 'released', result)
            live = json.loads((b.data / 'config/lack.config.json').read_text())
            self.assertEqual(live['publicRuntime']['agentOAuth']['clientIds'], ['fixture-agent'])
            self.assertIs(live['publicRuntime']['nodeRestPublic'], False)

    def test_missing_or_different_client_approval_stops_before_services(self):
        for approved in (None, (), ('other-client',), 'fixture-agent', True):
            with self.subTest(approved=approved), tempfile.TemporaryDirectory(prefix='chunlack-client-contract-') as tmp:
                b = Fake(Path(tmp))
                b.release_profile = 'mcp-only'
                b.approved_agent_client_ids = approved
                prepared = config(True)
                prepared['publicRuntime']['nodeRestPublic'] = False
                prepared['publicRuntime']['agentOAuth'].update(discoveryOnly=False, clientIds=['fixture-agent'])
                b.new_config.write_text(json.dumps(prepared))
                stops = []
                b.stop = lambda name, cap: stops.append(name)
                result = r.Transaction(b).execute()
                self.assertEqual(result['status'], 'preflight_failed', result)
                self.assertEqual(stops, [])

    @unittest.skipUnless(os.environ.get('CHUNLACK_TEST_PRODUCT_ROOT') and os.environ.get('CHUNLACK_TEST_NODE'),
                         'actual product fixture requires explicit isolated source and Node paths')
    def test_actual_product_schema_runner_checks_valid_node_and_reject_all_negative_control(self):
        import ast
        import subprocess
        source = Path(__file__).with_name('stage-schema-compatibility-20261017.py').read_text()
        tree = ast.parse(source)
        runners = [node.args[0].value for node in ast.walk(tree)
                   if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                   and isinstance(node.func.value, ast.Name) and node.func.value.id == 'runner'
                   and node.func.attr == 'write_text' and node.args
                   and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str)]
        self.assertEqual(len(runners), 1)
        environment = dict(os.environ, PYTHON=sys.executable)
        target = {'publicRuntime': {'nodeRestPublic': False, 'agentOAuth': {
            'enabled': True, 'discoveryOnly': False, 'issuer': 'https://pocket.e2e.invalid',
            'resource': 'https://agents.e2e.invalid/mcp', 'jwksUri': 'https://pocket.e2e.invalid/jwks',
            'browserClientId': 'human-client', 'clientIds': ['agent-client']}}}
        installed = r.apply_owned_config(target, {}, 'mcp-only', ('agent-client',))
        environment['CHUNLACK_CORRECTION_CASE'] = json.dumps({'runner': runners[0], 'targetRuntime': installed['publicRuntime']})
        result = subprocess.run([environment['CHUNLACK_TEST_NODE'], '--test-reporter=tap', '-'], input=ACTUAL_CORRECTION_NODE_TEST,
                                text=True, encoding='utf-8', capture_output=True, cwd=environment['CHUNLACK_TEST_PRODUCT_ROOT'],
                                env=environment, timeout=85)
        self.assertEqual(result.returncode, 0, (result.stdout + result.stderr)[-10000:])
        self.assertIn('# pass 1', result.stdout)
        self.assertIn('# fail 0', result.stdout)



# Independent, accepted-copy catalog; never use the candidate as an oracle.
GATE_EXPECTED_OBJECTS = json.loads(r'''[["index","sqlite_autoindex_agent_authority_grants_1","agent_authority_grants",null],["index","sqlite_autoindex_agent_authority_grants_2","agent_authority_grants",null],["index","sqlite_autoindex_agent_membership_epochs_1","agent_membership_epochs",null],["table","agent_authority_grants","agent_authority_grants","CREATE TABLE agent_authority_grants (\n        id TEXT PRIMARY KEY, issuer TEXT NOT NULL, subject TEXT NOT NULL,\n        client_id TEXT NOT NULL, resource TEXT NOT NULL,\n        user_id TEXT NOT NULL REFERENCES users(id), workspace_id TEXT NOT NULL REFERENCES workspaces(id),\n        node_id TEXT NOT NULL, membership_epoch TEXT NOT NULL, scopes TEXT NOT NULL,\n        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,\n        UNIQUE(issuer,subject,client_id,workspace_id,node_id),\n        FOREIGN KEY(issuer,subject) REFERENCES external_identities(issuer,subject) ON DELETE CASCADE ON UPDATE CASCADE\n      )"],["table","agent_membership_epochs","agent_membership_epochs","CREATE TABLE agent_membership_epochs (\n        workspace_id TEXT NOT NULL,\n        user_id TEXT NOT NULL,\n        epoch TEXT NOT NULL CHECK(length(epoch)=32 AND epoch NOT GLOB '*[^0-9a-f]*'),\n        PRIMARY KEY(workspace_id,user_id),\n        FOREIGN KEY(workspace_id,user_id) REFERENCES memberships(workspace_id,user_id)\n          ON DELETE CASCADE ON UPDATE CASCADE\n      )"],["trigger","agent_authority_external_delete","external_identities","CREATE TRIGGER agent_authority_external_delete AFTER DELETE ON external_identities BEGIN\n        DELETE FROM agent_authority_grants WHERE issuer=OLD.issuer AND subject=OLD.subject;\n      END"],["trigger","agent_authority_external_insert","external_identities","CREATE TRIGGER agent_authority_external_insert AFTER INSERT ON external_identities BEGIN\n        DELETE FROM agent_authority_grants WHERE issuer=NEW.issuer AND subject=NEW.subject;\n      END"],["trigger","agent_authority_external_update","external_identities","CREATE TRIGGER agent_authority_external_update AFTER UPDATE ON external_identities BEGIN\n        DELETE FROM agent_authority_grants WHERE (issuer=OLD.issuer AND subject=OLD.subject)\n          OR (issuer=NEW.issuer AND subject=NEW.subject);\n      END"],["trigger","agent_membership_epochs_delete","memberships","CREATE TRIGGER agent_membership_epochs_delete\n      AFTER DELETE ON memberships BEGIN\n        DELETE FROM agent_membership_epochs WHERE workspace_id=OLD.workspace_id AND user_id=OLD.user_id;\n      END"],["trigger","agent_membership_epochs_insert","memberships","CREATE TRIGGER agent_membership_epochs_insert\n      AFTER INSERT ON memberships BEGIN\n        INSERT INTO agent_membership_epochs(workspace_id,user_id,epoch)\n        VALUES(NEW.workspace_id,NEW.user_id,lower(hex(randomblob(16))))\n        ON CONFLICT(workspace_id,user_id) DO UPDATE SET epoch=excluded.epoch;\n      END"],["trigger","agent_membership_epochs_update","memberships","CREATE TRIGGER agent_membership_epochs_update\n      AFTER UPDATE ON memberships BEGIN\n        DELETE FROM agent_membership_epochs WHERE workspace_id=OLD.workspace_id AND user_id=OLD.user_id;\n        INSERT INTO agent_membership_epochs(workspace_id,user_id,epoch)\n        VALUES(NEW.workspace_id,NEW.user_id,lower(hex(randomblob(16))))\n        ON CONFLICT(workspace_id,user_id) DO UPDATE SET epoch=excluded.epoch;\n      END"],["trigger","agent_membership_epochs_user_delete","users","CREATE TRIGGER agent_membership_epochs_user_delete\n      AFTER DELETE ON users BEGIN\n        DELETE FROM agent_membership_epochs WHERE user_id=OLD.id;\n      END"],["trigger","agent_membership_epochs_user_insert","users","CREATE TRIGGER agent_membership_epochs_user_insert\n      AFTER INSERT ON users BEGIN\n        INSERT INTO agent_membership_epochs(workspace_id,user_id,epoch)\n        SELECT workspace_id,user_id,lower(hex(randomblob(16))) FROM memberships WHERE user_id=NEW.id\n        ON CONFLICT(workspace_id,user_id) DO UPDATE SET epoch=excluded.epoch;\n      END"],["trigger","agent_membership_epochs_user_state","users","CREATE TRIGGER agent_membership_epochs_user_state\n      AFTER UPDATE OF disabled_at ON users WHEN OLD.disabled_at IS NOT NEW.disabled_at BEGIN\n        UPDATE agent_membership_epochs SET epoch=lower(hex(randomblob(16))) WHERE user_id=NEW.id;\n      END"],["trigger","agent_membership_epochs_workspace_delete","workspaces","CREATE TRIGGER agent_membership_epochs_workspace_delete\n      AFTER DELETE ON workspaces BEGIN\n        DELETE FROM agent_membership_epochs WHERE workspace_id=OLD.id;\n      END"],["trigger","agent_membership_epochs_workspace_insert","workspaces","CREATE TRIGGER agent_membership_epochs_workspace_insert\n      AFTER INSERT ON workspaces BEGIN\n        INSERT INTO agent_membership_epochs(workspace_id,user_id,epoch)\n        SELECT workspace_id,user_id,lower(hex(randomblob(16))) FROM memberships WHERE workspace_id=NEW.id\n        ON CONFLICT(workspace_id,user_id) DO UPDATE SET epoch=excluded.epoch;\n      END"],["trigger","agent_membership_epochs_workspace_state","workspaces","CREATE TRIGGER agent_membership_epochs_workspace_state\n      AFTER UPDATE OF disabled_at ON workspaces WHEN OLD.disabled_at IS NOT NEW.disabled_at BEGIN\n        UPDATE agent_membership_epochs SET epoch=lower(hex(randomblob(16))) WHERE workspace_id=NEW.id;\n      END"]]''')


class MigrationContractTests(unittest.TestCase):
    key = b'isolated-fingerprint-test-key-32!!'

    def fixture(self, root):
        (root / 'db').mkdir()
        with closing(sqlite3.connect(root / 'db/identity.db')) as db, db:
            db.executescript('''
                CREATE TABLE schema_version(component TEXT PRIMARY KEY,version INTEGER NOT NULL,applied_at INTEGER NOT NULL);
                CREATE TABLE users(id TEXT PRIMARY KEY,disabled_at INTEGER);
                CREATE TABLE workspaces(id TEXT PRIMARY KEY,disabled_at INTEGER);
                CREATE TABLE memberships(workspace_id TEXT,user_id TEXT,role TEXT,version INTEGER,
                  PRIMARY KEY(workspace_id,user_id),FOREIGN KEY(user_id) REFERENCES users(id),FOREIGN KEY(workspace_id) REFERENCES workspaces(id));
                CREATE TABLE external_identities(issuer TEXT,subject TEXT,user_id TEXT,PRIMARY KEY(issuer,subject));
                INSERT INTO schema_version VALUES('identity',2,1);
                INSERT INTO users VALUES('synthetic-user',NULL);
                INSERT INTO workspaces VALUES('synthetic-workspace',NULL);
                INSERT INTO memberships VALUES('synthetic-workspace','synthetic-user','owner',1);
                INSERT INTO external_identities VALUES('https://synthetic.invalid','subject','synthetic-user');
            ''')
        with closing(sqlite3.connect(root / 'db/lack.db')) as db, db:
            db.execute('CREATE TABLE evidence(value)')
            db.executemany('INSERT INTO evidence VALUES(?)', [(None,), (0,), (0.0,), ('0',), (b'0',),
                ('Unicode-\u4e2d\u6587',), ('Unicode-\u4e2d\u6587',), (b'x' * (2 * 1024 * 1024),)])

    def install(self, root):
        import time
        with closing(sqlite3.connect(root / 'db/identity.db')) as db, db:
            for kind, name, table, sql in GATE_EXPECTED_OBJECTS:
                if kind == 'table':
                    db.execute(sql)
            for kind, name, table, sql in GATE_EXPECTED_OBJECTS:
                if kind == 'trigger':
                    db.execute(sql)
            db.execute("INSERT INTO agent_membership_epochs SELECT workspace_id,user_id,? FROM memberships", ('a' * 32,))
            db.executemany('INSERT INTO schema_version VALUES(?,1,?)',
                [(name, int(time.time() * 1000)) for name in ('agent-authority', 'agent-membership-epochs')])

    def test_explicit_contract_and_default_strict_policy(self):
        self.assertIsNone(r.validate_migration_contract('discovery-only', None))
        self.assertIsNone(r.validate_migration_contract('mcp-only', None))
        self.assertEqual(r.validate_migration_contract('mcp-only', 'agent-authority-v1'), 'agent-authority-v1')
        for profile, value in [('mcp-only','unknown'), ('discovery-only','agent-authority-v1'),
                               ('unknown',None), ('mcp-only',False), ('mcp-only',{})]:
            with self.subTest(profile=profile,value=value), self.assertRaises(RuntimeError):
                r.validate_migration_contract(profile,value)
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);self.fixture(root)
            before=r.schema_details(root)
            self.assertEqual(r.verify_schema_transition(before,before,None),'unchanged')
            self.install(root)
            after=r.schema_details(root)
            with self.assertRaises(RuntimeError):r.verify_schema_transition(before,after,None)
            self.assertEqual(r.verify_schema_transition(before,after,'agent-authority-v1'),'agent-authority-v1')
            self.assertEqual(r.verify_schema_transition(before,before,'agent-authority-v1',allow_baseline=True),'unchanged')
            with self.assertRaises(RuntimeError):r.verify_schema_transition(before,before,'agent-authority-v1')
            with self.assertRaises(RuntimeError):r.verify_schema_transition(after,after,'agent-authority-v1')

    def test_exact_definitions_and_all_original_objects_required(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);self.fixture(root);before=r.schema_details(root);self.install(root);after=r.schema_details(root)
            mutations=[]
            for target in ['agent_authority_grants','agent_membership_epochs_insert','sqlite_autoindex_agent_authority_grants_1','users']:
                changed=json.loads(json.dumps(after))
                row=next(row for row in changed['db/identity.db'] if row[1]==target)
                row[3]=(row[3] or '')+' -- changed'
                mutations.append(changed)
            missing=json.loads(json.dumps(after));missing['db/identity.db'].pop();mutations.append(missing)
            extra=json.loads(json.dumps(after));extra['db/identity.db'].append(['table','extra','extra','CREATE TABLE extra(x)']);mutations.append(extra)
            other=json.loads(json.dumps(after));other['db/lack.db'][0][3]+=' ';mutations.append(other)
            for i, changed in enumerate(mutations):
                with self.subTest(case=i), self.assertRaises(RuntimeError):r.verify_schema_transition(before,changed,'agent-authority-v1')
            partial=json.loads(json.dumps(before));partial['db/identity.db'].append(GATE_EXPECTED_OBJECTS[0])
            with self.assertRaises(RuntimeError):r.verify_schema_transition(partial,after,'agent-authority-v1')

    def test_valid_copy_typed_multiset_and_idempotence(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);self.fixture(root)
            before=r.copy_data_fingerprint(root,self.key)
            self.install(root);after=r.copy_data_fingerprint(root,self.key)
            r.verify_copy_migration(before,after,'agent-authority-v1','candidate')
            repeated=r.copy_data_fingerprint(root,self.key)
            for phase in ('previous','repeat'):r.verify_copy_migration(after,repeated,'agent-authority-v1',phase)
            self.assertNotIn('synthetic-user',json.dumps(after));self.assertNotIn(self.key.decode(),json.dumps(after))
            other=r.copy_data_fingerprint(root,b'z'*32)
            self.assertNotEqual(after['tables'],other['tables'])
            with self.assertRaises(RuntimeError):r.copy_data_fingerprint(root,b'short')

    def test_old_rows_deletions_overwrites_types_and_duplicates_rejected(self):
        for sql, params in [
            ('DELETE FROM evidence WHERE rowid=1',()),
            ('UPDATE evidence SET value=? WHERE rowid=2',(b'0',)),
            ('UPDATE evidence SET value=? WHERE rowid=3',(0,)),
            ('DELETE FROM evidence WHERE rowid=6',()),
            ('INSERT INTO evidence VALUES(?)',('extra',)),
        ]:
            with self.subTest(sql=sql,params=repr(params)), tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);self.fixture(root);before=r.copy_data_fingerprint(root,self.key);self.install(root)
                with closing(sqlite3.connect(root/'db/lack.db')) as db, db:db.execute(sql,params)
                with self.assertRaises(RuntimeError):r.verify_copy_migration(before,r.copy_data_fingerprint(root,self.key),'agent-authority-v1','candidate')

    def test_version_epoch_and_initial_grant_invariants(self):
        for change in ('missing-version','extra-version','wrong-version','old-time','future-time','missing-epoch','wrong-epoch','wrong-binding','grant','existing-version'):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);self.fixture(root)
                if change=='existing-version':
                    with closing(sqlite3.connect(root/'db/identity.db')) as db, db:db.execute("INSERT INTO schema_version VALUES('agent-authority',1,1)")
                before=r.copy_data_fingerprint(root,self.key)
                if change=='existing-version':
                    # A partial version-only source must fail even if the final schema is complete.
                    with closing(sqlite3.connect(root/'db/identity.db')) as db, db:db.execute("DELETE FROM schema_version WHERE component='agent-authority'")
                self.install(root)
                with closing(sqlite3.connect(root/'db/identity.db')) as db, db:
                    if change=='missing-version':db.execute("DELETE FROM schema_version WHERE component='agent-authority'")
                    elif change=='extra-version':db.execute("INSERT INTO schema_version VALUES('unapproved',1,1)")
                    elif change=='wrong-version':db.execute("UPDATE schema_version SET version=2 WHERE component='agent-authority'")
                    elif change=='old-time':db.execute("UPDATE schema_version SET applied_at=1 WHERE component='agent-authority'")
                    elif change=='future-time':db.execute("UPDATE schema_version SET applied_at=9999999999999 WHERE component='agent-authority'")
                    elif change=='missing-epoch':db.execute('DELETE FROM agent_membership_epochs')
                    elif change=='wrong-epoch':
                        db.execute('PRAGMA ignore_check_constraints=ON');db.execute("UPDATE agent_membership_epochs SET epoch='bad'")
                    elif change=='wrong-binding':db.execute("UPDATE agent_membership_epochs SET user_id='wrong'")
                    elif change=='grant':db.execute("INSERT INTO agent_authority_grants VALUES('id','https://synthetic.invalid','subject','client','resource','synthetic-user','synthetic-workspace','node','epoch','[]',1,2)")
                with self.assertRaises((RuntimeError,sqlite3.DatabaseError)):
                    r.verify_copy_migration(before,r.copy_data_fingerprint(root,self.key),'agent-authority-v1','candidate')

    def test_failed_migration_must_be_atomic_and_epochs_must_not_reset(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);self.fixture(root);before=r.copy_data_fingerprint(root,self.key)
            r.verify_copy_migration(before,r.copy_data_fingerprint(root,self.key),'agent-authority-v1','fault')
            self.install(root);after=r.copy_data_fingerprint(root,self.key)
            with self.assertRaises(RuntimeError):r.verify_copy_migration(before,after,'agent-authority-v1','fault')
            with closing(sqlite3.connect(root/'db/identity.db')) as db, db:db.execute('UPDATE agent_membership_epochs SET epoch=?',('b'*32,))
            with self.assertRaises(RuntimeError):r.verify_copy_migration(after,r.copy_data_fingerprint(root,self.key),'agent-authority-v1','repeat')

    def test_readonly_limits_and_symlink_rejection(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);self.fixture(root)
            before={p.name:p.read_bytes() for p in (root/'db').iterdir()}
            r.copy_data_fingerprint(root,self.key)
            self.assertEqual(before,{p.name:p.read_bytes() for p in (root/'db').iterdir()})
            called=[]
            def stop():called.append(True);raise RuntimeError('bounded_cancel')
            with self.assertRaisesRegex(RuntimeError,'bounded_cancel'):r.copy_data_fingerprint(root,self.key,stop)
            self.assertTrue(called)
            with closing(sqlite3.connect(root/'db/lack.db')) as db, db:db.execute('INSERT INTO evidence VALUES(?)',(b'x'*(9*1024*1024),))
            with self.assertRaises((RuntimeError,sqlite3.DatabaseError)):r.copy_data_fingerprint(root,self.key)




    def test_null_component_version_row_is_preserved_or_loss_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);self.fixture(root)
            with closing(sqlite3.connect(root/'db/identity.db')) as db,db:
                db.execute('INSERT INTO schema_version VALUES(NULL,2,1)')
            before=r.copy_data_fingerprint(root,self.key);self.install(root)
            r.verify_copy_migration(before,r.copy_data_fingerprint(root,self.key),'agent-authority-v1','candidate')
            with closing(sqlite3.connect(root/'db/identity.db')) as db,db:
                db.execute('DELETE FROM schema_version WHERE component IS NULL')
            with self.assertRaisesRegex(RuntimeError,'migration_original_rows_changed'):
                r.verify_copy_migration(before,r.copy_data_fingerprint(root,self.key),'agent-authority-v1','candidate')


class MigrationIntegrationTests(unittest.TestCase):
    def prepare(self, root, fail=None):
        import hashlib,time
        b=Fake(root,fail)
        seed=root/'seed';seed.mkdir();MigrationContractTests().fixture(seed)
        for item in (seed/'db').iterdir():os.rename(item,b.data/'db'/item.name)
        b.release_profile='mcp-only';b.approved_agent_client_ids=('fixture-agent',);b.migration_contract='agent-authority-v1'
        prepared={'publicRuntime':{'nodeRestPublic':False,'agentOAuth':{'enabled':True,'discoveryOnly':False,'clientIds':['fixture-agent']}}}
        b.new_config=b.root/'candidate-config.json'
        b.new_config.write_text(json.dumps(prepared))
        b.settings={'releaseProfile':'mcp-only','migrationContract':'agent-authority-v1','stageHashes':{'version':hashlib.sha256(b'new').hexdigest()},'preparedHashes':{},'approvedAgentClientIds':['fixture-agent']}
        baseline=r.schema_details(b.data)
        stable=lambda value:hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=True,separators=(',',':')).encode()).hexdigest()
        now=int(time.time()*1000)
        policy={'httpPort':None,'agentGatewayPort':None,'runtime':{'nodeRestPublic':False,'agentOAuth':{'enabled':True,'discoveryOnly':False,'clientIds':['fixture-agent']}}}
        b.proof={'version':1,'status':'passed','releaseProfile':'mcp-only','migrationContract':'agent-authority-v1','createdAtMs':now,'expiresAtMs':now+3600000,
          'baselineSchemaDetails':baseline,'bindings':{'catalogSHA256':stable(GATE_EXPECTED_OBJECTS),
          'candidate':{'version':hashlib.sha256(b'new').hexdigest()},'previous':{'version':hashlib.sha256(b'old').hexdigest()},
          'baselineSchemaSHA256':stable(baseline),'policySHA256':stable(policy),
          'stageHashesSHA256':stable(b.settings['stageHashes']),'preparedHashesSHA256':stable({})},
          'boots':[{'runtime':name,'cleanClose':True,'dataVerified':True} for name in ('candidate','previous','candidate-repeat')],
          'validations':{'exactSchema':True,'dataPreserved':True,'epochsBackfilled':True,'zeroGrants':True,'faultAtomic':True,'integrityAndForeignKeys':True,'idempotent':True},
          'networkIsolated':True,'rollbackBackup':False,'actualModelCalls':False}
        real_preflight=b.preflight
        def preflight():
            real_preflight()
            b.compatibility_proof=r.verify_compatibility_proof_content(b.proof,b.settings,b.staged,b.current,json.loads(b.new_config.read_text()))
            with mock.patch.object(r,'verify_compatibility_proof',return_value=b.compatibility_proof):
                r.LinuxBackend.check_migration_preflight(b)
        b.preflight=preflight
        real_start=b.start
        def start(name,cap):
            if name==r.APP and (b.current/'version').read_text()=='new':
                with closing(sqlite3.connect(b.data/'db/identity.db')) as db:
                    migrated=db.execute("SELECT 1 FROM sqlite_master WHERE name='agent_authority_grants'").fetchone()
                if not migrated:MigrationContractTests().install(b.data)
            real_start(name,cap)
        b.start=start
        return b

    def test_exact_migration_can_release_and_rollback_preserves_new_writes(self):
        for fail in (None,'loopback_https_acceptance_passed'):
            with self.subTest(fail=fail),tempfile.TemporaryDirectory() as tmp:
                b=self.prepare(Path(tmp),fail);result=r.Transaction(b).execute()
                self.assertEqual(result['status'],'rolled_back' if fail else 'released',result)
                with closing(sqlite3.connect(b.data/'db/identity.db')) as db:
                    self.assertEqual(db.execute('SELECT count(*) FROM agent_authority_grants').fetchone()[0],0)
                    self.assertEqual(db.execute('SELECT count(*) FROM agent_membership_epochs').fetchone()[0],1)
                if fail:
                    self.assertEqual((b.data/'new-upload').read_text(),'keep')
                    self.assertEqual(json.loads((b.data/'config/lack.config.json').read_text())['agents'],['user-changed-model'])
                    with closing(sqlite3.connect(b.data/'db/test.db')) as db:self.assertEqual(db.execute('SELECT value FROM evidence').fetchall(),[('new-write',)])

    def test_missing_proof_and_unknown_contract_never_stop_services(self):
        for mode in ('missing','unknown'):
            with self.subTest(mode=mode),tempfile.TemporaryDirectory() as tmp:
                b=self.prepare(Path(tmp))
                if mode=='missing':b.preflight=lambda:None
                else:b.migration_contract='unapproved'
                result=r.Transaction(b).execute()
                self.assertEqual(result['status'],'preflight_failed',result);self.assertTrue(all(b.active.values()))

    def test_proof_status_alone_and_each_binding_drift_are_rejected(self):
        for mode in ('status-only','candidate','previous','policy','contract','catalog','baseline','stage','prepared','expired','missing-validation','missing-boot'):
            with self.subTest(mode=mode),tempfile.TemporaryDirectory() as tmp:
                b=self.prepare(Path(tmp))
                if mode=='status-only':b.proof={'status':'passed'}
                elif mode=='candidate':(b.staged/'version').write_text('changed')
                elif mode=='previous':(b.current/'version').write_text('changed')
                elif mode=='policy':
                    value=json.loads(b.new_config.read_text());value['publicRuntime']['agentOAuth']['clientIds']=['another'];b.new_config.write_text(json.dumps(value))
                elif mode=='contract':b.settings['migrationContract']=None
                elif mode=='catalog':b.proof['bindings']['catalogSHA256']='0'*64
                elif mode=='baseline':b.proof['baselineSchemaDetails']['db/identity.db'].append(['table','unexpected','unexpected','CREATE TABLE unexpected(x)'])
                elif mode=='stage':b.settings['stageHashes']['version']='0'*64
                elif mode=='prepared':b.settings['preparedHashes']['other']='0'*64
                elif mode=='expired':b.proof['expiresAtMs']=1
                elif mode=='missing-validation':del b.proof['validations']['faultAtomic']
                elif mode=='missing-boot':b.proof['boots'].pop()
                result=r.Transaction(b).execute()
                self.assertEqual(result['status'],'preflight_failed',result);self.assertTrue(all(b.active.values()))

    def test_cold_source_drift_rejected_before_code_switch(self):
        with tempfile.TemporaryDirectory() as tmp:
            b=self.prepare(Path(tmp));original=b.checkpoint
            def drift(phase):
                if phase=='application_stopped':
                    with closing(sqlite3.connect(b.data/'db/identity.db')) as db,db:db.execute('CREATE TABLE late_change(x)')
                original(phase)
            b.checkpoint=drift;result=r.Transaction(b).execute()
            self.assertNotEqual(result['status'],'released',result)
            self.assertEqual((b.current/'version').read_text(),'old')
            self.assertFalse(b.previous.exists())

    def test_partial_or_tampered_migration_never_claims_successful_recovery(self):
        for mode in ('missing','tampered','extra'):
            with self.subTest(mode=mode),tempfile.TemporaryDirectory() as tmp:
                b=self.prepare(Path(tmp));original=b.check_candidate
                def corrupt(which):
                    with closing(sqlite3.connect(b.data/'db/identity.db')) as db,db:
                        if mode=='missing':db.execute('DROP TRIGGER agent_authority_external_insert')
                        elif mode=='tampered':db.executescript('DROP TRIGGER agent_authority_external_insert;CREATE TRIGGER agent_authority_external_insert AFTER INSERT ON external_identities BEGIN SELECT 1;END;')
                        else:db.execute('CREATE TABLE unknown_addition(x)')
                    original(which)
                b.check_candidate=corrupt;result=r.Transaction(b).execute()
                self.assertEqual(result['status'],'recovery_requires_attention',result)
                self.assertFalse(all(b.active.values()))


    def test_version_only_partial_source_rejected_before_any_stop(self):
        for component in ('agent-authority','agent-membership-epochs'):
            with self.subTest(component=component),tempfile.TemporaryDirectory() as tmp:
                b=self.prepare(Path(tmp))
                with closing(sqlite3.connect(b.data/'db/identity.db')) as db,db:
                    db.execute('INSERT INTO schema_version VALUES(?,1,1)',(component,))
                stopped=[];original=b.stop
                def stop(name,cap):stopped.append(name);original(name,cap)
                b.stop=stop
                result=r.Transaction(b).execute()
                self.assertEqual(result['status'],'preflight_failed',result)
                self.assertEqual(result.get('error'),'migration_source_versions_exist',result)
                self.assertEqual(stopped,[]);self.assertTrue(all(b.active.values()))

    @unittest.skipUnless(os.name=='posix','requires POSIX proof ownership and mode')
    def test_private_proof_metadata_and_prepared_hash_binding(self):
        import hashlib
        with tempfile.TemporaryDirectory() as tmp:
            b=self.prepare(Path(tmp));proof_path=b.root/'schema-compatibility-report.json'
            proof_path.write_text(json.dumps(b.proof));proof_path.chmod(0o600);b.root.chmod(0o700)
            b.settings['preparedHashes'][proof_path.name]=hashlib.sha256(proof_path.read_bytes()).hexdigest()
            # Non-root test users may inspect no private root-owned proof; fail closed.
            if os.geteuid()!=0:
                with self.assertRaises(RuntimeError):r.verify_compatibility_proof(proof_path,b.settings,b.staged,b.current)
                return
            r.verify_compatibility_proof(proof_path,b.settings,b.staged,b.current)
            proof_path.chmod(0o644)
            with self.assertRaises(RuntimeError):r.verify_compatibility_proof(proof_path,b.settings,b.staged,b.current)
            proof_path.chmod(0o600);proof_path.write_text(json.dumps({'status':'passed'}))
            with self.assertRaises(RuntimeError):r.verify_compatibility_proof(proof_path,b.settings,b.staged,b.current)


class RehearsalSelectionTests(unittest.TestCase):
    def test_selection_preserves_default_and_single_case_assertions(self):
        import ast
        source=Path(__file__).with_name('rehearse-operational-release-20261017.py').read_text(encoding='utf-8')
        tree=ast.parse(source)
        functions=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='select_rehearsal_cases']
        self.assertEqual(len(functions),1,'missing bounded scenario selector')
        namespace={}
        exec(compile(ast.Module(body=functions,type_ignores=[]),'<rehearsal-selector>','exec'),namespace)
        select=namespace['select_rehearsal_cases']
        expected=(('success',None),('rollback','loopback_https_acceptance_passed'))
        self.assertEqual(select('all'),expected)
        self.assertEqual(select('success'),expected[:1])
        self.assertEqual(select('rollback'),expected[1:])
        for invalid in ('','both','SUCCESS',None,1):
            with self.subTest(invalid=invalid),self.assertRaises(ValueError):select(invalid)

if __name__ == '__main__':
    unittest.main(verbosity=2)
