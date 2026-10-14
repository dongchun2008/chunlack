# Optional Agent JWT MCP transport: local validation

Date: 2026-10-14. Local transport checkpoint; not production or vendor acceptance.

## Changes

- `createPilotMcp` accepts an optional trusted `resolveAgentPrincipal` dependency
  only for a multi-user gateway with workspace access. Existing production
  assembly does not supply this dependency, so Agent JWT HTTP is not enabled
  by this commit alone.
- Dotted token candidates take only the Agent path; a failure never falls back
  to static pairing-token authentication. Agent tokens are bounded to 8192
  characters when opted in. The existing static Authorization-header limit
  remains 256 characters.
- The resolver receives the operation's required scope and must return an
  actual gateway-issued Agent principal. `requireAgent` rejects even an
  otherwise authentic static pairing principal as a substitute.
- Gateway authority is checked again before entering the workspace context
  for synchronous tool effects. Request arguments cannot select another node
  or workspace. Insufficient scope returns HTTP 403; invalid identity returns
  HTTP 401.
- A close occurring while principal resolution is pending prevents subsequent
  task execution.

Scope mapping:

| MCP operation | Required scope |
| --- | --- |
| server/discover, tools/list, pilot.read_task | task.read |
| pilot.claim_task | task.claim |
| pilot.heartbeat, pilot.report_event, pilot.submit_result | task.result |
| pilot.artifact_begin, pilot.artifact_chunk, pilot.artifact_finish | task.result |
| events/list | events.read, then explicit Agent feature denial |
| events/subscribe, events/unsubscribe | events.subscribe, then explicit Agent feature denial |

## Durable events remain closed for Agent JWTs

Existing background event delivery revalidates persisted node attribution,
not the new Agent grant. Therefore Agent JWT event methods deliberately return
`agent_events_not_ready`, and Agent discovery does not advertise events.
Static pairing-token events retain existing behavior. Enabling durable Agent
subscriptions requires persisted grant attribution, revocation/expiry checks
and restart tests; it is not safe to bypass this gate with the generic callback.

## Test evidence

- Baseline real-HTTP test before implementation failed with HTTP 401 where 200
  was required. The baseline test used a cryptographically signed synthetic
  JWT and an explicit local grant, not a fake authenticated principal.
- Focused six-file suite: 36/36 passed, zero failures/skips/cancellations,
  exit 0, 12602.9973 ms.
- Fresh full repository suite: 725/725 passed, zero failures/skips/cancellations
  or TODOs, exit 0, 790530.1202 ms. The original process was allowed to finish
  despite slower migration cases; no test timeout or assertion was relaxed.
- Full report:
  `.superpowers/sdd/2026-10-13-release-preparation/agent-mcp-http-full-20261014-205016.tap`.
- SHA-256:
  `5471e8448df9cbe21fa4474eedec2c6ff7e44cbc79494b9f6be148f03709e209`.
- Focused report:
  `.superpowers/sdd/2026-10-13-release-preparation/agent-mcp-http-focused-20261014.tap`.
- Baseline report:
  `.superpowers/sdd/2026-10-13-release-preparation/agent-mcp-http-red-20261014.tap`.
- The first independent reviewer stopped with service HTTP 429 and provided
  no conclusion. One later read-only retry completed with no actionable
  findings in this bounded change. No reviewer ran tests or modified files.

The new HTTP cases cover granted reads, cross-workspace denial, read-only
claim/upload denial without mutation, claim/renewal/progress, chunked screenshot
upload, result persistence and idempotence, explicit grant revocation, legacy
compatibility, malformed/oversized JWT rejection without fallback, withheld
Agent event capability, shutdown during authentication, and rejection of a
static-principal downgrade.

The image, browser activity description, users, keys, issuer, JWT and webhook
environment are synthetic. The saved pilot result reaches evidence_checked,
not automatic human acceptance. No Muse/dots cloud computer was executed.

## Reproduction environment

Node v24.19.0 and pinned repository dependencies. Full run used the existing
Python executable and portable Caddy v2.11.7 after confirming SHA-256
`5f93a9bd555f3aac9d33af2756ba14b3519d8cca4ffd55256bdaeab444c9db2a`.
Set PYTHON and CADDY_TEST_BIN, and add the Node and Git OpenSSL directories to
PATH as in prior local HTTPS verification.

```powershell
node --test --test-reporter=tap --test-concurrency=1 --test-timeout=90000 tests/agent-mcp-http.test.cjs tests/workspace-mcp.test.cjs tests/pilot-mcp.test.cjs tests/mcp-artifact-upload.test.cjs tests/agent-gateway-authority.test.cjs tests/agent-gateway-authority-boundaries.test.cjs
node --test --test-reporter=tap --test-concurrency=1 --test-timeout=90000 tests/*.test.cjs
```

## Remaining integration gates

- Trusted production issuer/client/grant selection and bounded lifecycle
  assembly. Tests explicitly bind one synthetic grant in their resolver;
  this is not an automatic production grant-selection implementation.
- Protected-resource metadata, OAuth challenge/discovery and exact HTTPS
  ingress/header limits compatible with actual clients.
- Durable Agent event delivery with persisted grant-bound authorization.
- Snapshot/restore authorization invalidation in derived working copies,
  without rewriting forensic backup payloads.
- Native Linux resource-limited validation and controlled production rollout.
- Real Pocket ID Agent enrollment and separate Muse LaoZhen / dots Xuanji
  native-computer evidence round trips, plus remaining project delivery gates.

No production service, VPS, Pocket ID application, credential, DNS/firewall or
Tailscale Peer Relay was modified. This checkpoint is not full delivery.
