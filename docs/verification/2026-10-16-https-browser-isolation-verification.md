# HTTPS and browser isolation verification, 2026-10-16

## Outcome and boundary

Fourteen additional distinct Linux cases passed: three packaged HTTPS cases,
nine TLS ingress cases, and two browser fixture cases. Together with the prior
25 cases documented in 2026-10-16-runtime-cleanup-linux-verification.md, this
is 39 distinct passing Linux cases. Diagnostic repetitions are not added to
that count. It is not a new complete Windows run, real-model acceptance,
vendor-Agent acceptance, or production delivery.

No product source or production service was changed in this follow-up. All
changes were to ignored local isolated-test runners and diagnostics. Each test
unit retained nobody/nogroup, private networking, private temporary storage,
read-only source/dependency mappings, 192 MiB memory, 10 percent CPU,
TasksMax=32, and a 90-second unit lifetime. No test assertion or original
per-test timeout was removed or increased.

## Failures investigated, not erased

### Browser 503 and task/thread saturation

The first browser DELETE test failed at login with HTTP 503. A diagnostic
reproduction showed the synthetic application's process exiting with SIGABRT,
while its local proxy observed ECONNRESET. A second diagnostic recorded
pids.current=31, pids.max=32 immediately before login and pids.events.max
increasing from 0 to 1 at the process abort. Cgroup OOM counters stayed zero.
The trace recorded stages, timing, error classes and resource counters only,
not headers, tokens, passwords, bodies, or full request URLs.

With explicit approval, only this single-file browser test uses the native
Node-supported --experimental-test-isolation=none option. The redundant Node
test worker is removed, not the application's own subprocess. The private
systemd unit remains the security boundary; no files run concurrently inside
that test process. Production settings, UV_THREADPOOL_SIZE, password hashing,
thread limits, memory and CPU limits were not changed.

The same diagnostic source archive then passed. At login pids.current was 25,
pids.events.max remained zero, login returned 200 and the application exited
with code 0 and no signal. The uninstrumented DELETE and early-STOP cases also
passed. This supports test-harness thread/task saturation as the cause of the
observed isolated failure, not a conclusion that the production VPS needs more
RAM or a claim about the precise native abort instruction.

Failed diagnostic: chunlack-runtime-browser-diagnostic-86ba2757daf3.service.
Passing diagnostic: chunlack-runtime-browser-diagnostic-fa9e8ca1e976.service.
Both used archive SHA-256:
`87334dd2e1dfa6627fb472bac51446b0306ca28efbf5055999997c67c102e5a3`.

### HTTPS fixture output mapping

The initial HTTPS-session trial failed before any login assertion because its
fixture output directory was absent in the read-only source namespace. The
approved repair adds one writable bind mount from the trial's private results
directory to that exact fixture-output path. Code and production dependencies
remain read-only; no production file permissions were changed. The same
packaged-HTTPS source archive subsequently passed all three cases.

### Terminal state and report retrieval

The earlier runner treated a failed systemd unit as not stopped even with
MainPID=0. Its conservative retention of temporary files was not a test pass.
With approval, cleanup now requires MainPID=0, terminal inactive/failed state,
the exact expected dedicated cgroup, and an absent or proved-empty cgroup
(populated=0 and empty cgroup.procs). Original failure results remain failures.

Two already-finished trials were separately audited and their owned payloads
removed only after that proof. Original reports were retained unchanged:
- chunlack-runtime-browser-delete-9d52f1f0f942.service
- chunlack-runtime-https-sessions-767b6c2919b9.service

The first HTTPS report could not be parsed from the SSH command response. Its
complete original report was recovered through SFTP without rerunning the
test. The runner now retrieves the bounded report file using SFTP and checks
its length, unit identity and archive digest. The exact cause of the earlier
command-response parse failure was not established.

## Passing runs

The following names have prefix chunlack-runtime- and suffix .service.

| Scope | Passed/total | Unit suffix |
| --- | --- | --- |
| Packaged HTTPS sessions, Origin/CSRF, workspace authorization | 1/1 | https-sessions-e71ec91c84be |
| Packaged login/workspace pages and referenced scripts | 1/1 | https-assets-dee95e6e322a |
| Packaged WSS, scoped sender and separated Agent routes | 1/1 | https-wss-2328fd4e70bc |
| TLS fixture cleanup and ingress rendering guards | 5/5 | tls-foundation-be4a65a922f0 |
| Actual TLS routing, raw paths and proxy-header boundaries | 1/1 | tls-routing-829568a98342 |
| Verified HTTP/2 and WSS | 1/1 | tls-protocols-90caa27169c1 |
| Signed Agent lifecycle, revocation and host separation | 1/1 | tls-agent-040dcabeabbc |
| Disabled Agent OAuth metadata remains unavailable | 1/1 | tls-disabled-b10d8a2c0ec4 |
| Browser DELETE forwarding and unchanged identity checks | 1/1 | browser-delete-b41f616a1571 |
| Browser STOP before readiness | 1/1 | browser-stop-172ed16bc6fb |

All listed runs exited 0 with no failures, cancellations or skips. Owned test
units stopped and payload directories were removed; evidence reports remain.
Before/after old LACK, public LACK, HTTPS and tailscaled process identities and
restart counts matched. Health endpoints returned 200 and the existing relay
listener remained present. This is not an end-to-end relay traffic or capacity
test. Failed test units may retain their systemd failed-state record; no
reset-failed operation was used to mask the failures.

Immutable archive SHA-256 values:
- Packaged HTTPS: ae3a5cc4c62b419001c19b5059e1d2e55cb959be2a0a173ef392e0dfd6e4f422
- TLS ingress: 7641624b75a47264a241028d11db58ff3dc611ff2bda782c253455e96e657101
- Uninstrumented browser: 14ae263d509ad489b0532a38126153d71603ee1a3b6b32de2298515e9a21ef67

Reports, handles, source archives, cleanup audits and diagnostic traces are in
the local ignored .superpowers/sdd/2026-10-14-agent-grant-routing directory.
Report names are the full unit name without .service, followed by -report.json.

## Full-suite failure correspondence

All six non-passing cases from the previous 841-case Windows diagnostic now
have passing Linux counterparts, while the original Windows failures remain
recorded:
- Discovery-only human boundary: prior runtime verification report.
- Packaged referenced scripts: https-assets above.
- Caddy raw paths and proxy headers: tls-routing above.
- Materialized import: prior runtime verification report.
- Legacy entry writer guard: prior runtime verification report.
- Browser JSON DELETE adapter: browser-delete above, with the expressly
  documented single-file test scheduling difference.

This correspondence is not a claim that a new full suite passed in one
environment, nor that all Windows-specific behavior is revalidated.

## Local admission and next gate

At 2026-10-16T14:39:16Z, a bounded local admission check observed CPU busy
fractions 0.889, 0.817 and 0.756, with 2574204928 bytes available RAM. Node and
Python no-op controls completed in about 738 and 457 ms. This is better than
the previous no-op timeouts, but did not meet the conservative predeclared
admission gate. No new full Windows suite was started, and no unrelated
process was stopped. Evidence: local-suite-gate-a4ac470e-2043-42df-8a88-89bc1d0b146d.json.

Next: use this evidence to prepare a read-only candidate-version/deployment
diff and rollback plan for the public-discovery-only stage, without activating
it or granting access. Full regression reporting, scoped secret-safe GitHub
synchronization, actual provider/vendor execution and user delivery remain
open. Public metadata must not be confused with successful Muse/dots access.
