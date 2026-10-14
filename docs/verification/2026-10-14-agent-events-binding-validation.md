# Agent event subscription binding: local validation and ciphertext repair

Date: 2026-10-14

## Scope

Local implementation only. No production service, VPS, Pocket ID client,
credential, DNS, or Tailscale Relay changes were made for this stage.
The Agent MCP events feature gate remains closed. Native Muse and dots
execution and runtime webhook authorization are not accepted by these tests.

The current patch exports subscription bindings only from gateway-owned Agent
principals, checks persisted bindings against live authority, clips subscription
expiry to the original JWT/grant expiry, and separates legacy and Agent
subscription identities. Enabling Agent authorization upgrades event schema
metadata to version 2 so an older implementation rejects the database.
Version 2 encrypts with AES-GCM additional authenticated data covering the
subscription ID, node, workspace, task, and format version. Its `v2:` ciphertext
format has no unbound fallback. Version 1 static-only stores remain supported;
enabling Agent authorization validates legacy subscription identities and
re-encrypts records with the schema update in one transaction. Previously
unbound version 2 development data is rejected, not silently trusted or upgraded.

## Evidence

- RED baseline: the binding-export test failed because the method did not exist.
- Focused tests after ciphertext repair: 24 passed; 0 failed, cancelled, skipped, or todo.
- Full suite after ciphertext repair: 749 passed; 0 failed, cancelled, skipped, or todo.
- Full suite exit code: 0.
- Full suite duration: 715822.0976 ms.
- Full TAP log (local ignored evidence):
  `.superpowers/sdd/2026-10-13-release-preparation/agent-events-ciphertext-full-20261014-215414.tap`
- Full TAP log SHA-256:
  `1d750b854dbb24a972c902f0ad9f34c824fc445146c44ffe46c2a3b2bb2045f0`

Tests exercise persisted delivery after events-store restart, grant revocation,
membership epoch changes, identity unlinking, JWT expiry with a still-live task
and grant, revocation during callback verification and before transport dispatch,
legacy subscription independence, missing-authorizer refusal, and future-schema
rejection. The callback transport in the new tests is synthetic, not a real
vendor callback or native cloud computer.
Additional coverage rejects ciphertext substitution at startup and in a running
store, tampered ownership fields, unbound ciphertext with or without a forged
format prefix, and schema downgrade. It also verifies successful migration with
pending delivery, wrong-key refusal without record changes, legacy identity
mismatch refusal, and transaction rollback under an injected re-encryption error.

## Independent review finding, reproduced and repaired

A read-only review identified that AES-GCM protects the sealed payload but does
not authenticate its owning subscription row. An attacker with event-database
write access could copy an existing valid legacy ciphertext into an Agent
subscription row. Decryption would then yield no Agent binding, permitting the
legacy authorization path instead of the intended grant recheck. This is a
finding was subsequently reproduced in an isolated temporary fixture: after
grant revocation, a copied legacy ciphertext caused one synthetic callback.
This is not evidence of a production incident. The reproduction initially had
fixture-parameter errors; those runs did not establish the vulnerability.
The corrected RED evidence is retained locally at
`.superpowers/sdd/2026-10-13-release-preparation/agent-events-ciphertext-substitution-red-final-20261014.tap`.

The approved correction now authenticates each owning subscription row with
its ciphertext. The same substitution is rejected before callback dispatch.
The permanent regression is in `tests/agent-events-ciphertext.test.cjs`.
Another bounded read-only independent review of the repaired stage reported no
actionable findings. That review did not independently rerun the tests.

The earlier 736-test passing run did not cover substitution and was not accepted
for release. The current 749-test run includes the new regression coverage.
This stage is locally validated for source synchronization, not production
activation or complete external-Agent delivery acceptance.

## Remaining integration gates

- Runtime/MCP wiring and live authorization after DNS resolution and before
  actual webhook dispatch.
- Restore/activation invalidation, preserving original forensic snapshots.
- Constrained Linux validation and controlled deployment with co-host checks.
- Real Muse and dots event-to-native-computer-to-evidence acceptance.

Requests already dispatched before revocation cannot be recalled; no stronger
delivery cancellation guarantee is claimed.
