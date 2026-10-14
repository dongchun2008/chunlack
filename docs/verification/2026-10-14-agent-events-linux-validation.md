# Agent event chain: constrained native Linux validation

Date: 2026-10-14
Tested source revision: d6a68089f631843666a994dbd1bcabd06b34daf1

## Result

Two sequential, independently bounded Linux batches passed:

| Batch | Tests / pass | Fail / cancel / skip / todo | TAP duration | Peak memory |
| --- | --- | --- | --- | --- |
| Storage, grant binding, ciphertext | 24 / 24 | 0 / 0 / 0 / 0 | 12504.501801 ms | 43814912 bytes (41.79 MiB) |
| Runtime, MCP HTTP, legacy runtime | 28 / 28 | 0 / 0 / 0 / 0 | 22898.346647 ms | 66228224 bytes (63.16 MiB) |

Both units reported success and exit status 0. Their actual systemd limits were
checked, not inferred from the intended command. These 52 selected native tests
are not a full Linux run of the 763-test Windows suite.

## Isolation and resource boundaries

- Existing Linux Node v24.21.0; no global package installation or upgrades.
- Each batch: MemoryMax 192 MiB, MemoryHigh 160 MiB, no swap, CPUQuota 10%,
  TasksMax 32, RuntimeMaxSec 90, and a 112 MiB Node old-space limit.
- Unprivileged nobody/nogroup, NoNewPrivileges, PrivateNetwork, PrivateTmp,
  ProtectHome and read-only system/source paths. Only the batch's own
  results/scratch directories were writable.
- No public port used. HTTP listeners existed only in the private test network.
- Tracked source and the pure-JavaScript dependency were uploaded with SHA-256
  verification. The existing native SQLite dependencies were copied into the
  owned test directory with version and per-file hash checks. Production files
  and permissions were not changed.
- Batches ran serially, not concurrently. Only each owned transient test unit
  was stopped. Local reports and isolated remote evidence were retained.

## Existing-service safeguards

Read-only preflight found about 961 MiB available memory, low load, and adequate
temporary disk space. Preflight and postflight required the old LACK, public
LACK candidate, HTTPS service and tailscaled to remain active. Their PIDs and
restart counters were identical before and after each batch.

The old loopback health endpoint returned status `ok`; the public HTTPS health
endpoint returned 200 through local resolution with certificate validation.
The Relay UDP 40000 listener output was unchanged. No existing service was
stopped, restarted, reconfigured or replaced, and no credentials, DNS, firewall
or public listener configuration was modified.

These checks establish the observed service/process/health/listener invariants.
They are not a measurement of Relay forwarding throughput or packet loss.

## Local evidence

- Storage unit: `chunlack-agent-events-storage-91404d34f2.service`
- Storage report:
  `.superpowers/sdd/2026-10-13-release-preparation/chunlack-agent-events-storage-91404d34f2-report.json`
- Storage report SHA-256:
  `69d6e21ac8d62645bfeae3263ada96ea9e784ae74462f38a0e3e63be2a62ea63`
- Runtime unit: `chunlack-agent-events-runtime-023f654e8e.service`
- Runtime report:
  `.superpowers/sdd/2026-10-13-release-preparation/chunlack-agent-events-runtime-023f654e8e-report.json`
- Runtime report SHA-256:
  `baea52741bf21595d55c1b693c9b4829fa597a333321725d638225452375063a`

The ignored reports contain TAP output, source/dependency hashes, effective
resource limits, and pre/post service checks. Neither report claims a native
vendor computer executed a task.

## Not accepted by this run

Production Agent OAuth assembly/enrollment, public protected-resource discovery,
restore/activation invalidation, and real Muse/dots task execution remain
separate gates. JWT/JWKS data and external callback DNS/HTTPS are fixture data;
local HTTP and Linux SQLite execution are real. Peak test memory is not a
five-Agent sustained workload limit. No production deployment was performed.
