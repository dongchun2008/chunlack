# Pocket ID diagnostic follow-up: release remains blocked

Date: 2026-10-11. Product source under observation:
`803e77b3d21b9e0d7dbde6fe3e1cfe38e2100cec`.

The previous goal turn made implementation and test progress. This follow-up
adds concrete diagnostic/reproduction evidence, not a deployment or repair.
The user-facing bounded correction request remains outstanding. Product code,
test deadlines/assertions, Pocket ID settings and production were not changed.

## Browser startup investigation

1. Worktree initially clean at the above revision. A bounded process query
   found no matching Node browser-fixture helpers/materialized servers left
   from the earlier failed runs. The recorded failed startup log was zero bytes.
2. An ignored, owned-test-only preloader measured module/startup timing. It
   activates only for a temp `lack-workspace-browser-*` server whose owner
   marker PID matches its actual parent. It changes no product code or deadline.
3. The unchanged helper reported readiness after **3362 ms**, then was stopped
   via its existing `STOP` control. Controller duration **3461 ms**, exit **0**.
4. The subsequently rerun original browser test, **without the preloader**,
   passed **1/1**, no failures/skips, **3220.7777 ms** total. Both captured owned
   diagnostic process IDs were absent afterwards.

Selected nested require timings from the diagnostic run:

| Require | Duration |
| --- | ---: |
| express | 279 ms |
| cheerio | 318 ms |
| eslint | 194 ms |
| main server module, including nested loads | 1366 ms |

These durations overlap and must not be summed as independent CPU usage.
They show that the current package can reach readiness, not why earlier runs
timed out. The earlier full-run and isolated timeouts remain valid failures;
root cause is still unconfirmed. This is a mock-model/local browser fixture,
not enabled real Pocket ID login, public TLS or native Muse/dots acceptance.

Retained ignored evidence:

```text
.superpowers/sdd/2026-10-11-real-1cat-provider/browser-startup-probe.cjs
.superpowers/sdd/2026-10-11-real-1cat-provider/browser-startup-diagnose.cjs
.superpowers/sdd/2026-10-11-real-1cat-provider/oidc-browser-startup-diagnostic.json
.superpowers/sdd/2026-10-11-real-1cat-provider/oidc-browser-recheck-after-probe.log
```

## Two review findings now have failing regression tests

Command:

```text
node --test --test-concurrency=1 --test-timeout=20000 tests/oidc-review-regressions.test.cjs
```

Result: **2 tests, 0 pass, 2 fail, 0 skip/cancel**, exit **1**, **1180.786 ms**.
These are expected red regression assertions against the disclosed defects,
not implementation corrections. Tests exercise the real OIDC client, session
store and HTTP router with an explicitly controlled synthetic issuer.

1. `OIDC close aborts an already-started cooperative token request before reporting completion`:
   after `close()` returns, the actual exchange's `AbortSignal.aborted` remains
   `false`. The test releases its synthetic upstream in `finally`, so it leaves
   no intentionally stalled request behind. This proves the component's missing
   cancellation; it does not independently prove the full writer-lease scenario.
2. `a delayed OIDC callback cannot overwrite a newer successful local login in the same browser`:
   an Alice OIDC callback waits at the token exchange, Bob successfully logs in
   through the existing local route using the same browser cookie jar, then the
   old callback returns **303**, not the required fail-closed **401/409**. The
   new test catches the stale-success branch. Later no-new-session-cookie and
   preservation assertions remain part of the regression and will run after
   that first assertion passes; do not claim they already passed.

The earlier static review is therefore strengthened by controlled reproductions.
There was no live-account attack, no real credential access and no production
network operation. Future fixes must turn these tests green without weakening
their failure expectations, then pass the full suite and migration/archive gates.

The last full-suite count remains **523 total / 514 pass / 2 fail / 7 skip**.
It predates these two new tests. This turn did not rerun the full suite and does
not reinterpret its counts using isolated later results.

## Still pending

- Disclosed correction authorization; lifecycle/drain and browser generation fix.
- Migration-test owned-store cleanup and real v1-copy/link restore coverage.
- Stable startup investigation, full regression and dependency hardening.
- Dedicated Pocket ID client setup and real multi-user login acceptance.
- Native Muse LaoZhen/dots XuanJi authorization and task/evidence round trip.
- Combined resource, public ingress, recovery and final delivery acceptance.

A purpose-built web read of the public discovery URL was unavailable in this
turn. This does not establish a Pocket ID outage or any change from the earlier
HTTP 200 discovery evidence; no new metadata/version claim was made.
