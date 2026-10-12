# Browser startup and native isolation checkpoint

## Approved local fixture correction

The local, uncommitted browser fixture now shares explicit test-only startup
budgets with its parent test, emits safe stage names, accepts STOP/EOF before
readiness, drains initialization before cleanup, and scopes forced fallback
cleanup to its own Windows process tree or dedicated POSIX process group.
Production timeouts and identity/authorization/DELETE assertions are unchanged.

Focused run: 2 tests, 1 passed, 1 failed, 0 skipped or cancelled, 24.214 seconds.
The new early-STOP regression passed. The normal browser regression now reports
the remaining failure precisely at `stage=runtime`, inside the helper's
approximately 5-second server readiness loop. Its synthetic startup log was
empty at the deadline; no product exception was identified from that log.

A separate diagnostic reused only that owned disposable fixture's materialized
server and synthetic identity database. It observed the actual server listening
after 17894 ms, then terminated that owned process normally with SIGTERM.
The diagnostic completed after 18062 ms. It did not exercise the browser's
DELETE assertion and is not a replacement passing test.

Local CPU sampling again reported 100%. This is evidence of load, not a proven
explanation for all prior suite failures. No unrelated process was stopped.
Approval was requested to change only this fixture's internal runtime budget
to 20 seconds and derive the outer budget from it, within the existing
90-second per-test ceiling. That adjustment is not yet applied here.

## VPS read-only preflight

- `chunlack.service` and `tailscaled.service`: active/running.
- Existing loopback LACK health: HTTP 200.
- Existing Relay UDP 40000 listeners: present.
- TCP 443 listener: absent during observation; no listener was created.
- Available memory: 1091184 KiB during preflight.
- Native Node: v24.21.0; Git executable available.
- Historical failed isolated test units were observed and left untouched.

## New native dependency runner: infrastructure failure, zero tests executed

The independently scoped seven-test dependency check packaged the current local
test, lockfile and five updated pure-JavaScript packages. It used a fresh owned
directory and transient unit, with a 10% CPU quota, 192 MiB memory maximum,
160 MiB memory-high threshold, no swap, 32 tasks, private networking/devices,
PrivateTmp, read-only system protection, and a 240-second runtime bound.

Unit: `chunlack-dependency-fa02c62b7cc1.service`.

The service failed before executing Node: `226/NAMESPACE`. The journal names
the owned `results` directory as missing inside the mount namespace. The new
runner omitted explicit directory bindings needed with PrivateTmp. No TAP
report was produced; the runner then attempted to retrieve the absent report
and raised FileNotFoundError. Neither event is a failed product test or a
successful native validation.

The finally block stopped only the unit whose description matched the new
nonce. Pre/post baseline comparison was unchanged, including both production
service PIDs, health status and observed listeners. No existing unit, global
software, credential, network rule or resource allowance was modified.

Approval was requested to repair this runner's explicit owned directory
mapping and missing-report handling while preserving every isolation/resource
constraint. That repair and native rerun are pending at this checkpoint.

## Evidence and outstanding gates

Ignored evidence directory:
`.superpowers/sdd/2026-10-12-dependency-hardening/`.

- `browser-fixture-budget-retest.tap`
- `embedded-runtime-cold-start-diagnostic.log`
- `native-dependency-preflight.txt`
- `native-dependency-fa02c62b7cc1/inputs.json`
- `native-dependency-fa02c62b7cc1/systemd.txt`
- `native-dependency-fa02c62b7cc1/journal.txt`
- `native-dependency-fa02c62b7cc1/before.txt`
- `native-dependency-fa02c62b7cc1/after.txt`
- `native-dependency-fa02c62b7cc1/result.json`

The dependency candidate and fixture edits remain local and uncommitted.
Complete local regression, smoke and upgraded-candidate native acceptance are
still required. The earlier full-suite result remains 537/548, not green.
The new Pocket ID client's exposed secret must be revoked/replaced by the
user before activation; no production OIDC login or workspace access was
enabled. Real model and Muse/dots Agent acceptance remain outstanding.
