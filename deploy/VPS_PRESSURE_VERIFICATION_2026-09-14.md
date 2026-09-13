# Corrected pressure test and operating recommendation

## Decision

For this VPS, start with **five worker Agents**, **two concurrent discussion tasks
for routine use**, and **three as the conservative tested operating ceiling**.
Here a task is one complete five-Agent discussion round in its channel. It is
not a single model API request, five separate machines, or an Agent count limit.

Five concurrent tasks also completed without errors, but their p95 round latency
was 25.191 seconds, just above the predeclared 25-second normal-profile objective.
That small miss is a latency-policy result, NOT a hardware failure or proof that
four/five tasks cannot run. Four was not separately measured. Three is the highest
tested ramp level meeting that objective, and was selected for sustained testing.
The routine recommendation of two leaves additional margin; it is an engineering
recommendation, not a separately proven mathematical optimum.

**No production task-concurrency limiter was implemented or enabled by this test.**
The application has no complete global admission-control queue. These operating
recommendations must be enforced by the caller until proper queuing is added.

## Test scope

- Application revision `56ec5ba`; no application/router/history code changes.
- Effective test window: 2026-09-14 07:13:59 to 07:31:54, Asia/Shanghai,
  approximately 17 minutes 55 seconds. Machine-readable timestamps are UTC.
- Dedicated `chunlack-stress.service`, separate data directory, loopback 3723.
  Same application jail, 448 MiB RAM limit, 128 MiB swap limit and 50% of one CPU
  core as production. Test load generator and guard ran in separate capped units.
- Exactly five shared worker Agents subscribed to `general`, `bench2`, `bench3`,
  `bench4`, `bench5`. Each channel had at most one outstanding test round.
- A task succeeded only after all five named Agents replied with its marker in
  that channel. There was a 2.5-second cooldown before the next round there.
- The existing sequential Agent dispatch, reflection and general-channel
  background behavior were retained. Mentions were NOT treated as task routing.
- Normal synthetic backend: 1 second per model response, approximately 2 KiB
  output, approximately 1 KiB added input per task. Slow profile: 5 seconds,
  approximately 8 KiB output and 16 KiB added input. Largest observed complete
  model request in the slow profile was 156650 bytes, including context.
- Latency SLO was declared before each profile: 25 seconds for normal rounds and
  105 seconds for slow rounds. The slow SLO is different because a five-Agent
  round includes sequential generation/reflection calls, not one inference call.

## Results

| Stage | Concurrent tasks | Completed rounds | Agent replies | Round p95 | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| Ramp 1 | 1 | 8 | 40 | 11.071 s | Pass |
| Ramp 2 | 2 | 14 | 70 | 16.106 s | Pass |
| Ramp 3 | 3 | 21 | 105 | 18.140 s | Pass |
| Ramp 5 | 5 | 29 | 145 | 25.191 s | All completed; normal latency SLO missed |
| Sustained normal profile | 3 | 114 | 570 | 11.080 s | Pass |
| Slow/larger-model profile | 3 | 6 | 30 | 95.387 s | Pass against the slow-profile SLO |

Total: **192 complete rounds, 960 Agent replies, zero task errors**. SQLite
integrity was `ok`. A separate database reconciliation matched each human task
marker to all five Agent senders in the same channel for all 192 tasks, preventing
the previous first-reply/mention counting error from being mistaken for success.

The sustained stage offered work for 480 seconds and took 490.124 seconds including
completion of the final rounds. Observed throughput was about 13.96 full rounds
per minute. Normal ramp 5 reached about 17.20 rounds/minute but with longer tail
latency. These synthetic figures are not promises for real model throughput.

Observed model-request concurrency differed from discussion-task concurrency:
it peaked at five during ramp 5 and four during the three-task soak. Reflections
and background calls explain why these concepts must not be conflated. Stage
model-call counters are observational windows, not a billing/cost accounting API.

## Coexistence and safety

The watchdog collected 215 samples at roughly five-second intervals:

| Measurement | Observed value |
| --- | ---: |
| Test service peak cgroup memory | 93.80 MiB |
| Minimum host available memory | 1008.46 MiB |
| Host CPU utilization peak, sampled intervals | 3.44% |
| Production health latency p95 / maximum | 1.62 ms / 4.40 ms |
| Test health latency maximum | 2.14 ms |
| Swap used | 0 MiB |
| Test cgroup OOM kills | 0 |
| Production/relay PID changes | 0 |
| Production/relay unhealthy samples | 0 |
| Safety-triggered aborts | 0 |

Abort conditions covered low host memory reserve (384 MiB), sustained high CPU,
production health degradation, test memory above 380 MiB, memory-pressure stalls,
OOM, test failure and relay/production PID or Tailscale health changes. Original
services were never restarted. The watchdog stopped only test units at completion.

Post-test checks found production and Tailscale active, their original PIDs and
restart counters unchanged, all baseline services active, no new kernel OOM,
about 1112 MiB available memory and 32 GiB free disk. Test ports 3723/13871 were
closed; production remained on loopback 3721. No firewall, SSH, DNS, relay or
production resource configuration was changed.

Memory increased as test history accumulated. This short test does not establish
an indefinitely flat memory/disk footprint or prove the absence of memory leaks.

## Full re-verification within this scope

- Corrected JS syntax and watchdog Python compilation: pass.
- Full-team completion and independent SQLite reconciliation: pass.
- Guard completion/cleanup without safety abort: pass.
- Existing provider/tool regression suite rerun on the VPS: 15/15 pass.
- Existing real HTTP/WebSocket/two-mock-backend/Agent-persistence smoke test: pass.
- Production/relay coexistence and removal of test listeners: pass.

This fixes the load-generator methodology, not the existing application history
reload defect. That defect documented in `VPS_DEPLOYMENT_2026-09-14.md` remains
unfixed; do not describe all application features as fully accepted.

## Evidence and limitations

Sanitized summary: `stress-results/2026-09-14.json`. Raw guard/driver records remain
private on the VPS at `/var/lib/chunlack-stress-results-r2-20260914`. The separate
test database remains at `/var/lib/chunlack-stress-r2-20260914`. The invalid first
attempt and its data are retained, not overwritten; see the prior diagnostic.

This is a closed-loop test with think time, bounded to five parallel tasks. It
does not measure unbounded arrival queues, every possible workload, real cloud
quotas, TLS/Internet delivery overhead, GUI/node connectors, GPU inference,
large attachments, model-server failure/retry storms, saturated relay traffic,
host reboot, or 24/72-hour stability. No hardware failure ceiling was sought.

Before important workloads: repair history restoration, add bounded task admission
and cancellation/backpressure, connect the intended real providers, and repeat a
longer soak under representative relay traffic. Do not increase concurrency just
because RAM appears available: multi-Agent sequencing and model latency matter.
