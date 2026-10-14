# Agent event runtime and MCP integration: local validation

Date: 2026-10-14
Baseline: cdda46e

## Implemented scope

- The event runtime accepts an explicitly supplied trusted Agent authority.
  Malformed authorities are rejected before the event database is created.
- Persisted subscriptions use the existing live-grant checks and encrypted
  row-bound records. Runtime webhook authorization checks both stored node
  access and the Agent grant before DNS and again before invoking HTTPS POST.
- MCP event subscribe/unsubscribe obtains bindings from gateway-owned opaque
  Agent principals. Client parameters cannot supply those bindings.
- Event listing requires `events.read`; it does not require or confer
  `events.subscribe`. Subscriptions and unsubscriptions require the latter.
- Agent event discovery and methods remain disabled unless a grant-aware
  event implementation is explicitly supplied. Static paired-node behavior
  remains covered by the existing tests.
- No new background service, scheduler, listener type, or per-Agent process was
  added. Existing runtime timers and the existing MCP listener are reused.

## Evidence

- Runtime RED baseline failed because the optional authority was not wired.
- HTTP RED baseline demonstrated why enabling a method alone is insufficient:
  without carrying the grant, an HTTP-created subscription behaved as legacy
  and still delivered after grant revocation. The completed adapter prevents it.
- Focused integration suite: 52 passed, 0 failed/cancelled/skipped/todo.
- Full local suite: 763 passed, 0 failed/cancelled/skipped/todo; exit code 0.
- Full-suite duration: 690195.0806 ms.
- Local ignored TAP evidence:
  `.superpowers/sdd/2026-10-13-release-preparation/agent-events-runtime-mcp-full-20261014-221511.tap`
- SHA-256:
  `10e91cf86de1308f17ded320cb4924a1860a8c6290cf715cab2cfdd49a89f6b0`
- One bounded independent read-only review reported no actionable findings.
  The reviewer did not independently execute the tests.

New integration coverage includes signed verification/delivery, grant revoke
before pumping and during DNS, membership epoch change, JWT expiry during DNS,
restart and missing-authorizer refusal, foreign-workspace denial, real loopback
HTTP discovery/list/subscribe/unsubscribe, scope rejection, injected-binding
rejection, and HTTP verification revocation while DNS is pending.

## Evidence limits and remaining gates

HTTP tests use an actual loopback MCP server and actual signed-token verification
with fixture keys. External DNS and HTTPS callback dispatch are injected test
dependencies. No real vendor callback, real Pocket ID Agent access token, or
native Muse/dots cloud computer was used. A callback receipt never proves task
execution; the successful fixture task remains queued until explicitly claimed.

This stage does not activate the production assembler, choose or create an
Agent OAuth client, expose OAuth resource metadata, select live grants, change
public ingress, or migrate a production event database. VPS, credentials,
Pocket ID applications, DNS, old LACK, and Tailscale Relay were not changed.

Remaining work includes constrained Linux validation, trusted production
configuration and grant enrollment, restore/activation invalidation, protected
HTTPS ingress and OAuth discovery, and native vendor end-to-end evidence.
No completed deployment, sustained capacity, or complete project acceptance is
claimed. Requests dispatched before revocation cannot be recalled.
