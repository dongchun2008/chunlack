# Research task bounds: controlled release preparation

Date: 2026-10-25

## Current authorization and result

Linux isolated verification and release preparation only. No production publication, real inference, Agent changes, credential changes, authorization changes or Relay changes. The selected native Linux regression set passed 158/158 with zero failures, skips or cancellations. This is not a full Linux suite or real-provider acceptance. Source payload commit: `43ddc34fbd88cca3a2974514dd72a35239783eab`.

## Local four-file gate follow-up

The new `2026-10-25/readonly-research-bounds-preflight.py` is implemented and locally verified: new profile 24/24, unchanged legacy profile 17/17, actual CLI fail-closed checks 2/2, complete local application suite 972/972 and smoke passed. Independent review found no actionable issue. See `docs/verification/2026-10-25-research-task-bounds-four-file-preflight.json`. This does not establish native ownership, systemd enforcement or whole-wrapper native acceptance. The old three-file source remains unchanged.

Future staging must copy the new wrapper as `preflight.py` and the exact pinned legacy source as `base-code-preflight.py`. Include both files in `trusted` and `preparedHashes`; preserve existing release/controller source bindings. The wrapper fixes its four-file scope in code and delegates all legacy checks. Its base SHA-256 is `5c9cf83f7c763a7e216feb865849c7eba761efa7f9dc40b990f1f67f0e69b18d`. Do not publish only the entry while omitting its verified base.

No extra Linux units were started: the prior plan remains 4/4 consumed. A new native allowance must explicitly enumerate preparation and business units, without reusing expired proofs or previously consumed scenarios. No production maintenance window is approved by this local verification. Multilingual UI/help remains a separate pending design and is not silently added to the four-file runtime scope.

## Completed preparation

- One preparation unit and three serial test units, each capped at 192 MiB memory, 160 MiB MemoryHigh, 10% CPU, 32 Tasks, zero swap, private network, 85-second execution plus 5-second stop allowance. No prior unit budget reset.
- Trusted copy preparation ran as root; all business tests ran directly as nobody (UID/GID 65534), without switching identity inside a root business process.
- Limits and identity were checked while each process waited at a nonce-bound proof gate. Terminal receipts, original PID disappearance and original cgroup emptiness were checked separately; post-GC defaults were not treated as limit evidence.
- Tests covered task request limits, strict routing, cancellation/late callbacks, capacity ownership, research search/verification, and an actual packaged HTTPS report fixture with authentication, workspace isolation and restart persistence. Sources/results were synthetic or loopback fixtures; private networking prevented real model access.
- Copied production dependencies and Caddy were hash-verified without changing their originals. Production service identities/restart counters, protected file hashes and listener sets were unchanged. All owned units stopped and the remote scratch directory was removed.
- A four-file local payload and expected before/after code inventories were generated. Default generated configuration and dependencies are not in the payload.

## Exact future executable scope

- `server.js`, materialized from the pinned `lack.py`.
- `collaboration/capacity.cjs`.
- `collaboration/model-transport.cjs`.
- `collaboration/task-control.cjs`.

A full generated tree additionally differs from the live `identity/workspace-shell.js`. That existing UI difference is deliberately excluded. Future staging must start from a fresh production code copy and overlay exactly the four payload files. Do not publish the entire generated tree. Preserve live configuration bytes, dependency hashes, client allowlists, authorization tables, credentials and ingress. No schema migration is planned.

## Blocking gates before any future publication

1. The separately versioned four-file gate is locally implemented, preserving the pinned base checks. Native end-to-end verification of this wrapper remains required; the existing 2026-10-23 three-file gate still correctly rejects this payload and has not been weakened or changed.
2. Local tests passed for missing/extra executable changes, UI drift, config bytes, dependency drift and proof freshness/bindings; these are separate from the prior 158-test native application receipt. Real native ownership, file permission and systemd failures remain to be verified, as does the complete wrapper-to-base native path.
3. Obtain separately approved, candidate-bound database-copy compatibility and success/failure rollback rehearsals with the original resource limits. Do not reuse expired proof or restart old consumed scenarios.
4. Obtain a fresh maintenance authorization, then repeat read-only production preflight immediately before switching. Keep a consistent backup and the original 55-second forward / 120-second total recovery bounds. Never restore a stale database over new writes, remove an existing writer lock or alter old LACK/Relay.
5. Only after all gates pass, switch within the approved scope and verify health, authenticated UI, exact payload hashes, preserved configuration/authorizations and co-host services. Any real-model acceptance needs its own explicit budget.

## Delivery boundary

Candidate and plan are prepared, but publication is blocked. No maintenance window is inferred from this verification request. No real-model or external-Agent acceptance was performed, and no claim is made that this patch is active in production. Raw TAP, live resource snapshots, receipts and candidate bytes are retained privately; only de-identified records and this plan are synchronized.
