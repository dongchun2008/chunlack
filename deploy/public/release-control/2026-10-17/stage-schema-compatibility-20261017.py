"""Compatibility-only live DB copies, isolated network, never a rollback backup."""
import hashlib
import secrets
import importlib.util
import json
import os
from pathlib import Path
import pwd
import signal
import sqlite3
import subprocess
import sys
import time

root = Path(sys.argv[1]).resolve(strict=True)
tag = root.name.removeprefix('chunlack-release-')
assert len(tag) == 12 and all(c in '0123456789abcdef' for c in tag)
assert root == Path('/var/lib/chunlack-release-' + tag)
container = Path('/opt/chunlack-public/staged-' + tag)
candidate = container / 'current'
shadow = container / 'schema-check'
assert not shadow.exists()
shadow.mkdir(mode=0o750)
os.chown(shadow, 0, 987)
shadow.chmod(0o750)
data = shadow / 'data'
data.mkdir(mode=0o700)
source = Path('/var/lib/chunlack-public')
files = sorted(source.rglob('*'))
databases = {p for p in files if p.is_relative_to(source / 'db') and p.is_file() and p.suffix in ('.db', '.sqlite', '.sqlite3')}
excluded = {source / '.public-runtime.lock'} | {Path(str(p) + suffix) for p in databases for suffix in ('-wal', '-shm', '-journal')}
deadline = time.monotonic() + 35
def tick(*args):
    if time.monotonic() >= deadline:
        raise RuntimeError('compatibility_copy_timeout')
    return None
for path in files:
    tick()
    assert not path.is_symlink()
    if path in excluded:
        continue
    target = data / path.relative_to(source)
    if path.is_dir():
        target.mkdir(mode=0o700)
    elif path in databases:
        src = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=1)
        dest = sqlite3.connect(target)
        try:
            src.backup(dest, pages=256, progress=tick, sleep=.01)
        finally:
            dest.close()
            src.close()
    else:
        assert path.is_file() and path.stat().st_size <= 64 * 1024 * 1024
        with path.open('rb') as src, target.open('xb') as dest:
            while True:
                tick()
                chunk = src.read(262144)
                if not chunk:
                    break
                dest.write(chunk)
spec = importlib.util.spec_from_file_location('release', root / 'release.py')
control = importlib.util.module_from_spec(spec)
spec.loader.exec_module(control)
initial = control.schemas(data)
config_path = data / 'config/lack.config.json'
original = json.loads(config_path.read_text())
prepared = json.loads((root / 'candidate-config.json').read_text())
settings = json.loads((root / 'settings.json').read_text())
release_profile = settings.get('releaseProfile', 'discovery-only')
approved_agent_client_ids = settings.get('approvedAgentClientIds')
control.validate_release_config(prepared, release_profile, approved_agent_client_ids)
migration_contract = control.validate_migration_contract(release_profile, settings.get('migrationContract'))
handoff_enabled = control.service_handoff_enabled(settings)
if handoff_enabled:
    control.configure_handoff_slice(tag)
handoff_identities = []
initial_details = control.schema_details(data) if migration_contract else None
private_key = secrets.token_bytes(32) if migration_contract else None
initial_data = control.copy_data_fingerprint(data, private_key) if migration_contract else None
code_before = {'candidate': control.code_inventory(candidate), 'previous': control.code_inventory(Path('/opt/chunlack-public/current'))} if migration_contract else None
for path in [data, *data.rglob('*')]:
    os.chown(path, 996, 987)
    path.chmod(0o700 if path.is_dir() else 0o600)
