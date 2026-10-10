# PROJECT_CONTEXT

## Project name
LACK Hybrid Multi-Agent Platform

## Background
This project extends the open-source LACK project (https://github.com/webxos/lack) into a self-hosted hybrid multi-agent collaboration platform that can coordinate local and cloud models in one workspace.

The intended environment includes a Linux server, dual NVIDIA V100 GPUs, local model serving, cloud LLM APIs, Codex for coding tasks, OpenClaw or similar execution agents, MCP-based tool integration, and future integration with news, financial market, global situation awareness, RAG, and Obsidian-based knowledge systems.

## Primary goal
Transform LACK from a primarily Ollama-oriented local multi-agent chat system into a model-agnostic orchestration platform where different agents can use different providers and models while collaborating through shared channels, plans, tasks, memory, delegation, moderation, and human approval.

## Core design principles
1. LACK remains the human/agent collaboration and orchestration layer.
2. Model providers must be abstracted behind an OpenAI-compatible or provider-neutral interface.
3. Different agents may use different models.
4. Local and cloud models must be usable in the same workflow.
5. Sensitive data should be routable to local-only models.
6. Expensive cloud models should be reserved for high-value reasoning, escalation, adjudication, and difficult coding tasks.
7. The system should support fallback and escalation policies.
8. LACK should not receive unrestricted host access.
9. Tool execution should be isolated through containers, MCP servers, sandboxes, or controlled gateways.
10. Architecture should remain modular enough to replace LACK later if needed.

## Target architecture

User
  -> LACK Workspace
      -> Agent Orchestrator
          -> Model Router
              -> Local provider(s)
                  -> 1Cat-vLLM / llama.cpp / other OpenAI-compatible servers
                  -> NVIDIA V100 GPUs
              -> Cloud provider(s)
                  -> OpenAI
                  -> Anthropic
                  -> other OpenAI-compatible APIs
              -> Coding provider(s)
                  -> Codex
                  -> local coding model
          -> Tool Gateway
              -> MCP servers
              -> OpenClaw / coding agents
              -> controlled shell/filesystem/browser/git tools
          -> Data and knowledge systems
              -> news platform
              -> financial data platform
              -> global situation awareness platform
              -> RAG/vector store
              -> Obsidian knowledge base

## Recommended deployment model
Linux host
- Docker or equivalent isolation
- lack
- model-router
- 1cat-vllm-gpu0
- 1cat-vllm-gpu1
- postgres or existing persistent store if LACK requires it
- redis if required for queues/caching
- vector database if needed
- mcp gateway/services
- reverse proxy
- Tailscale for private remote access

Do not mount /, /root, /etc, Docker socket, or unrestricted host paths into the LACK container.

## Initial GPU strategy
Preferred starting mode: one model server per V100, allowing parallel specialist agents.

Example:
- GPU0: general/research model
- GPU1: coding/reasoning/reviewer model

Alternative mode: tensor-parallel across both GPUs for a larger model when a strong single local model is more important than parallelism.

## Agent-to-model mapping concept
Examples only; configuration must remain data-driven.

- NewsAgent -> local lightweight model
- DataAgent -> local lightweight/general model
- ResearchAgent -> stronger local model, with optional cloud escalation
- MacroAgent -> stronger local model
- RiskAgent -> local reasoning model, cloud fallback
- CoderAgent -> Codex or local coding model
- ReviewerAgent -> strong reasoning/coding model
- ModeratorAgent -> strong cloud or trusted local model
- CIO/DecisionAgent -> strongest available model, usually cloud for final adjudication

## Model routing policies
The Model Router should support:
- per-agent primary provider/model
- fallback provider/model
- escalation provider/model
- timeout policy
- retry policy
- concurrency limits
- token/cost budgets
- local-only policy for sensitive workloads
- allow/deny provider lists
- health checks
- provider failover
- structured logging

Potential future policies:
- confidence-based escalation
- task-complexity routing
- privacy labels
- cost-aware routing
- latency-aware routing
- workload queues

## Collaboration concepts inherited from LACK
Preserve and build around useful LACK concepts such as:
- channels and threads
- multi-agent planning
- agent delegation
- agent memory
- Moderator role
- human-in-the-loop approval
- triangulation / cross-checking
- reconciliation / iterative improvement loops
- shell/file/git tooling, but isolated and permissioned

## Security boundaries
Mandatory:
- no unrestricted host shell
- no Docker socket exposure unless explicitly proxied by a restricted service
- workspace-scoped filesystem access
- command allowlists or policy checks for dangerous operations
- secrets stored outside prompts and logs
- separate provider credentials
- audit log for agent actions
- human approval for destructive actions
- network egress controls for sensitive agents where practical

## Near-term implementation priorities
Phase 1: Understand LACK internals
- map current provider/model invocation path
- identify Ollama-specific coupling
- identify agent configuration schema
- identify execution/tool boundaries

Phase 2: Provider abstraction
- introduce provider interface
- keep Ollama working
- add OpenAI-compatible provider
- add per-agent model/provider configuration

Phase 3: Model Router
- separate routing from LACK core
- implement local/cloud selection
- add fallback, timeout, health checks, logging

Phase 4: 1Cat-vLLM integration
- connect one or both V100-backed model servers
- validate concurrency and memory behavior
- benchmark representative agent workloads

Phase 5: Codex and tool integration
- route coding tasks to Codex where appropriate
- expose controlled MCP tools
- add sandboxed execution

Phase 6: Research-system integration
- connect news, financial data, situation awareness, RAG, Obsidian, and other private tools through MCP or explicit APIs

Phase 7: Governance
- add policy-driven escalation
- risk review
- approval flows
- cost controls
- model usage analytics

## Non-goals for first implementation
- Do not rewrite LACK from scratch.
- Do not tightly couple business logic to one specific model vendor.
- Do not expose unrestricted host resources to agents.
- Do not build a complex distributed scheduler before the single-node architecture is stable.
- Do not optimize prematurely for a large enterprise multi-tenant deployment.

## Success criteria for MVP
1. LACK runs self-hosted.
2. At least two agents can use different model backends in the same workspace.
3. One agent can use a local V100-backed model.
4. Another agent can use a cloud model.
5. Agents can collaborate on the same task and pass results between each other.
6. Fallback or escalation from local to cloud works.
7. Tool execution is sandboxed or otherwise constrained.
8. Logs show which agent used which provider/model and why.
9. Existing LACK core collaboration features continue to work.

## Preferred engineering style
- incremental changes
- small auditable commits
- backwards compatibility where reasonable
- configuration-driven behavior
- clear provider interfaces
- explicit security boundaries
- tests for routing and permission logic
- documentation updated with each architectural change

## Implementation status (2026-09-08)

The single-node implementation still lives in the embedded sources in lack.py. Ollama and configurable OpenAI-compatible providers are implemented. Generation routing has bounded retries, explicit per-agent cloud fallback permission and local-only generation checks. This is not yet a fully separated router service or end-to-end privacy system. See deploy/README.md for the private VPS deployment and tests for repeatable verification. GPU integration and native Anthropic/Gemini adapters remain planned.

## 2026-10-10 latest verified local checkpoint

- Task 9 local implementation and acceptance completed: isolated browser accounts, two workspaces, live member revocation, workspace re-entry, multi-tab logout, node create/pause/resume/revoke, task status and granted provider/model selection.
- Public UI uses text-only identity/evidence rendering, in-page destructive confirmation, and fail-closed identity reset. Invalid-cookie recovery and invite acceptance have explicit regression tests.
- Full local regression: 332 tests passed, zero failures; smoke passed for real HTTP/WebSocket, two mock model backends, SQLite restart persistence, private bind and configuration preservation.
- Browser fixtures use synthetic accounts and mocked TLS/model transport. Original-source rendering includes a separate labelled DOM fixture; it is not a real research or external Agent acceptance result. Narrow chat and evidence layouts were checked at 390 pixels.
- Task 10 materialization prerequisites implemented and tested: include identity/collaboration/login assets, pinned dependency manifests and account CLI; exclude fixtures/private runtime state and reject linked destination paths before writing. Atomic runtime lifecycle, single-writer guard, HTTPS ingress and read-only VPS preflight remain in progress.
- No VPS, DNS, real credentials or Tailscale Peer Relay configuration changed. Real model, Muse Laozhen and dots Xuanji end-to-end acceptance remains pending; the overall delivery goal remains active.

## 2026-10-10 Task 10 owned-runtime local checkpoint (not stage completion)

- Task 9 was recorded complete at ef351ae after 332 passing tests and isolated real-browser acceptance. That commit has been synchronized to origin/cloud-agent-pilot-foundation.
- Added explicit startLackRuntime/close/activate lifecycle and a production startPublicRuntime assembler. Importing the materialized server has no application-data, listener or retained-timer startup effects.
- Web, workspace node REST and MCP share the identity/capacity instances. They bind to loopback, deny admission before the readiness boundary, and roll back owned resources if component startup fails.
- Added reviewed-migration readiness/schema/integrity/workspace-owner checks and an exclusive data-root lock. Reproduced and fixed the legacy entry bypass: the server now requires the actual opaque writer lease before opening a public data root; a port conflict is no longer the writer guard.
- Shutdown aborts scoped local work and waits for actual transport settlement. An unresponsive transport or incomplete cleanup is an explicit failure; it does not authorize another writer. Stale locks are not automatically adopted.
- Actual generated-package tests passed for import-only behavior, three loopback endpoints, graceful exported shutdown/restart, occupied MCP-port rollback, survival of the unrelated listener, configuration preservation and legacy-writer rejection. Windows tests emit the SIGTERM event; real Linux/systemd signal behavior still awaits Linux acceptance.
- Full local regression: 343 tests passed, zero failures; real HTTP/WebSocket + two mock model backends + SQLite restart persistence smoke passed.
- Task 10 remains in progress: Caddy/TLS/header/route acceptance, resource-limited service units, read-only VPS coexistence preflight, public pairing and safe Events runtime still need completion. Events enabled explicitly rejects startup until assembled; node registration alone is not external pairing acceptance.
- Task 11 migration/backup/rollback/durable recovery and Task 12 real provider/Muse Laozhen/dots Xuanji + sustained production coexistence acceptance remain open. No production, DNS, private credential, model endpoint or Relay changes were made. Overall delivery goal remains active and is not complete.
