# Explicit Agent grant routing

Status: recommended routing approved by the user; implementation in progress. This document
does not authorize enrollment, expand a grant or enable production OAuth.

Baseline: `3bcffae39f5dfd3940d710d7a5b854d66d1f867a`.
Existing acceptance: local 775/775 and selected constrained Linux 64/64.

## Problem and recommended decision

The existing authority authenticates a token against an explicit grant ID.
That grant fixes issuer, subject, client, user, workspace, node and scopes.
The tested MCP resolver receives only the requested operation scope; production
assembly still needs a trustworthy way to select the grant. Selecting the
first matching grant, changing selection according to scope, or treating a
caller-supplied workspace ID as identity is not acceptable.

Recommend one canonical endpoint, `https://agents.chunclaw.top/mcp`, plus
explicit grant selection in MCP tool arguments. The Agent discovers its
available connections and supplies the selected `grantId` for each scoped
tool invocation. The ID is a routing selector, not a credential or proof.
Every operation authenticates its Bearer token against that exact grant.

This avoids separate OAuth resources/applications for every workspace and
does not require custom HTTP headers, a second service or new public ports.
It requires an additional discovery tool and an explicit argument on scoped
OAuth tools. Native vendor support must still be verified, not presumed.

## Standards boundary

[RFC 9728 section 3.3](https://www.rfc-editor.org/rfc/rfc9728.html#section-3.3)
requires matching resource identifiers when validating metadata, including
metadata obtained through a challenge. Do not append connection selectors to
the MCP URL while continuing to advertise an unrelated canonical identifier.

[MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
supports pre-registered client information and requires resource-bound access
tokens. Existing discovery does not prove a vendor can enter a pre-registered
client ID or successfully authorize with this Pocket ID instance.

[Pocket ID APIs](https://pocket-id.org/docs/guides/apis) separate API resources,
permissions and clients. Keep the existing human-login and Tailscale clients
separate from Agent API clients. Do not deploy the earlier custom issuer as an
implicit workaround or assume arbitrary requested scopes become permissions.

## Request flow

1. The client authorizes for the canonical MCP resource using its separately
   approved OAuth client. The token is sent only in the Authorization header.
2. Initialization and tool discovery validate the token and current local
   authorization before returning generic protocol/tool metadata. They do not
   manufacture a node principal or select a default workspace.
3. A proposed `chunlack_connections_list` tool returns a bounded list of the
   current subject/client's locally approved grants, with safe workspace/node
   labels and usable scopes. It must not expose other users' connections,
   tokens, pairing codes, event secrets or task payloads.
4. Each scoped OAuth tool requires an explicit `grantId`. The server removes
   that selector from the operation payload and resolves the existing opaque
   authority proof against the exact requested scope. Client-supplied user,
   role, workspace and node fields remain rejected.
5. Only the real gateway proof produced by the existing authority adapter may
   execute the operation. Membership, identity binding, grant expiry, node
   state and scope intersection are checked again as already required.
6. Events retain the authenticated grant binding in encrypted subscription
   state and revalidate it before delivery, including after asynchronous DNS.
   A later request cannot substitute another grant into an existing subscription.

No automatic first-grant fallback, sticky global active workspace or
scope-dependent grant selection is allowed, even when only one grant exists.
The legacy paired-node token path keeps its existing identity and tool
schemas; it must not accept OAuth grant selectors as a privilege expansion.

## Minimal implementation sequence after approval

1. Add bounded connection discovery to the existing authority, reusing the
   verifier and current binding/epoch checks. Verify a token once per request,
   not once per grant, and do not add a second JWT implementation. Discovery
   results are metadata, never opaque authorization proofs.
2. Extend the MCP OAuth branch with the discovery tool and required selector;
   preserve existing static-token behavior, request limits and error handling.
   The selected grant must be independent of the requested operation scope.
3. Compose the verifier/authority into public runtime startup. Pass a trusted
   assertion facade into the gateway store before readiness, then bind it to
   the actual authority once gateway workspace access exists. Before that
   binding, the facade must reject requests. There must be no admission window.
4. Own verifier, authority and any extra SQLite handle in the same startup,
   failure rollback and shutdown lifecycle. Reject new work before draining;
   do not release the writer lease after incomplete shutdown. Keep import-only
   behavior free of listeners, databases and retained timers.
5. Add human owner-only grant management through existing authenticated,
   CSRF-protected workspace administration. External Agent tokens cannot
   create or expand their own grants. No automatic account linking by email.
6. Expose only the exact metadata and MCP routes through the existing ingress,
   after runtime and Caddy integration tests. Do not widen the public matcher
   to arbitrary paths, change model providers, or alter Relay configuration.
7. Separately approve real Pocket ID API/client enrollment and native vendor
   authorization at action time. Stop for unsupported client capability rather
   than weakening token validation or pretending a custom worker is the vendor.

## Expected source scope

- `identity/agent-authority.cjs`: bounded discovery and current-grant checks.
- `integrations/mcp/pilot-server.cjs`: OAuth discovery and explicit selector.
- `gateway/public-runtime.cjs`: owned authority lifecycle and readiness.
- `gateway/runtime.cjs` and the embedded server in `lack.py`: trusted facade
  forwarding, without changing model routing or existing Ollama support.
- Existing human workspace administration and exact ingress templates, after
  their extension points are established; do not invent parallel admin APIs.
- Focused authority, HTTP, runtime, recovery, ingress and browser regressions;
  setup/usage documentation and native verification records.

## Acceptance gates

- One subject/client with multiple grants across workspaces and nodes selects
  each explicitly; missing/unknown grants never select another connection.
- Another subject, client or workspace cannot use the selected grant. A
  selector cannot expand token scopes or become an opaque gateway proof.
- Revocation, unlink/relink, membership epochs, expiry, node pause/revoke and
  asynchronous verification/delivery races retain existing fail-closed rules.
- Connection enumeration is bounded, privacy-filtered and contains no secrets;
  insufficient scope does not cause a switch to a more permissive grant.
- Static-token clients and disabled OAuth preserve behavior. Startup failure,
  shutdown drainage, writer-lock retention and restart have actual runtime
  coverage, not only source-shape assertions.
- Restore/activation must not revive a previously revoked grant or event
  binding; preserved forensic backups must not be modified to force a pass.
- Full local and selected constrained native regressions, exact HTTPS route
  tests and protected-service baseline comparisons precede deployment.
- Native Muse Laozhen/dots Xuanji acceptance requires the vendor Agent to
  receive a task, use its own computer and return matching nonce/evidence with
  a stored ChunLACK receipt. Metadata, HTTP 2xx and simulated workers do not
  satisfy that gate.

The alternative is one independently identified OAuth resource per connection
or workspace, with matching metadata and token audience. It is standards-based
but increases enrollment/configuration work; it is not silently selected by
this proposal. The user selected the canonical endpoint and explicit-grant approach.
