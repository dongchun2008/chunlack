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

## Earlier incomplete integration checkpoint

2026-11-16: 40 Python cases and four real-store Node cases passed after independent source review and local corrections. Three unseeded databases, an existing-owner-only private probe and full source/dependency/configuration/row/schema/authority checkpoints are implemented. The full two-boot join has **not** passed: its local fixture exhausted preparation while scanning the complete physical dependency tree, before application spawn. Failed fixtures are retained; no compatibility proof was produced. Worker/job/publisher integration, native validation and production delivery remain open. The reviewed local adapter is not the native pidfd execution path.

Local test ruling: the new full-tree fixture's initialization uses the remaining original 90-second overall deadline with 15 seconds reserved for boots/cleanup (maximum initialization 60 seconds). Existing boot-controller operations retain their original 10-second caps. This changes only fixture setup allocation and did not make the join pass; it changes no production or Linux-unit budget. Subsequent work must resolve this failed integration rather than treat the 44 narrower passes as whole-plan acceptance.

## Current Windows fixture verification

2026-11-16: a separate test retained the original Windows fixture dependency junctions and completed the three-database unseeded copy, actual candidate/previous-role CLI boots, full serial source/dependency/configuration/row/schema/authority checkpoints, authenticated private node read and forwarded-node rejection. Final affected run: 40 Python cases, four real-store Node cases and one complete Windows join passed, no skips; the join took20.419 seconds (20.715 seconds including its command wrapper). Actual replacement-adapter diagnostics show two normally closed children, exit0, no signals/forced cleanup/overflow and no live children.

The earlier physical-copy fixture failures and sources remain unchanged. Assuming that the Linux directory-link rejection also required a physical copy for this existing Windows fixture was incorrect: a direct test showed the original validator accepts its Windows junctions. This correction is local fixture wiring, not a relaxation of the Linux read-only mount requirement or a claim that the old physical-copy case passed. All complete serial fingerprints remain recomputed. Both source roles are current materializations with distinct test HTML, not historical version compatibility.

A four-reader experiment produced the same full digest but did not show a warm-cache wall-time benefit and used more CPU; it is not adopted. Native worker/job/proof publication, actual historical source versions, kernel containment, formal release and live delivery acceptance remain incomplete.

## Native child component verification

2026-11-16: a separate Python-owned Node adapter now captures a pidfd before polling or reaping, uses a bounded extra-descriptor metadata channel, checks the actual child identity/command/network namespace and loopback socket ownership, and requires normal exit, all pipe EOFs, quiescence, the original guard receipt and writer-lock release. An initially fresh host context is held on owned descriptors for the original bounded job; its capture timestamp is never refreshed. Node's internal IPC protocol is not used from Python.

Concentrated source review identified an important interface mismatch: the frozen namespace helper only accepts `/proc/self`, so using it for a child always failed. The new adapter now opens only its actual child's fixed namespace path, owns/closes that descriptor, verifies namespace type and identity, and retains surrounding pidfd/generation checks. The original helper remains unchanged. The fixed-source contract regression reproduced the failure before passing after the fix; no second review or native test is claimed.

Final affected local verification passed 78 cases: 28 new Python component tests, 40 existing Python cases, six Node pipe cases and four real synthetic gateway-store cases, without skips. All 25 selected source/test pins remained unchanged. Linux identity/namespace/pidfd/mount behavior was exercised through syscall doubles; the actual extra-descriptor child exchange ran on Windows. These are component results, not native compatibility. The full job capsule, worker entry and owner-only proof publication still require integration before requesting new native execution. No VPS connection, Linux unit, model call, Agent call, production publication, credential/grant or Relay change occurred in this local step. The earlier successful one-shot capacity allowance remains consumed; it was not repeated.

## Local fixed entry implementation

2026-11-16: the fixed root-capsule reader, bounded probe READY/GO process, unseeded-copy/two-boot orchestration, worker entry and owner-only report preparation/publication are now implemented privately. Source and material names are exact, frozen artifact tags remain distinct from execution tags, and captured input bytes are not promoted to fresh production observations. The worker never writes final proof. Its owner requires normal worker exit/EOF/quiescence/descriptor closure and the original complete validator before publication.

