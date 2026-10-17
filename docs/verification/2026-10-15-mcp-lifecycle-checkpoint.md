# MCP lifecycle compatibility checkpoint

Date: 2026-10-15. Local diagnostic, not a release or vendor acceptance.

## Scope and status

While three earlier test corrections still await explicit human approval,
checked the independent standard MCP lifecycle boundary. No existing product
or test file was modified. Added `tests/agent-mcp-lifecycle.test.cjs` to expose
missing transport behavior before implementing a correction.

This uses the real HTTP MCP handler, signed synthetic JWTs, verifier, authority,
SQLite gateway and workspace checks. The fixture replaces only external JWKS
retrieval. It does not use a native vendor client, public ingress or production.

## Observed run

Command:

```powershell
node --test --test-reporter=tap --test-concurrency=1 --test-timeout=90000 tests/agent-mcp-lifecycle.test.cjs
```

Node executable was the existing bundled Node v24 runtime. Result: 5 tests,
0 pass, 5 assertion failures, 0 skipped/cancelled/todo, exit 1,
1015.4299 ms. These are RED regressions, not a passing compatibility test.

| Boundary | Expected | Observed |
| --- | --- | --- |
| Valid initialize then id-less initialized notification | 202, empty body for accepted notification | 200; assertion failed before later discovery/read checks |
| Invalid JWT on initialized notification | 401 under the existing authenticated endpoint policy | 200; the RPC envelope rejection runs before authentication |
| Optional SSE GET when no stream is offered | 405 | 404 |
| Unsupported protocol header on tool discovery | 400, no protected tool result | 200 |
| Generic authorized ping | Empty result without selecting a workspace grant | JSON-RPC invalid_id; later revocation assertion not reached |

The invalid-JWT notification result does not prove unauthorized task execution
or data access: the implementation rejects the notification envelope. The issue
is an incorrect success HTTP status before the authentication boundary.

The first test proves initialization itself currently responds successfully;
it does not prove the complete handshake, since its notification assertion fails.
Ping is an optional mechanism; adding its expected behavior is a compatibility
recommendation, not evidence that every vendor requires it.

## Root causes visible in the current implementation

- `handleRpc` requires a string/integer id for every message, before authentication.
  The standard initialized notification intentionally has no id.
- The HTTP adapter always serializes an RPC object and maps most RPC errors to
  HTTP 200; it has no accepted-notification/empty-202 path.
- The method/path filter only accepts POST `/mcp`; GET falls through to 404.
- The HTTP adapter does not validate `MCP-Protocol-Version`.
- The generic explicit-OAuth branch handles discovery, tools/list and initialize,
  but not ping; ping falls into explicit grant selection and fails invalid_id.

## Reference contract consulted

- [MCP 2025-11-25 lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle): initialize followed by initialized notification.
- [MCP 2025-11-25 transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports): accepted notifications use empty 202; unsupported SSE uses 405; unsupported protocol headers use 400.
- [MCP 2025-11-25 ping](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/ping): optional liveness request with empty result.

## Proposed bounded correction, not yet applied

Keep the lightweight stateless JSON transport, loopback listener, rate/body
bounds, origin checks, token verification and explicit per-tool grant selection.
Handle the initialized notification as a distinct authenticated message, with
no side effect and an empty 202 response. Generic ping should check current
authorization without selecting any grant for tool execution. Reject invalid
or unsupported protocol headers and use 405 for the exact optional SSE route.
Do not accept arbitrary no-id tool calls or let notification handling bypass
token verification. Preserve the legacy paired-token protocol separately.

Before a product patch: confirm the compatibility scope with the user, inspect
existing legacy expectations once, and add negative cases for malformed messages,
Origin, revocation, disabled OAuth and unsupported notifications. Public ingress
needs its own exact-path integration validation; these loopback tests do not
authorize widening ingress or enabling SSE.

## Evidence pins

- `tests/agent-mcp-lifecycle.test.cjs` SHA-256: `d9f66edce4fde11fe4550339157a411639e48670f22c3819db5aa3f1400163fc`.
- `integrations/mcp/pilot-server.cjs` SHA-256: `afc44ec5cef0daa242aed27f0109a7708f988d7519e46a3618ad82170cbde471`.
- `.superpowers/sdd/2026-10-14-agent-grant-routing/mcp-lifecycle-red.tap` SHA-256: `2578da4dc8b00a569c44ae2f5187a68914ffb9c8fbc63dca21df29c0f439bd0b`.

Earlier full 813/814 and supplemental event results remain separate historical
runs. No new full-suite pass is claimed. No Git push, VPS connection, deployment,
Pocket ID configuration, credentials, model routes or Relay changes occurred.
Three earlier test corrections and this compatibility correction remain pending;
the overall delivery goal is not complete.
