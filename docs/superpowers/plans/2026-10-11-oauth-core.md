# Bounded OAuth core implementation plan

**2026-10-11 requirement update:** The user requires their existing Pocket ID
service. Follow `../specs/2026-10-11-pocket-id-integration.md` before choosing
the authorization-server deployment. This unmounted core is NOT accepted:
independent review found three issues recorded in the verification checkpoint.
Do not mount or promote it based on its 15 passing focused tests.

> **For agentic workers:** Use superpowers:executing-plans. Existing user
> authorization covers local implementation and tests; do not repeat approval
> requests for these steps. Production and external enrollment remain separate.

**Goal:** Implement a testable, unmounted OAuth protocol/storage core before
adding any new public route or changing the production identity schema.

**Architecture:** A maintained OAuth engine handles authorization-code/PKCE and
token exchange. A SQLite adapter owns hashed credentials, immutable grants,
atomic single-use consumption and live identity checks. No HTTP listener,
timer, database file creation or migration on import.

**Tech stack:** Existing Node 24, better-sqlite3; pinned
`@node-oauth/oauth2-server` 5.3.0 (MIT, Node >=16, 146411 unpacked package bytes,
three direct dependencies per npm registry). Its protocol code was inspected;
mandatory S256/resource and confidential-client enforcement remain explicit
application policy, not assumptions about library defaults.

**Spec:** `docs/superpowers/specs/2026-10-11-lightweight-oauth-design.md`.

## Global constraints

- Preserve Ollama, neutral Provider routing, static node Bearer and Relay.
- No production mount, schema upgrade, public listener, global installation,
  credential reuse, dynamic client registration or external account operation.
- Canonical HTTPS issuer/resource; exact registered redirect; S256 required.
- Access 300 seconds, code 60 seconds, refresh idle 7 days, grant 30 days.
- Only public browser task scope; owner-bound user/workspace/node grants.
- Synchronous current-state callbacks, bounded inputs/records and no raw-token
  persistence. Restore invalidation must revoke all grants before admission.

## Files and interfaces

- New `identity/oauth-core.cjs`: `createOAuthCore({db, identity, resolveNode,
  issuer, resource, now})`; trusted internal `registerClient`,
  `authorize({actor,nodeId,query,allowRefresh})`, `exchange(body)`,
  `verify(accessToken,{resource,scope})`, `revokeGrant(actor,id)`,
  `invalidateAll()`. No exported raw protocol model or unchecked token minting.
- New `identity/oauth-schema.cjs`: explicit isolated schema installer and table
  inventory. Must refuse an existing production identity database until the
  separate reviewed identity migration/inventory integration is implemented.
- New `tests/oauth-core.test.cjs`: real library + SQLite + identity store tests.
- Modify `package.json`/`package-lock.json`: exact reviewed dependency.
- Verification docs and retained canonical native Provider report.

## Task 1: Isolated OAuth core

1. Write tests for successful PKCE, wrong/absent verifier, exact client/redirect/
   resource/scope, one-use code, refresh replay, owner/workspace/node revocation,
   secret hashing, restart, restore invalidation and bounded admission.
2. Run the new tests and observe missing implementation failure.
3. Implement the declared core and explicit schema installer in one patch.
4. Run focused and existing regression suites; do not turn a failed security
   assertion into a weaker success condition. Record failures and exact scope.
5. Commit/sync only requested source, lockfile and evidence; no runtime secrets.

## Subsequent integration (not delivered by core alone)

1. Integrate schema through `identity/store.cjs`, archive inventories and restore
   invalidation; older code must reject newer schema. Core isolated databases
   are test fixtures, not a second production identity service.
2. Add session-bound consent transactions/UI and exact Origin/CSRF handling.
3. Mount token/discovery/revocation and MCP scope checks; update Caddy allowlist.
4. Verify combined package/TLS under existing resource caps, then native Muse
   LaoZhen and dots XuanJi account flows. No worker substitutes for native Agent.

## Review focus

- Concurrent code/refresh exchange cannot double-mint; replay revokes family.
- Wrong client cannot revoke another client's family by guessing/replaying input.
- Live grant validation is repeated at save and resource use, not only login.
- Errors and public protocol responses cannot expose secret input or SQL details.
- Dormant modules cannot modify production schema/listeners just by packaging.

## Execution record

- Native Provider runner corrected and r3 accepted; source/model unchanged.
- Task 1 in progress. HTTP/session-consent/production integration is not enabled.
