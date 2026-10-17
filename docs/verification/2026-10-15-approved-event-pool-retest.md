# Approved event evidence and client-pool corrections

Date: 2026-10-15. Local tests only; not deployment acceptance.

## Approved and changed

The user explicitly approved the event-delivery evidence correction and the
packaged-admin fixture's owned client-pool lifecycle correction.

Changed only these test files:

- `tests/helpers/public-agent-fixture.cjs`: observe settlement of the real
  webhook transport, returning only outcome/reason/abort state to the test.
  DNS and remote HTTP remain synthetic; real authorization is not replaced.
- `tests/public-agent-scope-events.test.cjs`: require a completed
  `callback_access_denied` rejection with no abort signal, only the earlier
  verification callback, and a successful live discovery request, before
  shutting down the runtime.
- `tests/public-agent-admin.test.cjs`: use a fixture-owned existing `undici`
  Agent for its HTTP calls, close the old pool before runtime shutdown, create
  a fresh pool after restart, and close it during final cleanup. Pool closure
  has a five-second failure bound and destroys the owned pool on failure.

No dependency was added. Existing HTTP request and test-case budgets were not
increased. No product, model, credential, public ingress or VPS change occurred.

## Focused result

```text
node --test --test-reporter=tap --test-concurrency=1 --test-timeout=90000 tests/public-agent-scope-events.test.cjs tests/public-agent-admin.test.cjs
```

5 tests passed, zero failures/cancellations/skips/todo, exit 0,
48520.9378 ms. This includes the exact observed access-denied settlement before
shutdown, and the same-port disabled-OAuth restart through a fresh client pool.

## Fresh full run: not accepted

```text
node --test --test-reporter=tap --test-concurrency=1 --test-timeout=90000 tests/*.test.cjs
```

Used the existing bundled Node, Python and hash-verified portable Caddy.
The original execution handle 5849 reached a terminal exit 1:

- Tests: 823.
- Pass: 801.
- Fail: 20.
- Cancelled: 2.
- Skipped/todo: 0.
- Duration: 2157049.0693 ms.

The five approved-scope tests passed again in this full run: test 492 and
tests 499-502. All fourteen pinned product/test files matched their pre-run
SHA-256 values after completion. No source edit occurred during the full run.

### All non-passing cases

| Test number | Case | Evidence category |
| --- | --- | --- |
| 193 | initialized notification then scoped discovery/read | Known MCP assertion, correction not yet approved |
| 194 | invalid JWT on initialized notification | Known MCP assertion, correction not yet approved |
| 195 | optional SSE GET status | Known MCP assertion, correction not yet approved |
| 196 | unsupported protocol header | Known MCP assertion, correction not yet approved |
| 197 | generic MCP ping | Known compatibility assertion, correction not yet approved |
| 439 | four distinct five-Agent HTTPS/WSS rounds | Caddy child ETIMEDOUT |
| 441 | oversized soak duration CLI rejection | Child exit status null, expected 1; cause not established |
| 442 | three humans/five nodes task lifecycle and recovery | Python child ETIMEDOUT |
| 443 | packaged login/workspace HTTPS assets | Python child ETIMEDOUT |
| 444 | packaged HTTPS sessions/Origin/CSRF/workspaces | Python child ETIMEDOUT |
| 445 | packaged WSS and host administration isolation | Cancelled after 30000 ms case timeout |
| 494 | public runtime live grant discovery/revocation | Known nodeId/id test assertion, correction not yet approved |
| 515 | real TLS routing/raw paths/proxy headers | OpenSSL child ETIMEDOUT |
| 516 | HTTP/2 and WSS browser host boundary | OpenSSL child ETIMEDOUT |
| 524 | synthetic read-only preflight CLI | Child exit status null, expected 0; cause not established |
| 535 | OIDC incomplete-body shutdown writer lock | Node child ETIMEDOUT |
| 536 | OIDC incomplete-body rollback writer lock | Node child ETIMEDOUT |
| 537 | materialized import side-effect boundary | Python child ETIMEDOUT |
| 538 | packaged web/REST/MCP lifecycle and restart | Cancelled after 25000 ms case timeout |
| 539 | MCP-port conflict startup rollback | Python child ETIMEDOUT |
| 540 | legacy server writer-guard enforcement | Python child ETIMEDOUT |
| 542 | materialized Events lifecycle/restart | Python child ETIMEDOUT |

Do not attribute all new failures to host load without further evidence. The
null child statuses do not by themselves establish timeout or its cause.
No timeout was relaxed and no failed assertion was removed in this run.

## Exceptional test-process cleanup

After test 445 reported its timeout, the log stopped progressing for several
minutes while its Node child and unique Caddy child remained alive. Read-only
inspection found Node 13848 under the full-suite parent 20620, with Caddy
36816 using exactly the owned-KGSsDl fixture configuration.

After rechecking executable paths, full-suite/child command lines, parent chain
and exact unique fixture config, stopped only that owned Caddy and timed-out
test child. Did not stop or restart the full-suite parent. Preserved the fixture
directory. The original full run then continued to its terminal result above.
These cancelled/failed results remain failures, not passing cleanup acceptance.

Final bounded process query found zero matches for the original suite parent,
that test child, and the exact owned Caddy configuration. This is not an audit
of unrelated processes or services.

## Evidence

Plan-owned ignored directory:
`.superpowers/sdd/2026-10-14-agent-grant-routing/`

- `approved-evidence-pool-focused.tap`, SHA-256
  `f8a6cf4d6b6482990d5f49f1bb2b6dcddab08fb869246b36369201de180a3e85`.
- `approved-evidence-pool-full.tap`, SHA-256
  `cbfa06083a937bfd8b0bd329465b66818ef451164654d2bd6f65bf51c03af7b7`.
- `approved-evidence-pool-full-source.json`: fourteen source pins, all matched.
- `approved-evidence-pool-failures.json`: extracted non-passing case inventory;
  full TAP remains authoritative for multiline assertions and stacks.

## Remaining gates

The two specifically approved corrections are verified locally. The overall
repository is not green and no release is claimed. Remaining work includes the
separate node-field correction, MCP lifecycle/ingress compatibility, diagnosis
of the new child timeouts and cancellation cleanup, clean full/native validation,
and actual browser/vendor acceptance. No Git push or production update was made
while these gates remain open.
