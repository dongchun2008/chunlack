# Migration root archive guard: pending verification correction

Date: 2026-10-11. Baseline: `bcc9c8986fd2b11a5d61cca1dba44e15d7c5286c`.

## Scope and publication boundary

This report describes an uncommitted local migration correction and its actual
test results. Publishing this report does not publish the product correction,
activate a workspace, create a production owner, or deploy a release.

The working changes are limited to `scripts/workspace-migration-engine.cjs` and
`tests/workspace-migration-apply.test.cjs`. The migration entry previously refused
all `unclassified_root_entry` items even when a verified v2 snapshot privately
retained them. The local correction requires the verified
`bounded_complete_root_inventory` scope and exact root/type/source/archival-path
matching. The existing snapshot verifier validates descendant coverage and bytes.
Unknown roots remain in `quarantine/snapshot/archive/legacy-root`; they are not
automatically loaded into active workspaces. Identity, owner and model-grant gates
are unchanged. This is not authorization to assign historical data to a live user.

## Observed results

- Before the product correction: four new selected tests, two passed and two
  failed, exit 1. The valid archive case and corrupt-payload case both reached the
  premature `migration_unresolved_input` rejection.
- Focused migration/snapshot regression after the local correction: 37 tests,
  36 passed, one failed, exit 1; duration 72.203 seconds.
- Full repository regression with the existing local Caddy test executable:
  `node --test --test-concurrency=1 --test-timeout=90000 tests/*.test.cjs`.
  497 tests, 496 passed, one failed, zero skipped/cancelled; exit 1;
  duration 256.307 seconds as measured by the wrapper.
- Independent `node tests/smoke.cjs`: exit 0, duration 3.238 seconds. It exercised
  actual HTTP/WebSocket, two mock model backends in one channel, SQLite restart
  persistence, private bind and config preservation. These are fixture/model
  simulations, not real cloud-provider or vendor-computer acceptance.
- An independent read-only static review found no security/compatibility finding
  in this narrow guard correction. Static review does not replace failed tests.

## Remaining failure and startup observations

The sole full-suite failure is the newly authored test
`reviewed v2 migration retains unclassified root bytes and empty directories only
in quarantine`. Its directory-level assertion incorrectly requires the active
workspace's entire `agent_memories` directory to be absent. The fixture's known
`memory/agent.json` must legitimately migrate to that directory. The intended
assertion is that unknown `agent_memories/old.json` is absent from the active
workspace while the known file remains. Human confirmation for correcting this
authoring mistake is pending. Later verification and recovery assertions in that
test were not reached; they must not be counted as passed.

The existing packaged migration business test separately failed twice at its
10-second startup readiness wait. A disposable diagnostic observer recorded:

- Child spawn: `2026-10-11T04:07:21.063Z`.
- `PUBLIC_RUNTIME_READY`: `2026-10-11T04:07:35.951Z`, approximately 14.888 seconds later.
- `PUBLIC_RUNTIME_CLOSED`: `2026-10-11T04:07:35.971Z`; child exit 0 at
  `2026-10-11T04:07:35.999Z`.

Those runs did not reach their business assertions. The same business test passed
in the subsequent complete 497-test run without changing its wait. The prior
timeouts remain relevant intermittent-readiness evidence; one successful run does
not prove a startup-time guarantee or justify silently widening limits.

## Production and delivery boundary

No SSH authentication, production stop/start, deployment, credential change,
DNS/firewall/443 change, or Tailscale Relay change occurred in this follow-up.
The previously authorized archive maintenance window was already consumed.
This local regression is not a new live health or Relay-traffic verification.

Do not claim the suite is green, the correction is delivered, or the overall
platform is ready for use. Next: obtain confirmation for the erroneous assertion
correction, complete focused/full/smoke verification, then publish the tested
product change and perform the approved isolated actual-data native migration
acceptance. Live owner initialization, production cutover, public TLS, and actual
Muse/dots computer acceptance retain their separate authorization/evidence gates.
