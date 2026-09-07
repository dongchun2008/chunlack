# AGENTS.md

## Mission
Evolve LACK into a self-hosted hybrid multi-agent platform that allows different agents to use local and cloud models while collaborating safely in one workspace.

## Read first
Before editing code:
1. Read PROJECT_CONTEXT.md.
2. Inspect the current LACK repository structure and identify how model calls, agent definitions, tools, memory, moderator logic, and planning are implemented.
3. Prefer adapting existing abstractions over adding parallel duplicate systems.

## Hard constraints
- Do not remove working Ollama support unless explicitly requested.
- Do not hard-code 1Cat-vLLM into the LACK core.
- Do not hard-code OpenAI or Anthropic assumptions into agent logic.
- Introduce a provider-neutral abstraction.
- Per-agent provider/model assignment must be possible.
- Local and cloud models must coexist in one task flow.
- Tool execution must not require unrestricted host access.
- Never introduce code that silently exposes secrets in prompts, logs, traces, or UI.
- Destructive actions must remain approval-gated or sandboxed.

## Architectural target
Preferred flow:

Agent -> Model Router -> Provider Adapter -> Model endpoint

Provider adapters may include:
- Ollama
- OpenAI-compatible
- OpenAI
- Anthropic
- future providers

The router should own policy. Agent code should declare intent/configuration, not implement vendor-specific transport logic.

## Minimum provider interface
The implementation should converge on an abstraction capable of expressing at least:
- provider id
- model id
- base URL / endpoint
- credentials reference
- timeout
- max tokens
- temperature or equivalent generation settings where supported
- streaming support
- tool/function calling capability flags
- structured output capability flags
- health status

Exact naming may differ to fit the existing codebase.

## Per-agent configuration
Each agent should eventually support configuration similar to:

agent:
  id: research-agent
  provider: local-vllm
  model: research-model
  fallback:
    provider: cloud-openai
    model: strong-reasoning-model
  routing_policy:
    local_only: false
    allow_cloud_escalation: true

Do not force this exact YAML shape if the existing project uses JSON, JS objects, environment variables, or database-backed configuration.

## Model Router responsibilities
Keep these concerns centralized:
- provider selection
- model selection
- fallback
- escalation
- timeout/retry
- provider health
- rate limiting
- concurrency
- cost/token accounting where available
- structured logs
- privacy restrictions

## Security instructions
Treat all agent tools as untrusted execution paths.
- Prefer containerized/sandboxed shell execution.
- Limit filesystem access to workspace roots.
- Avoid mounting Docker socket.
- Use allowlists/denylists for high-risk commands where practical.
- Keep API keys in environment/secret stores, not source code.
- Add explicit approval requirements for destructive operations.
- Preserve and strengthen Moderator/HITL boundaries.

## Development sequence
When asked to begin implementation, follow this order unless code inspection shows a better dependency sequence:
1. Repository architecture map.
2. Model-call path analysis.
3. Provider interface design.
4. Preserve Ollama through adapter.
5. Add generic OpenAI-compatible adapter.
6. Add per-agent provider/model selection.
7. Add Model Router.
8. Connect 1Cat-vLLM through OpenAI-compatible endpoint.
9. Add cloud provider(s).
10. Add fallback/escalation tests.
11. Harden tool execution.
12. Document deployment.

## Testing expectations
At minimum, add tests or repeatable verification for:
- agent A -> local model
- agent B -> cloud model
- same conversation/task involving both agents
- provider failure -> fallback
- local-only policy blocks cloud use
- timeout behavior
- routing logs
- existing Ollama behavior remains functional

## Code review checklist
Before considering a change complete, verify:
- Does this preserve provider neutrality?
- Can an agent choose a different model from another agent?
- Is policy separate from provider transport?
- Are secrets safe?
- Are execution permissions constrained?
- Is the change observable/loggable?
- Is configuration documented?
- Are failure modes explicit?

## Default decision rule
When there is a tradeoff between a fast one-off integration and a slightly more modular provider-neutral implementation, choose the modular approach unless it would substantially delay a minimal working prototype.
