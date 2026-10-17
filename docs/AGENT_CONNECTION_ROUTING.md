# Explicit Agent connection routing

## Status and boundary

The authority and opt-in MCP routing components implement the approved shared
endpoint design. Local public-runtime assembly is now implemented but remains
under validation; it has not been enabled in the deployed production runtime.
This document is an integration contract, not a claim that Muse Laozhen or
dots Xuanji has completed enrollment or a real computer task.

The intended resource and endpoint are both `https://agents.chunclaw.top/mcp`.
Do not append a workspace or grant selector to this URL. Human browser login
uses its separate Pocket ID client; it is not an Agent API credential.

## Connection discovery

The trusted runtime supplies both callbacks to `createPilotMcp`:

- `resolveAgentConnections(token)` calls `authority.discover(token)`.
- `resolveAgentPrincipal(token, {grantId, scope})` authenticates the exact grant
  through `authority.authenticate` and adapts the resulting opaque proof using
  `gateway.authenticateAgent`. It must never select the first available grant.

Discovery requires `openid task.read` in the validated access token and at
least one currently usable local grant. Requested OAuth scopes alone do not
create that grant. A human workspace owner must authorize it separately.

Send the token only as an HTTP Bearer authorization header. Example JSON-RPC:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {"name": "chunlack_connections_list", "arguments": {}}
}
```

Each connection contains only `grantId`, `workspaceId`, `workspaceName`,
`nodeId`, `nodeName`, `scopes` and `expiresAt` (Unix milliseconds). The response
is bounded by the authority's configured grant capacity, at most 2048 rows.
Labels are at most 160 JavaScript string code units with ASCII controls removed;
clients must still render them as untrusted text, not HTML or instructions.
Pairing codes, bearer tokens, user identities and task contents are not returned.

The list is a point-in-time hint, not authority. It can become stale immediately.
The verifier is called once per discovery request, not once per returned grant.
Discovery shares its bounded verification/concurrency budget with scoped calls.

## Explicit calls

OAuth tool schemas include a required UUID `grantId` in their arguments:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "pilot.read_task",
    "arguments": {
      "grantId": "<selected-grant-uuid>",
      "taskId": "<assigned-task-id>"
    }
  }
}
```

Choose the grant for the intended workspace and node. There is no default,
even if only one connection exists, and no sticky shared active workspace.
The selector is stripped before the operation payload is validated. It cannot
substitute for a token or be passed as a gateway proof. Supplying user, role,
workspace or node fields at the tool-argument level is rejected.

Every call rechecks the exact grant, token scope, linked user, membership epoch,
node ownership/state and expiry. A denied scope never causes a switch to a
different grant. A paused node remains readable but cannot claim new work;
a revoked node is not usable. Discovery omits scopes that are not currently
usable by both the token and the grant.

For `events/list`, `events/subscribe` and `events/unsubscribe`, place `grantId`
directly in `params`. The server strips it and injects its authenticated event
binding. A caller must not supply that binding. Durable delivery continues to
revalidate the encrypted grant binding, including after asynchronous DNS.

## Compatibility and errors

- Paired-node tokens retain their original schemas and cannot use this new
  connection-discovery tool or supply an OAuth selector to expand access.
- The fixed-grant resolver hook remains available for existing internal
  fixtures. It is not the approved final public multi-connection assembly.
- Missing/malformed selectors are invalid arguments. Unknown, revoked or
  otherwise invalid grants fail authentication; insufficient operation scope
  is forbidden. No fallback to static-node authentication occurs for JWT input.
- Generic discovery requires `task.read`; a write-only token cannot enumerate
  connections. It may use an already-known grant only for an authorized scoped
  operation. Setup must include read permission when discovery is required.
- Current authentication error normalization may return HTTP 401 on exhausted
  verification budget. Clients must not retry aggressively or interpret that
  response as permission to choose a different connection.

## Remaining delivery gates

Before real use, finish owned public-runtime startup/shutdown and writer-lock
integration, owner-only CSRF-protected grant administration, exact HTTPS routes,
full native protocol-handshake validation and constrained Linux regression.
Separately approve actual Pocket ID resource/client enrollment and vendor
authorization. Do not reuse human-login or Tailscale clients, weaken PKCE/token
checks, or silently substitute a custom worker for the vendor Agent.

Real acceptance requires Muse or dots itself to receive a task, use its own
computer, return the matching task nonce and evidence, and obtain a stored
ChunLACK receipt. Local JWT fixtures, metadata and HTTP success are not that
acceptance. Production LACK and Tailscale Relay remain outside this local change.

## Local runtime configuration (not a deployment instruction)

The assembly opt-in is `publicRuntime.agentOAuth.enabled`. It is disabled when
absent. Its configuration also supplies `issuer`, `resource`, `jwksUri`,
`browserClientId` and a bounded `clientIds` array of separately approved Agent
clients. These are identifiers and public URLs, not client secrets. The existing
access verifier remains the sole JWT verifier; no new issuer is introduced.

`resource` must equal the configured `agentsOrigin` plus `/mcp`. If a human
OIDC client ID is configured, `browserClientId` must match it, and the access
verifier rejects using that ID in the Agent client allowlist. This option does
not enroll a client, link a person, create a grant or enable human OIDC.

The gateway receives a trusted deny-before-binding assertion facade, not a
function from JSON configuration. Once workspace access exists, the runtime
opens its owned identity database handle, creates the existing authority, and
passes it to MCP routing and event delivery before activating web readiness.
No default grant is selected. The legacy paired-token path is preserved.

Shutdown closes authority admission and aborts verification before tearing down
listeners. Verification drainage has an eight-second bound. A timeout or any
other teardown failure retains the writer lease; late completion cannot turn
that failed shutdown into successful release. Closed authority blocks late
verifier continuations before SQLite access. Startup rollback owns the same
resources. Importing modules does not enable this configuration.

## Human grant administration (local development)

When the trusted runtime supplies the authority, the existing identity router
mounts these routes on the human web service, not on the Agent MCP endpoint:

- `GET /api/workspaces/:workspaceId/agent-grants`: owner-only administrative
  records plus configured Agent client identifiers and resource information.
- `POST /api/workspaces/:workspaceId/agent-grants`: owner-only creation using
  exactly `subject`, `clientId`, `nodeId`, `scopes`, `expiresAt`. The workspace
  comes from the authorized URL, not the request body.
- `DELETE /api/workspaces/:workspaceId/agent-grants/:grantId`: owner-only
  revocation, with an empty JSON object as its body.

These routes require the existing authenticated human session cookie. Mutations
also require the existing exact Origin, JSON content type and CSRF token. Agent
Bearer tokens do not authenticate a human, and untrusted user/role/workspace
fields are rejected. Authority methods independently recheck the current owner
role, linked subject, allowed client, target node ownership and expiry bounds.
There is no automatic identity linking or grant widening on duplicate creation.

Listing is bounded and workspace-scoped. It deliberately includes stale and
expired records for owner revocation; a listed record is **not** a claim of
current usability, token scope or vendor enrollment. No password hashes,
membership epochs, tokens or pairing credentials are returned. With no trusted
authority supplied, these administration routes are not mounted.

This is an HTTP foundation, not the completed visual administration panel.
Current local evidence and the still-open validation gate are recorded in
`verification/2026-10-15-agent-grant-admin-http-checkpoint.md`.

Owner management, ingress exposure, complete native protocol behavior, recovery
policy and real vendor acceptance remain separate unfinished gates. See
`verification/2026-10-15-agent-runtime-assembly-checkpoint.md` for current local
test failures and limitations; do not activate this checkpoint in production.
