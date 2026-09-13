# First pressure-test diagnostic: capacity conclusion withheld

## Status

The initial pressure test was stopped safely. It does NOT establish a sustainable
task-concurrency ceiling. The load-generator assumption did not match the current
application dispatch behavior, so its task-rate figures must not be used for sizing.
The owner has been asked to approve adjusting the test to count complete five-Agent
discussion rounds, then rerunning the ramp and sustained-load stages.

## Isolation and protection

- Application revision remained `56ec5ba`; production was not modified/restarted.
- A separate unit, `chunlack-stress`, used its own data root and loopback port 3723.
  Its memory/CPU limits matched production: 448 MiB and half of one CPU core.
- A low-privilege driver hosted synthetic model responses on loopback 13871.
  Initial profile: 1 second per model request, about 2 KiB response text.
- A separate watchdog sampled host/application health every five seconds, with
  abort thresholds for memory reserve, sustained CPU/latency pressure, OOM,
  production/relay PID changes and Tailscale health. Each test unit also had a
  maximum lifetime. The watchdog stopped only the disposable test services.
- The test created no real inference traffic, charges, public listener or relay
  throughput load. It did not test local computer connectors or GPU inference.

## Observations, not a capacity benchmark

The first 90-second stage observed 20 designated-worker replies, no errors, and a
reply p95 of 2071 ms. It also observed 371 model requests with a peak of six active
requests. These were not 20 completed whole-team tasks: other channel Agents also
responded, and their work could overlap subsequent submitted messages.

During the second stage, waiting for Work01's reply to LOAD_JOB_00000023 timed out
after 45 seconds. The driver failed and the watchdog stopped the test. No soak
stage or slower-model stage was reached. A one-task operating ceiling must NOT be
inferred from this failure.

Sampled available memory stayed above approximately 1031 MiB, and the test service
peaked around 68.6 MiB. Production HTTP health stayed below 5.5 ms in the recorded
samples; Tailscale remained healthy and swap usage stayed zero. The first host-CPU
sample covers too short an interval and must not be treated as a meaningful peak.

## Dispatch mismatch

In `lack.py` around lines 3601-3610, `onHumanMessage` selects all Agents subscribed
to the channel and awaits each Agent in sequence. This path does not filter Agents
by the `@name` in message text. Each ordinary response also requests a reflection.
`agentRespond` around lines 2262-2265 has a 2200 ms per-Agent/channel cooldown that
can skip an invocation when overlapping message flows arrive close together.

The initial driver assumed an `@WorkNN` message exclusively targeted that worker.
That assumption was wrong. The large model-call count and replies from Work03
through Work10 during the nominal one/two-worker phases demonstrate the mismatch.
The expected reply-token timeout cannot separate workload semantics, cooldown
interaction and model-output correlation from hardware capacity.

## Next valid test design

1. Use exactly five worker Agents in one channel.
2. Count a task complete only when all five have replied for the same discussion
   round, not when one designated worker first replies.
3. Keep one outstanding round per channel initially and respect cooldowns.
4. For independent task concurrency, use explicitly separated channels/teams,
   rather than assuming mentions provide isolation.
5. Ramp complete rounds and model-response sizes/latencies; soak a conservative
   passing configuration while the same watchdog protects production and relay.
6. Report a tested operating bound, not a hardware failure limit or a guarantee of
   indefinite uptime. Real model quotas/latencies and heavy relay traffic need
   separate acceptance.

Raw diagnostic data remain private under
`/var/lib/chunlack-stress-results-20260914`; synthetic app data remain under
`/var/lib/chunlack-stress-20260914`. The draft driver and watchdog are not promoted
as validated benchmark tooling in this diagnostic commit.
