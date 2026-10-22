# PROJECT_CONTEXT

> 当前发布快照（2026-10-21）：仅 MCP 元数据兼容模块的候选 `27139edf8fbb` 已受控发布，维护窗口 31.811 秒，历史 systemd journal 核对整个发布单元上界 38.386799 秒；保留发布时 552 文件、3 个数据库的一致性备份和旧代码。计时夹具复测 10/10 通过，未为取证重新发布。当前所有者通过既有 Pocket ID 会话进入工作区。MCP-only、一个专用 dots 客户端、事件关闭及公网节点 REST 关闭的边界保留。见[模块发布记录](docs/verification/2026-10-20-mcp-request-metadata-publication.json)、[计时与认证后续](docs/verification/2026-10-21-mcp-timing-and-connector-followup.json)和[最新逐项审计](docs/verification/2026-10-21-delivery-gate-audit.json)。下列旧日期条目均为历史快照。

> 玄玑单任务验收（2026-10-21）：经单独批准的一小时、三项任务权限临时授权下，玄玑原生对话领取唯一公开网页任务（attempt=1），使用自身云端浏览器并回传结果和截图；原生回复附件与服务端保存的 56,110 字节 JPEG 的 SHA-256 相同。任务为 `succeeded`、回执 `accepted: true`；本人另行核对并明确确认后，证据状态已持久化为 `accepted`，记录验收时间，不把服务回执自动当作人工验收。临时授权已撤销，创建／撤销审计已只读复核，当前授权数为 0；四个服务进程、配置和凭据未变。此次是人工触发单任务，不是 Events 自动唤起、长期稳定性或 Muse 接入验收。见[单任务记录](docs/verification/2026-10-21-native-dots-single-task-acceptance.json)、[接入说明](docs/MUSE_DOTS_INTEGRATION.zh-CN.md)和[使用手册](docs/USER_GUIDE.zh-CN.md)。

> 最新开发验证（2026-10-18，未发布）：以已提交代码 `3546b2b2ba153e51afa5926517d1b43d7c00951c` 导出的独立副本完成 Windows 全量回归，861/861 通过，零失败、零跳过、零取消；HTTP/WebSocket、两个模拟模型、SQLite 重启持久化及配置保留烟雾测试通过。全量运行仅为测试进程设置 `GOMAXPROCS=1`，随后默认 Go 设置下的 MCP-only 同组测试也 5/5 通过。原 Caddy 校验 10 秒上限未改；诊断遗漏的 stdin 写入已修正，三项补测均通过。原限额 Linux MCP-only 5/5 为此前同实现的独立证据，不能与本轮测试简单相加。见 [验收记录](docs/verification/2026-10-18-mcp-only-full-regression.json) 和 [配置与复现说明](docs/MCP_ONLY_CONFIGURATION.zh-CN.md)。

> 接入与发布边界（2026-10-18）：独立只读复核未发现此变更新增的越权或功能回归，但仍保留组合覆盖缺口。本轮未部署 MCP-only、未操作 VPS/Relay、未授予外部 API、工作区或任务权限。独立公共 PKCE 客户端“ChunLACK dots”已登记不等于玄玑已接入；Muse 老镇与 dots 玄玑自身电脑的真实任务及证据闭环仍未验收。已知未提交的界面修改未纳入测试副本或发布候选。下一步可准备受控发布方案，实际维护与外部授权仍须分别确认，整体交付目标尚未完成。

> 最新真实模型补充（2026-10-17）：Windows 独立 HTTPS/WSS 运行时通过五 Agent 两轮验收，实际生成 10/10 成功，回复跨隔离运行时重启保持一致；调用经临时本机回环 SSH 转发沿用 VPS 已有模型路径，转发及测试进程已退出。VPS 四项服务身份未变。这不是 VPS 持续负载、真人 Pocket ID 新登录或 Muse/dots 接入验收；失败尝试仍保留。见[真实五 Agent 验收](docs/verification/2026-10-17-real-five-agent-isolated.md)。

