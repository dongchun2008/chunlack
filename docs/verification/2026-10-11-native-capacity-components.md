# Native bounded capacity-component evidence, 2026-10-11

## Outcome and acceptance boundary

This run is **not accepted as a successful controller run**. The native Node
test process exited 0 and its complete spec log reports five passing tests,
zero failures, zero cancellations and zero skips. The controller exited 1
because it expected TAP output, while Node selected its default spec reporter.
The workload was stopped and its transient unit was subsequently absent.

No product source or existing native test was modified. Product source commit:
`95c70de51de569cd04f3c1bf60d6b2b944eac530`. All 315 source-tree entries were
compared with the pinned source archive before this run; its SHA-256 matched
the prior conversion trial.

Local control-flow injection passed 6/6 cases. The new parser passed 9/9
synthetic cases (one valid TAP record and eight invalid records). Those fixtures
did not verify the reporter selected by the actual Node invocation. The
failure is in the test orchestration, not evidence of a product regression.

## Native workload evidence

The unchanged `workspace-capacity-models.test.cjs` and
`workspace-capacity-stress.test.cjs` ran sequentially inside a private-network
systemd unit, using fresh isolated fixtures and mock HTTP model responses.

- Two workspaces; five logical model participants per round.
- 24 complete rounds; 120 mock model HTTP requests; zero failed rounds.
- Maximum active model HTTP requests: 1; maximum sampled workspace queue: 4.
- Stress diagnostic duration: 4,002 ms; round p95: 698 ms.
- Unit elapsed time as observed by the controller: 13.176 seconds.
- Unit memory peak: 47,349,760 bytes; swap peak: 0.
- Unit CPU accounting: 1,210,630,000 ns.
- Stress-process RSS diagnostic: 78 MiB. This is a different metric from the
  cgroup-accounted peak and must not be substituted for it.

The tests cover shared inference capacity, reauthorization around queued
execution, revocation before/after inference, scoped HTTP cancellation, and
bounded task-scope defaults. They do not exercise native Agent planning,
vendor computer execution, real model inference, authenticated public access
or a sustained production workload. Completed logical participant rounds
must not be presented as verified Muse/dots or real-model Agent rounds.

## Applied limits and isolation

Captured systemd properties, not merely requested command-line values:

- `CPUQuotaPerSecUSec=100ms` (10% of one CPU).
- `MemoryHigh=167772160` (160 MiB).
- `MemoryMax=201326592` (192 MiB).
- `MemorySwapMax=0`.
- `TasksMax=32`.
- `RuntimeMaxUSec=4min`.
- `OOMPolicy=stop`.

The workload used `PrivateNetwork=yes`, read-only product source and an owned
scratch directory. Existing LACK data, migration data, backup data and the
private fixture-auth file were inaccessible to this workload. No real backend
request, credential read, global install, listener publication or production
switch was performed. SSH and the Python host controller were outside this
unit; the figures do not include all host-side overhead.

## Co-host safeguards

Before/after recorded LACK PID 594652 and Tailscale PID 859 were unchanged;
both remained active/running with zero recorded restarts. Their unit-file
hashes were unchanged, LACK health returned 200 and the existing Relay UDP
40000 listener was present. Public TCP 443 state was unchanged.

A later read-only unit query showed the test unit not-found/inactive with
MainPID 0. No original service was stopped or restarted. These checks establish
service/listener continuity, not Relay forwarding, packet loss or throughput.

## Next gated action

The minimal correction is an explicit `--test-reporter=tap` argument in the
isolated test invocation. Preserve this failed-controller record, use a new
owned run identity, rerun with the same caps and capture actual properties.
Do not loosen the parser, auto-expand resource limits or interpret process
exit 0 alone as complete acceptance. Human approval for this newly identified
orchestration correction has been requested.

Evidence: [sanitized native result](fixtures/2026-10-11-native-capacity-components-43b57a21.json).
The complete 1,057-byte spec log is included there. It contains only test
diagnostics, not production credentials or private configuration.
