# OIDC boundary repair validation - 2026-10-12

Status: approved local repairs verified; not production or full-platform delivery.
Base commit: `8440bdacb849d4f8c295c7d5485884db0ed03c37`.

## Scope and implementation

The user approved the three disclosed OIDC repairs and local/isolated tests,
then separately approved two review-discovered corrections before they were made.
No Pocket ID application, credential, production database, VPS service, Relay,
DNS, firewall, model route or dependency was changed.

- The HTTP OIDC begin route revokes the browser's previously issued session
  before starting a new attempt. An old callback cookie arriving late no longer
  retains authority or prevents the current callback through an active session.
- Bounded issuer reads await the actual response-body cancellation promise,
  including on abort. Close still has its existing two-second deadline and reports
  incomplete teardown instead of pretending an unresolved transport has drained.
- Abandoned browser records expire after five minutes. Authenticated mappings
  remain for the existing session's maximum lifetime; the 256-record cap remains.
- Successful local login restores a missing/expired browser mapping. Capacity is
  reserved only after password verification, before session persistence. Issuance
  and association registration have no intervening await. Rejected capacity
  admission therefore cannot create hidden sessions or evict existing sessions.

Product changes: `identity/oidc.cjs`, `identity/oidc-http.cjs`,
`identity/sessions.cjs`, `identity/http.cjs`.
Regression changes: `tests/oidc-review-regressions.test.cjs`,
`tests/public-runtime.test.cjs`, `tests/helpers/oidc-drain-lock-child.cjs`.

## Evidence-driven corrections

1. Before the first repair, the body-cancellation, abandoned-capacity, late-cookie
   HTTP and two packaged writer-lock cases failed; the authenticated-binding
   preservation case passed. These were behavior failures, not relaxed assertions.
2. The initial repair passed 37 focused cases and a 538-test full run, but review
   found that local login after abandoned-binding expiry lost its association.
   An approved HTTP reproduction failed with an old session still returning 200
   where rejection was required. A capacity-recovery regression also failed.
3. The association correction passed 39 focused cases and 540 full-suite cases,
   but review then found reservation occurred after session persistence. An
   approved HTTP reproduction observed an extra SQLite session row after a 429.
4. The final correction reserves before persistence and registers synchronously.
   Focused review found no further issues within these follow-up edits. Final
   tests below supersede earlier intermediate green runs for this revision.

Review was static, read-only and scoped; it is not proof that all platform
features or external integrations have been audited.

## Final verification

Windows, Node v24.19.0, Python `C:\Python\Python313\python.exe`.
`npm` was not on this shell's PATH; its attempted invocation did not run tests.
The exact Node command from `package.json` was used instead, without modifying
the test script. Previously verified portable Caddy 2.11.7 was selected through
`CADDY_TEST_BIN`; Git's `usr/bin` directory supplied OpenSSL on PATH.

| Run | Result | Duration |
| --- | --- | --- |
| Final focused identity/OIDC/runtime regression | 80/80 passed, 0 failed/skipped/cancelled | 92298.0974 ms |
| Final full repository regression | 541/541 passed, 0 failed/skipped/cancelled | 422822.6609 ms |
| Final smoke | PASS | Not separately instrumented |

```text
node --test --test-concurrency=1 --test-timeout=90000 tests/oidc-review-regressions.test.cjs tests/oidc-login.test.cjs tests/identity-session.test.cjs tests/identity-http.test.cjs tests/workspace-ui-regressions.test.cjs tests/public-runtime.test.cjs
node --test --test-concurrency=1 --test-timeout=90000 tests/*.test.cjs
node tests/smoke.cjs
```

The full run includes the HTTPS/HTTP2/WSS and packaged scenarios previously
covered by a separate supplement. The focused tests are a subset, not additional
unique tests to add to 541. No matching portable Caddy process remained afterwards.
Smoke covers real local HTTP/WebSocket, two mock model backends in one channel,
SQLite restart persistence, private binding and configuration preservation.

New HTTP tests cover a delayed old cookie, local login after OIDC expiry, wrong
password at full capacity, repeated capacity rejection with unchanged session
rows, capacity recovery, and selective revocation of the newly tracked session.

The packaged failure tests use the real generated runtime and inject only the
issuer transport. Unresolved body cancellation causes normal close and startup
rollback to fail explicitly, preserving the exact writer-lock contents. A second
writer is rejected both before and after a later successful OIDC drain. Owned
child processes exit before fixture cleanup; tests never delete a live runtime's
lock to bypass the guard. This is Windows process-level evidence, not a new
Linux/systemd test or permission to automatically remove a production stale lock.

The full suite also reruns the genuine v1 session migration and active/revoked
session restoration checks documented in
`2026-10-12-session-migration-restore-validation.md`.

## Retained evidence

Ignored local directory: `.superpowers/sdd/2026-10-11-real-1cat-provider/`.
Failure logs contain synthetic fixture data only, not live credentials.

| Log | SHA-256 |
| --- | --- |
| `oidc-three-boundaries-red-20261012.log` | `7bb7a6eeacf24d36f1f822fe8e815c0464eb4b4cbbce7a89a7cac6d4d4f40b72` |
| `oidc-binding-expiry-red-20261012.log` | `007ead5e6f1a91543919c4779d11d0a1959b86d3a7ad4c1e8027419bba2956d9` |
| `oidc-capacity-order-red-20261012.log` | `ffad94eaa8e18b4917ab949fb87a057990319ebc75c07dec50691e2f5baaa591` |
| `oidc-capacity-order-focused-20261012.log` | `6095fba9c0ae46ad83d5b84d29334d0428dd02d4490a82dca3a2ba2b3cf7a6c7` |
| `oidc-capacity-order-full-20261012.log` | `10f016475a0f9acb78184f8b69310c71c81746a33df2bc496c1e9815eb481790` |
| `oidc-capacity-order-smoke-20261012.log` | `f11986f4ca6071992a388765ca44f0a4d23d1332a8d0f6a1603c5cd04cec79cb` |

## Remaining delivery gates

Dedicated Pocket ID client configuration and real browser/user acceptance,
native Muse LaoZhen and dots XuanJi computer-task/evidence round trips, deployment
of direct provider routing, production ownership/restore policy, dependency
hardening and the final combined resource/publication acceptance remain separate
gates. Prior native measurements and the earlier direct 1Cat check are historical,
not new results for this revision. Custom OAuth remains unmounted. This checkpoint
does not authorize production cutover or establish that the whole platform is ready.
