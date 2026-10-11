# Actual-backup authenticated runtime: native verification

Date: 2026-10-11. The operator explicitly approved correction of the three
disclosed disposable test-script defects and isolated verification.

Executed product code: `95c70de51de569cd04f3c1bf60d6b2b944eac530`.
This result supersedes the unstarted status in
`2026-10-11-actual-runtime-trial-review-pending.md`, without erasing its findings.

## Scope and corrections

Only new r1 test versions were used. Original private scripts remain intact.
No product code, production configuration, credentials or live owner changed.

- Queries/history grouping use the actual `messages.store_id` schema.
- Controller launch/poll/report-reading errors enter exception-safe ownership
  checking and own-unit cleanup. Cleanup precedes host-report writing. A changed
  root/owner fails closed; failures remain errors, never a passing result.
- Child shutdown waits for process `close` and log stream completion, not just
  `exit`, before checking closing markers and sensitive-value absence.

Exact executed r1 script SHA256 values:
- Node: `db0886e73392e802cc21ad59236f7d259fb0af55d7d99322a7635305a0740c7e`.
- Controller: `73505ffb317758fe62b72a15fa0368feaa142509ff4bbea6f292a5280ca6bc2f`.

Corresponding source copies are the two `.txt` files in `fixtures/`.
They are audit artifacts bound to this private fixture's absolute paths, not
general deployment commands. Do not execute them against production.
Fixture passwords, cookies, CSRF and invitation tokens are not in these copies.

## Local targeted checks and a retained failure

An in-memory SQLite fixture reproduced the original nonexistent-column error;
the corrected query returned its expected row. A controlled child lifecycle
emitted `exit`, then a trailing write, then `close`; the corrected boundary
retained the complete tail and awaited stream finish. Node syntax and Python
AST parsing passed.

A separate controller exception-injection fixture failed with
`KeyError: commit`: the temporary fake owner omitted a required field.
This is a test-fixture defect, not a native VPS failure. Its scenarios cannot
be reported as passed. The fixture was not silently repaired or rerun.
Native normal-path cleanup was observed below, but exception cleanup,
truncated-report and host-report-I/O fault injection remain unverified.

## Native VPS result

Private owned trial:
`/var/tmp/chunlack-actual-migration-20261011-7fd316ba/runtime-business-821f946c`.

Unit: `chunlack-actual-runtime-821f946c-r1.service`.
Controller and unit exit 0; errors empty; owned unit verified stopped.
Report completed `2026-10-11T07:59:29.573Z` (15:59:29 Asia/Shanghai).
Elapsed 45.419 seconds, peak cgroup memory 139321344 bytes (132.867 MiB),
swap peak 0. CPU quota 10%, memory high/max 160/192 MiB, tasks 32,
runtime maximum 180 seconds. This is not a concurrency/Relay performance test.

The actual frozen conversion candidate was privately copied into a new
operational test root. Product packaging used the existing materializer.
The config was fixture-only, with private loopback endpoints and no real
provider credentials. All three listeners were inside a private network
namespace, not public or tailnet listeners; no production port was occupied.

Observed business checks:
- Three fixture accounts logged in; two workspaces and four authorized
  membership contexts returned successfully.
- Anonymous/missing-workspace/foreign-workspace reads were denied. Foreign and
  nonexistent workspaces returned equivalent responses.
- Actual WebSocket history retained all 13 original message IDs/content before
  and after an independently started second runtime process.
- Viewer message writes and forged owner privilege were denied. Mutations
  without CSRF or with wrong Origin were denied.
- A new message was written only to the other isolated workspace, retained its
  authenticated sender despite forged identity fields, did not broadcast into
  the historical workspace, and survived restart exactly once.
- All three persisted sessions remained valid across restart. Logout revoked
  the selected session and closed its socket with 1008 without revoking the
  other account.
- Both child processes closed with exit 0 and emitted closing markers. Drained
  logs did not contain the inspected fixture passwords/session/CSRF/invite values.
- Operational database integrity and foreign-key checks passed. Historical
  workspace rows still exactly matched the selected original ID/store/content
  projection; the single original Agent remained.
- Frozen candidate, durable snapshot, recovery, materialized source and code
  inventories remained unchanged; runtime did not rewrite its config.
- Disabled model guard saw zero requests. No real backend or vendor task ran.

Original-service before/after checks verified active/running states, unchanged
PIDs/restart counts and service-file hashes, LACK health 200, Relay UDP 40000
listener presence and unchanged absence of TCP 443. These checks are not proof
of zero packet loss or unchanged production request latency.

## Delivery gates still open

This proves `authenticatedRuntimeBusinessVerified=true` for the isolated
actual-backup fixture. It does not create `chunlack-owner`, assign historical
authors, approve opaque memories/repositories, switch production, or prove
production restore readiness. `restoreReady=false`, `publicTlsVerified=false`,
`realModelAcceptance=false` and `vendorAgentAcceptance=false` remain explicit.

The earlier 497/497 repository suite and smoke result remain recorded in the
root-guard verification document. No product source changed in this step;
they were not redundantly rerun or called vendor acceptance. A fresh authorized
production window, live user/setup checks, real direct model routing, and true
Muse/dots task/browser/evidence callbacks remain necessary before delivery.
