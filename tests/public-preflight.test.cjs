'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawnSync} = require('node:child_process');

function run(t, occupied) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lack-preflight-fixture-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const shellPath = value => process.platform === 'win32' ? value.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, drive) => '/' + drive.toLowerCase()) : value;
  const log = path.join(root, 'read-only-commands.log'), shellLog = shellPath(log);
  const scripts = {
    uname: 'printf "Linux\\n"', getconf: 'printf "2\\n"',
    awk: 'printf "1651712 800000 0 0"', df: 'printf "Filesystem 1024-blocks Used Available Capacity Mounted\\nfixture 2000000 1000000 1000000 50%% /\\n"',
    ss: `if [ "$#" -eq 3 ]; then ${occupied ? 'printf "LISTEN 0 10 0.0.0.0:443 0.0.0.0:*\\n"' : ':'}; else printf "FIXTURE_LISTENER\\n"; fi`,
    systemctl: 'case "$1" in show) printf "LoadState=loaded\\nActiveState=active\\nSubState=running\\nMemoryCurrent=10000000\\nCPUUsageNSec=1000\\n";; *) exit 99;; esac'
  };
  for (const [name, body] of Object.entries(scripts)) fs.writeFileSync(path.join(root, name), `#!/bin/sh\nprintf '%s\\n' '${name}:'"$*" >> '${shellLog}'\n${body}\n`, {mode: 0o700});
  const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash';
  const result = spawnSync(bash, ['-c', 'export PATH="$1:/usr/bin:/bin"; exec /usr/bin/sh "$2"', 'preflight-fixture', shellPath(root), shellPath(path.join(__dirname, '..', 'scripts', 'public-preflight.sh'))],
    {env: {...process.env, MSYS_NO_PATHCONV: '1'}, encoding: 'utf8', timeout: 3000, windowsHide: true});
  return {...result, commands: fs.readFileSync(log, 'utf8')};
}
test('preflight only collects a synthetic baseline and never treats it as permission to deploy', t => {
  const result = run(t, false); assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /MEM_AVAILABLE_KIB=800000/);
  assert.match(result.stdout, /PREFLIGHT=BASELINE_COLLECTED_NOT_DEPLOYMENT_AUTHORIZATION/);
  assert.doesNotMatch(result.commands, /^systemctl:(?:start|stop|restart|reload|enable)(?:\s|$)|^(?:tailscale|apt|ufw|iptables):/m);
});
test('preflight refuses an occupied public port without stopping the unrelated listener', t => {
  const result = run(t, true); assert.equal(result.status, 2, result.stderr);
  assert.match(result.stdout, /PUBLIC_443_GATE=OCCUPIED_DO_NOT_REPLACE/);
  assert.match(result.stdout, /REVIEW_REQUIRED_NO_CHANGES_MADE/);
  assert.doesNotMatch(result.commands, /systemctl:(?:start|stop|restart|reload|enable)/);
});
