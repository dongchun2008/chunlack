# Bounded i18n release gate

## Approved scope

Local-only candidate controller adaptation and simulated regressions. No VPS
units, production execution, model calls, deployed-controller changes,
credentials, grants, ports, Agent settings, or Relay changes are authorized.

## Design

Use an independent adapter around hash-pinned existing controller and read-only
gate sources. Do not edit those sources or duplicate the operational backend.
Retain cold, consistent backup, filesystem-identity recovery, writer-lock
refusal, schema guards, protected-service checks and service-account checks.
Keep the existing 55-second forward and 120-second total recovery budgets.

Allow only the fourteen named i18n code/template paths. Bind complete previous
and candidate inventories, dependencies, authority fingerprint, raw config,
environment, ingress, controller sources and fresh database-copy proof.
The final ingress may differ only by the seven exact read-only asset paths and
the separate deferred nosniff directive. Never write or restore configuration
JSON, credentials, database backups or uploads during code-only recovery.
Externally changed ingress is not overwritten. Failed recovery is reported as
requiring attention, never as success. The candidate has no production CLI.

## Files

- `deploy/public/release-control/2026-10-25/i18n-release-gate.py`: adapter and gate.
- `deploy/public/release-control/2026-10-25/test-i18n-release-gate.py`: local real-file simulations.
- `tests/i18n-release-gate.test.cjs`: include Python regressions in the normal suite.
- `docs/verification/2026-10-25-i18n-release-gate.json`: sanitized results after verification.

## Execution and evidence

1. Add tests and observe assertion failures before implementation.
2. Implement the adapter once; keep existing controllers byte-identical.
3. Run new tests, existing controller/preflight regressions and the full local suite.
4. Test interrupted copying, rename interruption, failed start, failed recovery,
   changed configuration/credentials/ingress, stale proofs, scope drift, schema
   drift, retained locks, user writes, deadlines and disabled production CLI.
5. Scan exact staged bytes, sync the approved files, and verify the remote commit.
6. Propose fresh Linux rehearsal units and a scoped maintenance window separately.

Local simulations are not Linux rehearsals or production acceptance.
