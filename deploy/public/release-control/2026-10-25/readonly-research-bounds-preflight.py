"""Read-only four-file task-bounds gate; never a publication controller.

Stage this file as preflight.py and the exact pinned legacy gate as
base-code-preflight.py. All legacy config, identity, dependency, ownership,
fresh compatibility proof and before/after read-only checks remain active.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import types

BASE_PREFLIGHT_SHA256 = '5c9cf83f7c763a7e216feb865849c7eba761efa7f9dc40b990f1f67f0e69b18d'
BASE_PREFLIGHT_NAME = 'base-code-preflight.py'
ALLOWED_FILES = (
    'collaboration/capacity.cjs',
    'collaboration/model-transport.cjs',
    'collaboration/task-control.cjs',
    'server.js',
)


def require(value, code):
    if not value:
        raise ValueError(code)


def load_base(path):
    path = Path(path)
    require(not path.is_symlink(), 'base_preflight_source_link_denied')
    source = path.read_bytes()
    require(hashlib.sha256(source).hexdigest() == BASE_PREFLIGHT_SHA256,
            'base_preflight_source_hash_changed')
    module = types.ModuleType('readonly_research_bounds_base')
    module.__file__ = str(path)
    exec(compile(source, str(path), 'exec'), module.__dict__)
    # The profile is code-defined, never taken from settings or a client request.
    module.ALLOWED_FILES = ALLOWED_FILES
    return module


def run(root_string, trusted):
    require(os.name == 'posix' and os.geteuid() == 0,
            'readonly_gate_requires_posix_root')
    require(type(root_string) is str and
            re.fullmatch('/var/lib/chunlack-release-[0-9a-f]{12}', root_string) is not None,
            'release_root_invalid')
    require(type(trusted) is dict and
            trusted.get(BASE_PREFLIGHT_NAME) == BASE_PREFLIGHT_SHA256,
            'trusted_base_preflight_required')
    base = load_base(Path(root_string) / BASE_PREFLIGHT_NAME)
    result = base.run(root_string, trusted)
    return {**result, 'releaseScope': 'research-task-bounds-v1',
            'basePreflightSha256': BASE_PREFLIGHT_SHA256}


if __name__ == '__main__':
    try:
        require(len(sys.argv) == 3, 'root_and_trusted_hashes_required')
        result = run(sys.argv[1], json.loads(sys.argv[2]))
    except Exception as error:
        result = {'status': 'failed',
                  'error': str(error) if isinstance(error, ValueError) else type(error).__name__,
                  'productionMutated': False}
    print(json.dumps(result), flush=True)
    sys.exit(0 if result['status'] == 'passed' else 1)
