# Agent authority registry implementation plan

Execution: continue the approved local Pocket ID integration plan inline.
Spec: `docs/superpowers/specs/2026-10-11-pocket-id-integration.md`.
Parent plan: `docs/superpowers/plans/2026-10-14-pocket-agent-resource.md`.
Baseline: `f4499be`. No runtime mount, production change or real client grant.

## Contract

Create `identity/agent-authority.cjs` and `tests/agent-authority.test.cjs`.
`createAgentAuthority({db, identity, workspaceAccess, verifier, config, now,
maxGrants})` consumes caller-owned services and an open identity database.
Configuration pins the same issuer/resource/native client allowlist and separate
browser client ID as the existing access verifier. Maximum stored grants: 2048.

Expose `grant(actor,input)`, `revoke(actor,{workspaceId,grantId})`,
`authenticate(token,{grantId,scope})`, `assert(proof,{scope})`, and `close()`.
The administration methods are internal APIs for a future authenticated human
route, not network handlers. Actor user/workspace must come from that route's
server-owned session; re-read current membership and require workspace owner.

Grant input fixes subject, clientId, workspaceId, nodeId, scopes and expiresAt.
Resolve subject through the existing local external-identity binding, never
through token names/email/roles. The recipient must currently own that node and
have node-management authority in that workspace. Require explicit expiry,
at most 30 days ahead, and only the five existing task/events access scopes.

Store grants in the identity DB with the current membership epoch. Reject
duplicates; new grants require an explicit owner action. Keep creation and
revocation audit entries without bearer tokens. Delete expired/stale-membership
grants before capacity checks; retain audit history. Explicit revocation deletes
the grant, so its random ID and any proof pinned to it never revive.

Install transactional external-identity INSERT/UPDATE/DELETE triggers that
delete affected grants. This covers unlink/relink and REPLACE with recursive
triggers disabled, independently of resettable timestamps or versions. Install
membership epochs and the authority schema in one transaction; future component
versions fail closed. No separate issuer service or database is introduced.

`authenticate` consumes an opaque proof from the actual access verifier, then
checks the explicit local grant and returns a new opaque authority proof.
`assert` rechecks token/grant expiry, external binding, current membership epoch,
node ownership/revocation and scope on every use. Pause blocks new task claims,
but does not block existing-result submission. This proof is NOT accepted by
`gatewayStore.assertAuthenticatedNode`; the later transport bridge must preserve
gateway-owned principal creation and call authority assertions per operation.

Closing invalidates local proofs and prevents in-flight authentication from
issuing new ones. It does not close the caller's DB or verifier. A reopened
registry can use persisted grants only with fresh verified proofs. Regranting
after revocation is explicit new authorization, not automatic revival.

## Tests and gates

1. Write actual signed-JWT and real identity/gateway fixture tests; observe RED.
2. Implement transactional registry and opaque current-authority evidence.
3. Test forged/unknown proof, absent grant, wrong client/scope/workspace/node,
   owner-role revalidation, duplicate/capacity/expiry, account/membership changes,
   external unlink/relink/REPLACE, node pause/revocation/re-pair, restart and close.
4. Test migration-registration rollback and token/grant lifecycle independently.
5. Run focused and complete local suites and one independent read-only review.
6. Record results and sync GitHub. Do not claim HTTP or external-Agent acceptance.

Remaining integration: gateway-owned principal adapter, MCP resource discovery
and challenge, protected transport, restore invalidation and actual private
configuration. Native Muse/dots execution and live Pocket ID token acceptance
remain separate delivery gates.

## 2026-10-14 local verification checkpoint

The unmounted registry is implemented. The known unlink/relink fixture error
was corrected after explicit approval without weakening identity policy.
All independent review coverage items were added: stale-owner grant/revoke,
recipient and parent lifecycle invalidation, full-capacity pruning with audit
retention, and future-version rejection without writes.

Focused: 24/24 passed. Full local suite: 698/698 passed, zero failures,
skips or cancellations. See
`docs/verification/2026-10-14-agent-authority-validation.md` for commands,
red/green evidence, report hash and remaining gates.

This completes only local registry verification. Transport mounting,
gateway-principal integration, snapshot/restore wiring, native Linux and
real Pocket ID / Muse / dots acceptance remain unfinished. No production
service or credential was changed.
