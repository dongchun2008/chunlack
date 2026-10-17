# Discovery-only implementation checkpoint, 2026-10-16

Status: implemented locally; partial verification complete; not deployed.
Dates in this report refer to Asia/Shanghai. No final delivery claim.

## Approved change

The explicit `publicRuntime.agentOAuth.discoveryOnly` mode accepts an empty
Agent client list only when OAuth is enabled. The immutable verifier denies
all evidence and performs no JWKS fetch. The existing MCP HTTP and direct RPC
handlers reject signed and paired-node requests before task dispatch, while
the two existing public resource-metadata paths remain available.

The owning runtime does not create Agent authority or enable event delivery
in this mode. Combining it with enabled events fails during configuration
validation. Normal mode still requires a nonempty dedicated client list.
Human/internal gateway behavior is intentionally not globally disabled.

Product files changed: identity/agent-access.cjs,
integrations/mcp/pilot-server.cjs, gateway/public-runtime.cjs.
Tests: tests/agent-discovery-only.test.cjs and the explicit fixture option in
tests/helpers/public-agent-fixture.cjs. Usage: docs/AGENT_DISCOVERY_ONLY.md.

## Completed evidence

1. Before implementation, all three new tests failed on absent mode behavior:
   empty enrollment was rejected and conflicting mode settings were ignored.
2. The first Windows focused run ended with 90 tests: 84 passed, 4 failed,
   2 cancelled, no skips. Preserve this as failed evidence, not a pass.
   Failures/cancellations involved the new packaged test and existing
   materialization, runtime startup, port-conflict and restart cases.
   All test entries had reported but the public-runtime worker remained live.
   Only confirmed owned worker PID 35876 was stopped; the parent then exited
   with code 1. No unrelated Node process was terminated.
3. A diagnostic rerun of the new packaged test passed 1/1 with its unchanged
   60000 ms budget. Materialization completed around 4.98 s, packaged startup
   around 19.45 s, and assertions around 22.38 s from preload start. Test
   duration was 22114.487 ms. Requests returned metadata 200, MCP 401, foreign
   Origin 403, invalid metadata query 404, and human health 200. Both workspace
   tasks remained queued. This does not establish the initial timeout cause.
4. Native Linux discovery-only tests passed 3/3, exit 0, no failures,
   cancellations or skips. Unit: chunlack-discovery-only-63635d461d26.service.
   Source archive SHA-256:
   024c0934bdbcd95f7156ffc157dedf567f14a5d29da214514591d9a1bf4b78f7.
   MemoryPeak: 90931200 bytes; CPUUsageNSec: 1441322000.
5. Native Linux existing HTTPS ingress regression passed 9/9, exit 0, no
   failures, cancellations or skips. Unit:
   chunlack-agent-ingress-dd04ce129663.service. Source archive SHA-256:
   de3387d366352fd7d49f28a59366252339345f9fdb1449cc10139c41afb97c5c.
   MemoryPeak: 100904960 bytes; CPUUsageNSec: 3539472000.

Both native runs verified nobody/nogroup, PrivateNetwork, PrivateTmp,
ProtectHome, strict ProtectSystem, NoNewPrivileges, 192 MiB MemoryMax,
160 MiB MemoryHigh, no swap, 10% CPU, 32 tasks and a 90-second runtime limit.
Both stopped their owned unit and confirmed old LACK, public LACK, HTTPS and
Tailscale baseline unchanged. These limits apply to the test units; dependency
preparation was separately bounded, not claimed to run inside those units.

After successful tests and stopped-unit checks, only each new unit's source
directory, scratch directory and uploaded source.tar were removed. Remote
report.json and results/tests.tap, plus local reports/source archives, remain.

## Independent review and outstanding tests

A fresh read-only reviewer found no concrete security or functional bug in
the scoped additions. It identified missing runtime-level proof of zero JWKS
requests and preservation of authenticated human HTTP/internal node reads.
tests/agent-discovery-human-boundary.test.cjs adds that coverage without
changing product code or existing fixtures. It had not yet run at this
checkpoint.

The full project command is running with its existing single-worker,
90000 ms test budget and existing private Caddy executable. It started before
the supplemental test file was added; do not count that test in this run or
claim the current whole worktree has passed solely from that run.

Logs under .superpowers/sdd/2026-10-14-agent-grant-routing/:
- discovery-only-focused-20261016.tap (failed first run)
- discovery-only-startup-diagnostic-20261016.tap (one packaged test passed)
- discovery-only-full-20261016.tap (pending at checkpoint)
- chunlack-discovery-only-63635d461d26-report.json
- chunlack-agent-ingress-dd04ce129663-report.json

## Dots browser result

After closing the old unsaved form, reloading the authenticated plugin page,
and opening a fresh custom MCP form, ChatGPT displayed a concrete callback
URL. Automatic MCP OAuth discovery still reported failure at the same time.
Thus callback display recovered without deploying this patch; the original
callback failure cause remains unconfirmed. The unsaved form is retained and
its exact callback must be rechecked before creating an OAuth client.

No connector was created, no client secret entered, and no risk acknowledgment
or access consent submitted. Muse remains deferred until the user can log in.
No production files, credentials, Pocket ID clients, firewall or Relay settings
were changed. Real vendor execution and full delivery remain unverified.

