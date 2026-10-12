# Native runtime, storage and HTTPS validation

Date: 2026-10-12 (Asia/Shanghai).
Pinned product/test source: `753308194bfb9136e34555008d68c4736f76292e`.
No product code, test assertion or existing test timeout was changed.

## Result and remaining failure

**The runtime group is not accepted:** 15 of 17 tests passed; two child-process
operations exceeded their existing 5-second deadlines. Independent storage
and HTTPS groups subsequently passed: **52 storage tests and 10 HTTPS/ingress
tests**, with no skips or cancellations. Their success does not override the
runtime failures or constitute complete delivery.

Previously accepted native OIDC/session coverage remains documented in
[the separate 45-test report](2026-10-12-native-oidc-session-validation.md).

| Test file | Pass / total | Wall time (seconds) |
| --- | ---: | ---: |
| public-runtime.test.cjs | 15 / 17 | 102.798 |
| workspace-migration-apply.test.cjs | 24 / 24 | 78.100 |
| workspace-snapshot.test.cjs | 8 / 8 | 7.001 |
| workspace-snapshot-closed-wal.test.cjs | 1 / 1 | 1.897 |
| workspace-snapshot-root-coverage.test.cjs | 9 / 9 | 11.496 |
| workspace-snapshot-review-boundaries.test.cjs | 3 / 3 | 9.100 |
| workspace-restore-trial.test.cjs | 7 / 7 | 6.293 |
| packaged-public-ingress.test.cjs | 3 / 3 | 48.193 |
| workspace-ingress-lifecycle.test.cjs | 3 / 3 | 3.995 |
| public-ingress.test.cjs | 4 / 4 | 16.503 |

## Runtime failures and bounded diagnosis

Failures in `tests/public-runtime.test.cjs` were:

- Line 195: actual materialized import allocates no data directory, listeners
  or retained startup timers. The child invocation at line 197 timed out.
- Line 226: legacy server entry cannot bypass the public data-root writer
  guard. The child invocation at line 230 timed out.

Both child invocations retain `timeout: 5000`. The group exited with failure;
the controller stopped subsequent groups. Storage and HTTPS were then run
independently with fresh run identities and the same limits, not by ignoring
the failing group's exit code.

An additional diagnostic ran one materialized import under the same 10% CPU
quota and 192 MiB memory limit. Its separate observation deadline was 20
seconds; this was not a modification of either original test or an acceptance
rerun. The diagnostic recorded:

- Module load wall time: 5600.114 ms.
- Module load CPU time: 560.036 ms.
- Child total wall time: 6096.072 ms.
- Natural child exit status: 0, no signal, no error, empty stderr.
- No package `db` or `jspace` directory was created.

This demonstrates that a cold import can exceed the existing five-second
deadline at the deliberately restricted CPU quota. It does not prove that the
second failing writer-guard assertion passes. Both original tests must still
be rerun. A request is pending for an explicit low-CPU test mode with a bounded
12-second child deadline and corresponding bounded case deadlines, retaining
the default five-second behavior, all assertions and the original service
resource limits. Product request/operation deadlines must remain unchanged.

Notably, the actual packaged OIDC shutdown/rollback tests and both incomplete
body-cancellation writer-lock preservation tests passed in this runtime run.
They do not compensate for the two unaccepted assertions.

## Accepted storage and transport scope

Storage coverage includes genuine frozen v1 identity migration, active and
revoked sessions, isolated candidate ownership and preserved source bytes,
v2 identity links/session restore, snapshot consistency and closed WAL files,
root content coverage, failure boundaries and non-activating restore trials.
The datasets are disposable fixtures. No live production migration, refreshed
production consistency backup or activation was performed.

HTTPS coverage used the actual materialized application and Caddy, local test
certificates with verification enabled, real HTTPS/WSS requests, scoped human
sessions, Origin/CSRF checks and workspace/Agent endpoint separation. It did
not bind host port 443, obtain a public certificate, change DNS, exercise a
real Pocket ID account or invoke Muse/dots.

