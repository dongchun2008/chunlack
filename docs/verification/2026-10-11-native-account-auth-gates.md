# Native account access and MCP authentication gates

## Scope and checkpoint

- Observed on 2026-10-11; checkpoint recorded at 12:29:34 UTC.
- Reviewed source revision: a9ce03e0415a7a78b845adb2104d3aaff22eb9f0.
- This was a read-only UI/source review, not a native Agent acceptance test.
- No connection, plugin, tunnel, subscription or credential was created.
- No form was submitted, no model was called, and no VPS operation occurred.
- Unrelated conversation contents and account identifiers are not reproduced.

## Fresh visible account evidence

| Surface | Observation | What it does not prove |
| --- | --- | --- |
| Muse | Existing signed-in page displayed the Agent name Lao Zhen. Settings exposed Connectors and Permissions. | A ChunLACK connection or successful task execution. |
| Muse Connected list | The displayed list contained Browser; no ChunLACK connector was visible. | Absence of every possible connector outside this list or inability to create a supported connector. |
| ChatGPT Plugins | The page loaded as signed in and exposed Add custom MCP server. | Installation success, usable tools in Xuan Ji's conversation, or computer-task acceptance. |
| Custom MCP form | Connection choices included Server URL and Tunnel. Authentication choices were OAuth, No authentication, and OAuth or no authentication. No direct static Bearer field was visible. | That any configured server would be reachable, authorized or compatible. |
| Platform Tunnels | The selected organization's page displayed No tunnels yet and a Create tunnel button. | Effective Read + Manage + Use permissions, a linked ChatGPT workspace, or any working tunnel. |

The custom MCP form was cancelled without entering a server address or
credential. Muse settings remained a view-only panel; no setting was saved.
No message was sent to either Agent and no native dot conversation was opened.

## Source boundary and compatibility inference

The targeted authentication inspection of
`integrations/mcp/pilot-server.cjs`, lines 49-58, showed:

- The HTTP handler rejects methods/paths other than `POST /mcp`.
- Host must match loopback and exactly one Authorization header is required.
- The header must begin with `Bearer `; the credential is passed to RPC handling.
- There is no OAuth discovery or authorization route in this inspected handler.

`integrations/mcp/runtime.cjs` and the local pilot plan were also searched for
authentication/discovery declarations in this pass. This was a targeted review,
not a complete audit of every identity service, proxy or deployment route.
It therefore does not prove that the whole repository lacks OAuth support.

Inference: a static node Bearer contract alone does not establish compatibility
with the observed OAuth-oriented custom MCP form. The end-to-end authentication
route must be reviewed and, if absent, implemented and verified before direct
public native dots acceptance. Do not select No authentication as a workaround,
embed credentials in a URL, or inject a shared token for unauthenticated callers.
OAuth client credentials are not interchangeable with the node Bearer token.

## Follow-up: configured public route and identity boundary

A subsequent read-only review at revision
`ec5ae12925371bc552546bb53ac259c81e6878b6` covered the configured ingress,
renderer, identity HTTP router, session service and identity policy. The
identity schema, table-scope declarations and session/revocation methods were
also inspected. Truncated command output was recovered only for the affected
identity-store tail and deployment README.

- `deploy/public/Caddyfile.template`: the agents host permits only `POST /mcp`
  for MCP, does not expose protected-resource metadata, and rejects query
  strings except the explicitly scoped events cursor. The human host has no
  OAuth or well-known route. Merely adding a backend endpoint would not expose
  a working discovery/authorization flow through this template.
- `deploy/public/render-ingress.cjs`: it substitutes the approved hosts,
  loopback ports and TLS configuration; it does not add OAuth routing or
  authentication logic.
- `identity/http.cjs`: routes implement human login/logout, membership,
  invitations and password reset, not OAuth authorization or token exchange.
  `/auth/` queries are rejected. Existing exact-Origin and CSRF checks must
  remain intact; do not relax them globally to accommodate OAuth callbacks.
- `identity/sessions.cjs`: human sessions use a host-only secure cookie with
  idle/absolute expiry and revocation notifications. These are reusable human
  identity controls, not an OAuth grant or an external node credential.
- `identity/store.cjs`: identity schema version 1 and its table-scope map cover
  users, workspaces, memberships, invites, sessions, reset tokens and audit.
  The inspected schema does not contain OAuth client/code/grant/token tables.
  New authorization state requires an explicit storage and backup/restore
  contract, not an untracked table silently added to production.
- `identity/policy.cjs`: only workspace owners may manage nodes. External
  client consent must not turn a human owner's full role into a blanket node
  credential; current workspace/node permissions must still be enforced.

Finding: the inspected configured public MCP/identity path does not provide a
complete OAuth flow compatible with the observed client. This is a source
finding, not a live OAuth failure test, and does not claim that every possible
external identity provider was searched. No existing credentials were changed.

The [official MCP resource-server guidance](https://ts.sdk.modelcontextprotocol.io/v2/serving/authorization)
describes token verification, resource/audience checks, HTTP authentication
challenges and discovery metadata. It explicitly distinguishes the resource
server from the authorization server; adding metadata alone does not issue
valid tokens or implement consent. These requirements guide a proposed
integration, not a claim that this repository implements them.

Any OAuth addition changes the authorization boundary and deployment routes.
It needs a reviewed design and implementation plan before product changes.
The proposed direction is an isolated standards-based authorization component
reusing current human identity controls, without a separate always-on service.
Retain existing REST/Bearer compatibility, require explicit scoped consent,
and verify revocation, cross-workspace denial, restart and restore behavior.
Actual dependency choice, resource use and native-client compatibility remain
unmeasured; no production budget or new protocol version is approved here.

## Official documentation checked

The official [custom MCP server guide](https://developers.openai.com/api/docs/guides/custom-mcp-server)
lists server URL/tunnel connection choices and OAuth, no-authentication and
mixed authentication. It describes static OAuth client configuration,
CIMD and DCR. Workspace security restrictions still apply.

The official [Secure MCP Tunnel guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
distinguishes Platform tunnel permissions from ChatGPT custom MCP access.
It describes a client inside the private network forwarding MCP requests over
an outbound HTTPS path. A tunnel is transport, not authorization to run a task.

The approved public HTTPS direction is unchanged. An empty tunnel list is not
a blocker for that direction and is not a reason to install tunnel-client or
alter the existing Tailscale Relay.

## Next delivery actions and retained gates

1. Review the complete public MCP authentication route against the observed
   client contract; establish whether a suitable OAuth boundary already exists.
2. If an adapter is needed, design and test it without disabling node/workspace
   authorization. Keep authenticated identity, membership and revocation checks.
3. Complete the separately gated public HTTPS and formal identity publication
   steps before requesting a real external connection. Fixture TLS is not
   production HTTPS acceptance.
4. Validate Muse and dots separately with an approved unique browser task,
   lease/attempt/challenge, native activity evidence, screenshot upload and
   persisted ChunLACK receipt. A worker, model response or HTTP 2xx is insufficient.
5. Obtain a VPS-reachable direct model private API address, or separate approval
   for the bounded loopback forwarding trial. Do not reuse Open WebUI credentials
   or infer model reachability from account UI.

No production resource budget was accepted in this pass. No release window was
consumed. Existing test results were not rerun or upgraded into broader claims.
Overall delivery remains incomplete.
