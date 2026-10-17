# Child timeout and cancellation cleanup diagnosis

Date: 2026-10-15. Local diagnostic only; no product/test fixture repair in this step.

## CLI exit-status follow-up

The previous full run remains 823 tests, 801 pass, 20 fail and 2 cancelled.
Two CLI assertions saw null child exit status instead of the expected code.
The original run did not record the child's error and signal, so null alone
does not prove why the child failed.

An ignored observation-only preload now wraps just those two `spawnSync`
calls. It preserves arguments, timeout, returned result and exceptions, and
logs command category, elapsed time, exit status, signal and error code only.
It does not log credentials, request bodies or arbitrary command arguments.

Ran the same two cases unchanged, with their original deadlines:

| Child | Deadline | Elapsed | Exit | Signal/error |
| --- | --- | --- | --- | --- |
| oversized-duration soak CLI | 5000 ms | 271 ms | 1, expected | null/null |
| synthetic Bash preflight CLI | 15000 ms | 2218 ms | 0, expected | null/null |

Result: 2/2 passed, exit 0, 2981.6369 ms. This isolated diagnostic does not
erase the earlier failed full run or establish its root cause. It gives no
basis for automatically increasing the existing deadlines.

The first diagnostic invocation mistakenly split the `--require` path and
exited with MODULE_NOT_FOUND before loading the diagnostic or any test.
Corrected only the invocation, using the quoted absolute path. No script,
test assertion or timeout was changed to obtain the two-case result.

## Confirmed Node cancellation behavior

Current packaged HTTPS test callers await fixture construction before
registering `t.after(() => fixture.close())`. The fixture constructor can
create databases, listeners and Caddy before it returns. It has initialization
error cleanup but does not accept the test cancellation signal. A cancelled
test need not throw an error inside its still-running initialization promise.

A small, ignored characterization used two real, independent loopback
listeners and deliberately cancelled each test after 30 ms while its body
waited for a 150 ms initialization gate:

| Registration | Test cancelled | Hook ran | Listener still open at late continuation |
| --- | --- | --- | --- |
| after initialization | true | false | true |
| before initialization gate | true | true | false |

Late registration returned without throwing, but its hook did not run.
An independent `finally` closed each owned diagnostic listener. Output
confirmed both were closed. The diagnostic intentionally reports 0 pass,
0 fail and 2 cancelled, exit 1; it is not an application regression pass.

This confirms a cancellation-ownership gap in the pattern used by the current
fixture callers and is consistent with the earlier retained test child/Caddy.
It does not establish the exact initialization stage of that earlier timeout,
nor explain every Python/Node/OpenSSL/Caddy startup timeout.

## Minimal proposed next correction

Pending explicit approval, change only the packaged HTTPS/WSS test fixture
and affected callers to register owned cleanup before asynchronous startup,
propagate test cancellation, and prevent later initialization continuations
from creating resources after cancellation. Closing early must not merely set
an idempotent flag while a later continuation creates an unowned process.
Cleanup must remain bounded and retain diagnostic directories on incomplete
cleanup. Add actual-resource cancellation regressions.

Do not increase test or production deadlines, remove TLS/security assertions,
terminate unrelated processes, or change production resource limits. The
earlier node-field and MCP lifecycle repairs still require their own decision.

## Evidence artifacts

All new executable diagnostics are in the ignored plan-owned directory
`.superpowers/sdd/2026-10-14-agent-grant-routing/`, not the repository test glob:

- `cli-child-outcome-diagnostic.cjs` and `.tap`.
- `cancelled-hook-characterization.cjs` and `.tap`.

Only two exact unchanged repository cases were rerun. No complete suite was
restarted. No production, Pocket ID, credentials, model routing, Relay, ingress
or Git publication change occurred. All diagnostic commands are terminal.