> 最新部署状态（2026-10-17）：公网预接入已发布，维护中断 32.003 秒；Agent 业务仍拒绝访问，未创建外部客户端或授予权限。旧 LACK、Relay 与原凭据保持不变。当前验收边界、浏览器客户端拦截及 Muse/dots 待办以 [发布说明](docs/PREACCESS_RELEASE_2026-10-17.zh-CN.md) 和 [验收记录](docs/verification/2026-10-17-preaccess-publication.json) 为准；下方早期未发布条目保留为历史。

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

## 2026-10-11 native low-budget checkpoint (not full delivery)

- Actual-backup conversion and authenticated native business acceptance have separate evidence under docs/verification. Unknown roots remain quarantined, and fixture identities are not formal human accounts.
- A subsequent sustained isolated business trial completed 1800.892 seconds, 1080 authenticated requests, 30 message writes, two workspaces, three fixture users and five WebSocket clients. Restart, logout, original 13-message retention, SQLite integrity and frozen-source preservation passed.
- The trial requested CPU 10%, MemoryMax 192 MiB and no swap; its whole-unit memory peak was 134.359 MiB, swap peak zero, and 62 samples recorded no max/OOM event. Exact applied quota/limit properties were not independently captured. This is measured acceptance of that workload and duration, not indefinite stability or five-Agent inference capacity.
- Both original services retained their PIDs, restart counters and unit-file hashes; original LACK health remained 200 and the Relay listener remained present. Actual Relay forwarding quality was not measured. The owned trial stopped and its unit became not-found.
- The corrected fixed-revision local package was generated and inventoried without being started. No production cutover, live owner creation, certificate, credential/DNS/firewall change, or maintenance-window consumption occurred.
- Complete model-task load, combined HTTPS/application budget acceptance, formal account/data ownership, deployed direct 1Cat and native Muse Laozhen/dots Xuanji acceptance remain open. Open WebUI is not an integration target. Overall delivery remains active; see docs/verification/2026-10-11-low-budget-sustained-validation.md for scope and evidence hashes.

## 2026-10-11 bounded native model-capacity and TLS checkpoint

- Native capacity component retest: 5/5 passed, 24 complete five-participant mock rounds, 120 mock requests; applied CPU 10%, MemoryHigh 160 MiB, MemoryMax 192 MiB, swap 0, TasksMax 32. This is not native vendor-Agent or real-model inference acceptance.
- Native application + fixture TLS/WSS: 3/3 passed in the same 192 MiB / CPU 10% unit budget; peak 115224576 bytes, swap peak 0. Caddy 2.11.7 remained an isolated verified tool, not a global installation or production service.
- Original LACK and Tailscale PIDs/unit hashes remained unchanged, health 200 and Relay listener present; the owned test units/fixtures were stopped/cleaned. Public TCP 443 remained unbound. Relay forwarding performance was not measured.
- Evidence: docs/verification/2026-10-11-native-capacity-retest.md and docs/verification/2026-10-11-combined-tls-budget-validation.md.
- Real VPS-to-1Cat routing/generation, Muse/dots native computer-task acceptance, formal owner creation/data attribution, production TLS/login and sustained combined real workloads remain pending. The publication window is still unconsumed; do not claim production delivery or accepted production caps from these fixture trials.
- A usable direct-model private address or separately approved bounded loopback forwarding test is still needed. External node task protocol currently has research/browser types, not general model inference. Do not widen the public browser pilot or reuse Open WebUI credentials as a shortcut.

## 2026-10-11 Pocket ID human login checkpoint (not release ready)

- Existing issuer: https://pockid.chunclaw.top; dedicated client and real login remain unconfigured/unverified.
- Opt-in relying party, explicit identity links/schema v2 and local-session route integration are implemented in the development branch only.
- Full local run: 523 tests, 514 pass, 2 fail, 7 skip. Browser readiness recheck also failed; do not call this accepted.
- Open review findings: owned OIDC shutdown/drain, concurrent browser-login identity race, and genuine v1 migration plus active/revoked-link archive coverage.
- Corrections were disclosed and approval requested. No production/Relay/Pocket ID configuration changes. Preserve the long-term goal as active.
- See docs/verification/2026-10-11-pocket-id-login-checkpoint.md and docs/POCKET_ID_SETUP.md. Older custom OAuth core remains unmounted.

