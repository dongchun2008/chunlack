# Membership epoch lifecycle repair: local verification

Date: 2026-10-14. Baseline: `bd11dc2`.

Status: the approved parent-REPLACE repair and related boundary tests are
complete locally. The previous review finding is addressed. The module remains
unmounted; this record does not claim a deployed authority bridge or external
Agent acceptance.

## Minimal correction

Added AFTER INSERT triggers for users and workspaces. Each trigger assigns a
fresh epoch to surviving memberships of that parent, inserting missing epoch
rows or rotating existing ones. This covers `INSERT OR REPLACE` even when its
implicit deletion does not fire a DELETE trigger. It also restores fresh epoch
rows after an explicit parent deletion and reinsertion with foreign keys off.

The existing current-state read, role checks, epoch format, transaction boundary,
connection ownership and independent schema component are unchanged. No HTTP
endpoint, runtime import, new process or dependency was introduced.

## RED-to-GREEN evidence

The 15 new boundary tests were first run against the uncorrected module:
5 passed and 10 failed. The failures were all eight parent-REPLACE combinations
and the two explicit parent-delete/reinsert cases. After the two triggers were
added, all these cases passed together with the existing identity regressions.

| Run | Tests | Passed | Failed | Cancelled | Skipped | Exit |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| New boundary tests before correction | 15 | 5 | 10 | 0 | 0 | 1 |
| Epoch, boundary and identity-store tests after correction | 41 | 41 | 0 | 0 | 0 | 0 |
| Complete local `tests/*.test.cjs` after correction | 674 | 674 | 0 | 0 | 0 | 0 |

Focused duration: 3450.9194 ms. Full duration: 303097.905 ms.
Node 24.19.0, TAP reporter, serial test-file execution, 90000 ms per-file bound.
Actual local Caddy HTTPS tests were enabled. Its previously verified 2.11.7
executable was SHA-256 checked before the full run. No tests were skipped.

## Boundary coverage

- User and workspace REPLACE, each with foreign keys ON/OFF and recursive
  triggers ON/OFF. Disabled state rejects access; restored state has a new
  epoch while membership role/version remain unchanged.
- The unrelated workspace's complete epoch record remains unchanged.
- Explicit parent deletion/reinsertion with both pragmas OFF removes old epoch
  records and produces fresh records without foreign-key inconsistencies.
- An injected failure at migration version registration rolls back all preceding
  DDL and backfill; the complete SQLite schema and memberships match their
  original state, and a subsequent clean installation succeeds.
- An outer rollback around `invalidateAll()` restores every previous epoch.
- Failure injected on the second epoch update rolls back the first update too.
- A no-op membership UPDATE rotates only the affected membership's epoch.
- All fixture connections close before reopening; epochs and identity facts
  persist unchanged, with successful integrity and foreign-key checks.

The prior independent review and runtime reproduction are retained in the
checkpoint. This repair pass was verified by new failing tests becoming green
and the complete regression suite, not by claiming a second independent review.

## Scope and remaining delivery gates

Only the unmounted module, local tests and documentation changed. No VPS access,
production deployment, Pocket ID configuration, credential operation or
Tailscale Relay change occurred. No Linux-native test or real issuer access
token was used in this stage.

The storage primitive is now locally verified; the authority bridge is not yet
complete. It must still bind issuer/subject/client to explicit workspace/node
grants, recheck current node state, convert evidence into a store-owned opaque
principal, and wire restore invalidation into the actual restore path. HTTP
integration, real Pocket ID grants and native Muse/dots execution remain
unfinished acceptance gates. An epoch is not itself permission to act.

## Evidence hashes

| Artifact | SHA-256 |
| --- | --- |
| `identity/membership-epochs.cjs` | `d3503021035e04884ef72e03b325c9ab802151b937b6c3d572079db7ae30627a` |
| `tests/membership-epochs-boundaries.test.cjs` | `ba1405a7e3deddbf890cfb983dc37a8624533582a3a1b63e93fb63a80f5f5691` |
| `membership-epochs-boundaries-red-20261014.tap` | `aa37488d5be8081943ca08c5ddda4b7cc2f92d5656ec136305d636996327f56c` |
| `membership-epochs-repair-focused-20261014.tap` | `f49af22f64a7d760b90fa6ee2048a33b04c3cc0351fa469980330d4ff6fe3b7a` |
| `membership-epochs-repair-full-20261014.tap` | `eed8c5ac14786c5d3354004529ed2bee2bb29058f01365954ad984ff6bc2ee70` |

Private TAP files remain ignored under
`.superpowers/sdd/2026-10-13-release-preparation/`.
