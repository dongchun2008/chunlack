# Lightweight OAuth for private ChunLACK Agent collaboration

Status: architectural direction approved by the human on 2026-10-11;
written specification awaiting review. No OAuth implementation or deployment
is authorized merely by this document. Implementation planning follows
written-spec approval; implementation follows written-plan review.

## 1. Intent and boundaries

ChunLACK is a privately managed, general-purpose multi-Agent collaboration
platform. Multiple humans may share one workspace or belong to different
workspaces. Devices, model services, and task-executing Agents remain separate
entities. Research is a pilot, not the definition of the whole product.

The approved direction is a lightweight standards-based OAuth boundary within
the existing Node/SQLite deployment, not a new always-on identity-provider
stack. Slack and Raft are product-design references, not required services.
Public HTTPS is the selected ingress. Do not create a Secure MCP Tunnel or
modify Tailscale Relay to work around account authentication limitations.

Preserve Ollama, provider-neutral model routing, direct inference APIs, and
existing restricted REST/node-Bearer integrations. Do not use Open WebUI as a
ChunLACK provider or reuse its credentials. OAuth grants must not expose a
human's full account or turn a node into a workspace owner.

## 2. Current evidence

The configured public MCP pilot accepts node Bearer credentials, not a complete
OAuth authorization flow. Its loopback boundary validates Host, rejects browser
Origin/cross-site requests, and caps Authorization length at 256 characters.
The public Caddy allowlist has no OAuth discovery or exchange routes. The
reviewed identity router provides cookie login and workspace management, and
the declared identity schema has no OAuth client/grant/code/token tables.

The signed-in ChatGPT custom-MCP form inspected on 2026-10-11 offered OAuth,
no authentication, and mixed authentication, but no direct static node-Bearer
input. This does not prove every possible account/integration has that limit.
The inspected Muse connector list did not show ChunLACK. No external connector
was created or OAuth client registered during that inspection.

The VPS can now reach the existing inference router over Tailscale:
`http://100.72.70.102:8080/v1`. A bounded direct API call returned `OK` with
model ID `qwen38-27b-nvfp4`. This is not a ChunLACK end-to-end acceptance result
or proof of the GPU engine's live launch parameters. See the accompanying
verification record for the exact scope.

## 3. Architecture

```text
Human browser -> lack.chunclaw.top -> existing login + OAuth consent
                                      |
                                      v
                         existing Node identity / SQLite
                         clients, grants, codes, hashed tokens
                                      |
External MCP client -> agents.chunclaw.top/mcp
                                      |
                           OAuth resource verifier
                                      |
                 user + workspace + node + task capability checks
                                      |
                         existing restricted task facade

Muse REST connector -> existing restricted REST/Bearer route (unchanged)
ChunLACK Provider  -> existing Tailscale model router -> 1Cat backend
```

Use the existing Node service and SQLite, with independently bounded OAuth
modules. Reuse human sessions only to authenticate the consent interaction.
Never forward a human cookie, password, CSRF secret, reset token, or node key
to the external client. Model routing is independent of client authentication.

## 4. Origins, issuer, resource and routing

The proposed issuer is exactly `https://lack.chunclaw.top`. The initial protected
MCP resource is exactly `https://agents.chunclaw.top/mcp`. Configuration fixes
these canonical values; forwarded headers and user-supplied URLs cannot choose
an issuer, workspace, or audience. A token for this resource cannot authorize
the human web API, another workspace, or a model inference endpoint.

On the agents host, expose bounded public OAuth protected-resource metadata
and return the appropriate 401 `WWW-Authenticate` metadata challenge on the
protected MCP resource. Publish the authorization-server metadata on the web
host. Configure the standards component's metadata and resource path handling
explicitly; do not derive discovery paths by arbitrary string concatenation.

On the web host, add only the required metadata, authorization, consent, token,
and revocation routes. Maintain host separation and loopback-only upstreams.
The authorization route is an explicit, narrowly validated query exception;
it does not disable the ingress's general query/encoded-path defenses.

The existing application cookie remains Secure, HttpOnly, SameSite=Lax and
host-only. Consent writes require that cookie, exact web Origin and CSRF.
OAuth token exchange is a different authenticated server-to-server route;
it cannot inherit browser-cookie authorization or globally disable CSRF.
Reject cookies as credentials on the protected MCP resource.

