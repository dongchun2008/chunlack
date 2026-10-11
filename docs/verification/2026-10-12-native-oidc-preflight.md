# Native OIDC preflight and isolated startup failure

Date: 2026-10-12 (Asia/Shanghai).
Candidate source: `753308194bfb9136e34555008d68c4736f76292e`.
Documentation baseline: `294b92d40c4bf60ceb955a810dbcb65014db1c62`.

## Outcome

SSH authentication and read-only production preflight succeeded. The isolated
test unit failed during mount-namespace preparation, before Node or any test
started. This is **not** a passing native OIDC validation, a product test
failure, a Pocket ID login, a production deployment, or native Agent acceptance.

## Verified observations

- The ED25519 server fingerprint matched the user's previously supplied pin.
- An existing local Paramiko installation completed SSH negotiation without
  changing the server. The password came from the user-designated private file;
  no password was printed, uploaded, committed, or placed in command arguments.
- `chunlack.service` and `tailscaled.service` were active/running. Their PIDs
  remained 594652 and 859 respectively across this attempt.
- The existing loopback LACK health endpoint returned HTTP 200.
- The existing UDP 40000 Relay listeners remained present. The TCP 443 listener
  query returned no entries; no HTTPS listener was started by this attempt.
- Node was v24.21.0 on Linux x86_64. Available memory was about 1085 MiB during
  initial preflight; this is an observation, not a revised resource budget.
- Production dependency resolution found `ws` and `better-sqlite3`, but not
  `openid-client` or `@node-oauth/oauth2-server`. Production dependencies were
  not changed.

## Isolated preparation and failure

An exclusively created directory, `/var/tmp/chunlack-oidc-7533081-a61f09d2`,
holds the pinned source export and test-only dependency copies. The source
archive's Git commit identity was checked. Transfer hashes and 95 dependency
file hashes/sizes were checked before unit startup. The copied packages were
`openid-client` 6.8.8, `jose` 6.2.12 and `oauth4webapi` 3.8.8. These were copies
of the locally installed, version-checked packages, not a fresh registry
integrity attestation. No native Windows module was copied and no global
package installation was performed.

The intended test sequence was `oidc-login`, `oidc-review-regressions`, then
`identity-session`, each running as `nobody`, with a private network namespace,
read-only system mounts, 10% CPU, 160 MiB memory high, 192 MiB memory maximum,
zero swap allowance, 32 tasks and a 240-second unit lifetime. These limits were
requested but runtime acceptance was not reached.

The first unit, `chunlack-oidc-a61f09d2-1.service`, returned
`226/NAMESPACE`. Its journal reports that the isolated scratch directory was
not visible during mount namespace setup. `PrivateTmp=yes` hides the host
`/var/tmp` tree, while the source and scratch paths were not explicitly bound
into that namespace. Follow-up inspection confirmed `MainPID=0`,
`ActiveState=failed`, `SubState=failed`. The TAP log was empty. No test group
was restarted, no remaining group was launched, and resource limits were not
increased. The failed unit and owned artifacts are retained as evidence.

Proposed follow-up, pending the user's requested confirmation: retain private
temporary-directory isolation, bind only this run's source read-only and its
scratch directory read-write, then retry within the same resource budget.
Do not bind production data or credential directories into the test unit.

## Production preservation and evidence

The preflight and postflight records were identical: service state, PIDs,
unit-file hashes, health result, Relay/443 listener output, and Node binary
hash/version. This does not prove all production behavior or Relay throughput;
it confirms the stated checks did not change during this attempt.

Ignored local evidence directory:
`.superpowers/sdd/2026-10-12-oidc-native/native-oidc-7533081-a61f09d2/`.

| File | SHA-256 |
| --- | --- |
| inputs.json | d4bf8ad7d7f87105179878482d54ee744bbb5dd891cd7e1b1a979d515344945f |
| baseline.json | 2a9eba13dcf362333002ffb3b9a8c2e80983c8430c36994e1e66baae96c9581e |
| postflight.json | 2a9eba13dcf362333002ffb3b9a8c2e80983c8430c36994e1e66baae96c9581e |
| result.json | 500f020d6328df7c03ff3beae1e79a9ea11441788b256d26e2d99114392bef81 |
| start-failure-diagnostic.txt | 4d241ed4140abeef5a51084634cd61b8b8dc0dcd55f3f8dee20ce354492c10d |

## Remaining delivery gates

Native OIDC/session validation is still pending. The dedicated Pocket ID
client has not been created, and authorization for that external account
change is still pending. No real Pocket ID login, production activation,
Muse native execution, or dots native execution was performed in this round.
Earlier local passing suites and historical native results must not be used
to label this candidate fully delivered.
