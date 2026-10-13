# External Agent authorization readiness

Date: 2026-10-14. Source baseline: `d3e8b36`.

Status: human Pocket ID login and external Agent authorization are different
gates. Human login succeeded in the preceding browser trial; external Agent
OAuth is not implemented or accepted by that result.

## Current source and live observations

- `integrations/mcp/pilot-server.cjs` requires a supplied principal resolver,
  accepts only POST `/mcp`, and limits the Authorization header to 256
  characters. Its HTTP handler has no protected-resource metadata route or
  OAuth metadata challenge. A normal RSA-2048 JWT signature alone exceeds this
  transport limit; merely installing a JWT verifier would not complete OAuth.
- The MCP tool facade already separates task read, claim, heartbeat, events,
  result submission and bounded artifact upload. Multi-user operation requires
  workspace access and checks task ownership rather than trusting tool input.
- `integrations/mcp/runtime.cjs` checks stored node authorization during event
  preparation/delivery, uses bounded delivery and encrypted event persistence.
  These controls must remain after OAuth is added.
- The earlier custom authorization core is unmounted and has unresolved review
  findings. It is not an acceptable shortcut to native Agent login.

Two read-only, unauthenticated HTTPS GETs were made with ordinary TLS
verification, no redirect following, a 10-second request timeout and a 64 KiB
response bound. No token exchange, credential access or configuration change
was involved.

| Observation | Result |
| --- | --- |
| Pocket ID authorization-server discovery | HTTP 200 |
| Issuer | `https://pockid.chunclaw.top` |
| PKCE advertised | `plain`, `S256`; our policy remains S256 only |
| CIMD advertised | false |
| Registration endpoint advertised | no |
| Introspection endpoint advertised | yes |
| Revocation endpoint advertised | no |
| Unauthenticated GET `https://agents.chunclaw.top/mcp` | HTTP 404, no resource-metadata challenge |

GET `/mcp` alone does not prove that all metadata paths are absent, nor that an
authenticated POST would fail. The source inspection establishes the local
handler gap; the GET only records actual ingress behavior. Missing discovery
fields do not prove every administrative capability is unsupported.

## Official capability, not account acceptance

Pocket ID documents user-delegated API access with a dedicated resource and
permissions. The API must validate the access token, including its audience;
a browser ID token or administrative API key is not a substitute. This is the
preferred existing-issuer path, not authorization to modify its applications.
[Pocket ID API guide](https://pocket-id.org/docs/guides/apis).

The currently published token guide describes JWT access tokens and distinct
ID tokens. Its current documentation is not proof of the installed instance's
exact token shape or lifetime. The previously observed installed version was
2.14.0; it was not refreshed in this check.
[Pocket ID token guide](https://pocket-id.org/docs/guides/scopes-and-claims).

The official v2.14.0 release includes authorization-server metadata and API
support for metadata-document clients. Therefore the older installed version
alone does not justify installing another identity service or upgrading it.
Actual resource/client permissions and issuance still require verification.
[Pocket ID v2.14.0](https://github.com/pocket-id/pocket-id/releases/tag/v2.14.0).

OpenAI's MCP authorization guide permits predefined OAuth clients as well as
CIMD/DCR. Resource metadata, PKCE, audience/scope validation and the exact
client-provided redirect remain required. Actual account support for the chosen
setup must be checked; do not turn on global client registration to bypass it.
[MCP authorization](https://developers.openai.com/plugins/build/auth).

## Minimum remaining integration work

This is a gap map, not evidence that the following is already implemented:

1. Add a bounded access-token verifier using a maintained JWT library. Fix the
   issuer/resource, distinguish access tokens from ID tokens and reject
   unapproved clients and non-user grants. Bound trusted-origin JWKS fetching,
   key caching, token size, deadlines and concurrent verification.
2. Bind verified issuer/subject/client to an explicitly approved local
   user/workspace/node grant. Recheck current membership, user and node state,
   task assignment and operation scope on every call. Never infer owner access
   from a valid signature, email, group name or the browser login client.
3. Integrate a separate, bounded JWT credential path without weakening existing
   short node-Bearer validation. Invalid OAuth must not fall through to another
   credential class. Preserve duplicate-header, Host and Origin defenses.
4. Add exact protected-resource metadata and challenge routing through the
   existing HTTPS ingress. Do not expose arbitrary auth paths, model ports,
   anonymous tools or the human session cookie to external Agents.
5. Enroll only a dedicated API resource and the native clients actually needed,
   with explicit permission at the external configuration step. Keep the human
   login and Tailscale clients separate. Do not guess vendor redirect URIs or
   reuse their secrets. No such enrollment was performed in this check.
6. Test invalid issuer/audience/type/client/scope, expired tokens, key rotation,
   bounded failure handling, membership removal/re-add, node pause/revocation,
   cross-workspace denial, late results and restore invalidation. Check actual
   HTTPS metadata and challenge behavior, not only direct handler calls.
7. Separately prove native Muse/Laozhen and dots/XuanJi execution: authorized
   task delivery, their own cloud-computer action, task/nonce-matched evidence,
   stored result and receipt. An installed worker or webhook HTTP 2xx is not
   that acceptance.

No new daemon, broker, database service, tunnel or public port is needed by
this proposed integration. Resource use must still be measured after actual
implementation. A configured issuer does not by itself provide immediate
central revocation; local revocation and issuer disable propagation must be
specified and tested separately.

## Change boundary

This checkpoint changed documentation only. It did not create a Pocket ID API,
client, permission grant, Muse connector, dots subscription or credential. It
did not mount the old OAuth core, change product authentication or restart any
VPS service. No fresh full-suite result is claimed for this documentation-only
check; prior test totals remain scoped to their preceding source revisions.
