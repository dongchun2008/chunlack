# Pocket ID integration requirement and verified discovery

Date: 2026-10-11. User requires support for their existing Pocket ID service.
This updates the identity-source/issuer selection in the earlier lightweight
OAuth design. It does not authorize replacing existing Pocket ID clients,
changing its keys, migrating a tailnet, or modifying Tailscale Relay.

## Read-only live evidence

User-supplied origin: `https://pockid.chunclaw.top/`.
Three unauthenticated HTTPS GETs used normal certificate validation, a
15-second timeout and no redirects. No login, tokens, keys or mutations.

- `/.well-known/openid-configuration`: HTTP 200.
- `/.well-known/oauth-authorization-server`: HTTP 200.
- Both declare issuer `https://pockid.chunclaw.top` (no trailing slash).
- Authorization endpoint `/authorize`; token endpoint `/api/oidc/token`;
  JWKS `/.well-known/jwks.json`; userinfo `/api/oidc/userinfo`.
- Authorization code and refresh are advertised; PKCE S256 is advertised.
  ChunLACK must require S256 even though the issuer also advertises plain.
- Client authentication: `client_secret_basic`, `client_secret_post`, `none`.
- Discovery advertises `authorization_response_iss_parameter_supported: true`.
- `client_id_metadata_document_supported: false`; no registration endpoint.
  Do not treat this as permission to enable global dynamic client enrollment.
- Introspection is advertised at `/api/oidc/introspect`; no revocation endpoint
  is advertised. Actual client permission and revocation behavior remain untested.
- `/api/version/current`: HTTP 401. Installed version remains UNKNOWN.

These responses prove discovery availability/capability advertisement, not a
completed sign-in, valid client secret, usable API grant or native Agent login.

## Architecture preference

1. Reuse Pocket ID as the human OIDC identity provider. ChunLACK is a dedicated
   relying-party client, with exact registered HTTPS callback and PKCE S256.
2. Prefer reusing Pocket ID as the MCP/API authorization server too, IF the
   installed version and actual account support API resource-scoped tokens,
   required clients and scopes, expiry and acceptable revocation behavior.
3. Keep workspace membership, node binding, task scopes, ownership and immediate
   local revocation in ChunLACK. A valid signature alone grants no task access.
4. Do not automatically promote the earlier custom authorization core. If the
   installed Pocket ID cannot satisfy Agent OAuth, document the exact gap and
   compare a minimal adapter against an additional issuer before deploying one.

```text
Human browser -> ChunLACK -> existing Pocket ID sign-in
                    |
                    +-> local authenticated session + explicit memberships

External Agent -> Pocket ID user-delegated API authorization (to be verified)
                    |
                    v
              ChunLACK protected MCP resource
                    |
              current user/workspace/node/task checks
```

## Security and integration contract

- Fix issuer to the configured canonical value, not a caller/forwarded header.
- Use a maintained OIDC/JWT client implementation; check signature, issuer,
  exact audience, expiry, nonce, state and PKCE for the respective flow.
- Bind identities using `(issuer, sub)`, not email or display name. Existing
  `chunlack-owner` requires an explicit verified account link; no email-based
  auto-merge, automatic owner, or automatic access to all workspaces.
- Separate browser ID tokens from resource access tokens. Never accept an ID
  token, an unrelated application's access token, or a Pocket ID admin API key
  as an Agent credential. Do not repurpose an existing Tailscale/OIDC client.
- Only approved user-delegated Agent access in the first pilot. Advertised M2M
  support does not authorize bypassing human-bound node/task restrictions.
- Use a dedicated ChunLACK client and, if supported, a dedicated MCP API resource
  `https://agents.chunclaw.top/mcp`; confirm actual issuer normalization.
- The callback proposal is `https://lack.chunclaw.top/auth/oidc/callback`.
  It is NOT registered, mounted or live yet. Add only that exact route after
  session/CSRF/Origin and proxy tests; do not weaken all `/auth` routes.
- Keep issuer endpoints on the configured trusted origin, TLS verified, no
  redirects by default, bounded metadata/JWKS sizes, fetch timeout and key cache.
- Enforce local disabled users, membership changes and node revocation on every
  operation. Define how issuer disable/logout propagates; JWT expiry alone must
  not be described as immediate centralized revocation.
- Keep local recovery login restricted and deliberate; no unauthenticated
  fallback if Pocket ID is unreachable. Never log codes or client secrets.

## Next bounded implementation steps

1. Implement provider-neutral OIDC relying-party configuration and tests against
   a local synthetic issuer, with Pocket ID as the first configured provider.
2. Add identity links, login transactions and logout through versioned identity
   migrations and archive/restore inventories. Test remove/re-add, identity
   switch, replay, expiry and restoration without reviving old authority.
3. Confirm the installed Pocket ID version and dedicated-client/API capabilities
   through an authenticated, read-only view before any setup changes.
4. Configure only new ChunLACK-specific resources. Store secrets in a private
   file/environment reference, never chat or repository.
5. Test actual Pocket ID login, multi-user workspace isolation and controlled
   logout; separately test native Muse LaoZhen/dots XuanJi Agent authorization.
6. Re-run complete regressions and isolated combined-resource acceptance before
   production ingress. Existing LACK/Relay remain untouched during this work.

## Current official references (not proof of installed version)

- [Pocket ID introduction](https://pocket-id.org/docs/introduction): OIDC login.
- [APIs and permissions](https://pocket-id.org/docs/guides/apis): dedicated API
  resources/scopes and signature/issuer/audience/expiry checks for access tokens.
- [Scopes and claims](https://pocket-id.org/docs/guides/scopes-and-claims): user
  identity claims and token distinctions.
- [Client ID metadata documents](https://pocket-id.org/docs/guides/client-id-metadata-documents):
  explicit enrollment policy; disabled on the observed instance.
