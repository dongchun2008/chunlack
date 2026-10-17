# Native Linux Agent HTTPS ingress checkpoint

Date: 2026-10-16

## Result

The isolated Linux run of `tests/public-ingress.test.cjs` passed: 9 tests,
9 passes, 0 failures, 0 cancellations, 0 skips, and 0 todos. The orchestration
process exited with status 0. This checkpoint does not activate production.

The cases cover owned fixture cleanup, ingress rendering/input validation,
real Caddy HTTPS routing and identity-header handling, HTTP/2 and WSS,
protected-resource metadata, MCP lifecycle/authentication and grant revocation,
and metadata behavior when Agent OAuth is disabled. Identity and token fixtures
are synthetic; they are not evidence of vendor enrollment or real model use.

## Evidence

- Owned unit: `chunlack-agent-ingress-fcdcff0a648d.service`.
- Owned remote directory: `/var/tmp/chunlack-agent-ingress-fcdcff0a648d`.
- Source snapshot: 78 files from the working tree, not a clean Git commit.
- Source archive SHA-256: `3ed7c6e4e6c25ed930ac33dd4c6e47b935ef06bbc3f24d7d869612e8daa8d8e4`.
- Local raw report: `.superpowers/sdd/2026-10-14-agent-grant-routing/chunlack-agent-ingress-fcdcff0a648d-report.json`.
- Local ownership handle: `.superpowers/sdd/2026-10-14-agent-grant-routing/chunlack-agent-ingress-fcdcff0a648d-handle.json`.
- Independently copied dependencies: 4,452 files, 38,831,985 bytes.
- Runner reported no errors and verified the dependency-copy hashes.

The raw report and handle are local ignored evidence, not public repository
artifacts. The source archive and dependency copies exclude production
configuration, identity databases, and credentials.

## Isolation and resource results

- User/group: `nobody` / `nogroup`.
- MemoryMax: 201,326,592 bytes (192 MiB).
- MemoryHigh: 167,772,160 bytes (160 MiB).
- MemorySwapMax: 0.
- CPU quota: 100 ms per second (10%).
- Runtime maximum: 90 seconds; TasksMax: 32.
- PrivateNetwork and PrivateTmp enabled.
- ProtectHome enabled, ProtectSystem strict, NoNewPrivileges enabled.
- Observed MemoryPeak: 105,242,624 bytes (approximately 100.4 MiB).
- Observed CPU usage: 4,295,075,000 ns (approximately 4.30 CPU seconds).
- Test process Result: success; ExecMainStatus: 0; NRestarts: 0.

These limits apply to the test service, not the preceding bounded source and
dependency preparation. This is a functional test, not a sustained capacity
benchmark.

## Protected services and cleanup

The runner confirmed unchanged protected-service state, PID and restart count
across `chunlack.service`, `chunlack-public.service`, `chunlack-https.service`,
and `tailscaled.service`. Both health checks remained successful and the Relay
UDP listener remained present. These are before/after checks, not continuous
availability measurement.

After collecting the successful test-service properties, the runner stopped
its owned unit and confirmed it was stopped. The earlier captured
`active/exited` state reflects `RemainAfterExit`, not an orphaned running test.
The owned evidence directories remain available; no production service was
restarted or replaced, and no production configuration or credential changed.

## Delivery boundary

Together with the previous local 837/837 regression and smoke checkpoint, this
adds native Linux HTTPS ingress evidence. It does not establish production
deployment, live Pocket ID Agent-client compatibility, Muse or dots execution,
real-provider inference, or sustained five-Agent capacity. Those acceptance
gates remain separate. GitHub synchronization remains pending the outstanding
scoped whitespace-cleanup confirmation and synchronization checks.
