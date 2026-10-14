# Agent resource discovery and task deadline checkpoint

Status: local development checkpoint, NOT release-ready or full delivery.

Baseline: `45908a7a9a98deebaa325d87210858911ebb0afc`.
No production service, Pocket ID client, credential, DNS, firewall, public
listener or Tailscale Relay was modified during this checkpoint.

## Changes

- Added opt-in protected-resource metadata with pinned canonical HTTPS issuer
  and resource URLs. Public GET/HEAD discovery never derives URLs from forwarded
  headers. Enabling the profile requires the trusted Agent resolver.
- Added bounded Bearer discovery challenges for missing/invalid authorization
  and operation-specific insufficient-scope challenges. Existing readiness,
  Host, Origin, duplicate-header and token validation remain enforced.
- After explicit user approval, task root creation now samples the clock once
  for creation time, initial update time and deadline calculation. The maximum
  timeout remains 300000 ms. No timing assertion or startup budget was relaxed.
- Added deterministic advancing-clock regressions at 1000 and 300000 ms.

## Evidence, including failures

Evidence directory: `.superpowers/sdd/2026-10-13-release-preparation/`.
Reports are ignored local artifacts, not production data.

1. Resource discovery and existing MCP/events focused tests: 33/33 passed,
   exit 0, no failures/skips/cancellations, 55858.6207 ms.
   Report: `agent-resource-focused-20261014.tap`.
2. First full run: 773 total, 772 passed, 1 failed, no skips/cancellations,
   exit 1, 1013947.9514 ms. The migrated packaged runtime exceeded its
   existing startup readiness wait. This was not accepted as a passing run.
   Report: `agent-resource-full-20261014-224533.tap`.
   SHA-256: `34b52be7f82b6cf5d247bbfaf120cacb03b0797c02c7e04d4efc4d8f7b1363b8`.
3. Unchanged isolated rerun of that business test: 1/1 passed, exit 0,
   14746.1301 ms. This does not explain the earlier startup timeout.
   Report: `agent-resource-business-recheck-20261014-230257.tap`.
   SHA-256: `2f60beb04ac905798154bf34e874db29d6750f7e14acf5f398edc8414d53c38a`.
4. Second full run, still before the task deadline repair: 773 total,
   771 passed, 2 failed, no skips/cancellations, exit 1, 927222.9797 ms.
   The migrated business test passed. Failures were the background task
   deadline assertion and workspace runtime startup readiness.
   Report: `agent-resource-full-recheck-20261014-230354.tap`.
   SHA-256: `d75a7c7740e8c70785ae9b1782b6e543d7640c2639605be288060fde9ef852e6`.
5. Deterministic pre-fix task-clock reproduction: injected `now()` advanced
   one millisecond per call; recorded duration was 300002 ms for the
   configured 300000 ms. The real task controller and workspace fixture
   produced the expected failing assertion, exit 1. Separate clock samples
   in root creation explain this failure without attributing it to load.
   Report: `task-deadline-clock-reproduction-20261014.tap` (Node's default
   console reporter, despite the filename extension).
   SHA-256: `2cdbb5118668cc0089b29943f11a3d39932732b512156220ff845519af46c551`.
6. After the authorized single-clock repair, the focused ten-file run passed
   69/69, exit 0, no failures/skips/cancellations, 94043.6612 ms. It includes
   both startup cases, task control/background inference, new clock cases,
   resource discovery, event binding/ciphertext/runtime and real loopback MCP.
   Report: `task-deadline-focused-20261014-232001.tap`.
   SHA-256: `8ba5d7436fb98124ec28ba08a51196ea80ed5fb65b73252771b609cdff39ca82`.

Focused command (using the configured Node 24 runtime and Python):

```powershell
node --test --test-reporter=tap --test-concurrency=1 --test-timeout=90000 tests/task-deadline-clock.test.cjs tests/workspace-task-control.test.cjs tests/workspace-background-models.test.cjs tests/workspace-runtime.test.cjs tests/migrated-runtime-business.test.cjs tests/agent-resource.test.cjs tests/agent-events-binding.test.cjs tests/agent-events-ciphertext.test.cjs tests/agent-events-runtime.test.cjs tests/agent-mcp-http.test.cjs
```

Both full runs used `tests/*.test.cjs` with the same Node flags, Python,
and the existing verified portable Caddy 2.11.7 executable. No test files
were edited while a full run was in progress.

## Review and acceptance boundary

Separate read-only reviews of resource discovery and the task deadline fix
reported no actionable findings. Reviewers did not run tests.

There is no passing full-suite run after the deadline repair in this checkpoint.
Passing isolated startup tests does not resolve or explain the intermittent
full-run readiness failures. Do not combine separate results into a fictional
full pass, widen startup budgets without evidence, or release this checkpoint
as accepted. Preserve the failures for bounded startup-stage diagnosis.

Public runtime assembly of Agent authority, trusted grant selection, exact
HTTPS discovery routes, dedicated Pocket ID API/client enrollment, restart
and restore policy, and real Muse Laozhen/dots Xuanji computer round trips
remain separate gates. Metadata responses alone do not establish any of them.
Earlier constrained Linux results apply only to their recorded revisions,
not to the newly added discovery or clock changes. Git synchronization is a
development checkpoint, not a production deployment.
