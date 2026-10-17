# Packaged scoped-tool and event coverage checkpoint, 2026-10-15

Status: supplemental local evidence with two newly identified test-boundary
repairs awaiting approval. No product code or production configuration changed.

## Added coverage

New helper: `tests/helpers/public-agent-fixture.cjs`.
New tests: `tests/public-agent-scope-events.test.cjs`.

Each case materializes and starts the actual packaged public runtime, with
real SQLite identity/gateway state, signed fixture JWTs and the existing
verifier/authority/MCP composition. Public DNS and outbound webhook POST are
substituted at the transport boundary. Host allowlists, callback signatures
and live pre/post-DNS authorization remain real. No external callback is sent.

`packaged-scope-events.tap`: four tests executed and reported passing,
6301.8902 ms. Their evidence is not equally strong:

1. Real scoped `pilot.read_task` calls select B, A, B explicitly; foreign task
   access, omitted selection and use of a revoked grant are denied without
   falling back to the still-available grant.
2. OAuth event subscription rejects insufficient token scope, accepts the
   selected grant, delivers signed data for its workspace/task, and supports
   unsubscribe. Notification delivery does not claim or execute the task.
3. Human HTTP revocation during subscription-verification DNS prevents the
   verification POST and subscription persistence. The HTTP result is awaited
   before runtime teardown, so shutdown does not explain this rejection.
4. Delivery-DNS revocation test has a confound: it releases DNS and immediately
   closes the runtime. Shutdown itself can stop delivery, so this passing
   assertion does not independently prove revocation caused the denial.

Approval was requested to observe completion of the already-started transport
attempt and its revocation rejection before closing the fixture. That change
has not been applied. Keep this validation gap open despite the green count.

## Related run and reproduced connection-pool failure

`packaged-events-related.tap`: 43 executed, 42 pass, one fail, no skips or
cancellations, 21700.8034 ms. Failed case:
`packaged human grant administration and MCP use one live authority; disabled restart has no grant endpoint`.

An unchanged three-attempt run with sanitized fetch diagnostics passed twice
and failed once. The failed GET reported `ECONNRESET`, not a timeout.

A further read-only diagnostics-channel observer reproduced the failure on
its first attempt (`packaged-admin-socket-1.tap`). Socket identity 1, previously
used for POSTs before shutdown, was reused for the GET after the runtime
printed its second successful-start message. That socket then closed and the
GET failed with `ECONNRESET`. The observer records method, path and socket
identity/ports only; it does not log headers, credentials or bodies.

This identifies the test's reused client connection across the controlled
same-port restart. Approval was requested for a fixture-owned HTTP connection
pool, drained/closed before shutdown and replaced for the restarted runtime.
No product timeout, transport retry or production policy has been changed.

## Remaining repairs and delivery boundaries

Three test corrections currently await human approval:

- The earlier public-node assertion must use `id`, not `nodeId`.
- The new delivery-DNS test must establish revocation rejection before teardown.
- The packaged administration restart test must own its client connection pool.

The prior full run remains 813/814 on its recorded source/test inventory. These
four later tests were not in that full run; do not combine the counts into a
new full-suite pass. All current test exec handles are terminal. No process
restart was triggered merely by an observation timeout.

Changes remain local and uncommitted. No VPS, credential, Pocket ID client,
provider route, DNS, ingress or Relay change occurred. Native vendor execution,
real browser acceptance, current constrained Linux and final publication remain
unaccepted.
