# Native Linux OIDC and session validation

Date: 2026-10-12 (Asia/Shanghai).
Source revision: `753308194bfb9136e34555008d68c4736f76292e`.
Run identity: `42e70ca9`.

## Accepted scope

The three selected test files passed on the VPS with its existing Linux Node
v24.21.0: **45 tests passed, zero failures, skips or cancellations**.
This accepts the scoped native OIDC/session regression run, not the complete
541-test local suite on Linux, production deployment, real Pocket ID login,
Agent OAuth authorization, model inference or Muse/dots native execution.

| Test file | Passed | Duration (seconds) | Recorded memory peak (bytes) | CPU usage (nanoseconds) |
| --- | ---: | ---: | ---: | ---: |
| tests/oidc-login.test.cjs | 11 | 16.601 | 45813760 | 1723894000 |
| tests/oidc-review-regressions.test.cjs | 12 | 45.994 | 92356608 | 4462658000 |
| tests/identity-session.test.cjs | 22 | 109.697 | 67465216 | 11041356000 |

These are synthetic issuer and local HTTP/SQLite tests. They exercise signed
identity and PKCE validation, malformed/replayed callbacks, browser binding,
cross-tab session revocation, abandoned attempt reclamation, capacity failure
without hidden session issuance, cancellation/shutdown behavior, password
verification, rate limits, persistent sessions, expiry and revocation. They do
not prove a real browser can authenticate against the user's Pocket ID.

## Authorized isolation correction

The previous namespace and dependency failures remain recorded in
[the preflight report](2026-10-12-native-oidc-preflight.md). This run used a new
exclusive directory and three uniquely named transient units, without
overwriting or relaunching either failed attempt.

After the user's explicit authorization, the existing VPS dependency directory
was bound read-only at the test namespace's own dependency path. NODE_PATH
pointed there, rather than traversing the production release directory as
`nobody`. Production directory ownership, permissions and group membership were
unchanged. No production configuration or credentials were copied. The source
export and the same three version-checked OIDC packages were verified as in the
preflight report. No global package installation was performed.

The relevant mount layout was:

```text
BindReadOnlyPaths=<run>/source /opt/chunlack/current/node_modules:<run>/dependencies
BindPaths=<run>/scratch
ReadWritePaths=<run>/scratch
NODE_PATH=<run>/dependencies
TMPDIR=<run>/scratch
```

The test user remained `nobody`. Captured systemd properties confirmed private
networking, strict system protection, no new privileges, CPU quota 100 ms per
second (10%), MemoryHigh 167772160 bytes (160 MiB), MemoryMax 201326592 bytes
(192 MiB), MemorySwapMax 0, TasksMax 32 and RuntimeMax 4 minutes per unit.
Private temporary directories remained enabled. The controller started test
groups sequentially and stopped each owned unit after its terminal result.
The final record has `active_owned_unit: null` and all three groups accepted.

The maximum recorded memory peak was 92356608 bytes, approximately 88.1 MiB.
This is a test-run observation, not a production capacity or five-agent
sustained-load certification. No resource limit or test timeout was increased.

## Existing service preservation

The exact preflight and postflight records matched, including both existing
service states and PIDs, their unit-file hashes, the Node executable hash and
version, the HTTP 200 loopback health result, UDP Relay listeners and the empty
TCP 443 listener query. The production LACK and Tailscale services were not
restarted or reconfigured. These checks do not substitute for a full Relay
throughput test or production functional acceptance.

## Evidence

Ignored local evidence directory:
`.superpowers/sdd/2026-10-12-oidc-native/native-oidc-7533081-42e70ca9/`.
Retained remote artifacts: `/var/tmp/chunlack-oidc-7533081-42e70ca9`.

| File | SHA-256 |
| --- | --- |
| inputs.json | fd4818e7812df1f8143fd32da1f203a5df241f44a800b7993ea090445cd4c40d |
| baseline.json | 2a9eba13dcf362333002ffb3b9a8c2e80983c8430c36994e1e66baae96c9581e |
| postflight.json | 2a9eba13dcf362333002ffb3b9a8c2e80983c8430c36994e1e66baae96c9581e |
| result.json | c950728f1a43a78cf10a51f84bcaea3d9db6f4bacae79280b0cb60fde2dd41e1 |
| oidc-login.tap | a7652e5dfb4dd9f155410f7b183cd8d8ff5553de34169546d34ed5cf4d08dedf |
| oidc-review-regressions.tap | dd2ec863a1faaaae52e7de1f2623eb1ee79cce2fd1d30237085049b2f05c5c91 |
| identity-session.tap | 046ed59ded9c8e24f2bc2928d01c87c526f52c46a27fd0cbc5da895d620ded9b |

## Remaining delivery work

Pocket ID administrative login is deferred at the user's request. Creation of
the independent ChunLACK client is authorized, but has not occurred. Real
browser login and owner binding remain unverified. Native runtime/HTTPS,
backup/restore and workspace integration evidence must be matched to the
current candidate rather than inferred from these 45 tests. Agent OAuth and
Muse/dots end-to-end acceptance, real model acceptance for the delivery
candidate, and authorized production publication remain separate gates.
