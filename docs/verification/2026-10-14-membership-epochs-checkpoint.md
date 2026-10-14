# Membership epochs: unmounted checkpoint, not accepted

Date: 2026-10-14. Baseline: `0716134`.
Plan: `docs/superpowers/plans/2026-10-14-agent-membership-epochs.md`.

Historical checkpoint: the reproduced finding and additional test gaps below
were subsequently addressed with explicit user approval. See the
[fresh repair verification](2026-10-14-membership-epochs-repair.md).
The remainder records the earlier state; the module is still not mounted.

Status: local implementation and regression are complete for the initial test
set, but independent review found a reproduced lifecycle bypass. The module is
not accepted and is not called by the current runtime. Do not mount or deploy it
until the finding and missing boundary coverage below are resolved.

## Implemented foundation

`identity/membership-epochs.cjs` provides an optional SQLite side table and
transactional triggers. Existing membership versions can reset after deletion;
the new random incarnation is intended to distinguish a fresh membership from
the old one even if role, version and timestamps are identical.

The caller supplies and owns an open identity database connection. Installation
and initial backfill are transactional, with an independently versioned schema
component. Current-state reads join enabled users and workspaces. The explicit
`invalidateAll()` primitive is intended for a later trusted restore hook; no
restore integration or HTTP authorization is introduced here.

Existing product files were not changed. No dependency, background process,
Pocket ID configuration, credential, VPS service or Relay was changed. All
database experiments used temporary local fixtures, never production data.

## Executed evidence

The new test file was run before implementation and failed as expected with
`MODULE_NOT_FOUND` for the new module. After implementation:

| Run | Tests | Passed | Failed | Cancelled | Skipped | Exit |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| New epoch tests plus existing identity store tests | 26 | 26 | 0 | 0 | 0 | 0 |
| Complete local `tests/*.test.cjs` | 659 | 659 | 0 | 0 | 0 | 0 |

Focused duration: 1828.9176 ms. Full duration: 305332.2669 ms.
Node 24.19.0, serial file execution, TAP reporter, 90000 ms per-file bound.
Real local Caddy HTTPS tests were enabled after checking the previously verified
Caddy 2.11.7 SHA-256. There were no skipped tests. No Linux-native run or real
Pocket ID access-token/Agent acceptance occurred in this stage.

Covered cases include backfill/reopen, ordinary remove/rejoin at the same time
and version, role downgrade and reversal from another connection, normal
disable/re-enable, membership-update rollback, foreign-key-disabled membership
delete/reinsert, invalid current membership selection, global epoch rotation,
future component version rejection, and the frozen pre-OIDC schema.

## Blocking review finding and reproduction

The fresh read-only reviewer found that replacing a parent user or workspace
with `INSERT OR REPLACE` can retain its old epoch when the writing connection
has both `foreign_keys=OFF` and `recursive_triggers=OFF`. The implicit delete
does not fire the parent-delete trigger in that configuration, and replacement
does not fire `UPDATE OF disabled_at`. A disable/re-enable cycle can therefore
return the old incarnation after the enabled parent is restored.

The parent subsequently reproduced both cases in a temporary database:

| Parent replaced | Disabled interval rejected | Old epoch revived afterward |
| --- | --- | --- |
| User | Yes | Yes |
| Workspace | Yes | Yes |

No production access or source-file modification was involved in reproduction.
The ordinary API path's green results do not disprove this bypass.

Proposed minimal repair: invalidate surviving epochs on parent INSERT as well
as UPDATE/DELETE, then add exact regressions for both parent tables with both
pragmas disabled. Permission for that correction and complete retesting was
requested; it had not been received or performed at this checkpoint.

## Additional test coverage to complete

- Inject failure during migration and confirm DDL/backfill/version rollback.
- Roll back an explicit `invalidateAll()` transaction and confirm old state.
- Test no-op membership UPDATE and parent deletion with foreign keys disabled.
- Assert that changing one workspace leaves another workspace's epoch unchanged.
- Close all connections before reopening, not only open a second connection.

The requested follow-up includes these closely related lifecycle and rollback
checks; do not report complete boundary acceptance from the initial 26 tests.

## Next delivery gates

After this local repair: issuer/subject/client binding, explicit node grants,
current membership and node revocation checks, opaque principal conversion,
restore wiring and actual transport integration. Pocket ID client configuration
and native Muse/dots task execution remain separate real acceptance gates.
An incarnation record is not itself an authorization grant.

## Evidence hashes

| Artifact | SHA-256 |
| --- | --- |
| `identity/membership-epochs.cjs` | `b677992e19a782086e92635597cb0dd2beea88ce43afbc78e147a65771df775d` |
| `tests/membership-epochs.test.cjs` | `f52fa6f098b1110c218c7fc1bfa4b7a236ac7542b6071b5e995db99681a58b2c` |
| `membership-epochs-focused-20261014.tap` | `82a6e108eac218486381271c2478da49172f3435db574e66442ca80ab24043c7` |
| `membership-epochs-full-20261014.tap` | `29f60c40f67ca44ceec2dce41644714306c76b7185208f5304db58f028eb6159` |

Private TAP files remain ignored under
`.superpowers/sdd/2026-10-13-release-preparation/`.