## Final local results for this checkpoint

- Full project regression finished: 840 tests, 837 passed, 3 failed, 0 cancelled, 0 skipped, 0 todo; exit 1; duration 1102186.9853 ms.
- All three failures were in tests/public-runtime.test.cjs. Two failed while scripts/materialize.py exceeded the existing child-process budget; one failed the existing packaged-runtime readiness check.
- The three failing tests were rerun alone with the original test budgets and no product or fixture changes: 3 passed, 0 failed/cancelled/skipped/todo; exit 0; duration 23706.8947 ms. This does not establish the root cause or turn the original full run into a passing run.
- Supplemental authenticated human HTTP, workspace isolation, internal paired-node read, MCP denial and zero-JWKS-fetch regression: 1 passed, 0 failed/cancelled/skipped/todo; exit 0; duration 16594.2475 ms. This file was added after the full regression started and was not included in its 840 count.
- Relevant rerun logs under .superpowers/sdd/2026-10-14-agent-grant-routing/: discovery-only-runtime-three-rerun-20261016.tap and discovery-only-human-boundary-20261016.tap.
- No new timeouts were increased, no assertions removed and no production services or credentials changed to obtain these rerun results.
- Overall gate remains incomplete: no single all-green full-suite run for the current worktree, no production discovery-mode deployment, no dedicated dots OAuth client or access grant, and no real dots cloud-computer round trip.
- No GitHub synchronization was performed for this checkpoint. The local changes and both failing and passing evidence remain available for the next approved step.

## 2026-10-16 follow-up timing investigation (in progress)

- Previous goal turn made progress: mode implementation, native tests, callback display recovery and local failure/rerun evidence. It was not final delivery.
- Read the current materializer and packaged-runtime fixture. Materialization has an existing 10000 ms child deadline; runtime readiness uses 160 waits of 50 ms. Neither was changed.
- One current host CPU sample reported 100 percent busy. This is not proof of the earlier timeout cause; no unrelated process or security service was stopped.
- Three serial, owned-directory materialization probes retained the 10000 ms child budget. All exited 0; total wall times were 3686.6392, 1466.4005 and 966.6465 ms. Each performed 53 file copies and 57 target checks. Copy wall times were 2637.5804, 172.8235 and 120.3430 ms. Embedded-source parsing took 88.9454, 32.1734 and 28.7341 ms. No large recursive scan was observed in these samples. The earlier timeout was not reproduced and its cause remains unconfirmed.
- Probe directories were newly owned temporary roots, checked for exact canonical location before removal. No product source, test assertion, production configuration or credential was modified by the probe.
- Started one complete current-worktree regression with original deadlines, serial test execution and portable Caddy enabled. A local preload instruments only public-runtime.test.cjs child phases, timings and lifecycle markers, without recording arguments, environment, HTTP payloads or credentials. Its timing overhead must be considered when interpreting diagnostics.
- Running execution handle: 19443. Latest observed output advanced through test 372; the handle remained live. No final count, exit status or acceptance claim is available yet. Do not start a duplicate run because a wait observation times out.
- Logs: discovery-only-full-diagnostic-20261016.tap; public-runtime-phases-full-20261016.jsonl (created when that test worker runs); materialization-phases-20261016.jsonl, all under the ignored .superpowers/sdd/2026-10-14-agent-grant-routing directory.
- Pending after the run: inspect authoritative counts and failure phases, run the standalone smoke without overlapping the heavy suite, then complete scoped synchronization/release preparation. Real vendor enrollment and production changes retain their separate approval boundaries.

## Approved cleanup repair verification, 2026-10-16

Only test fixtures changed: tests/helpers/public-runtime-resources.cjs,
tests/public-runtime.test.cjs, and tests/public-runtime-cleanup.test.cjs.
Fallback cleanup now attempts all owned children and aggregates errors. Abort
regressions observe automatic STOP/root cleanup before explicitly awaiting close.
A real-child regression preserves forced-cleanup failure while cleaning the next
child. Original deadlines and functional/security assertions remain unchanged.

Prior full diagnostic: exit 1; 841 tests, 835 passed, 4 failed, 2 cancelled,
0 skipped; 3099751.0464 ms. The runtime fixture had loaded before this repair.
Its late-ready owned child PID 36064 (parent 33520) required forced cleanup;
that is failure evidence, not graceful shutdown acceptance.

The queued focused command exceeded its 900-second wait for the old suite and
never started tests. After the old suite completed, the focused run completed:
exit 1; 24 tests, 15 passed, 8 failed, 1 cancelled, 0 skipped; 232969.9925 ms.
All seven new cleanup regressions passed. Remaining cases failed on Python
materialization ETIMEDOUT, Node child ETIMEDOUT, or the MCP-conflict case's
original deadline. The focused run exited without manual child termination.

Local ignored evidence under .superpowers/sdd/2026-10-14-agent-grant-routing:
- discovery-only-full-diagnostic-20261016.tap
- runtime-cleanup-focused-20261016.tap

A subsequent read-only host-load query did not return promptly and was cancelled;
no host-load diagnosis is claimed. Investigate bounded materialization/startup
failures before another full acceptance run; do not weaken timeouts or repeat
until a chance pass. No production, credentials, access grants, Relay changes,
deployment or GitHub synchronization in this step. Delivery remains incomplete.
