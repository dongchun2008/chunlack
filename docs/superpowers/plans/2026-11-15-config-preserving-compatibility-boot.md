# Configuration-preserving compatibility boot plan

> **For agentic workers:** Use superpowers:executing-plans for the local work below. No remote execution or publication is authorized by this plan.

**Goal:** Supply the missing test-process startup boundary for compatibility checking with enabled OIDC and preserved Agent/provider configuration.

**Architecture:** Keep the existing synthetic native driver unchanged; it explicitly requires OIDC disabled and empty Agent/provider lists. A new private guard library and validating preload preserve pinned configuration bytes, simulate only issuer discovery, create ephemeral child-only credential stand-ins, and deny outbound requests and commands. They generate diagnostic snapshots, never native compatibility proofs.

**Tech stack:** Existing Node runtime, standard library and installed product dependencies. No new installation.

**Spec:** `.superpowers/sdd/config-preserving-boot-20261115-a1/DESIGN.md` (private local design).

## Constraints

- Local files, synthetic databases and owned local child processes only; no VPS, Linux unit or production service operation.
- No production credential reuse, stored Agent/provider configuration changes, grants, model calls or external Agent messages.
- Preserve the old native driver, source packages and failed attempts.
- Guard snapshots cannot replace real UID/GID/NNP/capability/cgroup checks, kernel network isolation, read-only production DATA, clean exits or the full proof validator.
- Actual remote copying, compatibility execution and controlled publication remain separate key nodes.

## Work and evidence

- [x] Inspect the actual old native driver and existing proof/configuration bindings; confirm why the old synthetic mode is insufficient for actual configuration.
- [x] Write failing guard tests, implement effect-free library import and explicit child installation, then pass configured-Agent/provider preservation, discovery limits and denial checks.
- [x] Write failing preload tests; implement per-role nonce/hash context, bounded same-descriptor source/config reads and captured-buffer module execution.
- [x] Diagnose implicit Windows child environment fields with a synthetic key-names-only probe; accept exactly those platform fields on Windows while leaving Linux policy unchanged.
- [x] Reproduce and fix direct constructor/prototype bypasses and opened-file allocation-before-validation; retain the failing evidence and pass the targeted cases.
- [x] Add actual unmodified local LACK startup/close coverage with enabled OIDC and synthetic data. This is local evidence, not real Pocket ID or Linux acceptance.
- [x] Diagnose missing local bare-ESM dependency resolution separately without starting the application; keep the native read-only dependency-copy requirement intact.
- [x] Complete actual-runtime validation, complete local affected regression and source-only review; retain failures rather than skip or widen timeouts.
- [x] Freeze source hashes and prepare the sanitized record and this plan for synchronization with exact readback.

## Remaining integration

The future native worker still needs an exact-context controller, fresh accepted input collection, original row/schema and authority preservation, real candidate and previous boot records, original full proof validation and its own authorized resource envelope. The local dependency junction used by the Windows test is not an approved native dependency layout. No source-only or guard snapshot result can activate a release.