Registered redirect URIs are exact-match HTTPS values without fragments or
embedded credentials. No wildcard, prefix, suffix, or arbitrary return-to
matching. Invalid redirect requests show a local error, never redirect to the
invalid destination. Authorization codes in a standards-required redirect
are short-lived; redact query strings from OAuth access/error logs.

## 5. Supported flow and client enrollment

Start with OAuth authorization code flow and mandatory PKCE S256. Do not add
implicit, password, anonymous, or client-credentials fallback for human-bound
Agent grants. Use a maintained OAuth server implementation for protocol
validation and exchange, with ChunLACK-specific persistence and authorization
adapters. Do not invent cryptography or hand-write a substitute OAuth protocol.

First enrollment uses an owner-approved static client with verified official
redirect URIs and the supported client authentication method. Client metadata
must identify the actual connecting product/account, not a guessed brand URL.
Native account support for supplying the resulting client registration remains
an acceptance gate. If that account requires CIMD or dynamic registration,
stop and specify that extension rather than making registration public or
claiming generic compatibility. Arbitrary self-registration is initially off.

Validate client identity, registered redirect, PKCE, requested resource,
requested scope, issuer binding and code single-use at exchange. Bind the
authorization transaction to the authenticated human session and request;
preserve the client's state according to the protocol. Login/session switching
cannot silently consent a different human or workspace.

The implementation plan must select a maintained server component against
these requirements, Node compatibility, dependency size, license, security
maintenance, body/rate bounds and SQLite adapters before installation. If no
suitable component meets the constraints, return for a design decision; do
not quietly deploy a large IdP or custom protocol instead.

## 6. Explicit consent and least authority

Each grant binds immutable client, user, workspace, node identity, approved
task types, resource and maximum scopes. The human chooses a workspace where
they currently have node-management authority, selects an existing authorized
node identity, and sees the requested capabilities before approving.

Initial scopes are narrowly mapped task read/claim/result and event access
operations. Scope names alone do not grant access: every operation also checks
the bound workspace, node, task assignment and approved task types. The first
native pilot enables only `browser.public_read`, not shell, Git, arbitrary
files, production mutation, user management or provider configuration.

The initial grant includes no arbitrary event destination. Event subscription
and delivery must use a separately validated native-client destination and the
existing supported protocol, with bounded egress and subscription ownership.
Receiving an event is not task completion or permission expansion.

Public OAuth metadata needs no task credential, but every task, event and result
operation does. An invalid OAuth token must not fall back to anonymous access,
another workspace, a shared owner token, or a node-Bearer credential. Existing
node keys remain a separately verified credential class; reject ambiguous
credentials and multiple Authorization headers.

## 7. Token, revocation and persistence rules

Proposed defaults are access lifetime 5 minutes, authorization-code lifetime
60 seconds, refresh idle lifetime 7 days, and absolute grant lifetime 30 days.
These values are design defaults, not live configuration. Unattended refresh
requires explicit consent and a supported native client. Without it, require
reconnection rather than indefinitely extending a token.

Use cryptographically random opaque credentials that fit the current bounded
Bearer transport. Store only domain-separated hashes of codes and tokens;
never plaintext secrets. Client secrets are shown once through the appropriate
private setup path. Rotating refresh is atomic; replay invalidates the family.
An interrupted exchange cannot cause duplicate valid codes/tokens. No token,
code, verifier, client secret or Authorization value enters audit/Git/logs.

Every protected operation and task side effect rechecks current user state,
workspace membership/version, grant, node and task authorization. Disabling a
user, removing membership, revoking a grant or pausing/revoking a node blocks
new work and late results. Cancel/requeue in-flight work through existing
bounded task machinery; do not claim revocation undoes an external side effect.
Revocation, expiration, and unusable refresh must be visible without secrets.

Add versioned OAuth client/grant/code/access/refresh-family persistence and
indexes through the existing identity migration boundary. Update table-scope
inventory, archive, consistent backup, restore, and ownership validation.
Expiry cleanup is bounded and indexed, not full-table scanning per request.
Schema incompatibility or failed identity notification remains fail-closed.

Restore must invalidate external sessions/grants before reopening ingress so
old backups cannot resurrect revoked access. Forward migration uses a verified
consistent backup. Rollback restores the matching schema and data together;
older code must not open a newer unsupported identity database.

