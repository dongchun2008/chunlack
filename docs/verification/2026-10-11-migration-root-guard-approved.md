# Verified v2 root archive migration guard

Date: 2026-10-11. This supersedes the pending correction state in
`2026-10-11-migration-root-guard-pending.md`, without erasing its failures.
The operator explicitly approved the pending corrections before implementation.

## Correction

`unclassified_root_entry` no longer blocks an otherwise reviewed migration when
the entry belongs to an independently verified v2
`bounded_complete_root_inventory` snapshot and its root/type/source/destination
matches the opaque archive. All descendants remain covered by the existing v2
verifier. The migration retains these entries in its private quarantine; it does
not automatically load them into a workspace. v1 partial snapshots, missing or
mislabelled roots and corrupt payloads still fail before candidate creation.
Owner binding, identity-change checks and exact model grants are unchanged.

The newly authored regression now checks the actual file-level boundary: unknown
`agent_memories/old.json` stays archived, while the known `memory/agent.json`
legitimately becomes the active workspace's `agent_memories/agent.json`.
Its independent migration/recovery assertions now execute successfully.

Only the packaged business fixture's three process-start readiness waits are
30 seconds. Its 90-second overall bound, default 10-second business waits,
model-round waits and resource limits are unchanged. Production startup settings
were not changed. The previously recorded approximately 14.9-second cold startup
explains why a 10-second fixture startup wait was insufficient; this correction
does not assert a production startup-time guarantee.

## Fresh verification

- Focused migration, v2 root coverage and packaged business regression: 38/38
  passed, zero skipped/cancelled, exit 0; duration 85.360 seconds.
- Full Caddy-enabled repository suite: 497/497 passed, zero skipped/cancelled,
  exit 0. Command: `node --test --test-concurrency=1 --test-timeout=90000
  tests/*.test.cjs`; wrapper duration 255.012 seconds.
- `node tests/smoke.cjs`: exit 0, duration 3.129 seconds. Actual HTTP/WebSocket,
  two mock models, SQLite restart persistence, private bind/config preservation.
- Existing packaged migration business test exercised three fixture accounts,
  two workspaces, workspace-bound routing, restart and legacy-compatible recovery.
  These accounts and models are test fixtures, not live users or real vendor nodes.

## VPS read-only preflight and remaining gates

After the focused run, a pinned-host-key SSH preflight confirmed original
`chunlack.service` active/running at PID 594652 and `tailscaled.service`
active/running at PID 859, both with restart count 0. Original LACK health returned
200, Relay UDP 40000 listeners remained present and no TCP 443 listener appeared.
The durable snapshot was readable; the existing native Node was v24.21.0.
This preflight did not install software, change credentials, stop/restart services
or open ports, and does not prove live Relay packet latency/loss.

This is a tested local product correction, not overall delivery. The next approved
step is an independent actual-backup native conversion trial with synthetic
ownership, private directories and bounded resources. It must preserve every
unknown root privately, prove original rows/counts and independently recover,
without creating `chunlack-owner` or switching production. Actual-data authenticated
business acceptance, public TLS/login, live model/vendor-computer acceptance and
explicit production cutover remain separate gates.
