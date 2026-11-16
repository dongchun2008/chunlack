# Independent copy-proof reader implementation plan

> **For agentic workers:** Use superpowers:executing-plans or subagent-driven-development; preserve frozen candidates and prior evidence.

**Goal:** Independently verify the exact native compatibility report against approved local inputs before treating the native run as usable release evidence.

**Architecture:** Reuse the frozen descriptor-based Observation reader and the original validate_copy_proof function. Add a fixed four-artifact read operation and a pure local correlation layer. The report is evidence; it grants neither execution authority nor production readiness. Existing frozen SSH bridge sources remain unchanged; integrate through a new local candidate.

**Tech stack:** Existing Python standard library, captured frozen source bytes and existing local tests. No installations, model calls or native operations in this implementation stage.

## Design and constraints

The existing Host/root already invoke the full validator. The new reader obtains only report, owner receipt, job capsule and launch context from this execution's physical host tree. Each file retains the existing4096-byte maximum and exact owner/mode checks. Input accepts only tag, nonce, expected report SHA-256 and the already observed host directory device/inode. Paths derive internally; arbitrary path selection, database reads, private configuration export and writes are absent.

The reader reuses captured original Observation/terminal bytes and original descriptor closure semantics. It validates the host identity while walking ancestors, preserves exact bytes/hashes and permits a completed reply only after every owned descriptor closes and the shared deadline holds. A standalone byte read never becomes kernel/lifecycle authority. Default execution is Linux/root only; local filesystem doubles are explicit test seams.

The local validator compares report SHA and job binding across all four artifacts, uses strict original parsers, compares capsule sources/materials against the captured local packet, and invokes the original full validator using trusted local settings/manifests. It retains actual wall-clock expiry and at least300000ms freshness. It does not use remote-supplied manifests, invent a new lifetime, reconstruct absent live kernel observations or claim to recompute database contents. Node fingerprint correlation is distinguished from an independently pinned current host binary.

This design follows the existing source-bound proof route. Trusting only a summary would omit independent byte verification. Recomputing databases or defining a replacement proof format would duplicate the existing verifier and require broader access. Neither is needed for this step. The implementation choice is delegated under the user's continuing local-work authorization; a new remote scope remains a key approval point.

## Files and tasks

- [x] Create private `native-copy-proof-20261117-a1/reader.py` and `test_reader.py`: fixed operation, original reader reuse, exact paths/metadata, no writes, bounds, drift and cleanup regressions.
- [x] Create private `validator.py` and `test_validator.py`: original parser/validator reuse, explicit captured trusted inputs, binding/source/material/freshness rejection, exact raw-byte evidence and non-escalating result.
- [x] Create private `carrier.py` and integration tests: derive trusted inputs from the already hash-bound actual packet, join actual reader replies to local validation, preserve the old frozen bridge/source hashes. Do not silently generate review pins.
- [x] Create new private driver/entry/bundle candidates: reuse the frozen SSH control flow and original local held-directory writer; add only the fixed proof-read phase and pure local validator. Keep the950-second outer budget and six-unit maximum, disclose that the new read phase itself creates no unit. Accept at most32768 bytes for this phase's reply; other phase limits and the4096-byte artifacts remain unchanged. Use compressed captured source for Windows command-length portability.
- [x] Perform concentrated static reviews and a regression-backed correction pass; execute final source-bound related tests and save an inactive proof-capable candidate.
- [x] Scan and synchronize only sanitized verification and plan records. Private source, packets, raw proof bytes and credentials remain local.

## Current-stage boundaries

No VPS connection, Linux unit, service start/stop, production publication, model/external-Agent invocation, credential/grant/DNS/port/Relay change. Previous remote allowances remain consumed. The old production55-second forward/120-second recovery budget and deployed resources remain unchanged.

Future native integration must retain explicit one-shot authorization, fixed target and source binding, no retry, the existing unit/resource limits and an outer deadline including SDK/startup/cleanup. A new fixed read phase may require a larger bounded JSON receipt, not larger artifact access. Its exact wiring and budget must be verified before any new remote request.

## Local implementation result

The source-bound final run passed59/59 tests with no skips and exit0. Actual reader/packet/original validator methods join through an explicit transport simulation; damaged artifacts and unknown transport close refuse acceptance. No test supplies a replacement full validator returning true. Captured source execution is now compared to the approved driver hash before argv generation, closing a version-mixing finding. Same-FD binding reads retain unknown-close refusal.

The saved inactive candidate contains15 files with13 bound inputs and the existing170-member packet. Its false approval has no reference and was executed through the actual owned entry: expected exit1 occurs before SDK, remote attempt or one-shot claim. All prior frozen source hashes remained unchanged; the old114-test suite was not rerun or added to this count.

The portable local checker intentionally does not invoke Common's path-dependent input reconstruction. It checks the already approved packet's material/source/request bindings and calls the original complete proof validator with those trusted settings/manifests. The unchanged native Host/root retain the original full reconstruction. Independent kernel/Node/lifecycle claims remain false for the raw checker and for every simulated test. A future real default path must jointly verify the frozen live chain, exact source/target/authorization, raw report and all cleanup; no current native or production acceptance is claimed.

Evidence: [independent copy-proof local verification](../../verification/2026-11-17-independent-copy-proof-local.json).
