# Actual-backup native workspace conversion

Date: 2026-10-11. Executed code: `95c70de51de569cd04f3c1bf60d6b2b944eac530`.
This is isolated verification, not a production deployment or owner assignment.

## Inputs and verified boundaries

- Durable snapshot: `/var/backups/chunlack-root-20261011-57c03a6e/snapshot`.
- Snapshot ID: `03c9eef3-d3c0-4ad1-be48-18f49de05cf5`.
- Manifest SHA256: `e4ba04e452c9aa398ffd41db54e60e4e88f0caf2ed753120de8f13bce1061cd3`.
- Git archive SHA256: `ccbfa2050383fd972aaa4b834f86db5ddae1400241ce405ba7c1275b2f60a157`.
- Owned test directory: `/var/tmp/chunlack-actual-migration-20261011-7fd316ba`.
- Native runtime: existing Node v24.21.0 and dependencies, no global installation.
- Private network namespace, CPU 10%, memory high/max 160/192 MiB,
  tasks 32, runtime maximum 180 seconds, writes only inside the owned directory.
- Original data root inaccessible; durable snapshot read-only. SQLite temporary
  files constrained to the owned `scratch` directory.

## Observed conversion and recovery

- Native controller and test exited 0. Report completed at
  `2026-10-11T04:43:13.952Z`; elapsed 126.011 seconds.
- Peak cgroup memory 138752000 bytes (132.324 MiB), swap peak 0;
  CPU time 12.479 seconds. These are conversion-test measurements, not a
  sustainable five-Agent concurrency benchmark.
- Source inventory: 1344 entries, 515 files.
- All 13 messages and the one Agent retained their checked fields and counts.
  Independent whole-table checks excluded extra/NULL/foreign-workspace rows.
- Three fixture users, two fixture workspaces and exactly four membership
  bindings independently matched. No live human account was created.
- Twelve unclassified roots stayed in private quarantine, not active workspace
  content. The known active-file map independently matched 25 files.
- Every one of 1349 recovered payload records matched type, size and SHA256;
  restored legacy message semantics and configuration hash matched.
- Applying the same approved fixture plan again verified idempotently.
- Source and durable snapshot full inventories remained unchanged.
- A separate final check matched the complete 315-entry code tree to the Git
  archive, including absence of extras and symlinks, and checked its PAX commit.
  No ancestor `node_modules` shadow was present.
- Final service check: successful owned test unit inactive/not-found, PID 0;
  failed first-attempt unit retained failed state with PID 0.

## Original-service observations

Before/after original LACK PID 594652 and Tailscale PID 859 remained active/running
with restart count 0. Their service-file hashes matched, LACK health returned
200, Relay UDP 40000 listeners remained present, and TCP 443 remained unused.
These checks do not measure packet loss, Relay throughput or user-visible latency.
No original service was stopped or reconfigured for this trial.

## Failures retained and review limits

The first attempt exited 1 at snapshot opening: `ProtectSystem=strict` made
the default `/tmp` read-only (`EROFS`). No conversion directories had been
created. The correction set `TMPDIR` to the private writable scratch directory,
without broadening filesystem or network permissions. Original outputs remain;
the failed native report is `trial-report-attempt0.json`.

An incorrectly quoted preparation command failed before mutation. An
unauthenticated intermediate retry SSH was cancelled before it launched a job.
A later SCP evidence download closed at authentication; the complete sanitized
host report was instead obtained over a fresh pinned-host-key SSH check.

Static review's code-extra-file evidence gap is closed by the separate exact
inventory check. Parsing a truncated native JSON report remains a future harness
hardening item: that exceptional path was not fault-injected in this successful
run, and must not be described as verified cleanup behavior.

## Not yet accepted

`authenticatedRuntimeBusinessVerified`, `productionCutover`, `liveOwnerCreated`,
`realModelAcceptance`, `vendorAgentAcceptance` and `restoreReady` are all false
in this conversion report. Historical ownership is fixture-only, not inferred
from message authors. Unknown memory/repositories are archived but not activated.
Authenticated actual-backup runtime business, live ownership and fresh cutover,
public HTTPS/login, real backend routing and true Muse/dots execution remain
separate delivery gates. The previous full 497/497 plus smoke result is recorded
in `2026-10-11-migration-root-guard-approved.md`; it is not vendor acceptance.