## 8. Resource and abuse bounds

No additional always-on daemon, container, broker or database. Proposed initial
bounds: 32 registered clients and 128 active grants per workspace, 1024 grants
globally, 256 pending authorization transactions, and bounded 16-KiB OAuth
request bodies. Admission fails visibly when limits are reached. Preserve the
existing model concurrency of one during the first real integration trial.

Rate-limit authorization/login, token and discovery paths independently.
Enforce a small global pending-request bound in addition to per-client limits;
unknown clients cannot allocate an unbounded map. Cap metadata, URI, scope,
state and redirect sizes. Configure request deadlines and reject redirects
when contacting metadata or event destinations unless explicitly reviewed.

These are limits, not a measured resource guarantee. Re-run isolated combined
Node/SQLite/TLS trials after OAuth implementation; prior frozen-code trials
do not validate new OAuth overhead. Do not increase production CPU/memory caps
or infer approval of production budgets from a low-budget fixture result.

## 9. Expected integration surfaces

This is a surface map, not a final implementation-plan file manifest:

- New focused OAuth protocol, persistence and resource-verifier modules.
- `identity/store.cjs`: versioned schema, lifecycle and identity notifications.
- `identity/http.cjs`: narrowly mounted consent routes using existing sessions.
- `identity/sessions.cjs` and `identity/policy.cjs`: reuse existing contracts;
  modify only if an approved integration requires it.
- `integrations/mcp/pilot-server.cjs` and `integrations/mcp/runtime.cjs`:
  metadata challenge, verified identity context, protected task/event dispatch.
- Existing node/task/workspace access adapters: current-state grant binding.
- `deploy/public/Caddyfile.template` and `deploy/public/render-ingress.cjs`:
  exact metadata/OAuth route additions and rendering validation.
- Existing archive/package/schema inventories and restore tests: OAuth state
  ownership, consistent backup, invalidation and fail-closed rollback.
- Login/consent and node-grant management UI plus concise private setup docs.
- Focused OAuth, multi-user isolation, packaged ingress and native pilot tests.

Identify exact remaining files once during implementation planning. Avoid a
general identity rewrite, changing research evidence rules, or adding generic
model-generation capabilities to the restricted browser task facade.

## 10. Acceptance and delivery gates

Tests must cover discovery through actual ingress, successful PKCE flow,
invalid redirect/client/resource/issuer/scope, code and refresh replay,
duplicate headers, oversized inputs, Origin/CSRF separation, multiple humans,
cross-workspace denial, membership removal, node pause, late result rejection,
expiry, restart, bounded rate admission and backup/restore invalidation.

Keep existing REST/Bearer, Ollama and provider-neutral tests passing. Prove
direct 1Cat use through ChunLACK's Provider and workspace authorization, not
only a raw curl/Python request or Open WebUI adapter. Validate model errors,
timeouts and queue release without fabricating a successful fallback.

For dots/XuanJi, prove event receipt in the actual subscribed conversation,
its own cloud-browser execution, unique task/nonce binding, public-page
screenshot, persisted ChunLACK result and receipt. A worker or server-side
fetch cannot impersonate the native Agent. For Muse/Laozhen, separately prove
the supported connector triggers its own Agent, not only an installed worker.
Neither product is a prerequisite for core collaboration, but both remain
explicit external acceptance gates in the current delivery goal.

Production publication still requires formal owner creation, verified data
ownership, accepted resource budget, protected secrets, valid public TLS,
rollback and the approved limited maintenance procedure. Do not open a model
port or modify Relay. Report "usable" only after the promised actual account,
native Agent and delivery tests pass; otherwise name each remaining gate.

## 11. Primary protocol references

- OpenAI custom MCP guide:
  https://developers.openai.com/api/docs/guides/custom-mcp-server
- MCP TypeScript SDK authorization documentation:
  https://ts.sdk.modelcontextprotocol.io/v2/serving/authorization
- OpenAI Secure MCP Tunnel guide (transport, not authentication):
  https://developers.openai.com/api/docs/guides/secure-mcp-tunnels

Use the native client's tested protocol/version; do not upgrade MCP or an SDK
solely because a newer specification exists. Account compatibility and the
server-component selection must be demonstrated, not inferred from these docs.
