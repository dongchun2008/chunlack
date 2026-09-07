# ARCHITECTURE

## 1. Overview

The platform is divided into five logical layers:

1. Collaboration layer
2. Agent orchestration layer
3. Model routing and inference layer
4. Tool/execution layer
5. Data and knowledge layer

## 2. Collaboration layer

LACK remains the primary user-facing workspace.

Responsibilities:
- channels
- threads
- mentions
- agent conversations
- task visibility
- planning
- human approvals
- status/progress

## 3. Agent orchestration layer

Responsibilities:
- agent identities
- agent prompts/instructions
- memory
- delegation
- planning
- moderator behavior
- triangulation/cross-check workflows
- iterative reconciliation loops

This layer should not contain provider-specific networking code.

## 4. Model routing and inference layer

### 4.1 Model Router

Central component responsible for routing agent requests.

Example:

ResearchAgent
  -> Model Router
      -> local-research -> 1Cat-vLLM GPU0
      -> fallback -> cloud reasoning model

CoderAgent
  -> Model Router
      -> Codex
      -> fallback -> local coding model on GPU1

CIOAgent
  -> Model Router
      -> strongest cloud reasoning model

### 4.2 Provider adapters

Recommended adapters:
- ollama
- openai-compatible
- openai
- anthropic
- codex adapter or execution bridge if applicable

### 4.3 1Cat-vLLM

Use 1Cat-vLLM as a local OpenAI-compatible serving layer rather than coupling LACK directly to its internal implementation.

Preferred starting topology:
- GPU0: research/general model
- GPU1: coding/reasoning model

Alternative:
- tensor parallel across both GPUs for a larger model

## 5. Tool and execution layer

All side-effecting tools should flow through a controlled boundary.

Examples:
- MCP gateway
- coding agent bridge
- shell sandbox
- browser automation service
- git service
- file workspace service

Avoid unrestricted access from LACK directly to the Linux host.

## 6. Data and knowledge layer

Future integrations:
- global news aggregation
- financial market analysis
- global situation awareness
- private RAG
- Obsidian vault
- internal documents

Preferred integration path:
- MCP where practical
- explicit internal API otherwise

## 7. Example multi-agent workflow

User asks for an investment research brief.

1. NewsAgent collects recent relevant material using local model and tools.
2. DataAgent structures market/financial inputs locally.
3. MacroAgent forms a macro view using a stronger local model.
4. RiskAgent independently challenges the thesis.
5. ResearchAgent escalates uncertain reasoning to a cloud model if policy permits.
6. CIOAgent receives all outputs and produces the final synthesis using the strongest approved model.
7. Human approval is required before any external or destructive action.

## 8. Routing example

```yaml
agents:
  news-agent:
    primary: local-small
    local_only: true

  research-agent:
    primary: local-research
    fallback: cloud-reasoning
    escalation_threshold: 0.65

  coder-agent:
    primary: codex
    fallback: local-coder

  cio-agent:
    primary: cloud-reasoning
```

This is conceptual configuration, not a mandated schema.

## 9. Security model

Security zones:

Zone A: LACK/UI
- no privileged host access

Zone B: model endpoints
- inference only
- restricted network exposure

Zone C: tool gateway
- explicit capabilities
- audit logging
- approval controls

Zone D: private data systems
- least-privilege credentials
- local-only routing where required

## 10. Observability

Every model call should ideally record:
- timestamp
- agent id
- task/conversation id
- provider
- model
- route reason
- fallback/escalation event
- latency
- token usage if available
- error class

Do not log secrets or full sensitive prompts by default.

## 11. MVP boundary

The first useful milestone is not the full research platform. It is:

- LACK running normally
- Ollama still supported
- generic OpenAI-compatible provider added
- 1Cat-vLLM connected
- cloud model connected
- two different agents using different backends
- collaboration between those agents verified
- fallback tested
- tool permissions constrained

## Current implementation and deployment (2026-09-08)

Model selection and fallback are centralized in queryOllamaWithRetry, with queryOllama delegating to that path. Compatibility names remain. Provider adapters use listModels/generate/embed. Cloud fallbacks are explicit in config.agentRouting; local compatible endpoints use config.llmProviders with local: true. Chat-provider changes do not change embeddingProvider. Persisted memory vectors are invalidated when the embedding namespace changes; source text is retained.

scripts/materialize.py extracts runtime files without executing the legacy installer. Docker runs immutable application code as uid 1000, with dedicated persistent data directories and a read-only root filesystem. Compose publishes only to host loopback; initial access is over SSH. LACK has no complete authentication/authorization system and must not be exposed as a public multi-user service. Container isolation bounds host access; existing internal tool/STACK/CI paths do not yet constitute a fully permissioned Tool Gateway. The localOnly switch covers model generation routes, not propagation of shared-channel content to other agents. Keep confidential workflows in separately scoped channels/instances with local embedding and local agents.