## Isolation and tool provenance

All test units ran sequentially as `nobody` with private networking and private
temporary directories. Source, existing VPS dependencies and test tools were
read-only binds. The only writable test areas were the owned scratch directory
and the test source's `.superpowers` fixture directory. The isolated source
node_modules directory contained links to the read-only dependency mount so
child fixtures that set their own NODE_PATH could load existing dependencies.
Production release permissions and user groups were unchanged.

Captured systemd properties verified CPUQuota 10%, MemoryHigh 160 MiB,
MemoryMax 192 MiB, MemorySwapMax 0, TasksMax 32, RuntimeMax four minutes per
group, `ProtectSystem=strict`, `NoNewPrivileges=yes`, `PrivateTmp=yes`, and
`PrivateNetwork=yes`. Group results retained the actual bind-path properties.
No budget was raised. Recorded memory peaks were 154914816 bytes for the
runtime group, at most 65101824 bytes for storage groups, and at most 116183040
bytes for HTTPS groups. These are recorded unit observations, not a production
capacity or sustained-load certification.

The existing isolated Caddy 2.11.7 Linux amd64 artifact was reused. Its archive
SHA-256 was `727b91701a392de6ebc5027509f548bf39979e5216340d0faed8fa5e69c84f8b`;
the binary SHA-256 was
`678ade3bfc088749c81a681adc603333ee0bb023b6a6cfe3c0f58bef8ff854e9`.
Both matched the retained prior provenance record, which reports verification
against the GitHub asset digest and no separate publisher-signature check.
The current attempt rechecked the bytes, not a new publisher attestation.
There was no global Caddy installation or production service creation.

## Production preservation and retained evidence

Every run and the diagnostic preserved the preflight/postflight baseline:
existing service states and PIDs, unit-file hashes, Node binary hash/version,
HTTP 200 LACK loopback health, Relay UDP listeners and the empty host TCP 443
listener query. The final controller records have no active owned unit. No
production service was restarted or switched. These checks are not a Relay
throughput benchmark.

Local evidence base: `.superpowers/sdd/2026-10-12-oidc-native/`.
Remote roots use `/var/tmp/chunlack-<kind>-7533081-<nonce>`.

| Kind / nonce | Local evidence directory | Result JSON SHA-256 |
| --- | --- | --- |
| runtime / 679fe4a2 | native-runtime-7533081-679fe4a2 | a4ad8d98bf5d85c4edf71c75b2b8699a173bb5db82ad469da10a6f626db7386e |
| storage / b913725c | native-storage-7533081-b913725c | a8aa861ec0f41e71495387fa3a6d4a5cf24b95fa0355e385c5910560b8e88579 |
| https / 0bf124ab | native-https-7533081-0bf124ab | 24752030d6621058c383f79b2072f3212887112ab46bf66e7f57cdcf25c724fe |

Each result records per-group resource properties and the corresponding TAP
SHA-256. Each run's baseline and postflight JSON have SHA-256
`2a9eba13dcf362333002ffb3b9a8c2e80983c8430c36994e1e66baae96c9581e`.
The runtime TAP SHA-256 is
`4da5e9e2bb1fe97a365e76239998255b0a676d99d184e5fc8f082f57707daa1f`.
The diagnostic result JSON in the runtime evidence directory has SHA-256
`2e2f794cf3b7a98e95196b2ae43f29cf309df712c1d6a1fdc134b592a6cf3514`;
its log SHA-256 is
`bcc554fc42536f217c3f0e75c38c3555e9ce52bd08d857ffcc48b23f6d2ce902`.

Pocket ID login remains deferred by the user. The native runtime failure,
real identity/model/Agent acceptance, current production-data validation and
authorized publication remain delivery gates. No full-system readiness claim
is made by this report.
