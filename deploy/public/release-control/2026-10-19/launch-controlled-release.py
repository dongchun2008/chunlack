"""Bounded operational launcher; business policy stays in the release controller."""
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys


def release_arguments(root, *, service_account_handoff=False):
    if type(service_account_handoff) is not bool:
        raise ValueError('invalid_service_handoff_mode')
    match = re.fullmatch(r'/var/lib/chunlack-release-([0-9a-f]{12})', root) if isinstance(root, str) else None
    if not match:
        raise ValueError('invalid_release_root')
    return [
        'systemd-run', '--quiet', '--unit=chunlack-prod-release-' + match[1] + '.service',
        '--property=Type=exec', '--property=User=root', '--property=Group=root',
        '--property=MemoryMax=192M', '--property=MemoryHigh=160M', '--property=MemorySwapMax=0',
        '--property=CPUQuota=10%', '--property=TasksMax=32',
        '--property=RuntimeMaxSec=180', '--property=TimeoutStopSec=130',
        *(['--property=Slice=chunlackhandoff' + match[1] + '.slice'] if service_account_handoff else []),
        '--property=NoNewPrivileges=yes', '--property=PrivateTmp=yes',
        '--property=ProtectSystem=strict', '--property=ProtectHome=yes', '--property=UMask=0077',
        '--property=IPAddressDeny=any', '--property=IPAddressAllow=localhost',
        '--property=ReadWritePaths=' + root + ' /opt/chunlack-public /var/lib/chunlack-public '
        '/etc/chunlack-public /var/backups /run/lock',
        '--property=ReadOnlyPaths=/opt/chunlack-public/runtime /etc/chunlack-public/runtime.env',
        '--setenv=PYTHONDONTWRITEBYTECODE=1', '--setenv=TMPDIR=' + root + '/scratch',
        '/usr/bin/python3', '-B', root + '/release.py', root,
    ]


def audit_elapsed(start_unix, end_ns):
    match = re.fullmatch(r'@([0-9]{1,12})(?:\.([0-9]{1,9}))?', start_unix.strip()) if isinstance(start_unix, str) else None
    if not match or int(match[1]) <= 0 or type(end_ns) is not int:
        raise ValueError('invalid_unix_timestamp')
    start_ns = int(match[1]) * 1000000000 + int((match[2] or '').ljust(9, '0'))
    if end_ns < start_ns:
        raise ValueError('negative_elapsed_time')
    elapsed_ns = end_ns - start_ns
    return {'status': 'passed' if elapsed_ns <= 120000000000 else 'failed',
            'elapsedUpperBoundSeconds': elapsed_ns / 1000000000,
            'within120Seconds': elapsed_ns <= 120000000000,
            'clockSource': 'systemd --timestamp=unix and filesystem Unix nanoseconds'}


def launch(root):
    arguments = release_arguments(root)
    if os.name != 'posix' or os.geteuid() != 0:
        raise ValueError('root_controller_required')
    base = Path(root)
    if base.resolve(strict=True) != base:
        raise ValueError('linked_release_root')
    metadata = base.lstat()
    if metadata.st_uid != 0 or stat.S_IMODE(metadata.st_mode) != 0o700:
        raise ValueError('release_root_not_private')
    for name in ('release.py', 'settings.json'):
        metadata = (base / name).lstat()
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_nlink != 1 or stat.S_IMODE(metadata.st_mode) != 0o600:
            raise ValueError('release_input_not_private')
    settings = json.loads((base / 'settings.json').read_text())
    mode = settings.get('serviceAccountHandoff')
    if mode is not None and mode != 'systemd-v1':
        raise ValueError('invalid_service_handoff_mode')
    arguments = release_arguments(root, service_account_handoff=mode == 'systemd-v1')
    subprocess.run(arguments, check=True, timeout=10)
    print(json.dumps({'status': 'started', 'unit': arguments[2].removeprefix('--unit=')}))


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('one_private_release_root_required')
    launch(sys.argv[1])
