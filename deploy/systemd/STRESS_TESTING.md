# Synthetic full-team pressure testing

Read the completed report `../VPS_PRESSURE_VERIFICATION_2026-09-14.md` first. These
are trusted-operator scripts, not an externally exposed load-testing service.
Never point the fixture or its data binding at production.

## Fixture contract

1. Create a new disposable data root with the same subdirectories as the systemd
   deployment and ownership `chunlack`, mode 700. Never overwrite prior evidence.
2. Clone `chunlack.service` into `/run/systemd/system/chunlack-stress.service`.
   Bind the new data root to `/data`, remove the provider environment-file line,
   set `Restart=no` and add `RuntimeMaxSec=1900`. Retain the original isolation,
   limits and read-only release. No real provider credentials are needed.
3. Set HTTP port 3723. Configure five providers `mock-01` through `mock-05`, local
   and without API keys, each with base URL
   `http://127.0.0.1:13871/workerNN/v1`, model `mock-model`, timeout 15000 ms.
   Use `mock-01` as default. Disable embedding, auto-pull, musing, triangulation
   and public memory. Preserve the deployment's other conservative settings.
4. Configure exactly five workers with IDs `worker-01` through `worker-05`, names
   `Work01` through `Work05`, corresponding providers and model `mock-model`.
   Each subscribes to all five channels: `general`, `bench2`, `bench3`, `bench4`,
   `bench5`; channel IDs and names must match. This shares five Agents across
   independent discussions, not 25 separately registered Agents.
5. Create a NEW `STRESS_RESULTS` directory writable by `chunlack`, mode 700.
   Keep scripts root-owned/readable outside the application's jail. Set
   `NODE_PATH` to the reviewed release's `node_modules`.

## Execution

Start the fixture and explicitly wait for HTTP health on 3723 before the driver.
Run `node stress.cjs` in the named `chunlack-stress-driver` transient unit as
`chunlack`, with 160 MiB memory, 64 MiB swap, 25% CPU, a 96 MiB Node old-space
limit and `RuntimeMaxSec=1750`. Pass `STRESS_RESULTS` and `NODE_PATH` explicitly.

Immediately run `python3 stress-watchdog.py` in a root-owned
`chunlack-stress-watchdog` transient unit, passing the SAME `STRESS_RESULTS`.
Cap it at 128 MiB/10% CPU and `RuntimeMaxSec=1850`. It needs host service/cgroup
and Tailscale visibility and permission to stop ONLY the two named test units.
Do not run these scripts concurrently with another test using those unit names.

The watchdog samples every five seconds and stops testing on health/resource
violations, driver termination or deadline. Its `finally` cleanup stops the
driver and fixture, never production/relay. Independent service deadlines bound
the test if the supervisor is unexpectedly killed. An operator should monitor
its JSONL output and stop the test manually if the supervisor itself fails.

The driver ramps 1/2/3/5 full-team rounds concurrently for 90 seconds per stage,
soaks the highest passing stage for 480 seconds, then tests a 120-second slow
profile. Stages wait for outstanding rounds, so wall-clock duration is longer.
One round requires five distinct expected Agent replies in the SAME channel,
carrying that round's marker. A 2.5-second pause respects the application cooldown.

Normal profile SLO: 25 seconds p95. Slow profile SLO: 105 seconds p95, matching its
five-second synthetic response delay instead of one second. These are explicit
benchmark-policy choices, not universal production requirements. Preserve failed
stage results, including a latency SLO miss even when no task failed.

## Acceptance and cleanup

- Require a final driver `finished` event and a guard `cleanup` without abort.
- Check every offered task, completed round, Agent count, timeout and SLO result.
- Reconcile all human markers to all five Agent senders per channel in the stopped
  fixture database, and require SQLite integrity `ok`.
- Review memory reserve/pressure, CPU, production latency and unchanged relay PIDs.
- Re-run existing `npm test` and `PYTHON=python3 npm run smoke` after pressure
  testing, under limits, so they do not contaminate the pressure measurements.
- Stop remaining test units, remove only the temporary unit file and reload
  systemd. Retain data/logs privately; never delete production data or reset
  unrelated service state. Confirm loopback 3723/13871 no longer listen.

Raw JSONL may contain operational host details. Publish only reviewed, sanitized
aggregates. This benchmark does not test real providers or establish a universal
hardware maximum; the first attempt's mention-based assumptions were invalid.