runner = shadow / 'runner.cjs'
public_fixture = shadow / 'oidc-public.json'
public_fixture.write_bytes((root / 'oidc-public.json').read_bytes())
os.chown(public_fixture, 0, 987)
public_fixture.chmod(0o640)
runner.write_text(r'''
'use strict';
if(process.argv[5]){
 const fs=require('node:fs'),uid=process.getuid(),gid=process.getgid();
 const slice='chunlackhandoff'+process.argv[5]+'.slice';
 const nnp=/^NoNewPrivs:\s+1\s*$/m.test(fs.readFileSync('/proc/self/status','utf8'));
 if(uid!==996||gid!==987||!nnp||!fs.readFileSync('/proc/self/cgroup','utf8').includes('/'+slice+'/'))
   throw Error('compatibility_service_identity_invalid');
 console.log(JSON.stringify({serviceProbe:'readable',uid,gid,slice,noNewPrivileges:nnp}));
}
const fs=require('node:fs'),path=require('node:path');
const compatibilityConfig=JSON.parse(fs.readFileSync(path.join(process.argv[3],'config/lack.config.json')));
const privatePorts=new Set([compatibilityConfig.httpPort,compatibilityConfig.agentGateway.port,compatibilityConfig.publicRuntime.mcpPort].map(String));
const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'oidc-public.json'))),networkFetch=globalThis.fetch;
globalThis.fetch=async(input,options)=>{
 const url=String(input instanceof Request?input.url:input);
 if(Object.hasOwn(fixture,url))return new Response(JSON.stringify(fixture[url]),{status:200,headers:{'Content-Type':'application/json'}});
 const address=new URL(url);
 if(address.protocol==='http:'&&address.hostname==='127.0.0.1'&&privatePorts.has(address.port))return networkFetch(input,options);
 throw Object.assign(Error('compatibility_network_denied'),{code:'compatibility_network_denied'});
};
async function main(){
 const modulePath=process.argv[2],data=process.argv[3];
 const config=compatibilityConfig;

 if(process.argv[4]==='fault-migration'){
  const localRequire=require('node:module').createRequire(modulePath);
  const Database=localRequire('better-sqlite3');
  const identity=localRequire('../identity/store.cjs').createIdentityStore({dbPath:path.join(data,'db/identity.db')});
  const db=new Database(path.join(data,'db/identity.db'));let observed=false;
  try{
   db.pragma('foreign_keys=ON');
   try{localRequire('../identity/agent-authority.cjs').createAgentAuthority({db,identity,
    workspaceAccess:{forHuman(){throw Error('unused_fault_access');}},
    verifier:{verify(){throw Error('unused_fault_verify');},consume(){throw Error('unused_fault_consume');}},
    config:compatibilityConfig.publicRuntime.agentOAuth,now:()=>NaN});}
   catch(error){if(error.code!=='invalid_clock')throw error;observed=true;}
  }finally{db.close();identity.close();}
  if(!observed)throw Error('migration_fault_not_observed');
  console.log(JSON.stringify({compatibilityBoot:'passed',faultAtomic:true}));return;
 }
 const runtime=await require(modulePath).startPublicRuntime({config,dataRoot:data,env:process.env});
 let privateNodeReadChecked=false,validForwardedNodeDenied=false;
 try{
  const health=await fetch('http://127.0.0.1:'+config.httpPort+'/health',{signal:AbortSignal.timeout(5000)});
  if(health.status!==200)throw Error('health_not_ready');
  if(config.publicRuntime.agentOAuth?.enabled&&(config.publicRuntime.agentOAuth.discoveryOnly===true||config.publicRuntime.nodeRestPublic===false)){
   const port=config.publicRuntime.mcpPort;
   const metadata=await fetch('http://127.0.0.1:'+port+'/.well-known/oauth-protected-resource/mcp',{signal:AbortSignal.timeout(5000)});
   if(metadata.status!==200||(await metadata.json()).resource!==config.publicRuntime.agentsOrigin+'/mcp')throw Error('metadata_failed');
   const mcp=await fetch('http://127.0.0.1:'+port+'/mcp',{headers:{Authorization:'Bearer compatibility-denial-probe'},signal:AbortSignal.timeout(5000)});
   if(mcp.status!==401)throw Error('mcp_not_denied');
   const node=await fetch('http://127.0.0.1:'+config.agentGateway.port+'/v1/manifest',{headers:{'X-Forwarded-Proto':'https','X-Chunlack-Agent-Mode':config.publicRuntime.agentOAuth.discoveryOnly?'discovery-only':'mcp-only'},signal:AbortSignal.timeout(5000)});
   if(node.status!==404)throw Error('public_rest_not_denied');
   if(config.publicRuntime.nodeRestPublic===false&&!config.publicRuntime.agentOAuth.discoveryOnly){
    const privateNode=await fetch('http://127.0.0.1:'+config.agentGateway.port+'/v1/manifest',{headers:{Authorization:'Bearer compatibility-denial-probe'},signal:AbortSignal.timeout(5000)});
    if(privateNode.status!==401)throw Error('private_rest_auth_not_preserved');
    const codeRequire=require('node:module').createRequire(modulePath);
    const Database=codeRequire('better-sqlite3');
    const owners=new Database(path.join(data,'db/identity.db'),{readonly:true,fileMustExist:true});
    let owner;
    try{owner=owners.prepare("SELECT m.user_id AS userId,m.workspace_id AS workspaceId FROM memberships m JOIN users u ON u.id=m.user_id JOIN workspaces w ON w.id=m.workspace_id WHERE m.role='owner' AND u.disabled_at IS NULL AND w.disabled_at IS NULL ORDER BY m.workspace_id,m.user_id LIMIT 1").get();}finally{owners.close();}
    if(!owner)throw Error('isolated_owner_required');
    runtime.identity.requireMembership(owner.userId,owner.workspaceId);
    // This temporary credential exists only in the disposable compatibility copy.
    // Seeding it directly avoids consuming capacity; production createNode limits remain unchanged.
    const crypto=codeRequire('node:crypto'),protocol=codeRequire('./protocol.cjs');
    const probeId=crypto.randomUUID(),probeToken=crypto.randomBytes(32).toString('base64url');
    const probeHash=protocol.hash(probeToken);
    const probeDb=new Database(path.join(data,'db/agent-gateway.db'),{fileMustExist:true});
    probeDb.pragma('foreign_keys = ON');
    try{
     probeDb.prepare('INSERT INTO nodes(id,name,capabilities,scopes,token_hash,created_at,workspace_id,created_by) VALUES(?,?,?,?,?,?,?,?)')
      .run(probeId,'Isolated schema compatibility probe','["browser.public_read"]','["public"]',probeHash,Date.now(),owner.workspaceId,owner.userId);
     const valid=await fetch('http://127.0.0.1:'+config.agentGateway.port+'/v1/manifest',{headers:{Authorization:'Bearer '+probeToken},signal:AbortSignal.timeout(5000)});
     await valid.arrayBuffer();
     if(valid.status!==200)throw Error('private_rest_valid_node_failed');
     privateNodeReadChecked=true;
     const forwarded=await fetch('http://127.0.0.1:'+config.agentGateway.port+'/v1/manifest',{headers:{Authorization:'Bearer '+probeToken,'X-Forwarded-Proto':'https','X-Chunlack-Agent-Mode':'mcp-only'},signal:AbortSignal.timeout(5000)});
     await forwarded.arrayBuffer();
     if(forwarded.status!==404)throw Error('forwarded_valid_node_not_denied');
     validForwardedNodeDenied=true;
    }finally{
     try{probeDb.prepare('DELETE FROM nodes WHERE id=? AND token_hash=?').run(probeId,probeHash);}
     finally{probeDb.close();}
    }
   }
  }
 }finally{await runtime.close();}
 if(fs.existsSync(path.join(data,'.public-runtime.lock')))throw Error('writer_lock_remains');
 console.log(JSON.stringify({compatibilityBoot:'passed',privateNodeReadChecked,validForwardedNodeDenied}));
}
main().then(()=>process.exit(0)).catch(error=>{console.log(JSON.stringify({compatibilityBoot:'failed',code:/^[a-z_]+$/.test(error.code||'')?error.code:error.name}));process.exit(1);});
''')
os.chown(runner, 0, 987)
runner.chmod(0o640)
node = '/opt/chunlack-public/runtime/node/bin/node'
environment = dict(os.environ)
environment.update(HOME=pwd.getpwnam('chunlack-public').pw_dir, USER='chunlack-public', LOGNAME='chunlack-public',
                   LACK_DATA_DIR=str(data), LACK_CONFIG_PATH=str(config_path))
