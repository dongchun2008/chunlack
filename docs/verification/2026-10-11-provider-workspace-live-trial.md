# Workspace Provider trial: local regressions and native runner gate

Date: 2026-10-11. Status: local regressions passed; native live Provider
acceptance NOT passed. No product code, production configuration, credentials,
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

## Next gate

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
