# Authorized maintenance-window archive verification

Date: 2026-10-11. Archive implementation revision: `d18b97332e55d166100aaa9afd66c0390b62c0f4`. Production remained at `/opt/chunlack/releases/e188eae`.

## Authorization and protections

The user explicitly approved the previously described LACK-only maintenance window of at most two minutes. This run did not authorize a production upgrade, repeated maintenance windows, data ownership reassignment, credential changes, or vendor enrollment.

Before stopping production, the operator checked service health, Relay ownership, free memory/disk, the existing Node/native dependencies, input hashes, and the original release and service-file hashes. An independent systemd timer was tested and then armed to stop only the owned trial and start the original `chunlack.service` after 75 seconds if necessary. Recovery did not depend on an interactive SSH connection remaining open.

The first empty timer did execute successfully according to its own journal, but systemd immediately garbage-collected the completed transient unit. Polling its exit properties then returned default zero timestamps, causing the operator harness to fail before any production stop. The revised dry run wrote an execution marker only inside its owned private directory, verified it, and cleaned up its own timer. It did not waive the recovery-protection gate. Both attempts are retained as operator evidence.

## Actual results

- Preflight UTC: `2026-10-11T03:28:22.552051+00:00`.
- Production stop completed in 0.025 seconds. Original service health returned HTTP 200 46.378 seconds after the stop command began.
- Native archive/independent-restore unit exited 0. The source inventory was unchanged across the complete archive and restore checks, including file identities, metadata, bytes and SHA-256 values.
- Source coverage: 1344 entries, comprising 515 files and 829 directories, totalling 9734656 bytes. Snapshot payload: 1349 typed entries, including derived archive/candidate entries; these two counts have different scopes.
- Snapshot ID: `03c9eef3-d3c0-4ad1-be48-18f49de05cf5`.
- Snapshot manifest SHA-256: `e4ba04e452c9aa398ffd41db54e60e4e88f0caf2ed753120de8f13bce1061cd3`.
- Independent restore trial ID: `9cceac43-1ea4-410d-a085-049f02e112a1`.
- Actual file/directory copies were independently checked, not just compared through a manifest. Restored SQLite integrity and foreign-key checks passed, and table counts matched: agents 1, messages 13, and zero rows in agent_memory, loop_health, pipeline_results and project_states.
- Snapshot/restore paths were root-owned, private 0700/0600 and link-free. Original SQLite was not opened as a database by the archive helper; its private copied database was used for inspection.
- Trial limits observed: 0.1 core, MemoryHigh 96 MiB, MemoryMax 128 MiB, TasksMax 32 and runtime limit 60 seconds. Original source was read-only in the trial namespace; trial networking was disabled.
- Observed memory peak: 77987840 bytes (about 74.4 MiB). CPU usage: 3.635578 seconds. Swap peak: zero. These are operator observations, not a sustained-capacity benchmark.
- Postflight UTC: `2026-10-11T03:34:05.355706+00:00`. Original LACK and its homepage/health endpoints returned HTTP 200. LACK PID changed from 234963 to 594652 as expected for the authorized manual stop/start; NRestarts remained zero.
- Tailscaled remained PID 859 with NRestarts zero. IPv4/IPv6 UDP 40000 ownership/listeners stayed unchanged throughout the operator checks. Unit-file hashes and original release symlink target were unchanged. No TCP 443 listener was added.
- All owned trial and recovery/dry-run units were inactive with no retained main process. The recovery timer was canceled after original health was restored. SSH and SCP sessions completed and closed.

## Private evidence and retention

The owned VPS root is `/var/tmp/chunlack-root-v2-20261011-57c03a6e`. It retains the code archive, owner marker, preflight/postflight, timer evidence, source inventories, snapshot, independent restore, native log and maintenance result. Do not delete it as disposable test output: it currently holds the accepted real-data backup. `/var/tmp` is not an off-host backup and its retention depends on server policy; a separately authorized durable/off-host copy remains advisable before production migration.

Inputs were checked against these values before extraction:

- Code archive: 3983360 bytes, SHA-256 `8623bb9d8c01064f04de2b9a4ada02eb7c172a791c346126a2baf0ade1576d5d`.
- Private driver: SHA-256 `ca88642f839e241fc4acb8f36bd5517476f6a162fd42a0357bbe0b508365e6f5`.

The ignored local operator directory retains `maintenance-control-57c03a6e.py` and `maintenance-57c03a6e-result.json`. The downloaded result was independently asserted to satisfy source coverage, service recovery within 120 seconds, retained original release/configuration, unchanged Relay identity, table counts and the still-false migration flags. Production data and credentials were not committed or uploaded to GitHub.

## What this does not prove

This completes the bounded original-root archive and independent offline file/database restore gate that earlier online trials failed. It does not replace or erase those failed trials.

The original service was restarted against its unchanged original data, not switched to the restored copy. Therefore restoring an application from the backup, reviewed ownership migration, new-runtime recovery/rollback and production business acceptance remain separate gates. The snapshot and restore reports intentionally retain `migrationReady=false`, `restoreReady=false` and `applicationConsistency=not_proven`.

No real model request or vendor Agent task ran during this maintenance test. Relay process/listener stability is not proof of real forwarding latency or packet-loss stability; traffic-based coexistence acceptance remains outstanding. The template-index product fix was not deployed. No new public port, DNS change, credential change or external account connection occurred.
