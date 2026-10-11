# Real backend and conversation restart contract

Date: 2026-10-11. Product revision under test: `3e9f6d56220629f0f9440b04236dc31f850b26bd`.

## Result and limits

The local isolated packaged-runtime probe exited 0. It exercised real HTTPS and WSS through Caddy, synthetic human accounts and workspaces, and an existing direct OpenAI-compatible inference endpoint. It did not use Open WebUI, change production, connect a vendor Agent, or establish overall delivery readiness.

The endpoint's fresh model-list request returned HTTP 200 and advertised `qwen38-27b-nvfp4`. The tested completions returned that model identifier. The fixture provider label `cat1-pilot` is not evidence of the inference engine, physical GPU, or 1Cat implementation behind the endpoint. That topology remains unverified.

## Evidence

- Exactly four inference POSTs were forwarded and succeeded; failures and budget rejections were both zero.
- Each forwarded request was limited to 32 output tokens, a 15-second timeout and a bounded response. No upstream credential was read or sent.
- Route durations were 390, 759, 358 and 742 milliseconds. These four samples are not a throughput or sustained-capacity benchmark.
- An Agent configured in workspace A generated a response containing observed real-backend output before restart.
- Restart of the isolated application retained the exact response ID and content in channel history.
- The persisted Agent completed another main-response/reflection cycle against the real backend after restart.
- A different workspace's owner received HTTP 404 for workspace A's provider view both before and after restart.
- Both tested local task scopes settled with no active branches; no inference request was active at the observed settlement points.
- The post-restart local task view contained zero prior records. Automatic task recovery was not tested or claimed.
- Cleanup closed the fixture and its own connections. The operator process exited 0.

Private operator evidence is retained under the ignored directory `.superpowers/sdd/2026-10-11-legacy-root-archive/`: `real-model-restart-contract-r3.log` and `real-model-restart-contract-r3-report.json`. These are local operator artifacts, not committed credentials or portable public test fixtures.

## Earlier failures must not be hidden

The original pilot assumed completed local task metadata survived restart. That assertion does not match the current task-control contract and its failed log remains retained.

Two subsequent probes required an exact or OK-containing model reply. The backend returned valid, nonempty completions that did not meet that arbitrary text condition. A model connectivity test must compare actual backend output with the delivered message, rather than assume prompt compliance.

The next probe exited 0 for narrower conversation/persistence criteria but forwarded only three successful requests. Its fourth attempted call was refused by its three-request guard and logged a failed route. That run was partial evidence, not an error-free two-round acceptance. Its report omitted a rejection counter and must not be used alone to claim a clean workflow.

The final probe changed only the isolated operator harness: four requests maximum, explicit zero failure/rejection assertions, and two successes required per response cycle. It preserved the earlier reports and did not raise production resource limits.

## Why four requests are necessary here

In the tested configuration, musing, triangulation and embedding requests are disabled. `agentRespondBody` makes a main `queryOllamaWithRetry` call and then calls `generateReflection`, which makes another model request. `judgeAndReweight(..., true)` uses the lightweight scoring branch rather than another inference judge. Therefore two ordinary response cycles require four completions in this configuration; other configurations may require more.

These legacy function names do not imply an Ollama transport was used: the configured provider routed all four requests through the direct OpenAI-compatible adapter. Existing Ollama support remains unchanged.

## Persistence is not a single capability

`collaboration/task-control.cjs` holds bounded local task metadata in an in-memory Map and explicitly keeps durable recovery and the external lease journal separate. `/api/tasks` combines this local live view with external gateway tasks. A local task scope marked completed means its execution scope settled; it is not proof that every model call or every business requirement succeeded.

The probe establishes conversation history and Agent configuration persistence for its fixture. It does not establish automatic resumption of interrupted local tasks, preservation of the local task view, or real vendor task recovery. External lease persistence has a separate implementation and acceptance boundary.

## Remaining gates

Production original-data consistency, independent application recovery and rollback, public domain TLS/login, bootstrap of the selected real owner, real Muse and dots execution, actual inference topology, and sustained multi-user/Agent coexistence with measured Relay traffic remain delivery gates. See [delivery readiness](../DELIVERY_READINESS_2026-10-11.zh-CN.md).
