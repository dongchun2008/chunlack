# OAuth core checkpoint: not accepted for deployment

Date: 2026-10-11. This records local work, failures and open gates honestly.
No production OAuth route, identity schema, Pocket ID client, credential,
public listener, model configuration or Tailscale Relay was changed.

## Implemented but unmounted

- Pinned `@node-oauth/oauth2-server` 5.3.0, MIT, in root manifests. Installation
  used `--ignore-scripts`; eight packages added, no global/VPS installation.
- Explicit isolated SQLite schema installer refuses existing identity tables.
- Internal protocol adapter implements mandatory S256, fixed approved clients,
  canonical resource binding, opaque credential hashes, owner/workspace/node
  checks and bounded record/request admission. It has no HTTP listener.
- No production migration, browser consent transaction, ingress route or native
  account acceptance is implemented by this checkpoint.

## Tests and failures

- New focused suite: 15/15 passed, zero skipped, duration 1378.6592 ms.
  The initial run failed due to the missing implementation before it was added.
- Full command: `node --test --test-concurrency=1 --test-timeout=90000 tests/*.test.cjs`.
  Result: 512 total, 503 passed, 2 failed, 7 skipped, 0 cancelled; 777324.1904 ms.
- Both failures were `tests/public-preflight.test.cjs`: child status null when
  Git Bash exceeded the fixture's 3000-ms timeout. Independent reproduction
  failed the same way. Windows-only budget changed to 15000 ms, Linux remains
  3000 ms; all read-only/occupied-port/service-protection assertions unchanged.
- Corrected preflight suite: 2/2 passed, durations 6260.48 and 7004.6869 ms.
  These passing targeted reruns do NOT constitute a second all-green full run.
- Seven skipped tests require actual Caddy/combined TLS fixture enablement;
  they are not passing tests. Earlier native fixture evidence remains separate.
- First `node tests/smoke.cjs` attempt timed out waiting for server health with
  no child log output. Repeat passed real HTTP/WebSocket, two mock model
  backends, SQLite restart persistence, private bind and config preservation.
  Root cause of the first timeout is unconfirmed; do not label it fixed.
- The OAuth test labelled restart reconstructs the core over the same in-memory
  SQLite connection. It does not prove file close/reopen or process restart.

## Independent review: unresolved, blocks acceptance

Read-only reviewer inspected code without executing tests or touching services.
These are source-traced findings, not independently reproduced runtime attacks.

1. P1: Membership removal deletes the version counter; re-adding an owner can
   recreate version 1 and revive old grants. Bind a durable incarnation or
   permanently revoke affected grants; add a two-owner remove/re-add regression.
2. P2: Revoked grants still count toward all quota limits and are only pruned
   after absolute expiry. Add bounded reclamation and capacity-recovery tests.
3. P2: Refresh consumption commits separately from replacement-token persistence.
   A later save/quota failure leaves no replacement, and retry looks like replay.
   Make rotation crash-safe/atomic without allowing parallel double issuance.

The reviewer did not accept the core. Fifteen passing focused tests are not a
security sign-off. It remains unmounted; the user subsequently required reuse
of existing Pocket ID. Follow the Pocket ID integration addendum before
expanding or promoting a separate authorization server.

## Dependency audit: unresolved existing release gate

`npm audit --omit=dev --json` exited 1: three critical and one high affected
package entries. None is the new OAuth package. Existing lockfile dependencies:

- `@simple-git/argv-parser`: unsafe editor detection.
- `simple-git`: unsafe Git configuration/options (recommended upgrade 4.0.2 is
  a major version; compatibility must be tested, not blindly forced).
- `proxy-addr`: trust-subnet IP spoofing.
- `brace-expansion`: denial-of-service inputs.

Do not run `npm audit fix --force` or silently alter production dependencies.
Resolve in an isolated dependency-hardening step and re-run the complete suite
before public release. Counts are from this audit, not a lasting safety claim.

## Completed separate native repair

The real 1Cat Provider r3 report is retained at
`fixtures/2026-10-11-1cat-provider-native-r3.json`, SHA256
`787f23062992c714d3c389a127128224cb74aa42ed3402d8072cedd9fad4b5e7`.
It passed with unchanged original services and successful owned-unit cleanup.
See `2026-10-11-provider-workspace-live-trial.md` for exact limits and evidence.

## Remaining delivery gates

Pocket ID live-client/API compatibility, OIDC identity linkage/session flow,
schema/restore/permission integration, dependency hardening, complete green
regression, bounded native combined load, formal account/data ownership and
real Muse/dots acceptance remain. Overall long goal remains ACTIVE.
