# Explicit grant routing: local checkpoint, not release acceptance

Date: 2026-10-15 (Asia/Shanghai). Baseline: `59146ca`.
The user approved the canonical `/mcp` endpoint with explicit per-call grant
selection, then separately approved correcting the new synthetic test actor
from member to owner. No production permission policy was changed.

## Implemented locally

- `identity/agent-authority.cjs`: bounded connection discovery using one existing
  verifier invocation, current identity/member epochs, node state, grant expiry
  and scope intersection. Returned labels and fields are limited; metadata is
  not an opaque gateway proof.
- `integrations/mcp/pilot-server.cjs`: opt-in connection discovery, generic
  initialization/tool listing without a default node principal, and required
  per-call grant selection for tools/events. Existing paired-node schemas and
  fixed-grant internal fixtures remain unchanged. New production assembly is
  still pending.
- Three new test files cover selection, isolation, invalid arguments, revoke,
  expiry, unlink, pause, labels, real HTTP, injected event bindings and budget.
- `docs/AGENT_CONNECTION_ROUTING.md` describes the integration contract and
  remaining delivery gates. The approved plan status is recorded.

## Test evidence

All reports are in ignored `.superpowers/sdd/2026-10-14-agent-grant-routing/`.

1. Original fixture: 0/8, failed while preparing nodes because the second
   workspace actor was a member. This was our fixture mistake, not a product
   routing regression. After the specifically approved correction: 3/8 passed,
   5 failed at the missing new discovery/routing behavior, providing RED evidence.
2. `green-focused.tap`: 51/51 passed, 0 fail/skip/cancel, 55392.8602 ms.
   Files: agent-grant-routing, agent-authority, agent-mcp-http, agent-resource.
3. `boundaries.tap`: 44/44 passed, 0 fail/skip/cancel, 36649.6363 ms.
   Files: agent-grant-discovery-boundaries, agent-events-binding,
   agent-events-runtime, agent-events-ciphertext.
4. `review-budget.tap`: 1/1 passed, 2986.2898 ms. Actual signed JWTs prove all
   four generic methods share the real verifier's 120/minute limit. After the
   setup verification, 119 more calls succeed; subsequent calls fail, and the
   next minute recovers. This is not a benchmark or production capacity claim.
5. Full suite with verified portable Caddy: **790 tests, 787 pass, 3 fail**,
   0 skipped/cancelled/todo, exit 1, 1234648.3057 ms. The duration includes a
   stalled fixture and explicit cleanup intervention, not just test execution.
   `full-20261015.tap` SHA-256:
   `56f3686ec6f48abc4703d46a8c822c1df4d43392543ed2e4338d6ee5b8c8e144`.

The full invocation was:

```text
node --test --test-reporter=tap --test-concurrency=1 --test-timeout=90000 tests/*.test.cjs
```

## Full-run failures and bounded follow-up

- Existing `public-ingress.test.cjs` TLS routing test failed in its after hook
  deleting its private temporary directory (`EPERM`), not in its route/TLS
  assertions. The fixture registers directory removal before server/child
  shutdown. An isolated Node hook-order probe confirmed registration-order
  execution. Its test child and owned Caddy remained alive and blocked progress.
- After checking executable paths, the parent chain and the exact unique
  fixture Caddyfile, only that test child (36404) and Caddy (25864) were stopped.
  The first absolute-path guard refused the child's relative test argument
  without changing anything; the revised guard matched the observed argument
  and verified chain. Parent runner 19524 was left running and completed.
  No temporary directory was manually deleted. The failure remains in the log.
- Two existing packaged OIDC incomplete-body tests timed out in `execFileSync`
  during shutdown/rollback trials. An unchanged, isolated two-test rerun passed
  **2/2** in 13140.7099 ms, without changing budgets, code or lock assertions.
  `unchanged-oidc-lock-retest.tap` SHA-256:
  `f2b5b89c83d8bd1aea70f03a96e3ac8fdcf984d6e457e59c1d6d565208cbad52`.
  The original timeout cause is not established by this later pass.

Approval has been requested to correct only the existing HTTPS test fixture's
cleanup sequence and repeat validation. That correction is not yet applied.
The two-test rerun does not turn the failed full run into a passing full run.

## Independent review and decisions

The scoped read-only reviewer reported one alleged generic-discovery rate-limit
bypass and no other concrete finding in the reviewed changes. The reviewer did
not run tests and did not review the later boundary/budget tests.

Ruling: the unlimited-request finding was not reproduced. Generic requests
bypass the node-ID bucket because they intentionally have no selected node,
but must first use the existing globally bounded JWT verifier. The new actual
verification regression above demonstrates that budget. No second decoder,
manufactured node identity or redundant limiter was introduced.

Ruling: discovery requires `task.read`, matching existing protocol discovery.
Write/event-only tokens cannot enumerate connections; setup must include read
permission for discovery. A known grant remains usable only within its actual
authorized operation scope.

Ruling: the new mode remains explicitly enabled by `resolveAgentConnections`.
The upcoming public runtime must provide both discovery and exact-grant
authentication callbacks; fixed-grant internal fixtures are not the final
multi-connection public configuration.

## Still required

- Fix and rerun the HTTPS cleanup fixture after approval, then obtain a fresh
  passing full suite. Preserve the two intermittent OIDC failures as evidence.
- Complete owned authority/runtime lifecycle, owner-only grant administration,
  exact ingress and full native MCP handshake coverage.
- Run selected constrained Linux tests for this new revision; earlier 64/64
  native results belong to the previous source and cannot be reused as current.
- Separately enroll real Pocket ID resource/clients and obtain native Muse
  Laozhen/dots Xuanji computer-task nonce/evidence/receipt acceptance.
- Retain the remaining sustained resource, restore/revocation and production
  publication gates from the approved plan. This is not delivery-ready.

No production service, VPS, Pocket ID application, credential, provider route,
public listener or Tailscale Relay was modified by this work.
