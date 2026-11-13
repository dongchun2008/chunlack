# Materializer Detail Trace Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans; test locally and preserve all original failures.

**Goal:** Identify the slow substage inside materialize without changing its filesystem, durability or deadline checks.

**Architecture:** A new private, optional observer records bounded phase/progress events and three aggregate durations: file fsync, directory fsync and write readback. No filenames, bytes, arguments or exception messages enter diagnostics. Every original store/tick call remains in order; original operation exceptions are rethrown unchanged. The13% path-plan prototype stays separate to avoid mixing a performance change into this diagnostic experiment.

**Tech Stack:** Existing Python, unittest and local temporary files; no dependencies.

**Spec:** Native record `docs/verification/2026-11-13-native-preparation-materialize-deadline.json` proves70.2 seconds in materialize but no finer bottleneck. The user delegates routine local implementation while native execution remains separately bounded.

## Constraints

- No SSH/VPS, new Linux units, production release, credentials, Agent changes or real models.
- Preserve75s work/80s output/90s unit,192MiB/20%CPU/32Tasks/zero swap, all hashes, identity/permission checks, fsync and cleanup.
- At most96 timeline rows, one progress row per256 completed dependency inputs, three aggregate labels and eight diagnostic error codes. This covers the existing20000-input ceiling without truncating a legal full run. A failed write must not increment a completed-copy sample.
- Metadata/identity/hashes are never cached. Original source4354/be698 and frozenb985, path-plan prototype10d9 and old failures remain unchanged.
- Diagnostic failures are represented separately; they never hide the original operation exception. Incomplete diagnostics must prevent a future candidate from being accepted as a complete instrumented run.

## Tasks

- [x] Test a pure bounded observer, monotonic clock, aggregation, redaction and original-exception retention.
- [x] Derive engine and store diagnostics only; compare exact filesystem/tick call sequences, default-mode behavior, all original engine/adapter cases and real local copy/readback.
- [x] Measure local instrumentation overhead and perform independent review; sanitized synchronization is recorded separately with exact readback evidence.
- [ ] Later bind the reviewed observer through NativeOps and entry into a new inactive package; verify complete hashes before any new native proposal. No native execution authorized by this plan.
