# Session migration and restore validation - 2026-10-12

## Approved scope

Local test fixtures only. Correct the legacy-session INSERT from nine placeholders
to eight and extend active/revoked session migration and restoration coverage.
No product code, production data, Pocket ID configuration, VPS services, or
Tailscale Relay configuration was changed.

Changed test: `tests/workspace-migration-apply.test.cjs`.

## Coverage

- Seed active and revoked sessions in the genuine frozen v1 schema, using explicit
  INSERT columns and the existing SHA-256/HMAC session and CSRF formats.
- Migrate only an isolated candidate; authenticate the original owner with the
  active session, validate CSRF, reject the revoked session, and verify logout.
- Preserve active/revoked external identities and sessions through a v2 snapshot
  and restore trial; exercise authentication, membership, CSRF and logout in a
  separate working copy rather than opening the verified archive for writing.
- Close session services before database handles and fixture cleanup.
- Assert original source bytes remain unchanged and the restored archive still
  independently verifies after the working-copy session operations.

## Fresh test results

Windows, Node v24.19.0. Python selected through `PYTHON=C:\Python\Python313\python.exe`.
Both commands exited with code 0.

Focused run:

```text
node --test --test-concurrency=1 --test-timeout=90000 --test-name-pattern="genuine frozen v1|v2 snapshot and restore" tests/workspace-migration-apply.test.cjs
```

2 tests, 2 passed, 0 failed, 0 skipped, 0 cancelled; 6320.4978 ms.

Related regression:

```text
node --test --test-concurrency=1 --test-timeout=90000 tests/workspace-migration-apply.test.cjs tests/workspace-snapshot.test.cjs tests/workspace-restore-trial.test.cjs tests/identity-session.test.cjs tests/identity-store.test.cjs
```

77 tests, 77 passed, 0 failed, 0 skipped, 0 cancelled; 82930.8352 ms.
The two focused tests are also included in the 77-test regression, not 79 unique tests.

Local ignored evidence directory:
`.superpowers/sdd/2026-10-11-real-1cat-provider/`.

| Log | SHA-256 |
| --- | --- |
| `session-restore-focused-20261012.log` | `d43fb26124fa580901cd8cb031aaec6d3e9291baca0fd06ec62d1e833dd52062` |
| `session-restore-regression-20261012.log` | `379ab9ecb78fbcb55edfdee8c268b6c4b41b29ca4b765102dff428af460c04a5` |

## Acceptance boundaries and remaining work

This closes the local active/revoked-session migration and restore coverage gap.
It is not a fresh full-repository test run or Linux/production acceptance.
The restore trial remains non-activatable. These checks prove archive fidelity
and behavior in an isolated working copy, not that production restoration may
reuse old active sessions or preserve revocations made after the snapshot.

The previously reported OIDC issues remain unresolved by this test-only change:
new login initiation must invalidate sessions issued by an older callback;
shutdown must await response-body cancellation settlement; and abandoned browser
records must be reclaimed without exhausting the bounded registry. Their product
repairs and the uncooperative OIDC shutdown/writer-lock regression remain pending
separate approval. Real Pocket ID login and native Muse/dots end-to-end acceptance
are not established by this checkpoint.
