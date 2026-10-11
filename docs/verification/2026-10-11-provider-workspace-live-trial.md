# Workspace Provider trial: local regressions and native runner gate

Date: 2026-10-11. Status: local regressions passed; native live Provider
acceptance PASSED in r3 below. Earlier failures are retained. No product code, production configuration, credentials,
model configuration, Tailscale routing or Relay configuration was changed.

## Fixture and local result

Added `tests/workspace-1cat-live.cjs`, a manually enabled live verification
fixture using the actual embedded Provider/workspace sections and existing
identity, resource and capacity modules. It does not run network traffic by
default. Both enablement and the explicitly confirmed endpoint are required.

The intended assertions are: authorized model discovery and generation,
ungranted-workspace denial, viewer denial, ungranted-model denial, no unrelated
credential, no prompt logging, and exactly two HTTP calls. The fixture's real
Axios wrapper caps generation to eight tokens and forbids any additional
retry/fallback traffic. That cap is a fixture safety measure, not evidence of
the product's default output-token limit or a full Agent acceptance test.

Local command:

```text
node --test tests/providers.test.cjs tests/workspace-models.test.cjs tests/workspace-background-models.test.cjs tests/workspace-1cat-live.cjs
```

Result: 28 tests total, 27 passed, 0 failed, 1 intentionally skipped live
fixture, 0 cancelled; reported duration 1152.857 ms. These contract regressions
cover Ollama/compatible Providers, fallback permissions, workspace model grants,
viewer restrictions, background task roots, and research provenance boundaries.
They do not replace the skipped real-interface acceptance.

## Native isolated attempt r1

Canonical unmodified report:
`fixtures/2026-10-11-1cat-provider-native-r1.json`.

The source archive was the previously frozen product commit
`95c70de51de569cd04f3c1bf60d6b2b944eac530`, SHA256
`ccbfa2050383fd972aaa4b834f86db5ddae1400241ce405ba7c1275b2f60a157`.
The new test overlay SHA256 was
`922717c287426e3c1fe5bc87afe7cd96d17e789a1eb7a088e0a3055f39302210`,
matching the current local fixture. No frozen source or prior evidence was
overwritten. This tests frozen product code plus the new verification overlay,
not an OAuth implementation or a newly published production package.

Trial root: `/var/tmp/chunlack-1cat-provider-20261011-8d72b4f1`.
Transient unit: `chunlack-1cat-8d72b4f1.service`.
Preflight MemAvailable: 1080744 KiB. Applied properties captured before cleanup:
MemoryHigh 167772160 bytes, MemoryMax 201326592 bytes, MemorySwapMax 0,
CPUQuotaPerSecUSec 100ms, TasksMax 32, RuntimeMaxUSec 2min.
Observed unit MemoryPeak: 28696576 bytes; CPUUsageNSec: 239387000.
These observations are for the failed launcher, not successful Provider load.

The existing Node binary and dependencies were accessed read-only through the
existing application's process-root paths. The Node CLI started, but its test
runner attempted to spawn a child using `process.execPath=/runtime/bin/node`.
That path exists in the application container, not the host namespace. The
reported failure was `spawn /runtime/bin/node ENOENT`, before execution of
the test file. The native report correctly records exit 1, pass 0, fail 1 and
`accepted=false`. Do not reinterpret the systemd wrapper's successful exit as
test success or claim the real Provider assertions ran.

## Service protection and cleanup

The original application is `chunlack.service`, not `lack.service`. Before and
after this attempt it was active with PID 594652 and health HTTP 200. Tailscale
was active with PID 859. Their `systemctl cat` output hashes matched within
this trial; these are output hashes, not individual unit-file hashes.
UDP 40000 listener output matched before/after. The test unit was stopped,
inactive with MainPID 0. Artifacts are retained in the owned isolated root.
No production service was stopped/restarted. No public port was opened.
These checks do not measure Relay throughput or prove long-term performance.

## Historical gate after r1

The minimal proposed correction is confined to the isolated controller:
execute this same Node test script directly rather than use a CLI runner that
spawns the inaccessible container-path binary. Do not change product code,
dependency versions, model settings or production paths. Human approval for
that correction/retest was requested; no correction or second attempt is
included in this report.

The raw VPS-to-model API call already passed in
`2026-10-11-direct-1cat-tailnet-route.md`. Its success does not prove this native
workspace Provider trial. OAuth written-spec review, native Muse/dots execution,
formal-owner/data ownership and final production publication gates remain.

## Native isolated correction and r3 acceptance

The approved r2 direct-script attempt exposed a second namespace mismatch:
container dependency links resolved to `/app` in the host namespace. It failed
with `ENOENT ... lstat '/app'`, before Provider acceptance. Its non-TAP reporter
also prevented reliable counts. Neither failed attempt is a successful test.

The r3 controller uses host-visible `/opt/chunlack/node/bin/node` and
`/opt/chunlack/current/node_modules`, executes the same script directly, and
explicitly selects `--test-reporter=tap` without the child-spawning `--test`.
Read-only SHA256 comparison confirmed the host and container Node binaries
are identical: `7fde7b8afa198da66257f42ee2001d874c7355631e6d1579a5fb5ef1f246df4c`.
Frozen product archive and live test hashes are unchanged from r1.

Canonical report: `fixtures/2026-10-11-1cat-provider-native-r3.json`.
Trial root: `/var/tmp/chunlack-1cat-provider-20261011-e8bd217c`.
Unit: `chunlack-1cat-e8bd217c.service`. Result: exit 0, tests 1, pass 1,
fail 0, skipped 0, cancelled 0, accepted true; elapsed 5.802 seconds.

The actual Provider performed exactly two calls to the private inference
router: model discovery and generation using `qwen38-27b-nvfp4`. Generation
returned HTTP 200 in 181 ms, 17 prompt tokens and 2 completion tokens; the
fixture asserted `OK`. Cross-workspace, viewer and ungranted-model attempts
were denied before transport. Prompt logging was not observed.

Applied limits remained CPU 10%, MemoryHigh 160 MiB, MemoryMax 192 MiB,
MemorySwapMax 0, TasksMax 32, runtime 2 minutes. MemoryPeak was 42577920 bytes
(40.605 MiB), CPU usage 497083000 ns. This is a bounded short acceptance test,
not sustained inference-capacity or full Agent/browser acceptance.

Original LACK PID 594652 and Tailscale PID 859, service-definition hashes,
HTTP health 200 and UDP 40000 listener output matched before and after.
The owned test unit stopped, inactive/dead with MainPID 0; cleanup passed.
No production/Relay restart, configuration change or new public listener.
The later report-download timeout did not invalidate the test and did not
justify repeating real inference; the retained report was downloaded again.

Next: implement the already-approved lightweight OAuth in local bounded steps,
then integrate identity/consent/ingress/restore and native account tests. The
successful Provider result does not complete those separate delivery gates.
