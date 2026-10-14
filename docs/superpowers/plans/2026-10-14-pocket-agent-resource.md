# Pocket ID Agent resource implementation plan

Execution: continue the existing authorized local implementation/testing plan inline using executing-plans. External enrollment and production authorization changes remain separate approval gates.

## Goal and selected design

Complete the Pocket ID resource-server path required by `../specs/2026-10-11-pocket-id-integration.md`, rather than deploying the unaccepted custom issuer. Keep Node/SQLite, provider-neutral routing, Ollama, node Bearer and Relay unchanged. The issuer is Pocket ID; the protected resource is the configured canonical MCP URL, never a forwarded header.

This plan adds no daemon, listener, credential or database on module import. A cryptographically valid token is only identity evidence, never a node or workspace principal.

## Task 1: bounded access-token evidence

Files: new `identity/agent-access.cjs`, `tests/agent-access.test.cjs`; explicit existing-version `jose` dependency in package manifest/lock.

Interface: `createAgentAccessVerifier({config, fetchImpl, now})` returns null when disabled. Enabled configuration requires canonical HTTPS `issuer`, same-origin exact `jwksUri`, canonical HTTPS `resource`, explicit `clientIds` and separate `browserClientId`. No discovery from token headers. The service offers `verify(token, {scope})`, single-use `consume(proof)` and asynchronous `close()`.

Initial supported profile: Pocket ID user-delegated RFC 9068 RS256 access tokens, `typ=at+jwt`, a UUID user subject, required `openid` scope, approved `client_id`, exact resource audience, issuer, integer iat/exp and bounded jti. Reject M2M `client-*` subjects, ID tokens, shared-secret/unsigned tokens, unexpected token-supplied keys/URLs and browser-client reuse. Accepting other identity providers or algorithms needs a tested profile, not relaxed checks.

Bounds: token 8192 bytes; 4 simultaneous verifications; 120 attempts per minute; JWKS 65536 bytes and at most 8 public RSA keys (2048-4096 bit modulus); 3-second fetch deadline; 30-second key-miss cooldown; 5-minute key cache; token lifetime at most 3600 seconds; clock tolerance 5 seconds. Trust only configured HTTPS JWKS, without redirects or request credentials. No raw tokens or decoded personal claims in errors/logs.

`verify` returns an opaque process-local proof. `consume` consumes it once and returns immutable issuer/subject/client/resource/scopes/time facts. Proofs cannot survive restart or service close and cannot be consumed after expiration. The future grant bridge must resolve the current identity link, membership generation, node authorization and operation scope independently; never pass these facts directly to the existing node principal resolver.

1. Add synthetic RSA-signed tests and observe missing-module failure.
2. Implement the module without mounting it or changing human OIDC behavior.
3. Run focused, related and full local tests with real HTTPS fixtures; report exact scope and failures.
4. Commit only code, explicit dependency changes and sanitized evidence. Keep all production state unchanged.

## Subsequent tasks required for delivery

1. Persist explicitly approved issuer/sub/client/workspace/node bindings with non-reusable membership and grant generations. Revalidate disabled users, changed identity links, remove/re-add membership, paused/revoked nodes and restored state on every operation. Use existing identity/store boundaries; do not repair and mount the unaccepted custom issuer as a shortcut.
2. Add opt-in MCP resource metadata and standards challenges, a separate bounded JWT transport path, exact scope checks for task/artifact/events operations, and integration through public runtime. Preserve old short-Bearer behavior and duplicate header/Host/Origin defenses. Failed JWT validation must not fall through to a different credential class.
3. Add exact Caddy resource-metadata routes. Test actual TLS ingress, authentication, scope failures, cross-workspace denial, startup/close, cache rotation/staleness, resource budgets and rollback before public activation.
4. With action-time approval, create only the dedicated Pocket ID API resource and required native client grants. Obtain exact native redirect/client requirements from the vendor UI; never guess them or repurpose the human/Tailscale clients. Verify real token shape without printing tokens.
5. Prove Muse LaoZhen and dots XuanJi native computer task/evidence/receipt round trips separately. Complete the remaining multi-user, five-Agent sustained-load and recovery gates before claiming full delivery.

## Review focus and source boundaries

- Local logout/revocation must not be confused with immediate issuer-side token revocation. Offline JWT validation cannot promise immediate issuer-disable propagation; an explicit policy and real test remain required.
- Unknown key traffic and JWKS failures must remain bounded without accepting stale expired cache indefinitely.
- Shutdown must abort owned fetches and settle cancellation before reporting closed; no successful proof after close.
- Scope/type/audience/client validation must remain distinct from local membership and node authorization.
- Public vendor documentation does not prove this account's installed version or native connector capabilities.

Primary references: [Pocket ID APIs](https://pocket-id.org/docs/guides/apis), [token formats](https://pocket-id.org/docs/guides/scopes-and-claims), [v2.14.0 token handler](https://github.com/pocket-id/pocket-id/blob/v2.14.0/backend/internal/oidc/token_handler.go), [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization). The versioned handler supplies a `client-` subject for client-credentials tokens; this supports rejecting that profile, not assuming the live deployment was inspected this round.
