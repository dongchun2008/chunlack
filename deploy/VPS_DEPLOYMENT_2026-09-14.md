# VPS deployment and bounded acceptance

## Outcome

Private LACK deployment is running; application acceptance is PARTIAL because
channel history is not reloaded into the UI after restart. Real models were
explicitly deferred by the owner. Do not label this production feature acceptance.

Application source: commit `56ec5ba`. Runtime: official Node `v24.21.0`, Linux x64.
No changes to `lack.py`, no removal of Ollama support, and no Codex/OpenClaw
connector deployment. New systemd artifacts and this record are synchronized
separately; the deployed application revision remains the one above.

## Delivery and isolation

- Docker Hub, npm and Node direct access were unavailable on the first session.
  Used a temporary, loopback-only SSH reverse tunnel to an allowlisted CONNECT
  proxy on the operator machine. TLS verification remained enabled. That delivery
  tunnel and proxy were stopped after dependency installation.
- Source archive SHA-256:
  `78694a687af572430a2d23bdda87e29709425c8fda5a8c89f4e947f342887040`.
- Node archive SHA-256:
  `fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6`,
  matching the official distribution's SHASUMS256 file.
- Installed 246 locked packages as the dedicated low-privilege account, with
  bounded CPU/memory. No system package installation or system-wide Node change.
- Added `chunlack.service`: private jail, read-only code/system mounts, dedicated
  writable data, no capabilities, no-new-privileges, disabled direct shell,
  448 MiB memory cap, 128 MiB swap cap, half-core CPU quota, 64-task limit.
- First start failed with EACCES because generated files were root-only readable.
  After owner approval, corrected code to root-owned/group-readable and directories
  group-searchable. Config remains mode 600 and data root mode 700. Startup passed.
- Only `127.0.0.1:3721` is listening for the application. No firewall, Tailscale,
  SSH, DNS or existing service configuration was changed. No public exposure.

## Verification results

| Check | Result |
| --- | --- |
| Provider/routing/tool regression suite | PASS, 15/15 on the VPS |
| Existing real HTTP/WebSocket smoke test | PASS, two synthetic providers and Agent SQLite persistence |
| Isolated service startup and health | PASS |
| Browser via local SSH tunnel | PASS, LACK v4.2.2 and CONNECTED, zero production Agents |
| Dedicated fixture, five synthetic Agents | PASS, five provider routes and replies, shared prior response context |
| Five WebSocket clients | PASS |
| 100 HTTP health requests, concurrency five | PASS; measured batch 106 ms, not a production benchmark |
| Mock model traffic | 20 requests observed; peak concurrent requests 2, NOT five-way real inference validation |
| Agent name/provider after fixture restart | PASS |
| Channel history after fixture restart | FAIL; database rows exist but WebSocket history is empty |
| Database integrity | PASS; `PRAGMA integrity_check = ok`, 15 test messages retained |
| Backup and restore into a separate directory | PASS; database/config hashes equal, 15 messages, restored service health OK |
| Code write attempt as service UID | Blocked with EROFS |
| Dedicated workspace write/remove | PASS |
| Host root/secret/socket access | Host root access denied; shadow, provider-env file and control sockets absent in jail |
| DNS configuration in jail | Readable; actual model connectivity not tested |
| Log rotation configuration | PASS, logrotate debug validation; no forced rotation |
| Service boot enablement | Enabled; VPS not rebooted |

The first disposable test-client attempt connected before its service was ready
and failed ECONNREFUSED. Re-running after explicit HTTP readiness passed. This is
recorded separately from the genuine history-restoration failure.

## History-restoration defect

On commit `56ec5ba`, channel initialization in `lack.py` around line 1320 uses
`messages: []`. The database reader `dbGetMessages` is defined around line 360
but not called to hydrate these channels. The join handler around line 3047 sends
that in-memory empty list. Evidence: all 15 messages, including the acceptance
marker, exist in SQLite after restart; the `general` history frame is empty.

The new `deploy/systemd/acceptance.cjs persisted` check intentionally fails here.
This deployment does not silently change existing application behavior or hide
the failure. A follow-up should hydrate bounded recent history in correct order,
preserve message metadata/thread relationships, and cover restart/restore in a
regression test before approving durable conversation workflows.

## Coexistence observations

At 2026-09-14 06:48 +08:00, after stopping the test instances:

- LACK cgroup memory approximately 53.5 MiB, peak approximately 55.1 MiB.
- VPS available memory approximately 1110 MiB; swap usage 0; root disk free 32 GiB.
- Memory PSI avg10/avg60/avg300 remained zero at sampled points.
- Tailscale remained Running, Online=true, Health=[]; PID 859 and NRestarts=0,
  with its original 2026-08-22 activation time and UDP 40000 listeners.
- All baseline running services remained active at the comparison point.
- No new kernel OOM entries were observed during the deployment verification.
- Test listeners 3722/13870 and the dependency tunnel listener 18765 were absent
  after cleanup. Test datasets/backups were retained privately, not uploaded.

An initial production backup was also created with only LACK briefly stopped and
then restarted. Tailscale was not stopped. This is a short, bounded coexistence
observation, not a sustained relay throughput test, host-reboot test or proof
that earlier host OOM causes have been permanently eliminated.

## Operator handoff

See `systemd/README.md` for paths, access, limits, rollback and repeatable testing.
Production is intentionally a zero-Agent, no-real-provider standby. The absent
Ollama endpoint produces an expected startup discovery warning. Embeddings and
auto-pull remain disabled. Configure model endpoints/secrets separately, fix the
history defect, and then validate real collaboration before important workloads.
