# Cloud agent local validation, 2026-10-09

Scope: local Windows development only. No VPS deployment, real account access,
tailnet enrollment, real subscriptions, credential changes or public listeners.

## Results

- `node --test --test-reporter=spec tests/*.test.cjs`: 127 passed, 0 failed,
  0 cancelled, 0 skipped; exit 0.
- `node tests/smoke.cjs`: PASS; actual HTTP and WebSocket against two mock model
  backends, SQLite restart persistence, private bind and configuration preservation.
- `node scripts/muse-transport-local-pilot.cjs`: local CONNECT verified;
  synthetic fixture; evidence_checked; cancellation/admin checks passed; cleanup true.
- `node scripts/dots-mcp-local-pilot.cjs`: mock_dot; signed local HTTPS callback,
  task claim, artifact upload, result persistence, duplicate prevention and
  unsubscribe passed; evidence_checked; cleanup true.

The local host lacks an npm executable on PATH. The commands above use the bundled
Node.js v24.19.0 executable directly and existing installed dependencies.

## Fixes

- Close the events database before deleting fixture directories on Windows.
- Separate subscription cleanup authorization from execution authorization.
  Completed tasks allow owner-only unsubscribe; new work and revoked/foreign
  identities remain denied. Existing users retain the original authorization
  behavior unless they explicitly provide an authorizeCleanup policy.

## Evidence boundaries and remaining work

Both real vendor Agent verification flags remain false. Screenshots in local
tests are synthetic PNG fixtures, not evidence of actual cloud browser activity.
Human acceptance remains false. This is not production readiness or a security
audit. The actual MCP client compatibility, private bridge/tunnel deployment,
cloud-account permissions, real computer execution, restart recovery, long-running
capacity cleanup and additional transport fault-injection cases remain to validate.

The localhost TLS key in tests/fixtures/pilot-tls-key.pem is a deliberately public
test fixture, never a deployment credential. Only that exact file may be exempted
from the private-key-marker check; all real credentials must remain out of Git.

Integration instructions: MUSE_PRIVATE_TRANSPORT.zh-CN.md and
DOTS_PRIVATE_COMPUTER.zh-CN.md in this directory.
