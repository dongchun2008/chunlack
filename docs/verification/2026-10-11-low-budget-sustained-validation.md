# Low-budget sustained native business validation

## Result and scope

The isolated native trial passed. It finished at `2026-10-11T09:15:52.708Z`.
This is 30-minute acceptance of the workload below, not indefinite stability,
five-Agent inference capacity, public HTTPS, or complete platform delivery.

- Product code: `95c70de51de569cd04f3c1bf60d6b2b944eac530`.
- Its existing native source archive and all 315 code entries were revalidated
  before launch; no ancestor `node_modules` shadow was found.
- Separate local package source: `aa3db26c0918a0d02dda7b367de409069debfce6`.
  Later commits changed documentation/test fixtures, not product source.
- Corrected PowerShell archive argument composition succeeded. Materialization
  exited 0, produced a 49-file inventory, found no linked entries, and passed a
  bounded credential-pattern scan. This scan is not exhaustive secret detection.
- The local package was not started or published.

## Workload and measured results

| Item | Observed result |
| --- | --- |
| Sustained business phase | 1800.892 seconds, 180 ticks |
| Total controlled run including preparation/restart/cleanup | 1853.207 seconds |
| Synthetic human accounts / workspaces / WebSocket clients | 3 / 2 / 5 |
| Authenticated HTTP requests | 1080 |
| Sustained message writes | 30 |
| HTTP latency p50 / p95 / maximum | 2 / 70 / 249 milliseconds |
| Whole trial unit memory peak | 140886016 bytes, 134.359 MiB |
| Whole trial unit CPU time | 11.168 seconds |
| Swap peak | 0 bytes |
| Host monitor samples | 62 |
| Lowest sampled host MemAvailable | 976476 KiB, 953.590 MiB |
| Sampled memory limit/OOM events | max=0, oom=0, oom_kill=0 |
| Native and controller exit status | 0; no controller errors |

The systemd launch requested CPUQuota 10%, MemoryHigh 160 MiB, MemoryMax
192 MiB, MemorySwapMax 0, TasksMax 32, and RuntimeMaxSec 2100. These are the
recorded launch limits; applied quota/limit properties were not independently
captured in this run's property snapshot. The SSH/Python host monitor was outside
the workload unit, so the unit measurements are not total host overhead.

Five WebSocket clients are not five Agent executions. No model backend was
called: both the real-backend counter and the fixture-model guard counter were
zero. The model guard deliberately denied inference; this run does not measure
provider latency, model context size, token throughput, cloud cost, or native
Muse/dots execution.

## Business and data checks

- Three authenticated logins and four allowed membership contexts passed.
- Missing identity/context, foreign workspace access, viewer writes, forged
  privilege, missing CSRF, and wrong Origin were rejected.
- Five sockets stayed connected through the sustained phase and answered pings.
- Message sender came from authenticated identity, not forged client fields.
- Sustained workspace-B messages were delivered to its viewer and not observed
  by the three workspace-A peers at each acknowledgement check. This is the
  implemented observation scope, not an exhaustive network trace.
- Both owned child runtimes closed with exit 0 and drained log streams.
- Restart retained the three sessions, all 13 original workspace-A message IDs
  and contents, and the separately checked workspace-B marker exactly once.
- Logout revoked the selected session and closed its socket; another account
  remained authorized.
- SQLite integrity/foreign keys passed; the one legacy Agent remained.
- Frozen candidate, snapshot, recovery, materialized source, and code inventories
  remained unchanged. The operational configuration also remained unchanged.
- The 30 sustained messages were acknowledged during the run; the final SQL
  assertion checked the additional restart marker, not each of those 30 messages.

## Co-host protection and independent postflight

The controller sampled the original health endpoint and Relay listener throughout
the run. A separate postflight checked the completed reports, their relationship,
input-script hashes, original unit-file hashes, current services and listeners.
The two downloaded native report files matched the remote SHA-256 values.

- Original `chunlack.service`: PID 594652, NRestarts 0, active/running, health 200.
- Original `tailscaled.service`: PID 859, NRestarts 0, active/running; UDP 40000
  listener retained. Neither original service was restarted or reconfigured.
- Trial `chunlack-sustained-6a719ce4.service`: stopped, PID 0, subsequently
  not-found. No live test process is retained.
- Public and HTTPS service units remained not-found; TCP 443 remained unbound.
- Relay forwarding traffic, packet loss, latency and throughput were not tested.
  PID/listener preservation must not be reported as full functional Relay proof.
- No live owner account, real credentials, DNS/firewall change, certificate
  issuance, production cutover, or maintenance-window consumption occurred.

## Evidence identities

- Fixed-revision source archive SHA-256:
  `8c794b5ed2e141e68ad352edd3aecbbb89afbc844fb4cc9d62b18702648441f1`.
- Local package inventory SHA-256:
  `a88c6d1ebfa9a50874a8f1f5101671450c196fc0e34e15a827e4273a1ca57ecc`.
- Native report SHA-256:
  `553a1096208a81c8e2b94aea5b93772e514b3eaa27c12c32187f053a1eb0f310`.
- Host report SHA-256:
  `f0158949145a72ec8aa18f64279d089c878c31cda2257982b3ecab2ec23509d9`.
- Exact executed source copies and independent postflight are under
  `docs/verification/fixtures/2026-10-11-sustained-*`.
- Executed native source SHA-256:
  `a741c65ebfeb52d9214257530b7b3f642e7ed5e0e3f000beeb844d2b67fc69d6`.
- Executed controller SHA-256:
  `0a6e86e9b63f370799ffff2d70cdb468e13fa3e82bbf15396b916718e575bc06`.

Before remote launch, the native driver syntax check and six local controller
exception-injection cases passed. Those injected cases still use mocks rather
than real OS faults. The source copies are audit artifacts tied to an already
completed owned trial, not instructions to rerun against its occupied directory.

## Remaining release gates

This result closes the bounded, low-budget authenticated-business trial, not the
whole resource or delivery decision. Next validate complete five-participant
model-task rounds through the shared capacity path and record exact applied
limits. Then combine representative application/HTTPS behavior before finalizing
the production budget; do not silently raise limits if a trial fails.

Formal data ownership/account setup, the consistent maintenance backup and abort
path, public certificate/authentication/isolation, deployed direct 1Cat access,
real Muse **老镇** and dots **玄玑** execution/result evidence, functional Relay
coexistence, and final usage/rollback instructions remain required. The overall
goal is active; this record is not permission to announce the system usable.
