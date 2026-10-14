# Agent authority gateway bridge checkpoint

Date: 2026-10-14. Status: local bridge verification passed after the authorized
fixture correction; runtime integration and full delivery remain incomplete.

## Implemented scope

- Trusted optional `agentAuthority` dependency on `createGatewayStore`.
- `authenticateAgent` converts a registry proof into a gateway-owned WeakMap
  principal; copying its public fields does not create authentication.
- Workspace node access revalidates registry authority on every operation.
- Exact task.read/task.claim/task.result/events.read operation mappings.
- events.subscribe remains a separate scope, not permission to poll events.
- Generic node callbacks are rejected for Agent principals while existing
  pairing-token behavior remains available to trusted existing callers.
- No JWT HTTP/MCP route or runtime configuration was enabled.

## Evidence

- New bridge tests first ran against the absent bridge: 1 passed, 9 failed.
  The nine failures showed the missing authenticateAgent API; the existing
  pairing-token compatibility test passed.
- Focused bridge/registry/workspace regression: 44/44 passed, zero skips or
  cancellations, exit 0, 6169.3458 ms.
- Full local suite before the subsequent boundary supplement: 708/708 passed,
  zero failures/skips/cancellations, exit 0, 297723.5499 ms.
- Full report:
  `.superpowers/sdd/2026-10-13-release-preparation/agent-gateway-authority-full-20261014-192926.tap`.
- Full report SHA-256:
  `9e863589ad0e0873b0bd630e70b4339bad41c9ebd6833bc7c0cc20a1274cca97`.
- Independent read-only review found no confirmed implementation defect but
  requested scope-positive and retained write/event lifecycle coverage.
- That separate eight-test supplement passed 7/8. Its events-read assertion
  incorrectly expects the submission eventId in polling output. The real
  nodeEvents API selects seq, task_id, type, message and created_at, not event_id.
  This is a newly introduced test assumption error. Correction awaits human
  approval; do not modify the API to satisfy that assertion.
- Supplement report:
  `.superpowers/sdd/2026-10-13-release-preparation/agent-gateway-authority-boundaries-20261014.tap`.
- The 708-test full run excludes this later supplement. These results must
  not be combined into a claim that the current complete tree passes.

The seven successful supplement cases cover result-only lease renewal and
completion, subscription-only denial of polling, paused-node completion of an
existing lease, and rejection of retained write/event access after grant
revocation, membership changes, grant expiry and token expiry.

## Recovery investigation and sequencing ruling

Existing workspace snapshot/restore-trial tools preserve exact payload bytes,
verify integrity and explicitly retain migrationReady=false/restoreReady=false.
Migration recovery likewise is an offline, non-activating recovery path.
Mutating authorization rows inside the retained forensic payload would violate
its existing integrity contract. No snapshot or recovery code was changed.

Ruling: implement the already-planned gateway-owned principal bridge next;
retain restore invalidation as a separate delivery gate at a derived working
copy/activation boundary. Do not claim that merely copying a snapshot rotates
authorization generations or that forensic restore verification is activation.

## Historical pending items (local correction completed below)

Correct only the events-read test to assert the documented task/type/cursor
fields; preserve all scope-denial checks. Rerun the focused group and the full
enlarged suite, then record and synchronize the accepted local stage.

Runtime JWT transport, snapshot/restore invalidation wiring, resource-limited
Linux validation, real Pocket ID resource enrollment and native Muse LaoZhen /
dots Xuanji evidence round trips remain unfinished. No VPS, production LACK,
credentials, Pocket ID application or Tailscale Peer Relay was modified.

## Enlarged full-suite follow-up

The fresh full suite including all eight boundary supplement tests completed:
716 total, 715 pass, 1 fail, 0 skipped/cancelled/TODO, exit 1,
338694.6172 ms. The only failure is the same events-read fixture assertion
expecting an eventId that the polling API intentionally does not return.
No further implementation or test correction was made in this follow-up.

Report:
`.superpowers/sdd/2026-10-13-release-preparation/agent-gateway-authority-expanded-full-20261014-193536.tap`.
SHA-256:
`cfe3e535acace565d159ae1c86c1086c5b4fc327ab4303703212b96f5de19505`.

At this follow-up the tree was not accepted, committed or published as a
passing stage. The fixture correction was pending human approval.

## Authorized event assertion correction and final local verification

The user explicitly approved correcting the event assertion and retesting.
Only the boundary test assertion changed: it now checks the returned task_id
and progress type, a positive safe-integer cursor, positive event sequence
numbers bounded by that cursor, and an empty event page when continuing from
the returned cursor. All scope-denial assertions remain. The event API and
product authorization logic were not changed to satisfy this test.

- Focused five-file regression: 52/52 passed, zero failures, skips,
  cancellations or TODOs, exit 0, 9238.8512 ms.
- Fresh full repository regression including all boundary supplements:
  716/716 passed, zero failures, skips, cancellations or TODOs, exit 0,
  320368.8068 ms.
- Full report:
  `.superpowers/sdd/2026-10-13-release-preparation/agent-gateway-authority-repair-full-20261014-203537.tap`.
- Full report SHA-256:
  `007c77f4125276559c227d1b0e7c6cd6873022c0ae2e8732e263a10c7775cdf8`.
- Focused report:
  `.superpowers/sdd/2026-10-13-release-preparation/agent-gateway-authority-repair-focused-20261014.tap`.

Commands used Node v24.19.0, pinned repository dependencies, the existing
Python runtime and portable Caddy v2.11.7 after checking SHA-256
`5f93a9bd555f3aac9d33af2756ba14b3519d8cca4ffd55256bdaeab444c9db2a`.
The Node and Git OpenSSL directories were supplied on PATH and CADDY_TEST_BIN
and PYTHON were set for the full suite.

```powershell
node --test --test-reporter=tap --test-concurrency=1 --test-timeout=90000 tests/agent-gateway-authority.test.cjs tests/agent-gateway-authority-boundaries.test.cjs tests/agent-authority.test.cjs tests/workspace-gateway.test.cjs tests/workspace-gateway-boundaries.test.cjs
node --test --test-reporter=tap --test-concurrency=1 --test-timeout=90000 tests/*.test.cjs
```

These are local synthetic identity/JWKS/node tests and local HTTPS regression,
not native Linux resource-budget validation or real Pocket ID / Muse / dots
acceptance. The pending runtime and recovery integration gates above remain.
No VPS service, production deployment, credential or Relay was changed.
