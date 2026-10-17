# Post-MCP full regression and remaining startup investigation

Date: 2026-10-15

## Status

Full acceptance is NOT passed. Local full regression finished with 835 tests:
834 passed, one failed, zero cancelled, zero skipped, exit code 1.
The single remaining failure is a migration-business fixture startup wait.
Its later isolated pass does not establish a root cause or erase the failure.

No product source, test assertions, timeouts, production services, model
configuration, credentials, DNS, or Tailscale Relay settings were changed in
this continuation. One ignored, local-only observational preload was added.
This is not production, real-provider, or vendor-owned computer acceptance.

Repository checkpoint observed before completion: branch
`cloud-agent-pilot-foundation`, HEAD
`16c54da97dea149809ed10b97dfe192b7846ae65`, with the existing uncommitted Agent
runtime, administration, MCP, fixture, and documentation work. HEAD alone does
not identify the tested working tree. No Git commit or push occurred in this
continuation.

## Completed runs

| Run | Tests | Passed | Failed | Cancelled | Skipped | Exit | Duration |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Remaining baseline files, unchanged | 50 | 50 | 0 | 0 | 0 | 0 | 457.066 s |
| Full suite after MCP correction | 835 | 834 | 1 | 0 | 0 | 1 | 716.895 s |
| Isolated business startup observation | 1 | 1 | 0 | 0 | 0 | 0 | 32.772 s |

The 50-test run covered `public-runtime`, `workspace-browser-fixture`,
`workspace-migration-apply`, `workspace-migration`, and `workspace-runtime`.
No intervening repair or deadline change was used to obtain its passing result.

The full suite used Node v24.19.0, concurrency 1, TAP, the existing per-test
budgets, Python 3.13, and the previously verified portable Caddy 2.11.7:

```powershell
node --test --test-reporter=tap --test-concurrency=1 --test-timeout=90000 tests/*.test.cjs
```

All three command sessions reached terminal exit status. No observation timeout
was treated as process completion and no running suite was restarted.

## Full-suite failure

- Test 379: migrated packaged runtime serves three humans in two workspaces,
  actual model routes, restart and legacy-compatible recovery.
- File: `tests/migrated-runtime-business.test.cjs`, test at line 150,
  readiness wait at line 154.
- Error: `Acceptance timed out: packaged public runtime`.
- Test duration: 47635.3867 ms.
- The initial public-runtime readiness wait already allows 30000 ms; the whole
  test is bounded at 90000 ms. Neither budget was changed.
- The readiness timeout did not include the captured child startup log, so the
  original failing run does not prove which internal startup stage stalled.

The full suite's other 834 tests passed, including the previously failing MCP,
identity, browser, workspace, and migration cases. This is evidence of the
current run, not proof that intermittent failures have been repaired.

## Observational follow-up

The ignored `business-startup-observe.cjs` preload wraps subprocess observation
without changing original arguments, environment, request behavior, assertions,
or deadlines. It records elapsed times, process events, and an allowlist of
readiness/close markers, not credentials or raw child output. The unchanged
business test passed with all business assertions enabled.

Measured from `spawn_begin` to the corresponding ready marker:

| Child | Mode | Ready latency | Exit |
| --- | --- | ---: | --- |
| 1 | Public runtime | 3111 ms | 0, no signal |
| 2 | Public restart | 2828 ms | 0, no signal |
| 3 | Legacy recovery | 6672 ms | 0, no signal |

Observed certificate generation: 681 ms. Materialization: 803 ms.
The observation recorded 35 events and three child processes, each with exit
and close events. All timings apply only to this isolated passing run.

## Evidence

Files below are under `.superpowers/sdd/2026-10-14-agent-grant-routing/`.

| File | SHA-256 |
| --- | --- |
| `remaining-baseline-retest-2026-10-15.tap` | `21269ec70c9c0cf69198621e7b447af63dd74c2e28ac4a4b1c5b82ad77afe3a0` |
| `mcp-postfix-full-regression-2026-10-15.tap` | `6307005ece7c7f7f0b210068d611637b3f3c0066ef745f66fcd1ec0f0e0ddff7` |
| `business-startup-diagnostic-2026-10-15.tap` | `0bdf625fe868e25417f216ea61dab7222d36522ea0b0da7c276707b5075a472c` |
| `business-startup-observation-36288.json` | `c9b882edc8e1f6922691ea30918eaa7a4f1404faacbadcf409e5753096058552` |

## Next gates

- Add bounded, secret-free phase diagnostics to the business fixture so a
  future full-run timeout identifies its startup stage without raising limits.
- Run focused and full regression; preserve both failing and passing evidence.
- Refresh the isolated Linux runner's snapshot provenance before using it.
  The inspected historical runner pins an older clean revision and was NOT run.
  Do not remove its provenance guard or attribute an old-snapshot result to
  the current working tree.
- Continue public ingress, Linux isolation, actual Muse/dots execution, and
  other delivery acceptance gates. No production release is justified yet.
