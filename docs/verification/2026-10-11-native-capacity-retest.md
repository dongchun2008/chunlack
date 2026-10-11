# Native bounded capacity-component retest, 2026-10-11

## Acceptance

The approved reporter correction was limited to an explicit
`--test-reporter=tap` argument in the isolated Node test command. A fresh owned
directory and transient unit (`70a891cd`) were used; the prior failed-controller
run (`43b57a21`) remains preserved.

**This bounded native component test is accepted.** Both the test process and
the controller exited 0. All five native tests passed; the controller recorded
no errors, verified the applied resource properties and stopped its owned unit.
Independent postflight also passed and found the transient unit absent with
MainPID 0.

Product code remains `95c70de51de569cd04f3c1bf60d6b2b944eac530`. Its 315
source-tree entries were compared with the pinned archive before the retest.
No product code, existing test, production service or Relay setting was changed.

## Results

- Local control-flow injection: 6/6 cases passed.
- Local TAP parser fixtures: 9/9 passed, including eight rejected invalid cases.
- VPS native tests: 5 passed; 0 failed, cancelled or skipped.
- Two workspaces; five logical model participants per round.
- 24 complete rounds; 120 mock HTTP model requests; 0 failed rounds.
- Maximum active model HTTP requests: 1; maximum sampled workspace queue: 4.
- Stress diagnostic duration: 3,813 ms; round p95: 695 ms.
- Controller-observed unit elapsed time: 13.185 seconds.
- Cgroup memory peak: 48,492,544 bytes (46.25 MiB); swap peak: 0.
- Unit CPU accounting: 1,214,467,000 ns.
- Stress-process RSS diagnostic: 79 MiB. This differs from cgroup memory
  accounting and is not a replacement for the cgroup peak.

These are component measurements using a loopback mock model endpoint.
They are not a stable production concurrency ceiling or sustained five-native-
Agent inference benchmark.

## Actual applied budget and containment

Verified properties were unchanged from the approved budget:

```text
CPUQuotaPerSecUSec=100ms
MemoryHigh=167772160
MemoryMax=201326592
MemorySwapMax=0
TasksMax=32
RuntimeMaxUSec=4min
OOMPolicy=stop
```

This corresponds to CPU 10%, MemoryHigh 160 MiB, MemoryMax 192 MiB,
zero permitted swap, 32 tasks and a four-minute runtime ceiling. Limits were
not expanded. The Node heap cap was 64 MiB.

The test used a private network namespace and fresh synthetic identity
fixtures. Product source was read-only, scratch data was confined to the owned
run, and existing production data, backup/migration data and fixture-auth
credentials were inaccessible. Host-side SSH/Python overhead is not included
in the workload cgroup measurements.

## Co-host continuity

Independent postflight completed at **2026-10-11 18:35:16 Asia/Shanghai**:

- Original LACK PID 594652 and Tailscale PID 859 remained unchanged.
- Both services remained active/running with zero recorded restarts.
- Their unit-file hashes remained unchanged.
- LACK health returned 200; Relay UDP 40000 listener remained present.
- TCP 443 remained unbound.
- The isolated unit was not-found/inactive with MainPID 0.

No original service was stopped, restarted or reconfigured. Listener/process
checks do not prove Relay packet forwarding, latency or throughput.

## Canonical evidence and reporting caveat

A local parser of interactive terminal output encountered terminal wrapping
during postflight display. That display parser was not modified. It was not
used as the acceptance authority: the original JSON reports were transferred
with SCP over the pinned SSH connection, and the downloaded host/trial report
hashes were compared with server-reported hashes. No test rerun was needed to
recover these records.

[Independent postflight](fixtures/2026-10-11-native-capacity-postflight-70a891cd.json)
is a byte-identical copy of the transferred JSON report, not a reserialized
PowerShell object. Its SHA-256 is:

`bc46091e1ad6ef786b6b5ec05d063ba41cd0b25ec1b54c9279a5164f1454209a`

Host report SHA-256:

`ad2dfc5fd824622b4f35460eb21e193ef0e7dbd96eeee09d8fcccb41e5d526c3`

Native trial report SHA-256:

`f4e28f90673c9cf0bccaa87f8c1f0f02f562eba07ba8fa142fa124e9a77efe32`

[Executed controller](fixtures/2026-10-11-native-capacity-controller-70a891cd.py.txt)
is retained for audit only. It targets this already-consumed run identity and
must not be rerun in place. SHA-256:

`484ecdec20e053fa6f9aed07b1477c45b176294d5714a870b0f1ab6d3f266e52`

## Remaining delivery gates

This result complements, but does not broaden, the prior 30-minute mock
authenticated business trial. It proves shared-capacity/authorization/
cancellation components under the captured limits. It does not prove:

- Real 1Cat model generation or a usable VPS-to-private-model route.
- Native Agent planning and execution, or Muse/dots computer-task completion.
- Public TLS, formal owner creation or production cutover.
- Combined sustained authenticated application, TLS and real-model load.
- A production budget or a stable maximum number of simultaneous nodes.

The previously observed private model route requires separate work; do not
reconfigure Tailscale Relay, publish the model API or use Open WebUI credentials
as a shortcut. The full delivery goal remains incomplete and active.
