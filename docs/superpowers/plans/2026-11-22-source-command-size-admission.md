# Source formatting and mandatory command-size admission

## Scope and evidence

This local phase started on 2026-11-22; final local artifact verification completed on 2026-11-23 (Asia/Shanghai). Filenames retain the phase-start label.

The [prior native attempt](../../verification/2026-11-22-startup-bound-native-command-size-failure.json) ended at the original SSH bootstrap-size gate, before manager bytes were transmitted. This phase is local-only and does not reuse that spent one-shot allowance. The objective remains full production delivery, which is incomplete.

## Implementation

The new build-time formatter accepts a bounded, hash-bound Python source, removes comment tokens and reduces indentation while retaining non-significant and significant newlines. It verifies identical AST; recursively equal executable bytecode, constants, exception tables, names, argument/stack/flag metadata; equal class/function first-line metadata and instruction line ranges. Docstrings and assertions remain. Diagnostic column positions can change. Invalid input, source drift and any failed equivalence check reject without execution or fallback. No formatter or dependency is installed on VPS.

Only the manager source slot is replaced on fresh modules of the existing carrier. Original archive/source builders, canonical rebindings and proof validators remain. The formatted bound manager is 34,943 bytes instead of 37,077; all other executable members and the packet are unchanged. The 15-file/13-input/170-member layout, false approval, identities, caps/NNP, resources, startup/cleanup deadlines and no-retry policy remain.

Every new local package build now runs closed admission through the actual frozen driver's remote-command envelope and original transport renderer. It checks preflight, receiver, manager, watch, proof-reader and optional failure-evidence commands with small and maximum legal numeric metadata. Config key shapes are compared with the frozen driver's actual invoke calls. Both the original bootstrap guard and an emitted-full-command limit of 65,536 bytes must pass. The longest full command is 65,482 bytes with the current closed config/source set. This covers these fixed schemas and source pins, not arbitrary future config or source changes; drift must fail and be revalidated. The separate receiver packet-stdin limit remains 32 MiB.

Admission rechecks the original saved hashes, root identity, false approval and all required source pins. Its size report contains no command/config contents and grants no execution authority. Package size admission is not proof of native compatibility or runtime permission.

## Verified local checks

The [sanitized record](../../verification/2026-11-22-source-command-size-admission-local.json) binds 78 passing scoped tests: formatter16, command admission10, actual carrier6, reused startup15 and original manager-guard31. The two manager suites redirect their manager fixture to the actual formatted implementation; original assertions and fixture bytes are retained. This is not a repeated whole-product regression.

Real source/config originally fails the unmodified renderer; the formatted source and maximum metadata pass. Changed source/driver budgets/transport limits, extra files, wrong manager and forged artifact receipts still reject. Actual unapproved local child refuses before SDK/attempt. One new carrier test initially looked for the external entry inside the package; the failure is retained and the final test captures the existing entry by its fixed hash. All six carrier tests then passed. No safety assertion or timeout was dropped.

## Candidate and remaining gates

A separate fresh random-tag candidate is built with the same mandatory size gate, all 15 digests rechecked, and positive 13-input admission in local memory only. Its saved approval remains false and no attempt exists. Private source, code packages, correlation values and raw failure evidence remain local; only sanitized plan/record are synchronized. No new independent review pass is claimed.

Next key decision: a new explicit native window, at most one SSH/six temporary unit objects/950 seconds including all overhead and same-connection failure evidence/cleanup. Keep the original workgroup192MiB/20-percent-one-core/32Tasks and observer96MiB/10-percent/16Tasks, zero swap/private network/low priority, identities/capabilities/NNP and all phase caps. Work only on new paths and database copies with synthetic model behavior. Failure stops without retry. No publication, existing service restart/stop, credentials, business grants, DNS/public ports, deployed controller or Relay changes. Actual Linux startup, boot-marker effect, compatibility/success/rollback and production acceptance remain unverified by this local work.

## Later native window on 2026-11-23

The user subsequently approved one new window. It stopped once with exit 1 after 20.9533706 seconds. Setup now completed with a real activating/start observation, live witness, normal exit, child/manager cleanup and empty scope. Watch failed at observe_actor_manager_absence before its observer-start call in the validated source flow. Its cleanup succeeded and four protected service baselines matched; no retry or publication occurred. This is native setup progress, not a complete chain, database compatibility or production acceptance. See [the native partial result](../../verification/2026-11-23-source-size-native-setup-pass-watch-absence-failure.json) and [next local metadata work](2026-11-23-observer-absence-metadata.md). The one-SSH allowance is consumed; the formerly inactive candidate must not be reset or reused.
