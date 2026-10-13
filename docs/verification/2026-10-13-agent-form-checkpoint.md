# Agent form development checkpoint - 2026-10-13

Status: NOT ACCEPTED FOR RELEASE. This is a development checkpoint, not a
production deployment or a completed delivery.

## Scope

- Replace native prompt-based Agent creation with an in-page form, selecting
  a configured provider and preserving existing backend authorization.
- Cover cancellation, model-load failures, stale workspace/provider responses,
  and repeated submission with tests against the embedded frontend functions.
- Adjust only Windows HTTPS test-fixture startup budgets after explicit
  approval. Caddy validation, adaptation, and readiness each have a bounded
  20-second allowance; the individual test allowance is at most 90 seconds.
  Add phase timing diagnostics. Production timeouts and Linux resource limits
  are unchanged; certificate, routing, HTTP/2, and WSS assertions remain.

## Test evidence

1. Full local suite before the Windows fixture adjustment: 566 tests,
   561 passed, 5 failed, none skipped or cancelled, exit 1, approximately
   25 minutes. Failures were the new reconnect regression, packaged runtime
   readiness, two real-Caddy fixtures, and the synthetic preflight subprocess.
2. Unchanged targeted rerun: 4 tests, 2 passed and 2 failed, exit 1.
   Packaged runtime and synthetic preflight passed. Both Caddy tests still
   failed at their old five-second validation/adaptation limits. The other
   intermittent failures are not thereby proven resolved.
3. Read-only Caddy process diagnostic: version completed in 4.248 seconds;
   synthetic configuration adaptation completed in 12.799 seconds. No
   listener or service was started by that diagnostic.
4. After the authorized Windows fixture adjustment: all 4 public-ingress
   tests passed, none skipped or cancelled, exit 0, total 65.973 seconds.
   Real TLS routing, path boundaries, trusted proxy headers, verified HTTP/2,
   and WSS assertions passed. Validation took 9.102/6.121 seconds, adaptation
   4.911/6.008 seconds, and readiness 12.085/4.697 seconds.

The latest four-test pass is not a replacement for a green full-suite run.
The full suite has not been rerun after the Windows fixture adjustment.

Local evidence is retained in the ignored release-preparation directory:

- `agent-form-full-suite.tap`
- `agent-form-unchanged-recheck.tap`
- `agent-form-caddy-budget-recheck.tap`
- `agent-form-isolation-postflight.json`

## Open release gates

- The same-workspace reconnect test reproduces duplicate submission: replacing
  the socket before receiving the creation acknowledgement discards the
  pending guard on reopening the form. Its regression is intentionally failing.
  The requested repair has not yet received a specific answer.
- The local real-browser fixture failed during runtime readiness. Form tests
  use a synthetic DOM with the actual embedded functions; they are not proof
  of successful browser-level acceptance.
- The new Linux isolation wrapper failed with systemd 226/NAMESPACE before
  Node started: its owned results directory was not explicitly mapped through
  PrivateTmp. No native tests ran in this attempt. The requested wrapper-only
  repair is pending authorization. Preserve the 192 MiB, 10% CPU, 90-second
  and private-network restrictions when retrying.
- After these repairs, rerun the affected tests, full local suite, bounded
  Linux isolation and browser acceptance before considering deployment.

## Production and wider delivery boundary

No form update or Windows fixture change has been deployed. This work did not
restart the old LACK service, candidate services, or Tailscale Relay. Following
the failed isolation launch, read-only postflight found their PIDs and restart
counts unchanged, verified public HTTPS health returned 200, and Relay UDP
listeners remained present. This is not a Relay forwarding performance test.

Prior Pocket ID human login and direct-provider model listing have separate
evidence. They do not establish real model generation through the new form,
multi-Agent task completion, or native Muse/dots computer execution.

Three separate synthetic probes of the older, unmounted custom OAuth core
failed previously. They are outside this 566-test suite. That abandoned core
must not be mounted or represented as accepted; external Agent authorization
remains a separate Pocket ID integration and acceptance task.

Do not publish this checkpoint as a production-ready release.

## Subsequent unchanged browser-fixture retry

After checkpoint `88180a1`, the clean development worktree was checked and the
existing manual browser fixture was retried without code or budget changes.
It again exited 1 during runtime readiness, before producing browser URLs.
Its synthetic startup log contained only the J-space stub initialization
message; it did not contain the required workspace-runtime listening marker.
The existing runtime allowance remains 20 seconds.

A subsequent read-only host CPU sample reported 100 percent utilization.
This is a point-in-time observation, not proof that CPU contention caused the
timeout. The diagnostic did not establish an offending process or justify
changing production limits. No real-browser form acceptance was completed,
no additional startup retries were launched after that observation, and no
VPS service was changed during this retry. Pending reconnect and isolation
wrapper repairs remain unapplied.