Concentrated source review found four important issues, all addressed in one regression-backed fix pass: constructor deadlines now preserve cleanup reserves; the new object is owned before resource acquisition; safe primary/cleanup diagnostic trees survive worker rejection; report publication uses a single no-overwrite atomic commit rather than fallible link/unlink postchecks. The Linux commit requires `renameat2(RENAME_NOREPLACE)` with no fallback. Every validation and writer close precedes commit; a later receipt error is reported separately from the committed transaction. No second source review is claimed.

Final affected local verification passed125 cases:71 entry/component Python cases,40 existing Python cases,6 metadata-pipe Node cases,4 probe-entry Node cases and4 existing real synthetic gateway-store cases. No failures/skips/timeouts; selected source/test hashes were unchanged. A private inactive snapshot binds22 entry/source files. Native syscall paths and atomic rename ABI remain doubled locally. No VPS connection/unit, model, external Agent, production publication, credential/grant or Relay action occurred.

The full transitive native package, historical source materialization and external producer sealing are still pending. Native acceptance must require the matching InvocationID, normal unit exit, report digest and complete validator; the presence of a `passed` file alone is insufficient. The earlier one-shot capacity scope remains consumed. No native execution or maintenance grant is inferred from these local results.

## Verified integration ruling

A local SQLite reproduction confirmed that the legacy six-row identity seed fires the membership trigger and adds an authority epoch, although original-row retention passes. Real copies must therefore remain unseeded in identity/collaboration: copy all original data first and add only a private synthetic gateway node referencing an existing copied owner/workspace. Preserve the original full authority fingerprint without filtering or modifying epoch records. The original six-seed copier stays unchanged as historical implementation; the new adapter reuses its fixed page-size, backup, integrity and row/schema-retention primitives. No actual production identity or grant is changed by this design.

## Inactive complete copy package and terminal lifecycle

2026-11-16: a new private candidate now binds193 source/product files, including66 manifest-bound candidate product files, the retained22-file historical entry snapshot, an owner job/InvocationID/PID correlation overlay and six derived hierarchy/pin changes. Old frozen source bytes remain unchanged. The separately derived copy request changes only the old helper hash through the existing revised binder; the successful capture and its timestamps are preserved, and its1/1 allowance remains consumed.

Final source-bound local verification passed74 cases, including all24 original kernel-guard assertions replayed against the derived guard. The actual persisted archive/catalog/private inputs were unpacked and replayed independently with the original full input/proof validators and a simulated retained-bus Manager lifecycle. Transitive compile bytes are bound to the complete catalog. Replay guards trusted fixed-source effects; it is not an OS sandbox for arbitrary code. The prior125 cases are separate historical evidence and are not added or claimed rerun.

Concentrated review found the slice hierarchy mismatch and missing transitive compile binding; their corrections were narrowly reviewed. A subsequent Manager review found forward cgroup reclamation during terminal sampling and loss of nested transport cleanup errors; both were reproduced and corrected with regressions. No second Manager review is claimed. Terminal validation requires an earlier exact live owner and normal exit, full report/receipt bindings and freshness; a passed file or terminal-only first observation never suffices. Startup5s+runtime84s+stop1s remains within90s, and the Manager reserves8s inside its own90-second envelope for cleanup.

This is local component progress, not a native copy proof or production readiness. No VPS connection/unit, model/Agent call, production action, credential/grant/Relay/DNS/port change occurred. NativeManagerReady remains false: concrete same-descriptor library/bus entry, scoped host materialization, fixed result-file observation and hard outer watchdog binding still require integration. Native historical-source/dependency checks, controlled release and live delivery acceptance remain pending; quiet dots/Muse integration remains open. Only this sanitized record and plan update are synchronized, not private implementation or material bodies.

Evidence: [local package verification](../../verification/2026-11-16-native-copy-producer-local-package.json).
