# Legacy Root Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Preserve bounded legacy-root files and empty directories without assigning or activating unknown data.

**Architecture:** Extend the existing snapshot and independent restore functions with version 2 records and source coverage. Keep version 1 readable with an explicit partial-scope result. Adapt actual migration/recovery consumers to retain directories in quarantine rather than enabling unknown archives.

**Tech Stack:** Node.js, built-in filesystem/crypto, existing better-sqlite3; no new dependency.

**Spec:** docs/superpowers/specs/2026-10-11-legacy-root-archive-compatibility-design.md

## Global Constraints

- Maximum 4096 source entries and 4096 payload records, including directories; 64 MiB/file, 512 MiB total, source depth 12, manifest 2 MiB.
- Linux private directories 0700, files 0600; Windows ACL proof remains unknown.
- Reject linked/special entries, path escape, source changes and unsupported versions.
- Keep migrationReady=false, restoreReady=false, applicationConsistency=not_proven for preparation and independent restore.
- Do not change production, credentials, Relay, DNS, public listeners or model routing.
- Human owner/workspace remain pending; archive success cannot approve migration or delivery.

## Review Focus

- Unknown config/db entries and files named .db must remain opaque private archives.
- Source directory creation/removal/replacement must invalidate preparation, even when file bytes do not change.
- Resealed metadata cannot omit required coverage, introduce directories or enable activation.
- Version 1 compatibility must be tested with an independently built old-format fixture, not a v2 round-trip.
- Restore and migration consumers must preserve empty directories and verify retained quarantine.

## Task 1: Snapshot v2 and independent restore

**Files:** scripts/workspace-snapshot.cjs, scripts/workspace-restore-trial.cjs; new tests/workspace-snapshot-root-coverage.test.cjs.

**Interfaces:** Preserve prepareWorkspaceSnapshot({sourceRoot,snapshotRoot}), verifyWorkspaceSnapshot(root), prepareWorkspaceRestoreTrial({snapshotRoot,restoreRoot}), verifyWorkspaceRestoreTrial(root). Add formatVersion, scope, entryCount/directoryCount and offline verification boundary to returned summaries without exposing contents.

- [ ] Write real SQLite/filesystem fixtures proving unknown memory/repository/config/db files and empty directories survive snapshot and restore.
- [ ] Run the new test file; expect absent archive/empty-directory behavior to fail against current code.
- [ ] Implement full bounded source inventory, canonical database support policy, v2 records and version-dispatched verification. Explicitly record all payload directories and verify source-to-target coverage.
- [ ] Adapt independent restore to both formats and fail closed on unsupported versions.
- [ ] Run snapshot, closed-WAL and restore tests with concurrency 1 and timeout 90000; expect zero failures.

## Task 2: Existing consumers and regression

**Files:** scripts/workspace-migration-engine.cjs, scripts/workspace-migration-recovery.cjs; the new coverage test and existing migration tests.

**Interfaces:** Consumers use the verified snapshot and its typed records; directory records have no bytes/hash. Unknown archive bytes are never opened as SQLite or copied to active workspace paths.

- [ ] Exercise reviewed recovery of a failed synthetic candidate retaining a v2 snapshot, including opaque .db bytes and empty directories.
- [ ] Preserve directory records in quarantine, account only file bytes, verify retained snapshots on publication checks, and avoid SQLite inspection of archive/legacy-root files.
- [ ] Run focused snapshot/restore/migration/recovery regressions; expect zero failures and no production effects.
- [ ] Run the complete package test command and smoke with existing Node; record actual counts, failures and terminal exit codes.
- [ ] Obtain independent review, address substantive findings only within authorized scope, and report remaining gaps.

## Task 3: Bounded native acceptance and synchronization

**Files:** new verification report and implementation status evidence; private trial artifacts stay ignored.

- [ ] Revalidate VPS baseline and deployment constraints before any new isolated trial.
- [ ] Use a new owned private root/unit with CPUQuota 10%, MemoryHigh 96 MiB, MemoryMax 128 MiB, TasksMax 32, RuntimeMaxSec 90, no network and read-only production data; stop if conditions are insufficient.
- [ ] Verify complete bounded source coverage, private payload permissions, empty directory recovery, database integrity and unchanged production/Relay PIDs, restart counters and health.
- [ ] Record unsupported/busy/oversize source conditions explicitly rather than claiming full backup; application consistency and real Agent/model acceptance remain open.
- [ ] Synchronize only authored code/tests/docs to cloud-agent-pilot-foundation, excluding credentials, copied data and private trial logs.

## Execution ruling

The user explicitly approved this design and instructed development/testing on 2026-10-11. Execute the described scope inline without another redundant permission round. New production activation or ownership assignment is not implied. No completion claim substitutes for the full original delivery goal.

## Progress 2026-10-11

- Snapshot/restore v2 and coordinated consumers implemented; independent review findings reproduced and repaired.
- Windows full regression with existing Caddy: 489/489 pass, zero failure/skip/cancel; smoke exit 0.
- Human-approved workspace/login: ChunLACK / chunlack-owner; account creation still pending, no password initialized.
- Native real-root trial failed closed before any snapshot: conservative 256-entry trial bound, not product's 4096-entry bound.
- Bounded read-only metadata proved 1344 entries / 9734656 bytes. Await explicit approval of a 2048-entry trial bound without raising CPU/memory/time/bytes or changing production.
- Real 1Cat direct generation and two isolated ChunLACK provider requests observed; restart of local task history remains an uncovered delivery gap, not a fully passed pilot.
- Production, HTTPS activation, application recovery, vendor-owned Agent execution and Relay traffic acceptance remain incomplete.
