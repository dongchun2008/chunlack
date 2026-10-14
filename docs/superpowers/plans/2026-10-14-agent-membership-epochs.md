# Agent membership epochs implementation plan

> For agentic workers: use superpowers:executing-plans inline under the existing
> approved local implementation and testing scope. Do not mount or deploy.

Goal: provide a durable, non-reused membership incarnation for the local Agent
authority bridge without treating a resettable membership version as identity.

Spec: `docs/superpowers/specs/2026-10-11-pocket-id-integration.md`.
Parent plan: `docs/superpowers/plans/2026-10-14-pocket-agent-resource.md`, task 2.
Baseline: `0716134`.

Local implementation and the review-fix pass are verified in
`docs/verification/2026-10-14-membership-epochs-repair.md`.
This completes only the unmounted membership-epoch primitive, not the parent
plan's complete authority bridge or production acceptance.

## Design ruling

The existing memberships table has a composite workspace/user key and an integer
version, but deletion and reinsertion can reuse version 1. The bridge needs an
independent random incarnation that changes transactionally even when another
SQLite connection performs the mutation between authorization requests.

Use an optional module installed on the same identity database connection. A
small side table contains only current memberships, with a 128-bit random hex
epoch. SQLite triggers rotate it on membership changes and account/workspace
disable-state changes. Deletion removes the row; reinsertion creates a new epoch.
No second database, polling process or external service is introduced.

This module is not called by the current runtime. Existing identity schema
version and legacy authorization behavior remain unchanged. Its independently
versioned schema component is initialized in a transaction; future versions fail
closed. The existing caller owns the database connection and write-lock policy.

## Files and interfaces

- Create `identity/membership-epochs.cjs`.
- Create `tests/membership-epochs.test.cjs`.
- Create a verification record after testing; preserve historical checkpoints.
- Export `createMembershipEpochs(db)` for an already-open better-sqlite3 identity
  database. Return frozen `{read(userId, workspaceId), invalidateAll()}`.
- `read` returns frozen `{userId, workspaceId, role, membershipVersion, epoch}`
  only for a currently enabled user/workspace and an existing membership;
  otherwise throw the existing `IdentityError('not_found', 404)`.
- `invalidateAll` rotates every current epoch in one transaction for a future
  trusted snapshot-restore hook. It is not exposed over HTTP.

## Implementation and verification

- [x] Write tests and observe the missing-module failure.
- [x] Implement the optional transactional schema, triggers and current-state read.
- [x] Prove delete/reinsert at identical timestamps and version 1 changes epoch.
- [x] Prove role changes, disable/re-enable and second-connection mutations invalidate.
- [x] Prove transaction rollback preserves the old committed epoch and membership.
- [x] Prove reopen preserves epochs, missing/disabled identities fail, future schema
  is rejected, and the frozen pre-OIDC identity schema remains compatible.
- [x] Prove the explicit restore primitive rotates all current epochs without
  changing roles or membership versions. Do not claim restore integration exists.
- [x] Run focused identity regressions and the complete local test suite.
- [x] Obtain an independent read-only review and address its finding through a
  reproduced RED-to-GREEN repair; record actual results for GitHub synchronization.

Review focus: foreign-key-disabled connections, delete/reinsert ABA, no-op updates,
cross-workspace leakage, migration rollback and persisted incarnation stability.
Unfinished next gates: issuer/subject/client bindings, node grants and live node
revocation, opaque principal conversion, snapshot restore wiring, HTTP integration
and real Pocket ID/Muse/dots acceptance. An epoch is not an authorization grant.
