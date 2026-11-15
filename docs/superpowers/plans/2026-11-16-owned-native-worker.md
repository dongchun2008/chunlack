# Owned native worker and compatibility entry plan

> Use superpowers:executing-plans inline. Local implementation proceeds under the standing goal. Native calls, units and production operations remain separately scoped; do not reuse exhausted allowances.

**Goal:** Execute the actual fixed copy/boot job inside a bounded owned Linux worker, confirming identity before GO and normal exit, pipe closure and scoped quiescence before proof publication.

**Architecture:** Reuse pinned host-origin attachment, original copier/full validator and serial Node boot controller. Add the missing pidfd-based worker owner; the existing <=35-second session/manager-removal API is not reused as a90-second job owner. Linux signals target verified pidfds only; no numeric-PID kill fallback. A fresh private cgroup and read-only production DATA remain mandatory. Worker computes a provisional result; only its owner may publish compatibility proof after all terminal checks.

**Stack:** Existing Python standard library, Linux pidfd/poll/selectors, existing Node runtime/modules. No package installation or service change.

**Spec:** `.superpowers/sdd/owned-native-worker-20261116-a1/DESIGN.md` (private).

## Tasks

- [x] Write failing protocol/lifecycle/budget regressions for the owned worker engine (local verification).
- [x] Implement the owner engine and Linux pidfd backend, including bounded output and scoped descendant cleanup (local syscall doubles only; native execution unverified).
- [ ] Join an unseeded copy adapter using the original fixed backup/retention primitives, native baseline/checkpoints and serial boot job; root inputs and historical source/dependency bindings remain exact.
- [ ] Verify provisional worker results only after normal exit, pipe EOF, descriptor closure and no extra owned cgroup processes; invoke original full validator before exclusive final proof writing.
- [ ] Complete local simulated integration and source review, bind sources and synchronize sanitized evidence.

## Constraints

One absolute <=90-second envelope, cleanup reserve10s. READY<=10s; GO once only after actual kernel identity attestation. No retries, timeout extension or fallback worker. At most64KiB stdout and64KiB stderr; protocol nonce/tag/payload digest exact. Use real pidfds for Linux signals, preserve primary/cleanup errors, fail closed on identity drift or unconfirmed exit. No schema proof written by the worker before owner terminal acceptance. Forced cleanup may be confirmed but never makes a job pass. All children share the existing192MiB/20%CPU/32Tasks/zero-swap private unit; no new unit is launched by this component. Existing source helpers and production files remain unchanged.

This plan is not a native execution or maintenance grant. Real previous/candidate source bytes, fresh accepted root inputs, actual copy provenance, kernel restrictions and original proof validation are required before production readiness. Local doubles cannot establish any of these native facts.

## Current incomplete integration checkpoint

2026-11-16: 40 Python cases and four real-store Node cases passed after independent source review and local corrections. Three unseeded databases, an existing-owner-only private probe and full source/dependency/configuration/row/schema/authority checkpoints are implemented. The full two-boot join has **not** passed: its local fixture exhausted preparation while scanning the complete physical dependency tree, before application spawn. Failed fixtures are retained; no compatibility proof was produced. Worker/job/publisher integration, native validation and production delivery remain open. The reviewed local adapter is not the native pidfd execution path.

Local test ruling: the new full-tree fixture's initialization uses the remaining original 90-second overall deadline with 15 seconds reserved for boots/cleanup (maximum initialization 60 seconds). Existing boot-controller operations retain their original 10-second caps. This changes only fixture setup allocation and did not make the join pass; it changes no production or Linux-unit budget. Subsequent work must resolve this failed integration rather than treat the 44 narrower passes as whole-plan acceptance.

## Verified integration ruling

A local SQLite reproduction confirmed that the legacy six-row identity seed fires the membership trigger and adds an authority epoch, although original-row retention passes. Real copies must therefore remain unseeded in identity/collaboration: copy all original data first and add only a private synthetic gateway node referencing an existing copied owner/workspace. Preserve the original full authority fingerprint without filtering or modifying epoch records. The original six-seed copier stays unchanged as historical implementation; the new adapter reuses its fixed page-size, backup, integrity and row/schema-retention primitives. No actual production identity or grant is changed by this design.
