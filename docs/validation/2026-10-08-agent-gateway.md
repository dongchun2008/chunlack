# Agent Gateway local validation record

Date: 2026-10-08. Environment: Windows local development checkout.

## Recorded results

- `node --test tests/*.test.cjs`: 67 tests passed, including existing provider/research tests and gateway/SDK integration. Windows credential ACL test passed after replacing the unavailable PowerShell Security-module dependency with .NET file ACL APIs.
- `node tests/smoke.cjs`: PASS for real HTTP + WebSocket, two mock model backends in one channel, SQLite restart persistence, private bind and config preservation.
- `node scripts/gateway-benchmark.cjs --nodes 5 --duration-seconds 300`: exited successfully with the following measurements.

```json
{
  "nodes": 5,
  "durationSeconds": 300,
  "completedTasks": 5,
  "failures": 0,
  "claimRequests": 55,
  "otherRequests": 10,
  "claimRequestsPerMinute": 11,
  "cpuPercentOfOneCore": 0.354,
  "rssStartMiB": 40.05,
  "rssPeakMiB": 60.51,
  "rssIncreaseMiB": 20.46,
  "peakWaiters": 5,
  "databaseBytes": 61440,
  "walBytes": 0,
  "persistenceVerified": true
}
```

RSS includes the gateway and all five fixture clients in one process. The 32 MiB incremental target was met in this run. The approximately 10 claims/minute idle target measured 11/minute, including startup and task delivery. CPU is averaged over the run, normalized to one core. This is a bounded low-duty-cycle measurement, not sustained model workload stress testing or a demonstrated VPS capacity limit.

## Remaining acceptance gaps

- No VPS deployment, service restart, public listener or production credential change.
- No real model or muse.ai/dots product wrapper integration.
- No native macOS execution or browser desktop/mobile visual acceptance.
- External retrieved excerpts remain untrusted and cannot replace independently acquired original sources.
- Trace/session metadata accepted by the queue is not yet fully persisted in task records.
- Terminal result reservation when per-task event limits are exhausted needs an explicit acceptance case before production use.
- The original plan checklist includes additional failure-path cases; passing the current suite does not mean every checklist item has been exercised.

The deliverable is a locally tested prototype. Keep the gateway disabled in production until these deployment and acceptance steps are addressed.
