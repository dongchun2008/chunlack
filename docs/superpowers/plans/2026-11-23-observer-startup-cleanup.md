# Interrupted-start cleanup and pending native window

Status: local source, startup regression, carrier and pending-entry validation completed; no new native execution or publication. Exact bindings and results are in [the local record](../../verification/2026-11-23-observer-startup-cleanup-carrier-local.json).

## Reproduced behavior and correction

Actual-method local replay confirmed that watch cleanup prematurely applied its running-state binding to a still-starting unit. The inner host cleanup could instead stop before its live kernel/scope binding, and a missing unit before any held scope could return without a cleanup error. This is local control-flow evidence, not attribution of the preceding native watch-absence failure; that failing raw row is still missing.

New private source derivatives preserve startup identity across wait and cleanup. Cleanup without a live scope now waits only for the same generation to reach active/running, using the original absolute end, polling cadence and command limits. It must then pass the original peer/kernel/scope binding before stopping the task and proving the held scope empty. There is no weaker pending-scope binding. Replacement, disappearance, terminal-before-live or uncertain ownership remains an error. If sufficient scope evidence never becomes available, cleanup is not declared successful.

The actual run method preserves the original task failure even after successful cleanup, records cleanup errors separately, and attempts close. Existing stop targets, privilege/resource/request policies, remaining methods and original init statements are retained. The local generator's initial stale-line-offset error was corrected by capturing original segments before insertions. Its failed source and tool output remain; the initial structured receipt was not written, and the receipt writer now records derivation failures rather than losing that diagnostic.

## Local evidence

Thirty-seven tests passed: 15 actual run/wait/cleanup cases, all 13 prior startup cases against the new derivative, and 9 closed-carrier integration cases. The prior method-delta assertion was updated to the exact new approved method set, with original peer checks retained. There is no new full-product-suite or independent-review claim.

The new canonical package has 15 saved files, 13 bound inputs and 170 members. Actual actor/watch bytes match the tested derivatives after digest rebindings. Host/business payload stays exact. Fixed helper-only driver changes, manager formatter equivalence, canonical tamper refusal, min/max metadata shapes and actual transport rendering pass. Full-command maximum is still 65,482 bytes; watch is 50,354 bytes. The original 65,536-byte guard and separate 32 MiB stdin bound are unchanged. All saved bytes were read back, and the fresh candidate directory/files have user/System-only ACLs.

A prospective invocation was validated only in memory against the fixed original coordinator, changing six data-binding constants. Positive 13-input preparation was checked in memory. The actual unapproved child then refused before SDK/SSH, with the shared parent/child initial clock verified. Approval bytes stayed unchanged. The candidate remains false-approved without an approval reference or attempt; no executable native coordinator, genuine grant or allowance ledger was created. The pending private proposal is not authority.

## Next key approval

The previous one-SSH grant is consumed. After record synchronization, request one fresh window: at most 1 SSH, 6 temporary unit objects including the shared slice, and 950 seconds total including SDK, evidence, cleanup and closure. Preparation/shared work remains 192 MiB, 20% of one CPU, 32 Tasks; the separate observer remains 96 MiB, 10%, 16 Tasks. Preserve zero swap, private networking, Nice=10, CPUWeight=10, exact identity/capability/NNP checks, stage deadlines and child accounting. Run serially, fail-stop, no automatic retry; perform precheck, failure evidence, owned cleanup and protected-service comparison within that same connection and budget.

Only new exclusive directories and database copies may be used; source databases remain read-only. Use synthetic configuration/models. No production publication or existing-service restart, credentials, business-grant, DNS, public-port or Relay change, real inference or external-Agent call. Old attempts, failures, directories, locks and unused remnants are preserved, not reused. Actual native compatibility, startup/cleanup, switch/rollback and production delivery are still unproven.
