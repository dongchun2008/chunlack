# Research pilot: evidence collection and three-role review

Status: local implementation only, not deployed. Batch 1 passed 30 offline
regression tests. Batch 2 adds independent role handoffs and strict evidence
gates; run `node --test tests/*.test.cjs` for current offline validation.
Real model access and live web retrieval have not been verified.

## Existing dual V100 deployment

The user's existing inference deployment uses llama.cpp and 1Cat. Do not
replace it, install Ollama, or infer its GPU split from the number of agents.
Use the existing OpenAI-compatible provider adapter if the deployed API
supports its chat-completions contract. Exact private base URL, served model
ID, authentication requirements and compatibility remain to be confirmed.
One endpoint may serve a model spanning both GPUs; two endpoints may serve
independent models. LACK should not configure the GPUs itself.

Configure the existing runtime Agent's provider and model through the existing
Agent controls. For `/siphon`, an administrator must explicitly set
`researchAgentId` to that Agent's real ID in the private runtime configuration.
No arbitrary first-agent or default-provider selection is used for research.
An Agent's research action uses that initiating Agent instead. All collection
model calls carry its ID through the existing router, including localOnly and
cloud-fallback policy. No real configuration or credentials were changed.

## Opt-in three-role configuration

Use existing real Agent IDs in the private runtime configuration. This is a
configuration fragment, not a replacement configuration or a deployment step:

```json
{
  "researchRoles": {
    "retriever": "YOUR_RETRIEVER_AGENT_ID",
    "verifier": "YOUR_VERIFIER_AGENT_ID",
    "summarizer": "YOUR_SUMMARIZER_AGENT_ID"
  }
}
```

The roles must use distinct Agent IDs, but may use the same model endpoint.
Each call uses that role's model and Agent ID through the existing router.
When an Agent initiates a research action, it is the retriever instead of the
default retriever; the three resulting identities must still be distinct.
Without `researchRoles`, the previous collection-only mode remains available.
Invalid or incomplete role mappings stop before the first model request.
If any role has `agentRouting[ID].localOnly: true`, all three must explicitly
have that policy, preventing a local-only handoff into an unrestricted role.
The router still enforces provider-locality and fallback on each model call.
This is not a guarantee that web search queries remain local: the pilot is
limited to public non-sensitive research and still uses external search.

The verifier receives saved excerpts and must return a decision for every
claim, with exact quotes for supported/partially-supported claims. Unknown
IDs, duplicate decisions, missing decisions and invented quotes reject the
entire verification stage before any claim is promoted. Conflicts require
quotes from at least two distinct source URLs. Distinct URLs do not prove
independent publishers; semantic support still depends on the model and human
review. Quotes are exact contiguous excerpts of 8-2000 characters.

The summarizer performs extractive ordering only. It must return every
supported claim ID exactly once, with no additional prose or fields. The
application, not the model, renders original claim text, exact quotes and
source URLs. Partial support, conflicts and missing-evidence notes remain
visible regardless of summary selection. A failed summary cannot overwrite
the successful evidence review. This conservative stage is not yet free-form
abstractive report writing.

`verifiedCount` is a compatibility field counting model-supported claims,
not human-verified facts. Research does not invoke the ordinary Agent response
loop, private/public memory, tools or automatic Git operations for review.

## Implemented boundaries

- No general-knowledge synthetic-fact fallback after an empty search.
- No answer generation from empty or unverified extracts.
- Extracted claims start unverified; reviewed claims retain explicit status.
- Source URL, retrieval time, bounded excerpt, excerpt hash and truncation
  indicator are retained. Claim records reference source IDs.
- Legacy `facts` strings remain for compatibility; they are not verified facts.
- `/pull` includes all question notes, claim references and missing-evidence
  messages rather than only a truncated final answer.
- Collection progress is not an evidence-confidence score.
- Research completion writes a session artifact but does not automatically
  invoke Git. This does not change other application Git features.
- Ollama and existing OpenAI-compatible adapters remain unchanged.

## Not complete; required before a real pilot

1. Repeat offline regression coverage after each change; add live acceptance
   only with explicit approval and an existing private endpoint.
2. Separate search failure, missing configuration and genuinely empty results;
   the current provider interface still merges these cases into an empty list.
3. Public-web-only fetch policy, redirect/DNS checks, response-size limits and
   durable final-URL metadata. Existing scraping is not yet a hardened gateway.
4. Human source sampling, publication-date and provenance evaluation; exact
   quotes and model review do not by themselves prove entailment or truth.
5. Real-model compatibility for strict JSON outputs and a trial topic.
6. One-task admission limit, cancellation and total model-call/time budgets.
7. Optional qualified natural-language synthesis; current synthesis only orders
   supported claims and cannot introduce prose or hide unresolved items.
8. Session reload after restart and complete UI evidence-status rendering.
9. Approved real-model test against the actual llama.cpp/1Cat private endpoint.

Do not expose a public port, modify secrets, restart the VPS or its existing
services, or run a real research task as part of this local implementation.
