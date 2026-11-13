# Materializer Path Plans Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans; execute locally, retain failed evidence.

**Goal:** Reduce repeated construction of immutable root path objects without caching filesystem state or changing any integrity check.

**Architecture:** New private NativeStore candidate derived from SHA43545869… only. Bound a per-instance cache of at most8 root path/ancestor plans; every tick, lstat, fstat, permission/identity check, file read, fsync and cleanup remains in the original order. No production files, frozen package or failure directory is changed.

**Tech Stack:** Existing Python3.13, unittest, cProfile, pathlib; no installation.

**Spec:** The previous native evidence record `docs/verification/2026-11-13-native-preparation-materialize-deadline.json` establishes70.2 seconds in materialize but does not identify a suboperation. This plan's design is a conservative local candidate, not a claimed native fix. User has delegated routine local decisions and requests confirmation only at key execution nodes.

## Global Constraints

- No VPS/SSH, new Linux units, credentials, publication, model calls or external Agent calls.
- Keep75s work/80s output/90s unit budgets and192MiB/20%CPU/32Tasks/zero swap policy unchanged.
- Do not drop/deduplicate OS metadata checks, cache identities/hashes, reduce fsync or weaken drift detection.
- Keep existing source43545869… and frozen b985 candidate unchanged. Cache only pure path representations, at most8 plans of at most40 paths/1024-character root spelling; other paths use the original computation.
- Existing changed/failed files are preserved. Only plan and sanitized evidence are synchronized.

## Task1: Preserve behavior and reduce path construction

- [x] Add tests comparing exact tick/lstat/fstat traces between original and candidate, including warmed plans, all metadata/tick injection positions, root changes and bounded memory.
- [x] Run against an unmodified copy and observe path-construction/cache tests fail.
- [x] Derive only constructor, _trust and _roots_ok changes plus a pure plan helper. Confirm all other methods stay identical.

## Task2: Local regressions and measurements

- [x] Run unchanged native adapter tests and real local copy/readback tests with their existing simulated POSIX metadata.
- [x] Run ABBA timing/count comparison using the same synthetic metadata model and original checks; report CPU-only local evidence, not VPS improvement.
- [x] Record the measured local CPU ratio0.869565 (about13.04% improvement), retaining unknown native benefit and timeout outcome. No native rebinding based on this local result.

## Task3: Review and synchronize

- [x] Independently review metadata freshness, trace equivalence, cache bounds and scope claims.
- [ ] Save candidate hashes and sanitized results, verify GitHub exact readback. New native validation remains a separate key approval.
