# Full local regression checkpoint

Recorded: 2026-10-16. Log filenames retain their run-start date, 2026-10-15.

## Result and boundary

The current local working tree completed the full suite with **835 tests, 835
passes, zero failures, zero cancellations, zero skips**, exit code 0, in
855161.1556 ms. This is a full local regression checkpoint, not production
delivery, Linux isolation, a real model invocation, or Muse/dots acceptance.

The previous failing runs remain recorded in
`2026-10-15-mcp-lifecycle-retest.md` and
`2026-10-15-post-mcp-full-regression.md`. The earlier intermittent startup
timeout did not reproduce in this run; its underlying cause is still unknown.
Adding observations is not claimed as a product-level repair of that timeout.

## Diagnostic-only change

- `tests/helpers/migrated-runtime-child.cjs` emits fixed-name, numeric timing
  markers for configuration loading, entry loading, runtime startup, ready,
  close, and failure. The marker payload contains no configuration or secrets.
- `tests/migrated-runtime-business.test.cjs` reports a bounded allowlist of
  those markers and process state in a `finally` block around each startup
  wait, so a future failed wait can retain stage information.
- The 30000 ms startup wait, 90000 ms test budget, startup/exit checks, model
  calls, three-user/two-workspace assertions, source preservation, restart,
  and legacy recovery assertions were preserved.
- No product source, credentials, providers, production services, DNS,
  firewall, or Tailscale Relay configuration was changed in this continuation.

## Execution evidence

Node v24.19.0; Windows; serial test execution; Python 3.13; existing portable
Caddy 2.11.7 for the real local TLS tests. No test was removed or skipped.

```powershell
node --test --test-reporter=tap --test-concurrency=1 --test-timeout=90000 tests/migrated-runtime-business.test.cjs
node --test --test-reporter=tap --test-concurrency=1 --test-timeout=90000 tests/*.test.cjs
```

| Run | Tests | Pass | Fail | Cancelled | Skipped | Exit | Duration |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Focused business fixture | 1 | 1 | 0 | 0 | 0 | 0 | 57506.5012 ms |
| Full local suite | 835 | 835 | 0 | 0 | 0 | 0 | 855161.1556 ms |

The focused test's startup waits measured 9924, 5300, and 9111 ms.
The full suite's corresponding waits measured 3466, 1482, and 3691 ms.
All were below the unchanged 30000 ms limit.

Both execution sessions finished normally. A subsequent read-only process
query found no process matching the business test or its child entry. This
scoped query does not claim to inventory unrelated processes.

Local evidence directory:
`.superpowers/sdd/2026-10-14-agent-grant-routing/`.

| File | SHA-256 |
| --- | --- |
| `business-phase-focused-2026-10-15.tap` | `d312190099ad3e73bf00387e50f78b1d52901b94c51c9b61c1225bb77f6107d8` |
| `business-phase-full-regression-2026-10-15.tap` | `386d56ef96ae130746ee6a673b0512cdf579af146881c32e651eca502f52dad2` |

## Git synchronization preflight

The checked repository is `temp-chunlack`, branch
`cloud-agent-pilot-foundation`, base HEAD
`16c54da97dea149809ed10b97dfe192b7846ae65`. The origin matched the intended
`dongchun2008/chunlack` repository and the index had no pre-existing staged
changes. This test result applies to the uncommitted working tree, not just
that base commit.

`git diff --check` stopped the synchronization preflight because of five
trailing spaces in previously changed fixture callers:

- `tests/packaged-agent-rounds.test.cjs`: line 10.
- `tests/packaged-node-lifecycle.test.cjs`: line 13.
- `tests/packaged-public-ingress.test.cjs`: lines 8, 33, and 57.

No files were staged, committed, or pushed. A narrowly scoped cleanup and
related verification was presented for approval. Line-ending warnings were
not treated as permission to change global Git configuration.

## Remaining delivery gates

- Complete the bounded formatting cleanup, related checks, secret-pattern
  checks, and scoped GitHub development-branch synchronization.
- Bind the Linux isolation run to an exact current snapshot, retaining
  provenance, 192 MiB / 10% CPU limits, private networking, and co-host service
  preflight/postflight checks. The historical pinned runner was not executed.
- Implement and verify the already identified exact public Agent metadata and
  GET `/mcp` ingress routes without exposing human administration endpoints.
- Complete actual Muse/dots enrollment and cloud-computer execution with task
  identity, original evidence, result receipt, and revocation checks.
- Complete the other production, real-provider, sustained-collaboration,
  documentation, rollback, and delivery gates. No production release follows
  automatically from this local test result.
