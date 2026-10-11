# Pocket ID repair checkpoint: not release-ready

Scope: approved local/isolated OIDC shutdown, cross-tab authentication, fixture
cleanup and migration/restore corrections. Base:
`329a5b89ce173302c226f9d4eccdb08d02a16bfc`. No production deployment.

## Implemented and tested

- OIDC owns cancellation and tracks fetch/begin/finish operations. Close waits
  up to two seconds before reporting incomplete shutdown. Generated-runtime
  normal-close and startup-rollback tests cover cooperative stalled exchanges.
- Browser generations invalidate pending exchanges/proofs after successful
  local authentication. A newer successful login revokes the previously tracked
  session. Stale callbacks no longer clear a newer binding cookie.
- SQLite fixture ownership closes the migrated store before directory cleanup.
- A frozen pre-OIDC v1 schema from
  `0f4760047f96410403b3472b4fa82661b5d3f0b9` exercises actual copy migration.
  Source identity/main/WAL hashes stay unchanged; only the candidate becomes v2.
- Snapshot/restore preserves active/revoked identity links and a revoked session.
  Revoked identity resolution/session minting stay denied. Archive activation
  remains false; behavior checks use a separate working copy of the restored DB.

## Test evidence

Windows, Node v24.19.0, Python `C:\Python\Python313\python.exe`.

| Run | Result | Duration |
| --- | --- | --- |
| Focused OIDC/identity | 69 total, 69 pass, 0 fail/skip/cancel | 46626.5223 ms |
| Extended OIDC/migration/runtime | 44 total, 43 pass, 1 fail, 0 skip/cancel | 290153.2486 ms |
| Full regression | 532 total, 525 pass, 0 fail, 7 skip, 0 cancel | 436329.8978 ms |
| `node tests/smoke.cjs` | PASS | Not separately instrumented |

```text
node --test --test-concurrency=1 --test-timeout=90000 tests/*.test.cjs
```

The extended failure was the existing legacy-writer-guard test's nested Node
process exceeding its unchanged 5000 ms deadline: ETIMEDOUT, empty stdout/stderr.
Its matching owned processes were not observed afterwards. The unchanged test
passed in the full run. This does not establish the intermittent timing cause
or erase the earlier failure; no deadlines or assertions were relaxed.

Seven skipped tests cover real Caddy TLS/HTTP2/WSS and packaged HTTPS multi-user,
five-node scenarios. Skips are not current acceptance. Historical Linux fixture
results are not a retest of this revision. Smoke covers real local HTTP/WebSocket,
two mock model backends, SQLite restart persistence, private binding and config
preservation, not real Pocket ID or native vendor Agents.

Ignored evidence directory: `.superpowers/sdd/2026-10-11-real-1cat-provider/`.

| Log | SHA-256 |
| --- | --- |
| oidc-repair-focused.log | a55c53055f6888607820a425b0aa067767e5428ba1f8aec6d2e816431395f78f |
| oidc-repair-extended.log | 00bd86c4f88c1baca5204258b70def716e487a9326cca714cd1add2fdbd32646 |
| oidc-repair-full.log | a7c0d5a4aad1a38362c37f872718c490cc09ce6b43f470cad669023c1264faf2 |

## Fresh independent review: release blockers

1. **Residual already-issued callback/newer-begin race:** begin invalidates
   generation but leaves the previously tracked session valid. A delayed old
   successful response can install it after another begin. Passing coverage
   currently addresses newer successful login, not this newer-begin case.
2. **Incomplete response-cancellation drain:** the abort handler discards the
   `reader.cancel()` promise. A local synthetic stream with delayed cleanup
   reproduced `CLOSE_RETURNED_BEFORE_BODY_CANCEL_SETTLED=true`.
3. **Introduced browser-capacity exhaustion:** cookie-less begins allocate
   12-hour records even though pending transactions expire after five minutes.
   A local fake-clock diagnostic accepted 256 abandoned begins; after all pending
   states expired, the next browser still returned `rate_limited`.

The latter two diagnostics made no live issuer/network requests. All three
findings remain important blockers, not cosmetic deferrals. Additional explicit
correction approval was requested; these repairs are not part of this checkpoint.
A green suite does not supersede independently reproduced missing cases.

Additional gaps: the genuine v1 fixture contains no existing sessions; snapshot
coverage lacks authentication using an active restored session; packaged-runtime
tests do not inject an uncooperative OIDC drain to prove writer-lock retention.

## Rulings and boundaries

- Keep browser binding in a Secure/HttpOnly host-only cookie and generation plus
  session IDs in bounded process memory, not provider bearer tokens. The current
  abandoned-record lifetime is flawed and must be corrected before release.
- Reject authority from a revoked stale response even if this may require a
  fresh login; preserving obsolete authority is not a usability workaround.
- Preserve prior failures alongside subsequent passing runs. Do not change
  startup deadlines without cause evidence.
- No Pocket ID client/credential change, production DB upgrade, DNS/firewall or
  listener change, VPS restart or Tailscale Relay modification occurred.
- Ollama/provider neutrality is unchanged. No Open WebUI integration was added.
- Dedicated Pocket ID real login, native Muse LaoZhen/dots XuanJi authorization
  and computer-task/evidence round trips, dependency hardening, resource budgets
  and publication remain separate gates. Custom OAuth remains unmounted.

This is a development checkpoint, not delivery or authorization to enable
production OIDC. The long-term objective is unfinished.
