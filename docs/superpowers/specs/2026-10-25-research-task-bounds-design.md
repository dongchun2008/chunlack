# Bounded research execution (local only)

Approved scope: user authorization of 2026-10-25. No publication, real inference, Agent changes, credentials, grants, DNS, ports or Relay operations.

## Approach
Reuse capacity, task-control and provider-neutral transport. No sidecar or new dependency. A proxy would add overhead and fail to prove the real application path. Existing chat routing remains unchanged.

## Contract
Public workspace research uses a server-owned model policy: at most 20 actual inference starts, serial execution, 20000 ms request ceiling, no automatic retries or fallback, and no external-Agent dispatch. Preserve the existing 300000 ms root task ceiling (stricter than the acceptance maximum of ten minutes); never extend a parent deadline. Nested tasks share counters and can only tighten limits. Queue admission does not count as an actual inference start. Discovery is not inference.

Both research entry points await the complete collection, verification and synthesis pipeline. Search, scraping and model work receive cancellation; strict research search does not automatically retry or switch endpoints/providers. Partial evidence and source links survive failure. Verification remains atomic across all batches. Cancellation and timeout must never be reported as a successful research completion. An aborted HTTP request does not prove remote GPU termination; occupied capacity remains until actual transport settlement.

## Compatibility and non-goals
Keep Ollama and OpenAI-compatible routing, ordinary chat retries/fallback, existing authorization and workspace isolation. Keep the legacy single-user research behavior compatible; the new strict profile is for authenticated workspace research. Do not create research Agents or use a one-Agent substitute for the pending production three-role acceptance.

## Evidence
New deterministic tests exercise the actual capacity/task-control/model-transport modules and extracted embedded server functions, using synthetic providers and public-source fixtures only. Run related and full local regression before secret-scanned, explicit-file GitHub synchronization. Production and real-provider acceptance remain pending.

## Approved follow-up boundary repair
Model-policy changes notify queued and executing requests; deadlines are measured from original request creation and may only become stricter. Routing rechecks restrictions before each retry and fallback, including after backoff. A task-control root is retired only when all tracked branches end; inherited callbacks cannot send requests or enter new scopes afterward. Aborted but unsettled transports retain capacity. The legacy diagnostic typo is superseded by valid failing callback regressions, not counted as prior evidence.
