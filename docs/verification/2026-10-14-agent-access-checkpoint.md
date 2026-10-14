# Agent access verifier checkpoint: not accepted or mounted

Date: 2026-10-14. Parent revision: `b0e1c27`.

## Scope and current state

The new `identity/agent-access.cjs` implements bounded Pocket ID access-token
evidence, not workspace/node authorization. It is not imported by public
runtime or mounted on any endpoint. No production services, Pocket ID clients,
permissions, credentials or Relay settings were changed in this work.

The already-present locked `jose` version 6.2.12 is now an explicit direct
dependency. The initial npm command could not run because npm was absent from
PATH. The existing package/lock declarations were updated without installing
packages, changing versions or running lifecycle scripts. This is not a fresh
clean-install acceptance result.

Design and subsequent integration gates:
`docs/superpowers/plans/2026-10-14-pocket-agent-resource.md`.

## Test evidence

- The initial focused test failed because the new module did not exist.
- After implementation, 33 focused cases passed with real synthetic RSA
  signatures and a controlled JWKS fetch boundary; no real issuer tokens used.
- Full local suite: 633 tests, 633 passes, zero failures, cancellations, skips
  or todo; exit 0; duration 312745.4556 ms.
- The full suite used Node 24.19.0, existing project dependencies and the
  existing Caddy 2.11.7 executable. Its SHA-256 matched the previously verified
  digest before execution; real HTTPS fixtures were enabled, not skipped.
- Full-suite execution session 23602 ended with exit 0. No second suite was
  launched merely because an observation wait had not returned.

The green results do not cover or dismiss the independent findings below.
No Linux isolation or real Pocket ID access-token acceptance is claimed for
this new module.

## Independent review findings: approval pending

1. `sub` is checked with a UUID regex without first requiring a string.
   A signed one-element array can pass JavaScript coercion and be retained
   inside shallow-frozen evidence. This is a claim-schema/immutability defect,
   not a signature bypass. Require a string and add array-subject rejection.
2. JOSE's key-miss cooldown is measured from successful key retrieval.
   Failed refreshes after that window can retrigger requests on subsequent
   admitted verifications. Add an explicit failed-fetch cooldown while
   preserving single-flight and bounded recovery.

The reviewer also identified missing coverage for key rotation/removal,
expired-cache outages and recovery, body-phase timeout/cancellation settlement,
repeated close, rate-limit reset, cross-verifier proofs and malformed claims.
The injected verification clock does not currently advance JOSE's cache clock;
cache tests must account for that rather than falsely simulating expiry.

A specific approval request for these two repairs and related tests has been
sent and remains unanswered at this checkpoint. No repairs were applied after
the findings, and the component must not be promoted or enabled based on its
current green tests. The independent reviewer performed no edits, tests,
credential reads or production operations and has been closed.

## Evidence hashes

| Artifact | SHA-256 |
| --- | --- |
| `identity/agent-access.cjs` | `497fc695f5355419ebdfcf1fd8fb558fe6338864795ae81457e8590a60d62b82` |
| `tests/agent-access.test.cjs` | `6e650367a6ccfa28035ce99d1357f2d7457c48d4856a4026a41bfde5967b804d` |
| Full TAP log | `abdfe453cb132167d9147bd6a4baf22e7282f00983b678b6c9a280c6711e9e14` |

The TAP log remains in ignored local storage:
`.superpowers/sdd/2026-10-13-release-preparation/agent-access-full-20261014.tap`.
No private runtime files or credentials are included in this checkpoint.
