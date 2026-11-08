# Full native capture integration: local phase

## Scope and current proof

The 2026-11-08 live SSH readiness check passed in 7.96051 seconds. It proved
process context, source/nonce correspondence, genuine diagnostic exit, and
ordered SSH cleanup. It did not run query children, inventory business data,
create a unit, measure host capacity, or authorize publication.

The six module/input digests are recorded in the companion gap audit. Existing
frozen worker, inventory, support, launch contract and collector stay unchanged.
Private implementation files are not included in this documentation sync.

## Interfaces that must meet

- launch_contract.build_request(packet, binding_sha) builds a request; it does
  not execute or authorize it. Its nativeExecutionAllowed field stays false.
- launch_contract.verify_loaded_unit requires the exact expected invocation,
  transient identity, complete accepted Service command schema, exact executable
  and argv, empty command flags, and genuinely empty auxiliary Ex properties.
- collector.NativeQuery binds one unit and uses the corrected NativeOps. The
  latter requires isolated Linux/root, a single main thread and default SIGCHLD
  ownership before child creation, wait and any owned-group termination.
- collector.collect reads identity -> complete introspection -> all accepted Ex
  properties -> identity again. It is not a service-start or capacity API.
- native.execute_worker validates its fixed input, source hashes, zero-capability
  worker identity, invocation, cgroup and applied kernel limits before census.
- native.observe_terminal verifies the legacy policy, receipt, source hashes,
  genuine unit exit and cgroup absence/emptiness. Its legacy query path and
  textual command prefix are not the strong structured launch proof.
- inventory.inventory returns metadata counts only. Full coverage does not mean
  a consistent application snapshot or sufficient backup/publication space.

## Local implementation sequence

1. Add a new private integration adapter and tests, with no SSH/start/stop API.
   Load only the fixed source closure by checked bytes. Reject packet or source
   drift before constructing a query or reader. Do not alter frozen modules.
2. Combine independently latched unit/invocation identity, structured launch
   evidence and terminal/census evidence. Never obtain the trusted invocation
   solely from the worker receipt being checked. Do not relabel injected readers
   or queries as native by replacing class aliases or setting a boolean.
3. Keep a single bounded phase deadline across collection, observation and
   cleanup. Existing 18-second collector/worker and 2-second query bounds are
   ceilings, not fresh budgets per retry. If a phase cannot fit, reject it.
4. Preserve the original observer policy, complete census checks and genuine
   process exit proof. Do not use the legacy textual prefix alone as command
   authorization. Do not widen the accepted command schema or discard entries.
5. Define exact before/after protection-baseline and resource-evidence inputs.
   Baselines must cover the existing co-host services and selected unchanged
   source/configuration identities; do not infer them from absence of errors.
   Preserve unknown metrics as unknown. Do not read business database contents.
6. Add deterministic local regressions for source/packet drift, wrong invocation,
   extra command stage/argv/flags, nonzero or missing exit, schema/output limits,
   partial census, late callbacks, cleanup failure and mismatched evidence.
   Native readiness, native capture, census, capacity and publication remain
   distinct verdicts. Finish with one whole-boundary independent review.

## Native phase is not authorized by this plan

Only after local tests and review pass, propose an explicit new allowance for
one fixed worker and bounded read-only SSH orchestration. Decide the outer
shared startup/observation/cleanup budget from the completed local assembly;
do not assume that the spent 20/35-second readiness allowance covers it.

The existing worker policy remains: UID996/GID987, no supplementary privilege,
NNP, zero capabilities, 192 MiB, CPU20%, CPUWeight10, Nice10, 32 Tasks, swap0,
private network/tmp/devices, strict read-only host protection, fixed data root,
20-second start timeout, at most 2-second stop timeout and 18-second worker
internal limit. All process descendants must share its limits.

Use a new exclusive staging root and nonce only after explicit native approval.
Never reuse failed directories, locks, invocation IDs, allowances or receipts.
Any bounded stop may target only the independently verified owned unit, never
LACK, HTTPS ingress, Pocket ID or Tailscale Relay. Failure stops the phase;
no automatic retry or budget expansion.

## Completion boundaries

- Local integration green is not native capture acceptance.
- Native capture plus complete census is not capacity sufficiency.
- Capacity evidence is not a consistent backup, restore/rollback trial or release.
- No production update is authorized by this document. Production still requires
  fresh source/configuration/compatibility proof, consistent backup, protected
  co-host baseline, bounded recovery and a separately confirmed maintenance scope.
- Provider-neutral routing, Ollama support, real model tests, bilingual UI/help,
  multi-user workspace boundaries and native external-Agent acceptance remain
  part of the overall delivery goal; this work does not redefine that goal.
