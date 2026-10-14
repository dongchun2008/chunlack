# Explicit grant routing: constrained native Linux validation

Date: 2026-10-15 (Asia/Shanghai).
Pinned source: `9ecb3e7972b008800627f3a842c4f218aade6742`.
This follows the local **793/793** validation; it does not repeat the entire
suite on Linux or establish real vendor acceptance.

## Scope and result

The existing isolated runner and guarded SSH helper were copied into this
plan's ignored workspace. Only the candidate revision and a new selected test
group were changed. No production dependency permissions were altered and no
global software was installed.

Selected files:

- `tests/agent-grant-routing.test.cjs`
- `tests/agent-grant-discovery-boundaries.test.cjs`
- `tests/agent-discovery-budget.test.cjs`

**15 tests, 15 passed, 0 failed/cancelled/skipped/todo; controller exit 0.**
The runner reported `passed=true`, `limitsVerified=true`,
`protectedUnchanged=true` and no errors. Its report includes source and native
dependency hashes. Tokens and accounts in these tests are synthetic fixtures.

Actual captured unit limits:

| Property | Result |
| --- | --- |
| CPUQuotaPerSecUSec | 100ms (10%) |
| MemoryHigh | 167772160 bytes (160 MiB) |
| MemoryMax | 201326592 bytes (192 MiB) |
| MemorySwapMax | 0 |
| TasksMax | 32 |
| PrivateNetwork | yes |
| NoNewPrivileges | yes |
| MemoryPeak | 65126400 bytes (62.11 MiB) |
| ExecMainStatus / Result | 0 / success |

Owned unit: `chunlack-agent-events-routing-15f166fc4c.service`.
The runner's pre-stop capture shows `active/exited` with MainPID 0 because the
transient unit retains its completed result. A separate read-only post-run
query confirmed **LoadState=not-found, ActiveState=inactive, SubState=dead,
MainPID=0**. No owned test service remains active.

## Protected-service evidence

Preflight and postflight matched:

| Existing service | MainPID | NRestarts | State |
| --- | --- | --- | --- |
| chunlack.service | 594652 | 0 | active |
| tailscaled.service | 859 | 0 | active |
| chunlack-public.service | 646156 | 0 | active |
| chunlack-https.service | 646181 | 0 | active |

Old health remained `ok`; TLS-validated public health remained HTTP 200.
Existing UDP 40000 Relay listener output was unchanged. Actual Relay forwarding
quality was not measured, and listener presence is not a forwarding benchmark.

Report:
`.superpowers/sdd/2026-10-14-agent-grant-routing/chunlack-agent-events-routing-15f166fc4c-report.json`

SHA-256:
`a5424ce8806a620cb7c70a22f8b3b716286bd8dcfd7e8dddba557e7e7ca04065`.

## Remaining gates

This validates the selected authority/MCP routing components under a constrained
native runtime. It does not enable them in production. Public runtime ownership,
owner-only administration, exact ingress, full native protocol handshake and
real Pocket ID/Muse Laozhen/dots Xuanji enrollment/execution remain outstanding.
The prior failed full run remains documented; the later local full pass is a
separate result. No production, credential, model route or Relay change occurred.
