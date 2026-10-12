# Git environment compatibility and regression checkpoint

## Scope

The approved test-only environment allowlist contains exactly
`GIT_CONFIG_NOSYSTEM` and `GIT_TERMINAL_PROMPT`, supplied as fixed values `1`
and `0`. The fixture retains its temporary HOME/XDG isolation, environment
filtering, executable Git configuration rejection, and all assertions.
No `allowUnsafe` setting or production Git permission was added.

The local dependency-upgrade candidate also uses the named `simpleGit`
factory. Product and dependency changes remain uncommitted pending acceptance;
this checkpoint alone is eligible for documentation synchronization.

## Completed checks

| Check | Result | Duration |
| --- | --- | --- |
| Dependency/Git security fixture | 7 passed, 0 failed | 9.487 s |
| Complete serial local regression | 537 passed, 11 failed, 0 skipped, 0 cancelled; 548 total | 1335.669 s |
| Unmodified focused rerun of four affected test files | 21 passed, 1 failed; 22 total | 157.185 s |
| Independent smoke check | Exit 0 | Not separately recorded |

The smoke check reports real local HTTP/WebSocket transport, two mock model
backends in one channel, SQLite restart persistence, private bind, and config
preservation. It is not real-provider or external-Agent acceptance.

The complete regression failed during Caddy validation (one case), Python
materialization (eight public-runtime cases), browser-fixture readiness (one
case), and embedded workspace-runtime readiness (one case).

The focused rerun covered `packaged-agent-rounds.test.cjs`,
`public-runtime.test.cjs`, `workspace-browser-fixture.test.cjs`, and
`workspace-runtime.test.cjs`. Only the browser-fixture readiness case failed
again. This does not erase the failed complete regression or prove other
startup failures are fixed.

## Remaining startup investigation

The browser test waits 10 seconds for its helper's JSON readiness record. The
helper first creates disposable identities, materializes the package, starts
the embedded server, seeds two workspace conversations, and starts loopback
proxies. Its readiness deadline therefore includes several startup stages.

A separate bounded diagnostic, not an acceptance test, observed the helper
report an internal startup failure and exit 1 after 14.349 seconds, without
emitting readiness. Its 30-second observation deadline did not expire. The
diagnostic did not retain the specific internal failure message, so it does
not identify which stage failed. Merely extending the outer test deadline is
not an established fix.

A coarse local sample reported CPU load 100%, approximately 2.8 GiB free
physical memory, and 22 Node processes using approximately 793.5 MiB combined
working set. These are point-in-time observations, not proven causality.
Unrelated processes were not terminated or reconfigured. No test timeout,
assertion, production service, or VPS resource limit was changed here.

## Evidence

Ignored local directory: `.superpowers/sdd/2026-10-12-dependency-hardening/`.

| Evidence file | SHA-256 |
| --- | --- |
| `git-environment-compatibility.tap` | `e0351c2ae55edd489c4723e5610e64a3e0275208a5d39d10d8f69242a96a3f74` |
| `full-suite-compatibility-fixed.tap` | `64db04bb43b907d428b057d3b027003a9d1107bf1ecceb570cd6e04b5c126276` |
| `startup-failure-retest.tap` | `aae5da20afc231c64fa8fa56c427201452910e494ba04bba84cf8990671e7cec` |

Additional local evidence: `smoke-compatibility-diagnostic.log` and
`browser-fixture-readiness-diagnostic.log`. Runtime logs and private credentials
are not included in this documentation commit.

## Delivery gates

- The Git compatibility fixture is accepted locally; the complete candidate
  is not accepted for release.
- Preserve the failures and diagnose startup-stage timing before any further
  fixture change. Then rerun the complete suite, smoke, and the approved
  resource-limited native Linux checks for the actual upgraded candidate.
- Prior native results apply to their recorded source/dependency snapshots,
  not automatically to this candidate.
- The new Pocket ID client remains separate from the existing Tailscale client
  and has no allowed user groups. Its initially generated secret was exposed
  in a tool result; the user was notified and must revoke and replace it before
  use. The private credential file currently has an empty secret and a
  replacement-required marker. No production login was enabled.
- Real external-Agent and real-model acceptance remain separate delivery
  requirements. No production or Relay restart/change was performed here.

## Follow-up stage timing

A subsequent instrumented, local-only helper run completed successfully and
shut down its own server. It did not change the test or production code:

- Password hashing: 737 ms.
- Package materialization: 1282 ms.
- Server spawn to listening indication: approximately 5375 ms.
- Supervisor start to complete helper readiness: 9898 ms.
- Supervisor completion: 10058 ms, exit 0; the owned server received SIGTERM
  during the helper's normal shutdown.

Evidence: ignored `browser-startup-stage-diagnostic.log` in the same directory.
The instrumentation emits stage names, timings and exit status only, not
credentials, task contents or actual account data.

This establishes that the 10-second outer readiness budget can be almost
exhausted by a successful initialization. It is also shorter than the sum of
the allowed internal materialization and server-startup budgets, before
session seeding. It does not explain every earlier timeout or turn a failed
acceptance test into a pass.

Approval has been requested for a test-only correction: derive bounded outer
readiness from the internal startup stages, expose safe failure-stage
diagnostics, and ensure timeout cleanup reaches only the owned subprocesses.
All identity, authorization and DELETE assertions, production timeouts and
security policy must remain unchanged. No such correction has been applied
at this checkpoint.
