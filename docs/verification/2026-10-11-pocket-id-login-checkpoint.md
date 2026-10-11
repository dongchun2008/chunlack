# Pocket ID login checkpoint: NOT RELEASE READY

Date: 2026-10-11. Parent revision: `0f4760047f96410403b3472b4fa82661b5d3f0b9`.
This is a development checkpoint, not a successful delivery or deployment.

## Implemented, not accepted

- Pinned `openid-client` 6.8.8; three small JS dependency additions. Installation
  used `--ignore-scripts --no-audit --no-fund`, with no global/VPS install.
- Opt-in human OIDC relying party with S256, state/browser binding, nonce,
  RS256 signature checks, fixed issuer/audience and short single-use proofs.
- Existing local sessions/workspace permissions reused; provider tokens are
  discarded. Explicit issuer/subject links are stored in identity schema v2.
- v1 upgrade requires an explicit migration flag and public runtime requires
  v2; the isolated migration engine enables migration on its target copy.
- Login link, exact callback route and setup guide added. The earlier custom
  authorization server remains unmounted and unaccepted.

## Executed tests

Environment: Windows, Node v24.19.0; Python explicitly set to
`C:\Python\Python313\python.exe`. All model/OIDC fixtures here are synthetic.

| Run | Total | Pass | Fail | Skip | Duration |
| --- | ---: | ---: | ---: | ---: | ---: |
| OIDC + identity store/session/HTTP focused | 67 | 66 | 1 | 0 | 41.807 s |
| Entire node:test suite | 523 | 514 | 2 | 7 | 461.004 s |
| Browser fixture unchanged isolated recheck | 1 | 0 | 1 | 0 | 15.610 s |

Commands:

```text
node --test --test-concurrency=1 tests/oidc-login.test.cjs tests/identity-store.test.cjs tests/identity-session.test.cjs tests/identity-http.test.cjs
node --test --test-concurrency=1 --test-timeout=90000 tests/*.test.cjs
node --test --test-concurrency=1 --test-timeout=90000 tests/workspace-browser-fixture.test.cjs
```

The initial RED test failed on the absent OIDC module and missing migration
behavior. Protocol tests passed after implementation, but the focused suite
is NOT green due to the cleanup failure below. No all-green full-suite claim.
Seven gated tests remained skipped; these are not seven passes or live TLS proof.

Failures:

1. `tests/oidc-login.test.cjs:118`: the added migration test registers its opened
   store's close hook after the fixture directory cleanup. Windows refuses
   removal with `EPERM`. The test must register that store with fixture ownership
   so it closes before directory removal. This correction has been requested,
   not applied in this checkpoint.
2. `tests/workspace-browser-fixture.test.cjs:7`: full run failed on the packaged
   child's readiness deadline; isolated recheck failed on the outer readiness
   deadline. The first retained synthetic startup log contained no usable output.
   The helper polls for approximately five seconds and the outer test allows ten
   seconds, but those bounds alone do NOT establish the root cause. Do not merely
   increase timeouts or claim transient recovery. Collect bounded startup-stage
   evidence and confirm all owned child processes are cleaned up before rerun.

Retained ignored logs under `.superpowers/sdd/2026-10-11-real-1cat-provider/`:

| File | SHA-256 |
| --- | --- |
| oidc-login-focused.log | 8fa5ad6dced12edecfb834fa396a38e151d9922db8f5aa359f9bec1f672e55e3 |
| oidc-full-regression.log | 41db48728c18bbabf3bd72e41949b6529acbf4abd19d581c745a52cef2efb596 |
| oidc-browser-recheck.log | 8c1bb27b5e7aa4b30ce8b212075dbe46041607535e535fea8282f078aea3c5b5 |

## Independent read-only review: changes required

Reviewer `01a12b61-2a5e-7d63-a510-427c5c9f9506`; no edits, network or tests.
These are source-traced findings, not reproduced live-account attacks.

1. **P2: OIDC lifecycle is not fully owned.** `lack.py` creates the OIDC service
   but does not register its cleanup. The service's close only clears pending
   records; it neither aborts nor waits for exchanges/JWKS requests. Add explicit
   cancellation and drain handling plus stalled-request startup/shutdown tests.
2. **P2: concurrent browser login can change identity.** The callback checks its
   request cookie before awaiting the exchange. A different tab can log in in
   that interval, and the delayed callback can overwrite the browser cookie.
   Existing sockets may then represent another identity. Add a server-owned
   browser authentication generation shared with successful login/logout,
   invalidate pending/in-flight transactions, and prove the delayed race fails
   closed. Rechecking only the old request header is insufficient.
3. **P2 acceptance gap: upgrade and archive fixtures.** Exercise a genuine v1
   source through isolated-copy migration; prove original source preservation.
   Round-trip active AND revoked identity links through snapshot/restore and
   prove old authority is not revived. A table-classification assertion alone
   does not establish these properties. No archive corruption was demonstrated.

User has been informed and asked to approve these bounded corrections and full
retest. Do not enable OIDC or publish this checkpoint while they remain open.

## Live-service boundaries

The earlier Pocket ID discovery HTTP 200 evidence remains valid as a historical
observation. A supplementary read-only probe in this round failed in the local
command: a `node:timers/promises` binding shadowed `setTimeout` used by the fetch
runtime. It returned no new metadata. No new claim about live RS256 support or
installed Pocket ID version follows from that probe.

No real client registration, secret retrieval, login/token exchange, production
database upgrade, DNS change, public listener, VPS service restart or Relay
modification occurred. Existing 1Cat/Ollama/provider-neutral routing was not
changed. No Open WebUI integration was added.

The preceding dependency-audit findings remain unresolved; this round did not
prove a clean audit. Real Pocket ID login, native Muse LaoZhen/dots XuanJi OAuth,
production TLS, combined resource limits, recovery and final delivery remain
pending. Preserve the active long-term delivery goal.
