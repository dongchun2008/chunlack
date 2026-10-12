# Test-boundary revalidation checkpoint

Status: local full regression passed; Linux acceptance remains incomplete.
This is not a production release or a complete ChunLACK delivery declaration.

## Approved changes

- Added test-only bounded cleanup for owned public-runtime ChildProcess objects.
  STOP receives a five-second grace period, followed by SIGKILL of that exact
  child and a three-second exit deadline. Forced cleanup remains a test failure.
  No product shutdown, writer-lock or process-selection policy changed.
- Added three real-child regressions: graceful exit, forced cleanup without
  killing an independent child, and cleanup after an already completed exit.
- Browser login alone receives ten seconds under CHUNLACK_TEST_LOW_CPU=1;
  the default remains three seconds. Other request budgets remain unchanged.
  The complete browser test limit is 90 seconds in low-CPU mode and 85 seconds
  in normal mode.
- The POSIX snapshot recovery fixture explicitly makes its copied snapshot
  root 0755 and asserts snapshot_permissions_invalid. It then sets only the
  owned copy's directories to 0700 before the existing positive restore and
  archive-preservation assertions. Source snapshots and product checks remain
  unchanged. Windows does not exercise POSIX permission assertions.

## Current results

| Run | Tests | Pass | Fail | Cancelled | Skipped | Exit |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Windows focused boundaries | 31 | 31 | 0 | 0 | 0 | 0 |
| Windows complete suite | 552 | 552 | 0 | 0 | 0 | 0 |
| Linux isolated candidate, 16 groups | 136 | 134 | 2 | 0 | 0 | 1 |

The Windows complete run used the repository's serial test command with its
90-second per-test ceiling and TAP output. Duration: 359115.8144 ms. No manual
process termination was needed during this run. Smoke exited zero and exercised
real HTTP/WebSocket, two **mock** model backends in one channel, SQLite restart
persistence, private binding and configuration preservation. This is not real
provider or external Agent acceptance.

Linux batch: native-candidate-6666cbcbdf11. The runner requested the unchanged
CPUQuota=10%, MemoryMax=192 MiB, MemoryHigh=160 MiB, no swap, private network,
PrivateTmp, non-root identity and a 240-second per-group service deadline.
Candidate sources and production dependency mappings were read-only; only the
owned scratch/results directories were writable. Production dependencies were
not upgraded. The input manifest captures the base revision and candidate file
hashes. The runner's legacy scope label still says 133; the actual explicit
group counts total 136 after adding three cleanup tests.

All boundary groups passed: owned cleanup 3/3, browser 2/2, public runtime 17/17
and snapshot root coverage 9/9. Dependency security 7/7, OIDC login 11/11,
OIDC review 12/12, identity/session 22/22, packaged HTTPS 3/3, workspace ingress
3/3, migration 24/24, snapshot 8/8, closed WAL 1/1, snapshot review 3/3 and
restore trial 7/7 also passed.

The standalone public-ingress group passed 2/4. Its two failures were:

- real Caddy TLS ingress enforces routing, raw path boundaries and trusted proxy headers
- real Caddy negotiates verified HTTP/2 and forwards WSS without changing the browser host boundary

Both failed in execFileSync(openssl) with ETIMEDOUT while creating temporary
RSA-2048 test certificates, before their TLS assertions ran. The existing
certificate-generation limit is 5000 ms. No TLS security assertion was removed
or bypassed. Increasing that test-only low-CPU budget is proposed separately;
it has not been implemented at this checkpoint. The batch is not accepted.

## Production coexistence observations

Every group and the final check retained the baseline: chunlack.service and
tailscaled.service active with unchanged main PIDs, existing LACK /health 200,
Relay UDP 40000 listeners present, no TCP 443 listener. These observations do
not measure actual Relay forwarding quality. No production cutover, existing
service restart, public port, DNS, firewall or credential change occurred.

## Preserve earlier failed evidence

The previous complete Windows run had 549 tests, 536 pass, 12 fail and one
cancelled test. It required manual termination of one verified owned test
helper after the runtime Events timeout and is not clean unattended acceptance.
The earlier Linux batch had 133 tests with 131 pass and two failures in browser
login and snapshot permissions. Those records are retained, not overwritten.
The new results supersede neither the history nor the remaining delivery gates.

## Evidence hashes

Files are retained locally under .superpowers/sdd/2026-10-12-dependency-hardening;
raw runtime artifacts and private files are not committed.

| Evidence | SHA-256 |
| --- | --- |
| boundary-focused.tap | b9e1c9b55ecce3bfc7536a8fff931982b4af2edba1a36311f97340a3de8708cf |
| full-suite-boundary-fixed.tap | eef988b99e0a1bb844f571879b8100f401764f1697367d3eb6a76ce0df66c7ba |
| smoke-boundary-fixed.log | f11986f4ca6071992a388765ca44f0a4d23d1332a8d0f6a1603c5cd04cec79cb |
| native-candidate-6666cbcbdf11/result.json | 90d2b3ac69195392439311515c459ddd3af73f316581c09391a7dba3c3ad6529 |
| native public-ingress TAP | 4686f8216bad15d0ac02743d424e7a15b798fe3b1fa5e86ef262f3be9641a98f |
| native snapshot-root-coverage TAP | 72c7a3384ffacca9d8345d618ee01a5c7881e31edf17f4f7440e821c1b2f240a |

## Remaining gates

- Complete Linux acceptance, including both real TLS tests, within the existing resource limits.
- Keep the dependency/runtime candidate local until acceptance; synchronize this evidence checkpoint only.
- Confirm revocation/replacement of the previously exposed new Pocket ID secret through the approved private-file workflow; do not reuse the exposed value.
- Complete formal-account, direct-provider, Muse Laozhen and dots Xuanji real end-to-end acceptance before claiming delivery.
- Production release remains separately gated; this run does not consume or renew a maintenance window.