### Pocket ID diagnostic follow-up (same product revision 803e77b)

- No matching browser-fixture Node processes remained from failed runs. Owned startup probe reached readiness in 3362 ms; unchanged browser test then passed 1/1 without the probe. Earlier timeout root cause remains unconfirmed.
- Two new regression tests reproduce the disclosed OIDC shutdown-cancellation and delayed-login race; 0/2 pass as expected before repair. Product code was not changed; correction request remains outstanding.
- Last full-suite counts still refer to the prior 523-test run, not these later isolated runs. See docs/verification/2026-10-11-pocket-id-diagnostic-followup.md. Keep release and full-delivery gates closed.

### Authorized Pocket ID corrections and fresh review

- Added owned abort/drain, browser generation, successful-login session replacement and SQLite fixture cleanup. New tests cover generated-runtime shutdown/rollback, frozen genuine v1 migration, and active/revoked-link snapshot/restore.
- Focused 69/69 passed. Extended 43/44 passed, with an unchanged nested Node startup deadline timing out. Full regression: 532 total, 525 pass, 0 fail, 7 skip; the writer-guard test passed without changes. Startup timing cause remains unknown. HTTP/WebSocket, two mock models and persistence smoke passed.
- Fresh review blocks release: newer begin does not revoke an already-issued old session; stream cancellation is not fully drained; abandoned browser bindings can exhaust the new 256-entry capacity. The latter two were reproduced using synthetic diagnostics. Additional correction approval was requested.
- Seven real Caddy/packaged HTTPS tests were skipped, not passed. Active-session restoration and uncooperative OIDC writer-lock retention need coverage. See docs/verification/2026-10-11-pocket-id-repair-checkpoint.md.
- No production, Pocket ID application, credentials, VPS/Relay or provider-route changes. This checkpoint is not release-ready; full delivery remains unfinished.

### Read-only capability follow-up

- Fresh public Pocket ID discovery and JWKS both returned 200 at 2026-10-11T15:35:07.693Z. S256, RS256, authorization code and client_secret_basic are advertised; the public key is RSA/RS256. Dedicated client, real login and installed version remain unverified.
- Local HTTPS skips are gated by absent CADDY_TEST_BIN. Verified official Windows archive/manifest SHA-256 downloads are isolated in ignored storage, but preparation stopped before extraction/execution because the command compared the manifest SHA-512 with the API SHA-256. Correction permission was requested; no new HTTPS pass claim.
- See docs/verification/2026-10-11-pocket-id-live-capability-followup.md. Login review blockers and production boundaries are unchanged.

### Authorized Windows HTTPS supplement

- Corrected the portable Caddy checksum command after explicit approval: archive/manifest SHA-256 and the archive's published SHA-512 all matched. Only the verified executable was extracted; no global installation or service creation.
- Unchanged HTTPS test files completed 11/11, zero failures/skips/cancellations, 47348.7477 ms. This includes all seven previously skipped TLS/HTTP2/WSS/packaged multi-user and node scenarios. No owned Caddy processes remained afterwards.
- The earlier 532-test full-run count remains historical; this is a separate supplement, not a newly combined full run. Backends/nodes are synthetic, not real Muse/dots acceptance, and no production resource-cap claim follows.
- Evidence: docs/verification/2026-10-11-windows-https-supplement.md. Remaining OIDC repairs were not authorized by the Caddy-only response and were not performed. Production LACK, Pocket ID and Relay remain unchanged.

## 2026-10-12: approved session migration/restore test coverage

