# Agent authority registry: local validation

Date: 2026-10-14

## Scope and status

The unmounted `identity/agent-authority.cjs` registry binds a verified Agent
access token to an explicit local grant for one user, client, workspace and
node. It rechecks the current external identity, membership epoch, node
ownership, scopes, revocation and expiration on use. Only a currently valid
workspace owner can create or revoke grants through its internal API.

Registry proofs are opaque and are deliberately not gateway principals.
Trusted human-session actor sourcing and gateway-owned principal creation
remain responsibilities of a future transport adapter. No public route or
production login was enabled by this change.

The authorized correction changed the test fixture, not identity binding or
registry policy. A revoked external identity cannot be silently linked again.
Unlink rejection and SQL REPLACE invalidation now execute in separate tests.
The latter is synthetic database lifecycle fault injection, not a supported
user relinking workflow.

## Red/green evidence

- Before correction, the focused registry suite passed 13 of 14 tests. The
  combined unlink/relink/REPLACE test failed with `identity_already_linked`
  before reaching its revocation assertions.
- The pre-correction full suite passed 687 of 688 tests, with this same single
  failure, no skips or cancellations. Report:
  `.superpowers/sdd/2026-10-13-release-preparation/agent-authority-full-20261014-190555.tap`.
- One independent read-only review identified the known fixture defect and
  missing lifecycle, capacity and schema-version coverage. It reported no
  additional concrete registry implementation defect. This is not a claim of
  comprehensive security assurance.
- After the authorized fixture correction and coverage additions, the focused
  suite passed 24 of 24 tests, zero failures/skips/cancellations, exit 0,
  duration 3447.0746 ms. Report:
  `.superpowers/sdd/2026-10-13-release-preparation/agent-authority-repair-focused-20261014.tap`.
- The fresh full suite passed 698 of 698 tests, zero failures, skips,
  cancellations or TODOs, exit 0, duration 297858.7792 ms. Report:
  `.superpowers/sdd/2026-10-13-release-preparation/agent-authority-repair-full-20261014-191804.tap`.
- Full report SHA-256:
  `6931d56779b7d3f88006db975fc5ac5d639b455928cf1dbbbe74e150986a31fa`.

Reports remain in ignored local storage; no private runtime artifacts are
included in this commit.

## Added acceptance coverage

- External unlink invalidates an existing proof and fresh-token use of the
  old grant, deletes the grant, and still rejects implicit relinking.
- External identity REPLACE with reused timestamps invalidates old grants
  with recursive triggers disabled; explicit fresh authorization works.
- A cached owner actor cannot grant or revoke after demotion. Failed attempts
  leave grant records and audit history unchanged.
- Recipient demotion/promotion and user/workspace disable/reenable cannot
  revive old proofs or grants. Explicit new authorization is required.
- At capacity, expiration or membership-epoch changes allow stale grant
  pruning and a replacement grant while retaining the prior audit record.
- Future authority and membership-epoch component versions are rejected
  without changing schema or data.

All lifecycle mutations use disposable synthetic SQLite fixtures. None are
changes to live users, workspaces, bindings or credentials.

## Reproduction

Use the repository's pinned dependencies and Node v24.19.0. The full run used
the existing portable Caddy v2.11.7 after verifying its SHA-256:
`5f93a9bd555f3aac9d33af2756ba14b3519d8cca4ffd55256bdaeab444c9db2a`.
Set `CADDY_TEST_BIN` to that executable, `PYTHON` to the available Python
executable, and put the Node and Git OpenSSL directories on PATH.

```powershell
node --test --test-reporter=tap --test-concurrency=1 --test-timeout=90000 tests/agent-authority.test.cjs
node --test --test-reporter=tap --test-concurrency=1 --test-timeout=90000 tests/*.test.cjs
```

The full run includes local HTTPS coverage, not a real Pocket ID Agent grant
or vendor execution trial. RSA/JWKS and user identities in these registry
tests are synthetic.

## Remaining delivery gates

- Gateway-owned principal adapter with per-operation authority checks.
- Agent JWT MCP transport, metadata, ingress and scope enforcement, without
  weakening existing static-token authentication.
- Snapshot/restore classification and real restore invalidation for the new
  authorization tables.
- Resource-limited native Linux verification and controlled publication.
- Real Pocket ID Agent client/resource enrollment and Muse LaoZhen / dots
  Xuanji task-to-native-computer-to-evidence round trips.
- Remaining multi-user, multi-Agent, research provenance and delivery gates
  in the parent project plans.

No VPS service, Pocket ID application, credential, DNS, firewall, existing
LACK instance or Tailscale Peer Relay was modified during this local stage.
This checkpoint does not establish full platform delivery.
