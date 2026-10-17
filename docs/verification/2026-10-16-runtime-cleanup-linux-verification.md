# Runtime cleanup and bounded Linux verification, 2026-10-16

## Decision

The approved cleanup regression changes passed seven real-child tests on
Windows and Linux. The complete 17-case public-runtime file and one additional
discovery-only human boundary case passed disjoint Linux groups. This is 25
passing Linux cases, not a passing full project suite or production delivery.

No production service, credential, client registration, access grant, DNS,
firewall, Pocket ID application, or Tailscale configuration was changed.

## Windows diagnostic evidence

The pre-repair diagnostic suite exited 1: 841 tests, 835 passes, four failures,
two cancellations, no skips. The subsequent repaired-fixture run exited 1:
24 tests, 15 passes, eight failures, one cancellation. All seven new cleanup
cases passed, but related materialization and startup cases still timed out.
Neither result is superseded by the Linux result below.

A bounded independent control, observed at 2026-10-16T13:51:27Z, sampled all
eight local logical CPUs as busy, with 1,601,155,072 bytes free of 16,745,644,032
bytes RAM. Even Node and Python programs that only print `1` exceeded their
5000 ms deadlines (observed wall times 6272.762 and 6197.199 ms). They did not
load project code. Reading lack.py returned 369143 bytes in about 3.10 ms.

This establishes that local execution pressure can affect startup tests; it
does not prove every failure is environmental, identify the responsible
process, or exclude product defects. No unrelated process was stopped, and no
test deadline was increased. An earlier slow WMI query was cancelled without
using it as evidence. A diagnostic lookup for an incorrectly guessed
materializer filename returned ENOENT; actual runtime tests use
scripts/materialize.py and their results are unaffected.

## Linux constraints and evidence

All groups ran serially, as nobody/nogroup, with private network and private
temporary storage, read-only source mappings, NoNewPrivileges, ProtectHome,
and ProtectSystem=strict. Each test unit retained MemoryMax=192 MiB,
MemoryHigh=160 MiB, no swap, CPUQuota=10%, TasksMax=32, and RuntimeMaxSec=90.
Original per-test timeouts and assertions were retained. These are test-unit
limits, not a claim that all preparation work was inside the test cgroup.

| Scope | Passed/total | Unit suffix | MemoryPeak bytes |
| --- | --- | --- | --- |
| Real owned-child cleanup regressions | 7/7 | cleanup-db192de1f7c4 | 49532928 |
| Runtime foundation and preflight | 8/8 | runtime-foundation-4768d5d1b0ca | 38158336 |
| OIDC drain on shutdown and rollback | 2/2 | runtime-oidc-drain-152de8364dbf | 70164480 |
| Incomplete OIDC body and retained writer lock | 2/2 | runtime-oidc-incomplete-1ee7158a181a | 75124736 |
| Import without startup side effects | 1/1 | runtime-import-e023b590085f | 68894720 |
| Packaged web, node REST, MCP close and restart | 1/1 | runtime-restart-02d66c4abab5 | 99835904 |
| MCP port conflict rollback | 1/1 | runtime-port-conflict-b34450802de9 | 73011200 |
| Legacy entry writer guard | 1/1 | runtime-writer-guard-35d3244ea6b9 | 111063040 |
| Events lifecycle and restart | 1/1 | runtime-events-7de230923b60 | 87973888 |
| Discovery-only human and internal-node boundary | 1/1 | runtime-human-boundary-e574f0fbdc77 | 81629184 |

Unit names have prefix `chunlack-` and suffix `.service`. Each reported exit 0,
zero failures/cancellations/skips, verified limits, stopped owned unit,
unchanged protected service baseline, and removed owned source/scratch/archive.
Reports and TAP logs are retained. Cleanup regressions took 11199.640853 ms.

The eight public-runtime groups cover 17 cases from the same immutable source
archive, SHA-256:
`e893239846cfc5c1e6d48b6faa0bec79b3b41f928801bef1039f1d7b0278497b`.
The three-file cleanup archive SHA-256 is:
`ed26217d44d2abbf9a1473c67659f4cc51daa886a8269ecc4796020237a7b796`.
The human-boundary archive SHA-256 is:
`b968b96b3c3da7ef7becd7e31f9ff6cd8914fe374e8043c816e1f02408c275f3`.

The cleanup cases include a deliberately non-cooperative synthetic child. Its
forced-cleanup error must be retained while another child is still cleaned;
that test is not evidence that forced termination is graceful shutdown.

Local reports and source archives are retained under the ignored directory
`.superpowers/sdd/2026-10-14-agent-grant-routing/`, named
`chunlack-<unit suffix>-report.json` and `chunlack-<unit suffix>-source.tar`.
Remote report.json and results/tests.tap are retained under each unique
`/var/tmp/chunlack-<unit suffix>/` directory. No production file permissions or
dependencies were changed; any dependency copies were private to each trial.

## Protected-service observations

Each group compared before/after MainPID, NRestarts, and ActiveState for old
LACK, public LACK, HTTPS, and tailscaled. They matched. Old and public health
endpoints returned HTTP 200, and the existing UDP 40000 relay listener remained
present. This is process/health/listener evidence, not an end-to-end relay
traffic test, a sustained capacity result, or a production login acceptance.

## Remaining delivery gates

- Resolve or independently account for the full-suite failures; do not report
  this 25-case native selection as all project tests passing.
- Verify the complete discovery/authorization integration before any new
  production activation. This phase did not activate discovery-only mode.
- Complete real Muse (Lao Zhen) and dots (Xuan Ji) task receipt, their own cloud
  computer execution, evidence return, and persisted ChunLACK receipt. Neither
  a worker substitute nor mock model output is equivalent acceptance.
- Retain the full private-platform scope: multi-user/workspace authorization,
  provider-neutral direct model routing, actual model and Agent acceptance,
  bounded five-Agent collaboration, recovery/rollback, and co-host stability.
  This report does not establish those broader gates.
- Finish scoped secret-safe GitHub synchronization and the user handoff after
  the relevant acceptance gates. No commit or push was made in this step.
