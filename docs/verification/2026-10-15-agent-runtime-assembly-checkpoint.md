# Agent runtime assembly checkpoint, 2026-10-15

Status: local development only, not accepted for deployment or full delivery.
Base: `16c54da97dea149809ed10b97dfe192b7846ae65`.

## Scope

- Wire the existing verifier and authority into `gateway/public-runtime.cjs`.
- Forward the trusted deny-before-binding facade through `lack.py` and
  `gateway/runtime.cjs`; do not accept proofs or functions from JSON.
- Bind MCP connection discovery, exact grant authentication and event delivery
  to the same authority before readiness.
- Own verification abort/drain, the extra SQLite connection, startup rollback
  and writer-lock retention on incomplete shutdown.
- No production services, ingress, credentials, model routes or Relay changes.

## Evidence

Reports are under the ignored directory
`.superpowers/sdd/2026-10-14-agent-grant-routing/`.

1. `runtime-red.tap`: six new tests failed before assembly. Missing facade,
   missing authority and missing configuration rejection were observed.
2. `runtime-initial.tap`: five selected new tests passed, zero failures or
   skips, 11342.0205 ms. This includes actual materialized application startup,
   genuine signed fixture JWT discovery, startup rollback/restart, aborting an
   active JWKS request and retaining a writer lock for an unsettled verifier.
3. `runtime-related.tap`: 32 existing related tests, 31 pass, one failure,
   82481.6669 ms. The failure was `packaged OIDC incomplete body cancellation
   retains the writer lock on rollback`: its child `execFileSync` timed out.
4. `runtime-oidc-unchanged.tap`: that exact case passed unchanged on a separate
   run, 1/1, 6943.6067 ms. Neither its budgets nor assertions were changed.
   This does not establish the earlier timeout's root cause or convert the
   earlier run into a passing run.
5. `runtime-field-diagnostic.tap`: the remaining new integration test fails at
   line 117 because this new test asserts `nodeId` instead of the gateway's
   actual public-node field `id`. Its prior metadata and connection-discovery
   assertions ran successfully; later revocation assertions have not run in
   this test. Explicit approval to correct this fixture was requested.

## Open gates

The incorrect test field has not been silently repaired. No full regression
has been run on this assembly checkpoint, and no new constrained Linux result
applies to it. Prior 793/793 local and 15/15 native results concern the preceding
source, not this patch. No successful whole-checkpoint claim is made.

After approval, correct the fixture field, run all new cases and complete
regression/review. Continue owner-only CSRF-protected administration, exact
ingress and protocol coverage, restoration invalidation and separately approved
Pocket ID/native vendor enrollment. The tests use synthetic JWTs and local
fixtures; they are not Muse Laozhen or dots Xuanji computer-task acceptance.

This checkpoint is uncommitted pending the known fixture repair and validation.
No remote branch or deployment has been updated during this checkpoint.
