# Runtime and grant administration full regression, 2026-10-15

Status: not accepted for deployment. One known test defect remains unrepaired
pending explicit approval; further end-to-end acceptance gates remain open.

## Source and execution

Base HEAD: `16c54da97dea149809ed10b97dfe192b7846ae65`, plus local runtime,
authority administration, UI and corresponding test changes.

Command:

```text
node --test --test-reporter=tap --test-concurrency=1 --test-timeout=90000 tests/*.test.cjs
```

The existing Node v24.19.0 runtime and verified portable Caddy executable were
used. The Caddy SHA-256 guard matched
`5f93a9bd555f3aac9d33af2756ba14b3519d8cca4ffd55256bdaeab444c9db2a`.
No unexpected preload environment was permitted. Ten changed product/test file
hashes were recorded before execution and matched after the run.

The same exec handle, `94218`, was observed until it returned terminal exit 1.
Observation waits did not trigger a restart. No manual process termination was
needed in this run.

## Actual result

- Tests: 814.
- Pass: 813.
- Fail: 1.
- Cancelled/skipped/todo: 0/0/0.
- Duration: 387278.753 ms.
- Exit: 1.

Only failed case:
`public runtime binds a deny-first facade, routes real JWT discovery and invalidates revoked grants`.

It fails at `tests/public-agent-runtime.test.cjs:117`, where this newly written
test reads `nodeId` instead of the gateway public-node field `id`. This is the
previously reported fixture error, not a newly observed product regression.
That test's subsequent assertions remain unexecuted and must not be counted as
passed. The field has not been silently repaired.

Full TAP report:
`.superpowers/sdd/2026-10-14-agent-grant-routing/runtime-admin-full.tap`.

SHA-256:
`161252f96215c45f62aa06c73cd48dbb057061c2e5ce109f4c61623cb07a9ef4`.

Source pins:
`.superpowers/sdd/2026-10-14-agent-grant-routing/runtime-admin-full-source.json`.

The earlier related-run OIDC child timeout did not recur in this complete run.
Its root cause remains unconfirmed; this does not retrospectively change the
earlier failed result.

## Independent review and coverage

An independent read-only reviewer found no actionable product defects within
the local steps 3-5 integration. The reviewer was closed after completion and
did not edit files, run tests, read credentials or contact production.

Review coverage is not delivery acceptance. Still missing are complete-runtime
scoped tool and OAuth event-subscription coverage, actual packaged browser
login/cookie/rendering acceptance, current constrained Linux validation, exact
public ingress/protocol acceptance, restore invalidation and real vendor tasks.

The local packaged human HTTP create/list/revoke to signed-JWT MCP discovery
test passes and is included in this full run. It uses seeded synthetic sessions
and is not a real Pocket ID login. The UI tests use a synthetic DOM; they prove
logic and safe text rendering, not real-browser appearance or cookie delivery.

## Release boundary

No production services, credentials, Pocket ID applications, provider routes,
ingress, DNS or Relay settings changed. No native Muse/dots enrollment or task
was performed. Local changes remain uncommitted/unpushed pending the known
repair and validation. The previous 793/793 result applies to the preceding
source, not this checkpoint.

Continue the outstanding acceptance work, correct the known fixture only after
approval, then complete a clean full regression before considering publication.
