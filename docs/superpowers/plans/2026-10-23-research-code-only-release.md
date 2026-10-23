# Research code only release implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Execute the approved bounded plan inline and retain original failures.

**Goal:** Publish the accepted research changes without changing existing configuration, authority, credentials or co-hosted services.

**Architecture:** Retain the existing release transaction and service-account handoff. Add a read-only, exact-scope preflight; prepare an exclusive clone of live code and overlay only the three approved files. Require fresh candidate-bound compatibility and operational success/rollback evidence before invoking the publisher once.

**Tech Stack:** Python standard library, existing Node 24 runtime, SQLite, systemd, existing Caddy, pinned SSH transport.

**Spec:** The user's approved 2026-10-23 scope: at most three new isolated scenarios, followed by a conditional controlled three-file release.

## Global constraints

- Executable differences: `server.js`, `gateway/research-search.cjs`, `identity/workspace-shell.js` only.
- Preserve current configuration bytes, allowed client identities, authority, credential files, DNS and listening ports.
- Include all dependency contents, including nested `node_modules`, in the candidate and copy-proof binding.
- Refuse publication if the unchanged existing controller would serialize configuration to different bytes; do not rewrite configuration merely to pass this gate.
- Fingerprint authority schema, indexes and triggers as well as rows. Load the trusted controller from verified source bytes without consulting or creating bytecode caches.
- Do not stop or modify old LACK or Tailscale Relay.
- At most three newly authorized top-level isolated scenarios; do not reset any preceding allowance.
- Each scenario and all its business children together: at most 90 seconds, 192 MiB, 10 percent CPU, 32 tasks, zero swap, private network.
- Business processes must retain the accepted non-root service identity. Privileged test control must not run business work as root.
- Capture actual live limits before releasing work; retain terminal process receipts and verify empty cgroups.
- Publication requires a consistent cold backup and retained previous code, 55 second forward and 120 second total recovery budgets.
- Never remove a retained writer lock, restore old data over new writes, relax TLS checks or infer success from an observation timeout.
- No new model calls, grants, events, client creation or native Agent messaging in this stage.

## Review focus

- Extra, missing or deleted executable files must fail the three-file scope gate.
- Existing nonempty and empty client lists must both remain unchanged, not be mistaken for a new enrollment operation.
- A stale or different-candidate compatibility proof must not authorize a release.
- Fixture child services must share their scenario's private network and aggregate resource ceiling.
- A collected transient unit must not erase live limit or terminal timing evidence, and an observation failure must not trigger a second publication.

## Task 1 Read only code preflight

Files: create `deploy/public/release-control/2026-10-23/readonly-code-preflight.py` and `test-readonly-code-preflight.py`.

Interfaces: consume existing controller code inventory and staging permission validation; produce pure manifest/configuration/copy-proof validators and a read-only `run(root, trusted)` operation.

1. Preserve the deterministic RED evidence that the historical manifest validator accepts an extra password-module change.
2. Implement exact file scope, configuration equality, authority fingerprints and candidate-bound, fresh two-boot copy proof checks.
3. Run the new local suite and relevant existing controller/launcher/preflight suites. Preserve failures and do not widen a budget to hide them.

## Task 2 Candidate and isolated acceptance

Files: new private operational scripts and receipts under this plan's ignored workspace; do not edit historical release or failure artifacts.

Interfaces: consume the exact committed three-file payload and Task 1 gate; produce a full candidate/previous code manifest, identical configuration copy, hashed operational inputs, fresh copy proof and three scenario receipts.

1. Prepare an exclusive current-code clone. Verify that only the approved three hashes differ and protect all production paths.
2. Run one live-database-copy candidate/previous compatibility scenario using synthetic environment references and fixed public OIDC fixtures. It is not a cold backup or a recovery point.
3. Run one operational success and one injected-failure rollback scenario, retaining original assertions about new writes and configuration preservation.
4. Seal proof bindings and freshness, verify all live limits, identities, child cleanup and unchanged protected baselines, then run the code-only preflight without production mutation.

## Task 3 Controlled publication and acceptance

Interfaces: consume all passing receipts and trusted staged inputs; produce one bounded transaction receipt and a sanitized acceptance record.

1. Secret-scan and synchronize the new gate, tests, plan and scoped evidence before publication.
2. Invoke the existing bounded publisher once. Observe the same handle on transient polling errors; do not repeat a release because a report or observation failed.
3. Verify the consistent backup, exact installed three-file hashes, unchanged credentials/configuration/authority/ingress, protected old-service state, verified HTTPS health and OAuth denial boundaries.
4. Retain rollback restrictions and all original failed evidence. Synchronize only sanitized records; report this research release separately from remaining full-delivery gates.
