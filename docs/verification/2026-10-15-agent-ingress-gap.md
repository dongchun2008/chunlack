# Agent ingress gap: local evidence only

Date: 2026-10-15. No production service was contacted or changed.

## Checked

- Read current `deploy/public/Caddyfile.template`, `render-ingress.cjs`, example
  configuration and `identity/agent-resource.cjs`.
- Rendered an ignored candidate from the existing example configuration and
  successfully ran the existing portable Caddy `adapt` command, with a bounded
  20-second process timeout. No Caddy server was started, no ports were bound,
  and no certificate was requested.
- Ran unchanged `tests/agent-resource.test.cjs`: 10/10 passed, zero failures,
  skips or cancellations, exit 0, 1249.1937 ms.

## Confirmed local mismatch

The backend exposes exactly these public GET/HEAD metadata paths when Agent
OAuth is enabled:

```text
/.well-known/oauth-protected-resource/mcp
/.well-known/oauth-protected-resource
```

The rendered Agent-host ingress has only POST `/mcp` plus existing `/v1/`
node routes, followed by a catch-all 404. Neither metadata path nor GET `/mcp`
has a forwarding rule. Consequently, this candidate configuration would block
the metadata advertised in the backend's authentication challenge. This is a
local configuration finding, not a fresh measurement of deployed public routes.

The existing human-host patterns already cover GET/POST/DELETE
`/api/workspaces/<id>/agent-grants[/<grantId>]`. They do not require broadening
to support owner grant management. The existing Agent host does not forward
human `/api/` routes; preserve that separation.

## Minimal next implementation scope

After the pending runtime/test corrections and required validation gate:

1. Forward only GET and HEAD for the two literal metadata paths on the Agent
   host, to the MCP backend. Do not proxy an arbitrary `.well-known` prefix.
2. Coordinate exact GET `/mcp` handling with the pending transport correction:
   declining optional SSE should yield 405, not a missing-route 404. Do not
   introduce a streaming service merely to satisfy this path.
3. Preserve query rejection, malformed-path rejection, identity-header scrubbing,
   loopback upstreams, Origin protection, and the absence of Agent-host human
   administration routes.
4. Test real local HTTPS forwarding, metadata body and challenge consistency,
   disabled-OAuth backend 404, exact methods, path/query variants, cross-host
   denial and authentication. Caddy adaptation alone is not this acceptance.
5. Only after local and constrained native validation, use a separately scoped
   controlled rollout. No production update follows from this diagnostic.

This requires no extra service, listener, database or polling process. It does
not change model routing, Pocket ID clients, credentials or Tailscale Relay.

## Artifacts

Ignored plan-owned directory:
`.superpowers/sdd/2026-10-14-agent-grant-routing/`

- `mcp-ingress-audit.Caddyfile`: generated candidate, not activated.
- `mcp-ingress-adapt.json`: actual Caddy-adapted configuration.
- `mcp-ingress-adapt.stderr.txt`: adaptation diagnostics.
- `ingress-resource-baseline.tap`: unchanged ten-test backend run.

The previous lifecycle test failures and three fixture correction requests
remain open. This ten-test result does not supersede any failed full run, prove
vendor enrollment or satisfy the full delivery goal.
