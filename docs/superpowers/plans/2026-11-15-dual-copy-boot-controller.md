# Serial copy-compatibility boot controller plan

> **For agentic workers:** Use superpowers:executing-plans. Reuse the existing checkout and original private helpers; ordinary local implementation continues autonomously. Remote execution/publication remains separately gated.

**Goal:** Coordinate candidate then previous unmodified LACK startup against one persistent private database-copy directory, stopping on any failed identity, probe, close or preservation check.

**Architecture:** An effect-free flow engine controls a separately owned process adapter. Configuration-preserving guard and original IPC preload stay byte-pinned. The existing code-directory exchange pattern changes only private code directories. Checkpoints must separately validate original row/schema/authority preservation; no observations become a native proof.

**Tech stack:** Existing Node runtime, Python copy/validator helpers, installed dependencies; no installation.

**Spec:** `.superpowers/sdd/dual-boot-controller-20261115-a1/DESIGN.md` (private local design).

## Constraints

- Local synthetic data and owned local children only; no VPS, native unit, real model, external Agent or production operation.
- One shared <=90-second clock; no retries, timeout extension, data reset or lock deletion.
- Candidate clean close and checkpoint precede code exchange and previous startup.
- Failed/late callbacks and unknown cleanup cannot promote completion.
- Every result is provisional and cannot grant native execution or activate a release.
- Preserve actual configuration/Agent/provider bytes and the old synthetic driver.

## Tasks

- [x] Write failing engine tests for ordering, failed/late close, checkpoint/swap failure, immediate ownership, clock failure and separate cleanup errors.
- [x] Implement the bounded effect-free engine and pass its directed cases.
- [x] Implement the IPC owned-process adapter using the fixed guard, original preload, exact source/config/data checks and private-node probes.
- [x] Exercise two actual local LACK boots against one synthetic data directory; verify closure, source role transition and original rows/configuration retention.
- [x] Independently review the whole component, fix confirmed issues with regression evidence, run the complete affected local tests and bind source hashes.
- [ ] Synchronize only this plan and the sanitized verification record with exact GitHub readback.

## Remaining native gate

Kernel-enforced read-only production DATA, fixed helper execution, UID996/GID987/NNP/zero capabilities, cgroup resources, actual previous/candidate source/dependency binding, original full proof validation, and a new explicit remote unit scope remain necessary before real compatibility acceptance. Synthetic role snapshots are not historical-version acceptance.

## Local verified result

20 affected cases passed (14 Node, 6 Python), zero skips/failures, actual exits zero. Source review identified three P2 issues; four failing regressions reproduced them before fixes. Reviewed fixes enforce per-operation caps and an absolute HTTP timer, attempt termination of an owned child even with no confirmation budget, and retain failed-flow fixtures regardless of expected-test success. Independent delta source review found no confirmed remaining P1/P2 within that scope; it did not execute or independently verify test results. Original pre-fix records remain unchanged. This does not certify a production-version upgrade or native Linux copy proof.
