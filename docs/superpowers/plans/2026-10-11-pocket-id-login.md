# Pocket ID relying-party implementation

Spec: `../specs/2026-10-11-pocket-id-integration.md`.

1. Add failing signed synthetic-issuer tests for PKCE, state/browser binding,
   nonce, issuer, audience, expiry, replay, identity links and HTTP sessions.
2. Implement an opt-in openid-client relying party, identity schema v2 with
   explicit v1 migration, stable identity links, existing-session integration,
   exact callback route and a login entry. No native Agent API tokens yet.
3. Run focused tests and existing identity/runtime/migration regressions. Keep
   production and existing Pocket ID applications unchanged. Record failures.
4. Synchronize scoped source and evidence. Dedicated Pocket ID client setup,
   real browser login and native Agent OAuth remain distinct acceptance gates.

Ruling: Login transactions are bounded, five-minute, memory-only records, not
persisted authorization codes/verifiers. Restart invalidates pending logins;
users retry sign-in. Durable account links are versioned in identity.db.
This reduces persisted sensitive material without weakening replay protection.

Ruling: Do not mount the earlier custom OAuth authorization server. Human OIDC
support does not imply Pocket ID resource tokens or Muse/dots access works.

Files: identity/oidc.cjs, identity/oidc-http.cjs, identity/store.cjs,
identity/sessions.cjs, identity/http.cjs, identity/workspace-shell.js, lack.py,
gateway/public-runtime.cjs, scripts/workspace-migration-engine.cjs,
package.json/package-lock.json, tests/oidc-login.test.cjs,
tests/identity-store.test.cjs and this plan/verification documentation.