boots = []
installed_config = control.apply_owned_config(prepared, original, release_profile, approved_agent_client_ids)
boot_plan = [('candidate', candidate, installed_config), ('previous', Path('/opt/chunlack-public/current'), original)]
if migration_contract:
    boot_plan = [('fault', candidate, installed_config), ('previous-after-fault', Path('/opt/chunlack-public/current'), original),
                 *boot_plan, ('candidate-repeat', candidate, installed_config)]
last_data = initial_data
fault_atomic = False
for name, tree, config in boot_plan:
    config_path.write_text(json.dumps(config, indent=2) + '\n')
    started = time.monotonic()
    if handoff_enabled:
        argv = [node, str(runner), str(tree / 'gateway/public-runtime.cjs'), str(data), 'fault-migration' if name == 'fault' else 'boot', tag]
        process = control.run_service_probe(tag, name, argv, seconds=40, data_root=str(data), env_file=str(root / 'isolation.env'))
        out, err = process.stdout, process.stderr
        handoff_identities.append(control.validate_service_identity(out, 996, 987, tag))
    else:
        process = subprocess.Popen([node, str(runner), str(tree / 'gateway/public-runtime.cjs'), str(data), 'fault-migration' if name == 'fault' else 'boot'],
                                   cwd=data, env=environment, user=996, group=987, extra_groups=[987],
                                   start_new_session=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            out, err = process.communicate(timeout=40)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.communicate(timeout=5)
            raise RuntimeError('compatibility_boot_timeout_' + name)
    (root / ('schema-boot-' + name + '.log')).write_bytes(out + b'\nSTDERR\n' + err)
    (root / ('schema-boot-' + name + '.log')).chmod(0o600)
    if process.returncode or b'"compatibilityBoot":"passed"' not in out:
        errors = []
        for line in out.decode(errors='replace').splitlines():
            try:
                value = json.loads(line)
                if value.get('compatibilityBoot') == 'failed':
                    errors.append(value.get('code'))
            except (ValueError, AttributeError):
                pass
        raise RuntimeError('compatibility_boot_failed_' + name + '_' + '_'.join(str(v) for v in errors))
    assert not (data / '.public-runtime.lock').exists()
    if migration_contract:
        after_data = control.copy_data_fingerprint(data, private_key)
        phase = 'fault' if name in ('fault', 'previous-after-fault') else 'candidate' if name == 'candidate' else 'previous' if name == 'previous' else 'repeat'
        control.verify_copy_migration(last_data, after_data, migration_contract, phase)
        last_data = after_data
        fault_atomic = fault_atomic or name == 'fault'
    else:
        assert control.schemas(data) == initial, 'compatibility_schema_changed_' + name
    proofs = []
    for line in out.decode(errors='strict').splitlines():
        try:
            proof = json.loads(line)
            if isinstance(proof, dict) and proof.get('compatibilityBoot') == 'passed':
                proofs.append(proof)
        except ValueError:
            pass
    assert len(proofs) == 1, 'compatibility_boot_proof_missing_' + name
    needs_private_probe = name != 'fault' and config.get('publicRuntime', {}).get('nodeRestPublic') is False and config['publicRuntime'].get('agentOAuth', {}).get('discoveryOnly') is not True
    if needs_private_probe:
        assert proofs[0].get('privateNodeReadChecked') is True and proofs[0].get('validForwardedNodeDenied') is True, 'compatibility_private_node_proof_missing_' + name
    if name in ('fault', 'previous-after-fault'):
        continue
    boots.append({'runtime': name, 'seconds': round(time.monotonic() - started, 3), 'cleanClose': True, 'dataVerified': bool(migration_contract),
                  'privateNodeReadChecked': proofs[0].get('privateNodeReadChecked', False),
                  'validForwardedNodeDenied': proofs[0].get('validForwardedNodeDenied', False)})
report = {'status': 'passed', 'releaseProfile': release_profile, 'boots': boots, 'databaseCount': len(initial), 'schemaPreserved': not bool(migration_contract),
          'networkIsolated': True, 'sourceMountedReadonly': True, 'applicationConsistentSnapshot': False,
          'rollbackBackup': False, 'actualModelCalls': False,
          'oidcMetadataTransport': 'fixture_from_tls_verified_public_discovery_and_jwks',
          'realOidcLoginTested': False}
if handoff_enabled:
    report['serviceAccountHandoff'] = {'mode': 'systemd-v1', 'identities': handoff_identities, 'allBusinessNonRoot': len(handoff_identities) == len(boot_plan), 'sharedSlice': control.handoff_slice(tag)}
if migration_contract:
    control.require(code_before == {'candidate': control.code_inventory(candidate), 'previous': control.code_inventory(Path('/opt/chunlack-public/current'))}, 'compatibility_code_changed_during_trial')
    created = int(time.time() * 1000)
    report.update(version=1, migrationContract=migration_contract, createdAtMs=created, expiresAtMs=created + 3600000,
                  baselineSchemaDetails=initial_details,
                  bindings={'catalogSHA256': control._canonical_hash(control.AUTHORITY_V1_OBJECTS), **code_before,
                            'baselineSchemaSHA256': control._canonical_hash(initial_details),
                            'policySHA256': control._canonical_hash(control._public_policy(prepared)),
                            'stageHashesSHA256': control._canonical_hash(settings.get('stageHashes', {})),
                            'preparedHashesSHA256': control._canonical_hash(control._prepared_binding(settings))},
                  validations={'exactSchema': True, 'dataPreserved': True, 'epochsBackfilled': True, 'zeroGrants': True,
                               'faultAtomic': fault_atomic, 'integrityAndForeignKeys': True, 'idempotent': True})
    control.verify_compatibility_proof_content(report, settings, candidate, Path('/opt/chunlack-public/current'), prepared)
report_path = root / 'schema-compatibility-report.json'
control.atomic_write((json.dumps(report, indent=2) + '\n').encode(), report_path)
if migration_contract:
    settings.setdefault('preparedHashes', {})[report_path.name] = control.digest(report_path)
    control.atomic_write((json.dumps(settings, indent=2) + '\n').encode(), root / 'settings.json')
print(json.dumps({'status': report['status'], 'releaseProfile': release_profile, 'migrationContract': migration_contract,
                  'boots': [row['runtime'] for row in boots], 'productionChanges': False}))
