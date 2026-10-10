#!/bin/sh
# Read-only collector; no installation or activation is performed.
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
node_bin=${NODE_BIN:-node}
if ! command -v "$node_bin" >/dev/null 2>&1; then
  printf '%s\n' '{"status":"BLOCKED_OR_REVIEW_REQUIRED","deploymentAuthorized":false,"gates":["node_runtime_missing"]}'
  exit 2
fi
exec "$node_bin" "$script_dir/preflight.cjs" "$@"
