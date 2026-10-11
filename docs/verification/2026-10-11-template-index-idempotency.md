# Template index idempotency and source-stability diagnosis (2026-10-11)

## Corrected diagnosis

The actual differing source entry in the retained 2048-entry trial inventories is `lack_repos/templates/manifest.json`, a **file**, not a directory. Only its mtime/ctime changed; its byte count and SHA256 remained identical. Earlier summaries inferred a directory from the bucket-level diagnostic and were incorrect. This correction supersedes that classification, not the failed overall trial result.

The running VPS source `/app/server.js` in release e188eae has `scanAndReindexTemplates()` unconditionally writing this manifest. `startStackWatcher()` calls it every 10000 ms. A file-specific, 20-second read-only inotify observation captured MODIFY/CLOSE_WRITE pairs at 3.332 and 13.342 seconds, with identical before/after file content and changed mtime/ctime. The observer independently reported the source filesystem as read-only inside the test namespace. This establishes the periodic identical-content rewrite mechanism; it is not a trace uniquely attributing every write syscall to a PID.

An earlier 40-second watch observed only the parent `lack_repos` directory, nonrecursively; it found no direct-child events and cannot rule out writes below `templates`. It is not source-stability proof.

## Minimal local correction

`lack.py` now compares the new serialized template index with the existing file and writes only when bytes differ or the manifest is absent. In-memory indexing, changed/removed templates, embedding/provider selection, the watcher interval, and Ollama support are unchanged. This is a bounded idempotency fix under the user's approved minimum-correction/full-retest scope, not consent to modify the running VPS release.

Four behavioral regressions run the actual embedded scanner extracted through the existing AST helper, with real temporary files. Only remote embedding is replaced by an explicit no-embedding fixture. They cover unchanged empty/populated indexes preserving exact filesystem timestamps, changed/deleted templates updating disk and memory, and recreating a missing manifest.

## Fresh test evidence

- Windows pre-fix RED: 4 tests, 2 pass and 2 expected timestamp failures, exit 1. The failures name the observable unchanged-file rewrite, not a source-text comparison.
- Windows focused run: 18/18 pass, fail/cancel/skip 0, exit 0, duration 19779.7068 ms. Includes template scanner, workspace background inference policy, root inventory coverage and review-boundary regressions.
- Windows full regression with the existing Caddy 2.11.7 binary: 493/493 pass, fail/cancel/skip 0, exit 0, duration 246765.3161 ms. These include actual local TLS/WSS fixtures, not published-domain or real external Agent acceptance.
- Smoke: exit 0, real local HTTP/WebSocket, two mock model backends, SQLite restart persistence, private bind and configuration preservation. Not real-model acceptance.
- Native Linux v24.21.0: original scanner RED 2 pass/2 expected failures; fixed scanner GREEN 4/4 pass, fail/cancel/skip 0. Transient unit `chunlack-template-index-5f52cc30-r1.service` exit 0, runtime 28.451 seconds (includes observation and an 8-second final observation hold), CPU time 1.206 seconds, memory peak 53.1 MiB as reported by systemd, swap peak 0.
- Native inputs: base commit 93d528cbf5a79376951ca530c8d385d1851af3e1; fixed lack.py SHA256 0a1608b0c8b8973b7a1ec7fc00c3653bb387f95ca9940404de72313bf83c5942. Tests use only private copied code and temporary fixtures, not a running production replacement.
- The first native harness run exited 1 because its summary parser expected TAP while Node emitted the spec reporter. Its raw log already contains the correct RED result. The bounded retry explicitly selected TAP; no test expectation, product assertion or resource budget was relaxed. Failure evidence was retained.

Native trial boundaries remained CPUQuota 10%, MemoryHigh 96 MiB, MemoryMax 128 MiB, TasksMax 32, RuntimeMaxSec 90, PrivateNetwork, PrivateTmp, NoNewPrivileges, ProtectSystem strict, source read-only, and one explicitly owned private writable trial root. No global package installation occurred.

## VPS coexistence and delivery boundary

At 2026-10-11T02:49:59.602183+00:00: LACK PID 234963 and Tailscale PID 859 active/running with NRestarts 0; LACK health HTTP 200; the existing IPv4/IPv6 UDP 40000 listeners still belong to PID 859; no TCP 443 listener; production release remains e188eae; available memory 1114232 KiB and used swap 0. All own observation/test units were terminal with MainPID 0. Only the failed own harness unit's failed flag was cleared; SSH closed. This does not prove real Relay traffic quality.

The local fix has **not** been deployed. The original 2048-entry real-root archive/restore trial remains overall failed on exact source stability; passing scanner regressions do not replace that trial. Flags remain migrationReady=false, restoreReady=false, applicationConsistency=not_proven. No production stop, restart, cutover, new listener, credential, DNS, or Relay configuration change occurred.

A requested, separately approved LACK-only controlled maintenance window is still needed for consistent source capture; the request includes a maximum two-minute access interruption, independent timed recovery of the original service, and explicitly excludes Tailscale interruption and new-release cutover. Do not execute this pause until the user grants that specific window. Real application recovery, actual owner bootstrap, public TLS/login and actual external Agent/model workflows remain required delivery gates. The overall delivery goal is active, not achieved.
## Independent bounded review

Raman completed read-only static review of the scanner patch and its four regressions against 93d528c: no actionable findings. Remote embeddings were not tested in these fixtures; vectors are still recomputed by the existing scanner and genuinely differing vectors may legitimately cause a rewrite. Static review does not replace the coordinator's actual test outputs or production acceptance.