- Local test-only correction: explicit eight-column/eight-placeholder legacy session INSERT in `tests/workspace-migration-apply.test.cjs`.
- Genuine v1 migration and v2 snapshot/restore now cover active session authentication, CSRF, revoked-session rejection and logout in isolated working copies, preserving source/archive bytes.
- Fresh focused result: 2/2 passed. Related five-file regression: 77/77 passed, zero failures/skips/cancellations; the focused cases are included in those 77.
- Evidence and exact commands: `docs/verification/2026-10-12-session-migration-restore-validation.md`.
- No product code, production, Pocket ID application or Relay changes. Restore trials remain non-activatable; this is not production rollback-session policy validation.
- Three previously reported OIDC product issues and shutdown/writer-lock coverage remain pending separate approval. Real Pocket ID and native Muse/dots delivery gates remain open.

## 2026-10-12: OIDC boundary repairs verified locally

- Approved repairs now revoke already-issued prior browser sessions on a newer OIDC begin, await response-body cancellation settlement, and expire abandoned browser records after five minutes without pruning authenticated mappings early.
- Two review findings were separately authorized and corrected: restore missing bindings after local password login; reserve bounded binding capacity after password validation but before synchronous session issuance/registration. HTTP regressions verify rejected attempts do not create hidden sessions or revoke existing ones.
- Final focused regression: 80/80 passed. Final full repository regression with verified portable Caddy: 541/541 passed, zero failures/skips/cancellations. Smoke passed for local HTTP/WebSocket, two mock model backends, SQLite persistence, private binding and config preservation. No matching Caddy test process remained.
- Real generated-package fault injection proves incomplete OIDC body cancellation retains the writer lock on shutdown and startup rollback, rejecting second writers even after later drain. This is Windows-local evidence, not native Linux or production acceptance.
- Evidence, intermediate review findings, reproduction failures and final log hashes: `docs/verification/2026-10-12-oidc-boundary-repair-validation.md`. Pocket ID setup instructions updated. No product dependencies, provider routes, Pocket ID applications, live credentials, VPS services or Relay configuration changed.
- Dedicated Pocket ID real login, native Muse LaoZhen/dots XuanJi task/evidence round trips and production publication remain open. The custom OAuth core remains unmounted; full platform delivery is not claimed.

## 2026-10-12: pinned post-repair candidate package

- Exported immutable commit `753308194bfb9136e34555008d68c4736f76292e` and materialized its runtime into a new ignored local candidate directory. This avoids mixing later documentation or checkout changes into the source package.
- Runtime: 53 files, 837191 bytes; compressed archive: 218783 bytes. Inventory and independent unpacked-file count/size/SHA-256 checks passed. No installed dependencies, live data or private configuration were copied.
- Artifact hashes and scope: `docs/verification/2026-10-12-pinned-oidc-candidate.md`. Default configuration is not a production-ready configuration; no runtime or VPS was started/contacted.
- Dedicated Pocket ID client availability requested; existing Tailscale/OIDC applications remain untouched. Native post-repair verification, external enrollment and full delivery remain separate gates.

## 2026-10-12: native OIDC/session isolation retry accepted

- Candidate source remains `753308194bfb9136e34555008d68c4736f76292e`; no product code changed in this retry.
- With explicit approval, mapped only existing dependencies read-only into the test namespace, retaining nobody, private networking, PrivateTmp, 10% CPU and 192 MiB maximum memory.
- Native Linux results: oidc-login 11/11, oidc-review-regressions 12/12, identity-session 22/22; 45 total passes, zero failures/skips/cancellations. Highest recorded memory peak was 92356608 bytes.
- Production preflight/postflight records matched. Existing LACK and Tailscale Relay were not restarted or modified. No owned test unit remains active according to the completed controller result.
- Evidence and limitations: `docs/verification/2026-10-12-native-oidc-session-validation.md`. Earlier failed attempts remain documented separately.
- Pocket ID client creation is authorized but awaits the user's deferred Passkey login. Real Pocket ID authentication, native runtime/HTTPS and migration integration for this revision, native Muse/dots execution and formal publication are not accepted by the 45-test result.

## 2026-10-12: native storage/HTTPS pass; runtime timeout gate remains

