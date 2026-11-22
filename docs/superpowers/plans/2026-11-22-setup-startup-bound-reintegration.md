# Restore bounded setup startup handling in the genuine candidate

## Evidence and implementation

The [single native window](../../verification/2026-11-22-two-management-native-setup-failure.json) ended with missing-live and empty setup streams. Cleanup was confirmed; the first native unit observation was not saved. A local test using the captured wait/stop methods showed a first activating/start row can be rejected before the next genuine running sample, with subsequent cleanup stopping that generation. This does not prove the native root cause.

Inspection found an existing tested startup implementation that was absent from the genuine carrier. A new private candidate derives from the current absence-fix manager and reuses only its pinned same_startup, observe_wait, live and wait methods. It preserves the later absent-unit fix, kernel/capability and target mapping checks, command pools, real live witness, retained normal exit, and held-scope cleanup. The full older passive-capability manager was not copied back.

The five-second startup bound, 105-second work budget, 120-second manager envelope and cleanup reserve are unchanged. Only known activating/start-pre, activating/start and activating/start-post states may wait inside the original startup deadline. Invocation and positive start identity remain fixed across startup/live/cleanup. Terminal-before-live, foreign scope, changed generation, bad exit and uncertain cleanup still fail. Waiting for state is not a second StartTransientUnit call or task retry.

First-wait and pre-cleanup states are recorded from already-required state reads. Unknown strings become `other`; diagnostics are bounded and carry no authority. Evidence-generation errors preserve the primary and cleanup outcomes. No extra host read, command, new capability or timeout extension was introduced.

## Local verification and package closure

- Red: current source rejects the initial activating/start case; green: restored bounded path passes with real live and normal-exit evidence in the filesystem/bus doubles.
- Fifteen targeted startup/diagnostic/source-boundary regressions passed.
- The unchanged 31-case original manager protection suite passed on this candidate through its existing explicit-double seam.
- Five actual carrier/inactive-package checks passed: exact canonical manager binding; unchanged driver, packet and proof sources; all 15 files/13 inputs/170 members; positive in-memory admission and wrong-manager refusal; actual unapproved-child refusal before SDK or attempt.
- Retain the failed test invocation that initially addressed the wrong carrier dictionary and the comparison that initially omitted the two exact archive-size literal rebindings. Final checks use the existing canonical replacement map and exact full source bytes; no integrity assertion was dropped.

The new local candidate remains unapproved and unattempted. A separate random-tag inactive package has artifact-specific digest/admission checks, not native authority. Private code, identities, packages and raw failed evidence remain local. Only this plan and the [sanitized verification record](../../verification/2026-11-22-setup-startup-bound-reintegration-local.json) are synchronized.

## Next key decision

No SSH or Linux unit was used during this work. The previous native grant is consumed. After local readiness, request a fresh bounded native window using the same one-SSH/max-six-unit/950-second limits, resource and identity checks, isolated network, copies/synthetic model behavior, fail-stop/no-retry and same-connection failure evidence. No publication or existing-service, credential, business authorization, DNS, public-port or Relay change is included. No new independent review pass is claimed. Neither this local suite nor restoration of an older tested path establishes boot-marker effectiveness, actual native success or full production delivery.

## Later approved native execution: stopped at command-size admission

The user subsequently approved one new native window. It ended once with exit 1 after 6.0680758 seconds at the unchanged `ssh_command_size` guard. The SSH allowance is consumed 1/1; no retry occurred. Before/receiver/after phases completed, the setup transport sent zero bytes and had no manager reply, and same-connection evidence observed the fixed install unit absent, with zero sampled processes. Four protected service baselines were identical; transport and SDK cleanup were confirmed. No publication or existing-service change occurred. See [the fixed native result](../../verification/2026-11-22-startup-bound-native-command-size-failure.json).

Offline use of the actual renderer/config reproduced a 67,834-byte bootstrap exceeding its 65,536-byte limit. This is a proven command-admission failure, not evidence about the restored manager's runtime or the earlier native startup failure.

An in-memory formatting feasibility check retained AST, executable bytecode, constants, exception tables, instruction line ranges, class first-line metadata and docstrings while reducing indentation and removing comments. Diagnostic column positions changed. The actual frozen renderer accepted this source and maximum legal metadata for the setup-manager config. This feasibility check is not a new regression suite, integrated carrier or native acceptance. Dropping non-significant newlines was rejected because it changed Python 3.13 class metadata; comment removal alone did not fit. No original source/package was overwritten and the 65,536-byte guard was not raised or bypassed.

Next local phase: implement the exact formatting operation with boundary regressions, bind it into a new candidate, and enforce real and maximum-metadata encoded-size admission before any future SSH. Check all affected phase commands and preserve prior semantics/budgets; no new native run is authorized by these notes.
