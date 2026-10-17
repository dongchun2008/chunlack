# Packaged fixture cancellation repair and retest

Date: 2026-10-15. Scope: explicitly approved local test fixtures and callers only.

## Changes

- Added `tests/helpers/owned-fixture-lifecycle.cjs`: register the test cleanup hook before asynchronous initialization; propagate parent/test cancellation; wait for in-flight initialization to settle; close a late-returned resource; share one cleanup promise and retain cleanup failures.
- Updated `tests/helpers/packaged-ingress-fixture.cjs`: use that ownership wrapper, check cancellation before startup allocations and commands, abort HTTPS requests and WebSockets, serialize restart settlement against cleanup, and use the existing owned-child cleanup helper for bounded Caddy exit. Preserve the fixture directory when resource cleanup fails.
- Updated `tests/helpers/packaged-agent-scenario.cjs`: propagate cancellation to the inner fixture and interrupt owned polling/cooldown waits.
- Updated `tests/packaged-public-ingress.test.cjs`, `tests/packaged-node-lifecycle.test.cjs`, and `tests/packaged-agent-rounds.test.cjs`: pass test context during construction instead of registering cleanup after construction.
- Added `tests/packaged-ingress-cancellation.test.cjs`: pre-cancellation, early cleanup registration, real loopback listener and child-process reclamation, late resource adoption, repeated close/error propagation, and actual TLS/WSS shutdown with rejection of post-cancellation operations.

Existing per-test deadlines and security assertions were not increased or removed. No product code, deployed service, credential, Pocket ID configuration, VPS or Tailscale Relay was changed.

The earlier real-listener late-hook characterization is recorded in `2026-10-15-timeout-cleanup-diagnosis.md`. This turn did not rerun that deliberately failing characterization.

## Evidence, including unsuccessful runs

1. First focused run: 6 tests, 5 pass, 0 fail, 1 cancelled, 0 skipped; exit 1; duration 110795.0263 ms. The actual packaged TLS test exceeded its unchanged 30000 ms deadline. The process exited without manual termination. A subsequent scoped process query found zero matching fixture Node/Caddy processes.
2. Unchanged TLS-only diagnostic run with an observational preload: 1 test, 0 pass, 0 fail, 1 cancelled; exit 1; duration 41965.3002 ms. The same unchanged 30000 ms deadline expired. Recorded synchronous phases included materialization 7647 ms, generated server module loading 12893 ms, OpenSSL 2150 ms and Caddy validation 1675 ms. Module timings are nested and must not be summed. This does not establish the cause of host timing variability or prove stable cold-start performance.
3. Final related run, without the observational preload: **13 tests, 13 pass, 0 fail, 0 cancelled, 0 skipped, 0 todo; exit 0; duration 115862.614 ms**. The actual TLS cancellation test passed in 19942.8831 ms. Final scoped process query found zero matching fixture Node/Caddy processes.

The final run exercised four complete five-Agent rounds with 20 synthetic model requests, three human sessions, two workspaces, five registered synthetic nodes, task lifecycle/restart recovery, HTTPS sessions/Origin/CSRF, WSS scoping and ingress separation. Registered nodes and synthetic inference are not real Muse/dots execution acceptance or production capacity evidence.

## Final related command

The existing portable Caddy executable was supplied through `CADDY_TEST_BIN`; Node was v24.19.0. `PYTHON` selected `C:/Python/Python313/python.exe`; the Node and portable Git Unix-tool directories were prepended to PATH.

```text
node --test --test-reporter=tap --test-concurrency=1 --test-timeout=90000 tests/packaged-ingress-cancellation.test.cjs tests/packaged-public-ingress.test.cjs tests/packaged-node-lifecycle.test.cjs tests/packaged-agent-rounds.test.cjs
```

TAP files are under `.superpowers/sdd/2026-10-14-agent-grant-routing/`:

| File | SHA-256 |
| --- | --- |
| cancellation-focused-2026-10-15.tap | 75aed59baa1b8426b6c5cc2e056470d29bdb370917e1f7a5ce41bf169abc9b11 |
| cancellation-startup-observed-2026-10-15.tap | f809db0d76480c877f47f84615c30209709c5643b152c53ed3daf376d2682ef8 |
| cancellation-related-2026-10-15.tap | b8d3b3af7cdb1ac749acc91499ba4a4d262db002a1bb2efdaad25b8fb1586c92 |

## Remaining gates

- This is a related-test pass, not a new full-suite pass. The whole repository suite was not rerun in this turn; previous MCP lifecycle failures and the node-field assertion remain outside this approval.
- Earlier cold-start deadline failures remain recorded. Do not reinterpret a later passing run as proof that timing variability has been resolved.
- Native vendor-Agent enrollment, real execution/receipt evidence and complete delivery acceptance remain separate pending gates.
- No release, production restart, Git commit or GitHub push was performed in this turn.
