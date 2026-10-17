# MCP lifecycle compatibility: local regression record

Date: 2026-10-15

## Scope and status

The user approved minimal lifecycle compatibility corrections, the node identity
assertion, and local/isolated regression. No production publication, credential
change, authority expansion, provider change, or Relay operation was performed.

Current status: the approved corrections passed the related local tests. This is
not full-project acceptance or a verified Muse/dots vendor integration.

## Changes

- `integrations/mcp/pilot-server.cjs`: accept authenticated initialized
  notifications with an empty HTTP 202 response; validate explicit protocol
  headers; authenticate optional GET and return 405 with `Allow: POST` when no
  SSE stream is provided; support authenticated ping without selecting a grant.
- Preserve current grant checks, revocation, Origin protection, rate limits,
  legacy paired-node behavior, scoped task operations, and shutdown checks.
- `tests/agent-mcp-lifecycle.test.cjs`: retain the five original reproduction
  cases and add six cases for malformed notifications, version compatibility,
  authentication/revocation, legacy nodes, and close-during-authentication.
- `tests/public-agent-runtime.test.cjs`: assert the authenticated node's `.id`,
  rather than the nonexistent `.nodeId` field.

The existing initialization version remains `2025-11-25`. Explicit HTTP headers
accept the two versions already declared by the implementation; absent headers
remain compatible with existing callers. This does not establish full compliance
with every MCP version or a particular vendor client.

Protocol references:
[transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports),
[lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle),
[ping](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/ping).

## Test evidence

Node v24.19.0, Windows, test concurrency 1, TAP reporter. Existing per-test
deadlines and assertions were retained. All commands below finished; no test
session was left running.

| Run | Tests | Pass | Fail | Cancelled | Skipped | Exit | Duration |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Full baseline before this patch | 829 | 814 | 13 | 2 | 0 | 1 | 2907.424 s |
| Initial MCP focused regression | 26 | 25 | 0 | 1 | 0 | 1 | 101.862 s |
| Unchanged identity HTTP diagnostic | 18 | 18 | 0 | 0 | 0 | 0 | 29.347 s |
| Expanded MCP related regression | 68 | 68 | 0 | 0 | 0 | 0 | 69.099 s |

The initial focused regression cancelled the materialized-application authority
test at its existing 45-second deadline. The same test passed in the expanded
run in 5.299 seconds without an intervening code or timeout change. The failed
run remains evidence; the cause of the timing variation is not established.

The identity diagnostic left product and fixture behavior unchanged and recorded
145 observations, no request errors, and no detected connection reuse across
test servers. The two baseline `fetch failed` cases did not reproduce. This is
not evidence that their root cause has been fixed.

Expanded regression command:

```powershell
node --test --test-reporter=tap --test-concurrency=1 --test-timeout=90000 tests/agent-mcp-lifecycle.test.cjs tests/agent-mcp-http.test.cjs tests/agent-discovery-budget.test.cjs tests/agent-grant-discovery-boundaries.test.cjs tests/agent-resource.test.cjs tests/pilot-mcp.test.cjs tests/workspace-mcp.test.cjs tests/mcp-artifact-upload.test.cjs tests/mcp-events-lifecycle.test.cjs tests/mcp-events-cleanup.test.cjs tests/mcp-events.test.cjs tests/public-agent-runtime.test.cjs tests/public-agent-scope-events.test.cjs tests/dots-mcp-local-pilot.test.cjs
```

Coverage includes signed test JWTs, discovery budgets, task scope, grant
revocation, resource metadata, cross-workspace denial, bounded uploads, signed
event delivery, shutdown behavior, and the local dots protocol pilot. Local test
JWTs and the local pilot are not production Pocket ID or actual dots execution.

A fresh, read-only process query after completion found no Node process matching
the selected test commands or identity observation preload. This is a scoped
check, not an assertion that all unrelated system processes are absent.

## Retained full-baseline failures

The full baseline failed cases 193-197 (MCP lifecycle), 283-284 (identity fetch),
500 (node field assertion), 546/548 (public runtime), 606 (browser fixture),
686/705 (migration apply/recovery), 711 (migration CLI), and 744 (workspace
runtime). Cases 546 and 686 were cancelled; the others were failures.

Related green tests do not replace a new full-suite result. In particular, the
remaining runtime, browser, and migration failures still require investigation
and/or unchanged reproduction. A previously sampled CPU/memory pressure state
is an observation, not a proven cause for all failures.

## Evidence hashes

Local logs are under
`.superpowers/sdd/2026-10-14-agent-grant-routing/`.

| File | SHA-256 |
| --- | --- |
| `cancellation-full-regression-2026-10-15.tap` | `1193e37020b78115a55409d755cefc67e20851e02ce64962c3313b2b6a26edb4` |
| `mcp-lifecycle-focused-2026-10-15.tap` | `ab36217579d05b4bfde25a5c421da2cc1525d58ea650028227b87a25429be7e6` |
| `identity-http-diagnostic-2026-10-15.tap` | `b70afcfda1d554b32c3fa2770697f3a0c8b968cbfaeb7874eee154d1cb25717a` |
| `identity-http-observation-36008.json` | `bf134eb1813f7c6ae8489b61181748fb9f99d251c1a9c77abd8811aaf4f6a0ff` |
| `mcp-lifecycle-related-2026-10-15.tap` | `6f438d7cd071eb65ff5be26bcae958617938939da4349be8add99f78a98c1c22` |

## Remaining gates

- Resolve the outstanding full-suite failures without weakening safety checks.
- Complete constrained Linux verification and full regression after integration.
- Verify the public HTTPS ingress routes separately; this backend patch does
  not change the Caddy ingress template.
- Perform actual Muse/dots enrollment, task execution, evidence return, and
  revocation acceptance under separately approved configuration.
- Complete the delivery evidence and GitHub synchronization checkpoint. This
  local regression phase did not run Git or publish production changes.
