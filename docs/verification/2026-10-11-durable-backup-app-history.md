# Durable retention and actual-backup application history

Date: 2026-10-11. Tested product source: committed `d18b97332e55d166100aaa9afd66c0390b62c0f4`; later branch changes before this run were documentation-only. No additional maintenance window or production switch was performed.

## Verified same-host retention

The accepted snapshot and its provenance metadata were copied to the new private root `/var/backups/chunlack-root-20261011-57c03a6e`. The original accepted snapshot was mounted read-only in a resource-limited, network-isolated unit.

- Unit: `chunlack-backup-retain-57c03a6e.service`; exit 0, host elapsed 10.077 seconds.
- Retention observation UTC: `2026-10-11T03:40:50.688100+00:00`.
- All snapshot paths, types, file bytes/SHA-256, root ownership and private modes matched the copied tree. Original snapshot inventory and identities remained unchanged.
- Actual copied snapshot tree: 1351 entries and 10834320 bytes, including snapshot metadata. These counts are not the 1344 original-source entries or 1349 typed payload records from the maintenance report.
- Manifest SHA-256 remained `e4ba04e452c9aa398ffd41db54e60e4e88f0caf2ed753120de8f13bce1061cd3`.
- Copied provenance metadata included preflight/postflight, trial and maintenance reports, before/after source inventories and recovery protection records. Each metadata copy was hash-checked. File and directory fsync operations were completed for the retained snapshot and copied records.
- Observed CPU usage 0.508876 seconds, memory peak 30412800 bytes, swap peak zero. Limits remained 0.1 core, MemoryMax 128 MiB, TasksMax 32, runtime 90 seconds and no external network.

The target is a same-host backup, not off-host disaster recovery, encryption-at-rest assurance or a guarantee against disk failure or privileged modification. The accepted temporary snapshot and failed-trial evidence were not deleted.

## Actual application check

The private root `/var/tmp/chunlack-app-restore-20261011-41e25a90` was created separately from both production and the accepted backup. The existing v2 restore API verified the retained snapshot and produced an independent payload. Candidate data and the retained unknown legacy-root entries were materialized into a writable test data root without overwriting the backup.

The current source was materialized using the existing packaging script; no global software was installed. Model execution, embedding, model auto-pull, public memory, musing, triangulation, public identity mode and the Agent gateway were disabled in the mutable test configuration. Any retained non-Ollama provider labels were represented by inert loopback endpoints rather than real credentials or upstream calls. Original configuration bytes remained retained in the frozen backup and were not used for model requests.

The original copied database supplied expected message digests and Agent metadata. The harness then started the actual packaged `startLackRuntime` implementation in legacy-compatible mode, rather than replacing its HTTP/WebSocket business handlers.

- Successful native unit: `chunlack-app-restore-41e25a90-r1.service`; exit 0, host elapsed 44.358 seconds.
- Final application observation UTC: `2026-10-11T03:48:05.643361+00:00`.
- Two separate application OS processes, PIDs 595072 and 595115, started sequentially and each exited 0 after exported shutdown.
- Both processes returned health HTTP 200 and served actual WebSocket history containing all 13 original message IDs with matching sender/type, full text, timestamp, parent/thread linkage, reply count and reactions.
- The original Agent ID, name, model and provider matched the actual WebSocket roster in both processes.
- The frozen backup's manifest, database and original configuration hashes were unchanged after both application runs.
- Observed unit CPU usage 3.915774 seconds, memory peak 100900864 bytes (about 96.2 MiB), swap peak zero. Limits remained 0.1 core, MemoryHigh 96 MiB, MemoryMax 128 MiB, TasksMax 32, runtime 90 seconds and PrivateNetwork=yes.

## Failures and correction retained

The first application unit exited 1 before materialization or application startup because its source hash expected Windows worktree bytes. The verified Git archive contains LF bytes instead of the Windows checkout's CRLF bytes.

Read-only investigation established these exact values:

- Windows worktree: 355596 bytes, 6636 CRLF sequences, SHA-256 `0a1608b0c8b8973b7a1ec7fc00c3653bb387f95ca9940404de72313bf83c5942`.
- Committed Git blob and extracted archive member: 348960 bytes, no CRLF sequences, SHA-256 `d834526d6ba05df1f8f5fdffc3e5726fc3527afcb30845933188cda788a4f6d3`.
- Normalizing only worktree CRLF to LF exactly matched the committed blob. The extracted source exactly matched its verified archive member; no foreign code change was found.

The retry used the independently derived committed-byte digest and also verified every extracted archive member against the unchanged, hash-verified archive before packaging. It did not ignore the failed gate, normalize untrusted remote content into acceptance, change product code or raise trial limits. The first failed unit/log/result remained retained; only its own terminal failure flag was reset after the successful retry.

SCP prompted separately for the two remote result paths. The first local result assertion ran before the second download completed and failed with ENOENT; after completing that same live transfer, the local assertions passed. This operator ordering failure did not affect native application results or waive their checks.

## Cohost safety and retained evidence

Final postflight UTC: `2026-10-11T03:49:16.872532+00:00`. LACK stayed PID 594652, tailscaled stayed PID 859, both NRestarts zero and active/running; LACK health returned HTTP 200. Original release `/opt/chunlack/releases/e188eae`, service-file hashes and UDP 40000 Relay listeners remained unchanged. No TCP 443 listener was added. All owned retention/application units were inactive with MainPID zero; both application child PIDs were absent. SSH and SCP sessions closed.

Private native reports/logs remain under the two owned roots. Ignored local operator artifacts retain the harness, controllers and downloaded `host-retention-result.json` / `host-app-result-r1.json`. Local assertions checked exit codes, unchanged cohost identity/health, resource/network bounds, two distinct application PIDs, original record counts and the explicit incomplete-delivery flags. No production database, model credential, password, message text or backup payload was committed to GitHub.

## Scope not completed by this evidence

This is actual-backup history recovery using the current packaged legacy-compatible runtime, not the pinned historical release and not an authenticated public multi-user migration. It does not verify new writes/edits, complete project/attachment/tool workflows, reviewed ownership, business rollback, original provider configuration connectivity, public TLS/login, five-Agent sustained rounds, vendor-native Muse/dots execution or real Relay forwarding latency/loss.

`applicationConsistency=not_proven`, `migrationReady=false` and `restoreReady=false` remain unchanged. The full delivery goal remains incomplete; these flags must not be flipped merely because the narrower history/startup checks passed.