- Same pinned product source `753308194bfb9136e34555008d68c4736f76292e`, with no product/test assertion changes.
- Native storage: 52/52 pass across migration application, snapshot/WAL/root-boundary and isolated restore tests. Native HTTPS/ingress: 10/10 pass, actual materialized application/Caddy where specified; no skips or cancellations.
- Runtime group: 15/17 pass. Two unchanged 5-second child-start deadlines timed out. Independent bounded sampling measured a natural cold import exit at 6.096 seconds total, 5.600 seconds module load and 0.560 seconds CPU, without creating package db/jspace directories. This diagnostic does not replace either failed test.
- Requested approval for an explicit bounded low-CPU test mode; defaults and product deadlines remain unchanged until approved. Pocket ID login is deferred by the user.
- All groups retained nobody, private network/tmp, 10% CPU, 192 MiB max, zero swap and four-minute per-unit limits. Production service baselines matched; no active owned test units remain in the completed controller records.
- Full evidence and remaining gates: `docs/verification/2026-10-12-native-runtime-storage-https-validation.md`. No production deployment, live data migration or native Muse/dots acceptance was performed.

## 2026-10-12 native runtime low-CPU retest

- User-authorized test-only cold-start mode is committed as `36ec636`.
- Native Linux runtime group passed 17/17 with no skips/cancellations at unchanged 10% CPU, 192 MiB memory and 240-second unit ceiling.
- LACK and Tailscale Relay baseline/postflight matched; the owned unit stopped. No production update or public listener change.
- Evidence: `docs/verification/2026-10-12-runtime-low-cpu-retest.md`.
- Separate dependency-security upgrade/regression remains in progress; this native result does not include upgraded dependencies. Pocket ID and native Muse/dots acceptance still gate delivery.
## 2026-10-12 dependency upgrade checkpoint (not accepted)

- Local-only security candidate updates simple-git 4.0.2 and four associated/transitive packages; production dependencies are untouched.
- Actual installed versions now match the candidate lock. Current advisory query returned no findings across 239 locked package names; this is not functional acceptance.
- Existing suite: 525/541 passed, 16 failed. The new seven-case dependency test file was not included in that run.
- Confirmed startup break: simple-git 4 exports a named factory; the legacy callable require import must be adapted. New Git fixtures also need safe HOME/XDG isolation instead of GIT_CONFIG_GLOBAL. Repair confirmation requested, not yet applied.
- One SDK fetch failure passed a separate rerun; cause remains unknown. A full enlarged-suite rerun, smoke and native upgraded-dependency validation are required.
- See `docs/verification/2026-10-12-dependency-security-checkpoint.md`. Do not confuse this uncommitted candidate with the earlier accepted native runtime-only retest.

## 2026-10-23 隔离真实研究闭环验收（未发布）

- 当前源码 `75a7aca23d5b1be5b606cf8ac78b087062f6964e` 通过本轮独立预算验收：16/20 次实际 1Cat 推理，零失败，串行最多 1 个请求；最长 9.558 秒，转发控制器总耗时 124.098 秒，未扩展 20 秒单请求及 10 分钟总预算。此前独立轮次 13/20、17/20 分别保留，不重置。
- 检索员、核验员、汇总员是三个不同逻辑 Agent，但共享一个真实模型；不等于不同模型独立核验、云端混合供应商或物理节点验收。
- 24 条模型判为 supported 的陈述、26 处逐字引文和 24 个摘要引用均保留来源；六份 IANA 原文快照对应两种不同摘录正文。九条非 IANA 候选因本轮出站白名单被拒绝，保留 fetch_failed，不生成替代事实。模型支持不等于事实已经人工确认。
- 实际 HTTPS/WSS 研究流程、获授权的研究 REST、现有 workspace-shell 文本 DOM 展示及隔离运行时重启持久化通过；不是像素级浏览器验收，公网 `/pull` 继续禁用。
- 临时本机回环转发与独占测试运行时均已关闭；未发布生产，未改现有凭据、授权、DNS、端口或 Relay，未向原生 Agent 日常对话发送消息。整体交付门槛仍未全部完成。
- 详见 [真实验收记录](docs/verification/2026-10-23-real-research-rest-acceptance.json) 与 [逐项交付审计](docs/verification/2026-10-23-delivery-gate-audit.json)。
