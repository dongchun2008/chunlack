# Bounded Research Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans.

**Goal:** Track the entire research task and enforce task-local inference bounds without changing normal chat or production.

**Architecture:** Extend the existing capacity scope with an immutable, monotonically restricted model policy and shared actual-start counter. Task control forwards policy and the embedded research flow awaits every stage. Model transport enforces per-request deadlines while retaining unsettled execution slots.

**Tech Stack:** Node 24, CommonJS, AsyncLocalStorage, AbortController, existing Python materializer, node:test.

**Spec:** docs/superpowers/specs/2026-10-25-research-task-bounds-design.md

## Global Constraints
- Local and synthetic models only; no production, credential, authorization, Relay or Agent configuration changes.
- Strict profile: 20 actual starts, 20000 ms per request, serial, no retries/fallback/external Agents.
- Preserve existing 300000 ms root deadline and parent restrictions.
- No new dependencies or daemon; preserve provider neutrality and legacy behavior.

## Review Focus
- A nested task or discovery request must not reset or overspend actual-start counters.
- Timeout/cancel must not free an occupied slot before transport settlement.
- A search or verification cancellation must not promote evidence or start synthesis.
- Both human slash-command and Agent research-action entries must await completion.
- Ordinary retries/fallback and workspace ownership checks must remain intact.

### Task 1: Shared model bounds and complete research lifecycle
**Files:** Modify lack.py, collaboration/capacity.cjs, collaboration/task-control.cjs and collaboration/model-transport.cjs. Create tests/research-task-bounds.test.cjs. Add only necessary compatibility coverage to existing research tests if required.
**Interfaces:** limits.modelPolicy carries maxRequests, requestTimeoutMs, allowRetry, allowFallback, allowExternal and serial; capacity.restrictModelPolicy(policy), beginModelRequest(), stopCurrentTask(code), and currentTask().modelPolicy/modelRequests enforce and expose server-owned metadata.
- [ ] Write synthetic behavioral regressions for exact budgets, nested tightening, timeout/late settlement, routing restrictions and research cancellation/lifecycle.
- [ ] Run new tests and record expected missing-behavior failures.
- [ ] Apply the bounded product patch in one application phase.
- [ ] Run targeted and full local regression with explicit runtime paths and bounded test processes; retain all failures.
- [ ] Obtain a fresh read-only review, record findings and do not silently repair newly discovered defects outside approval.
- [ ] Scan explicit changed files, commit and non-force push only after passing verification; verify remote commit.

Execution ruling: the user explicitly approved development, simulation and synchronization; proceed inline without another plan-approval round. Reuse the existing clean feature branch, not main/master, and existing installed dependencies.

## Follow-up authorized 2026-10-25
- [x] Reproduce dynamic queued/in-flight policy and route restrictions with behavioral tests.
- [x] Reproduce ordinary/strict late callbacks and retained-scope entry before repair.
- [ ] Verify the observer/retirement repair, existing gateway evidence fixture and full regression.
- [ ] Scan and synchronize only after every acceptance gate passes.

## Local acceptance outcome
The final unchanged complete run passed 972/972, with zero failures, skips or cancellations; targeted regression passed 157/157 and the local HTTP/WebSocket/two-model/restart smoke passed. Earlier failures remain separately recorded in docs/verification/2026-10-25-research-task-bounds-local.json. Implementation and testing are complete locally. Synchronization is gated by an explicit-file secret scan and staged-byte verification; neither this plan nor Git synchronization authorizes production publication.
