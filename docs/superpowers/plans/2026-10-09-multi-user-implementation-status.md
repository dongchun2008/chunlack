# 多用户、多工作区实施进展

日期：2026-10-10。实施计划已由用户确认，采用本会话直接开发和测试。

## 已完成 Task 1

- 新增账号、工作区、成员关系及审计 SQLite 存储，不把密码哈希返回到普通用户对象。
- 实现所有者、成员、只读成员的默认拒绝策略，未知动作和平台级权限不会因为工作区所有者身份自动放行。
- 成员修改重新查询当前权限，拒绝伪造角色、跨区操作和被撤销的旧上下文。
- 最后一名有效所有者不能被删除、降级或停用；跨工作区停用检查在同一事务内完成。
- 通过两个独立线程及 SQLite 连接并发降级的真实测试，最终始终保留一名有效所有者。
- 数据库重开、外键、完整性、账号停用、作用域审计和未来 schema 拒绝均有测试覆盖。

## 本轮测试证据

- 新增身份测试先因尚无实现失败，随后 `16/16` 通过。
- 完整测试 `155/155` 通过，失败、取消和跳过均为 0。
- `node tests/smoke.cjs` 退出码 0，覆盖本地真实 HTTP/WebSocket、两个模拟模型后端、SQLite 重启持久化、私有监听和配置保留。
- 命令、日志与 Task 1 BASE 保存在本计划专属的 Git 忽略执行记录中；不提交运行数据库、密钥或截图。

## 已完成 Task 2

- 密码采用带随机盐的 scrypt；认证前限制同时进行的密码运算、来源和账号尝试次数，缓存有明确上限。
- 会话只保存令牌摘要，支持闲置和绝对过期、注销、全端注销、账号停用、密码重置，以及权限变动通知。
- 重置令牌一次性使用且有时效；会话支持服务重启后续用，同时限制每个账号的活跃会话数量并分批清理旧记录。
- 已修复限流模块遗漏导出。身份与会话联合测试 `38/38`，完整回归 `177/177`，失败、取消、跳过均为 0；真实 HTTP/WebSocket 冒烟测试退出码为 0。模型后端仍为模拟后端，不是远端真实模型验收。
- 本地密码性能测量仅代表当前 Windows 开发机器，不能当作 VPS 容量结论。

## 已完成 Task 3

- 新增身份 HTTP 路由：登录、当前账号、注销、全端注销、密码重置、工作区列表、成员管理和邀请。
- 登录 Cookie 为 `__Host-chunlack_session`，限制 Secure、HttpOnly、SameSite 与 Path；修改请求检查精确 Origin，已登录账号的修改请求另检查 CSRF。
- 开户仅通过绑定账号与工作区的 24 小时一次性邀请；已有账号必须以匹配的身份登录后接受。账号和成员关系原子创建，邀请者失去 owner 权限后旧邀请不能继续授权。
- 新增本机维护命令 `scripts/accounts.cjs`，首个管理员密码仅从受控 stdin JSON 输入；拒绝密码命令行参数和重复初始化。重置令牌写入不覆盖的私有文件，不打印令牌到正常日志。
- HTTP 与维护命令测试 `18/18`，包含独立进程竞争接受邀请、数据库写入故障回滚、会话固定攻击、权限伪造、CSRF 和邀请重用。
- 完整回归 `195/195`，失败、取消、跳过均为 0；HTTP/WebSocket 冒烟测试退出码为 0。此前回滚测试的 Windows 文件清理失败已修正并复验。

## 已完成 Task 4

- 新增冻结的 AsyncLocalStorage 工作区上下文，独立工作区状态及有上限的状态注册表；业务句柄每次访问重新核验账号的实际成员资格和角色。
- 六类原有业务数据和研究会话、原始来源采用非空工作区标识、复合键与必要外键，搜索、导出和来源查询均带工作区范围。未知新表拒绝启动，旧消息库需要显式迁移，不原地猜测数据归属。
- 嵌入式服务器的消息、Agent、项目状态、pipeline 和循环健康持久化入口已添加受限委托；业务 Map、缓存和循环控制在启用多人模式后按工作区分离。旧式原始业务 SQL 在该模式下被拒绝。
- 保留明确的本机旧模式；显式公网模式不能自动回退到旧模式。原有 Agent 显示名与内部 ID 的对应在当前工作区内解析，原始显示名保留。
- 工作区与既有供应商、研究联合测试 `64/64`，完整回归 `208/208`，失败、取消、跳过均为 0；HTTP/WebSocket 冒烟测试退出码 0。模型仍为模拟后端，不代表远端实测。
- 本阶段仅实现数据与状态边界。旧 HTTP/WebSocket 入口的认证、连接撤销、文件/模型授权和完整启动流程仍由后续阶段完成，未启用多人公网运行。

## 当前交付状态与下一步

目前完成账号、权限、密码、会话、邀请、身份 HTTP 和工作区数据/状态基础，但尚未接入完整的公开运行入口。真人登录页面、HTTP/WebSocket 连接隔离、文件与模型授权、节点授权桥接、生产迁移及真实 Muse/dots 验收尚未完成。未提供可用的多人网页，不将上述测试称为完整交付。

未修改 VPS、DNS、凭据、既有 LACK 或 Tailscale Relay。继续按 Task 5 实现 HTTP/WebSocket 的身份、消息权限与连接撤销；生产切换仍须满足计划中的单独安全条件。

## 2026-10-10 Task 5: verified workspace HTTP and WebSocket boundary

- Implemented authoritative session/membership/Origin/CSRF checks, server-owned sender identity, action allowlists and workspace/channel/thread-scoped delivery.
- Passive push and sweep do not extend idle sessions; removal, disable and logout revoke live connections. Connection/frame bounds are enforced.
- Real certificate-verified HTTPS/WSS fixtures and an isolated real embedded LACK child-process test passed. This is local validation with mock models, not VPS or real external-agent acceptance.
- Full suite: 224 passed, 0 failed, 0 skipped. Smoke: passed (HTTP/WS, two mock backends, SQLite restart persistence, private bind, config preservation).
- Public shell/Git, global maintenance and unscoped filesystem/summary interfaces remain denied pending resource guards. Member-owned cancellation requires server task ownership in Task 8.
- Remaining delivery work: Tasks 6-12. Production cutover and real Muse/dots computer execution are not yet accepted.

## 2026-10-10 Task 6: workspace resource and model boundaries verified locally

- Added private workspace resource paths, traversal/symlink/junction rejection, separate personal user directories, bounded atomic JSON writes and credential-shaped payload rejection.
- Model catalog summaries contain only granted IDs/models and safe metadata. Primary generation, embeddings and every fallback revalidate membership and model grants before transport. Viewers may read metadata but cannot generate; workspace owners are not platform credential administrators.
- Embedding and J-space caches include workspace/user boundaries; shared-memory summaries and captured maintenance callbacks are workspace-scoped. Maintenance remains opt-in. Shell/Git/unreviewed Agent tool actions remain disabled in multi-user mode, including when shell permission is otherwise enabled.
- Research snapshots are persisted with original URLs and acquired excerpts, updated without source URL substitution, and restored on workspace initialization. Existing no-synthetic-facts and missing-evidence regressions remain intact. Research roles and routing do not inherit legacy global assignments.
- Local validation: 73 named resource/provider/research/store/runtime tests passed; the external research gateway compatibility regression passed 4/4; complete suite passed 237/237, zero skips. Smoke passed HTTP/WS, two mock model backends, SQLite restart persistence, private bind and config preservation.
- Fixed observed regressions: pre-database initialization ordering, isolated legacy VM helper dependencies, stale saved research excerpts, personal-directory access and model execution versus metadata permission separation. Test assertions were retained.
- Private operator configuration: workspaceModelGrants[workspaceId][providerId] = {models: [exactModelId, ...]}; omission denies access. workspaceSettings[workspaceId] or workspaces/<workspaceId>/settings.json selects researchAgentId/researchRoles/researchPublicOnly/agentRouting. These grant/settings snapshots currently require runtime restart to refresh; member/role/session revocation is checked live. UI administration follows Task 9.
- Remaining: Tasks 7-12, including gateway/MCP/SDK workspace identity, global capacity, UI, materialization/public ingress, migration and real VPS/model/Muse/dots acceptance. No production cutover, credential change or VPS/Peer Relay modification was performed in this task. Passing local mock tests is not final delivery.

## 2026-10-10 Task 7: workspace-bound node, MCP and SDK authorization

- Added server-owned workspace/creator attribution to the existing gateway queue, leases, events, screenshot metadata and acceptance records. Public mode rejects populated unassigned legacy databases before adopting or modifying their records; node reauthorization creates a new logical identity and invalidates captured old credentials.
- Human operations revalidate membership and their individual policy actions; there is no arbitrary human callback bypass. Node access requires a store-branded authenticated principal and a currently authorized grant owner. Pause prevents new claims but allows the existing lease to be renewed; revocation and owner disable are checked live.
- REST, MCP, multipart uploads, SDK profiles and Muse CONNECT transport preserve workspace identity. Forged body/header selectors and changed response identities fail closed. MCP text and structured results both retain the workspace identifier. Public admin/pairing routes remain unavailable.
- Event subscriptions and durable deliveries retain workspace attribution, use encrypted callback credentials, revalidate node authorization, and apply private operator-configured per-workspace callback host grants before DNS/HTTP. Unknown ownership, incompatible event schema/mode, symlink paths and legacy event components are rejected in public mode.
- Actual embedded-process testing found and fixed the skipped public gateway startup path. It now shares the human identity store; research role lookup and deferred bridge operations use freshly checked workspace handles. Global legacy metric updates do not run in multi-user mode.
- Evidence: complete suite 255/255 passed, zero failures/cancellations/skips; smoke passed real local HTTP/WebSocket, two mock model backends, SQLite restart persistence, private bind and configuration preservation. Additional real certificate-verified local HTTPS CONNECT exercised exact claim, valid PNG upload, lease renewal, result receipt and cross-workspace denial. Images and activity records in these fixtures are explicitly synthetic test evidence, not Muse/dots cloud-computer acceptance.
- Windows cleanup ordering and incomplete runtime fixture dependencies were corrected without relaxing the authorization/lease/evidence assertions. Failed-first test evidence and final logs remain in the ignored execution ledger.
- Remaining: Tasks 8-12. The current gateway still enforces its existing global single external execution limit; shared model/node capacity, usable multi-user UI, materialization, migration, production publication and both real external Agents remain unfinished. No VPS, DNS, production credentials or Peer Relay changes were made.

## Task 8: shared capacity and bounded task control (2026-10-10)

- One shared coordinator covers actual Ollama/OpenAI-compatible inference and embedding HTTP, plus persisted external node leases; metadata discovery remains role-safe.
- Root ownership, fresh cancellation policy, deadline/depth/step/delegation limits, queued aborts and actual-settlement occupancy are implemented. External research enqueue shares the step budget; its wait does not consume a second slot.
- Fixed public missing-setting defaults, legacy VM fixture injection, budget/error propagation through retry/fallback, and membership revocation propagation after a cloud response.
- Real process test found a startup readiness race in its fixture. It now waits for the actual gateway response and retries only ECONNREFUSED, not incorrect HTTP responses. Unified atomic startup is still Task 10.
- Verified: 290/290 tests, 0 failures/skips/cancellations; HTTP/WebSocket mock-model smoke passed. Local loopback stress: 2 workspaces, 24 complete five-agent rounds, 120 model requests, 0 failed rounds, actual model HTTP concurrency <= 1. Not a real-model/VPS soak or resource upper-limit claim.
- Root metadata is bounded in memory; durable audit/restart state remains Task 11. Estimated cost is not a verified billing ceiling. UI task controls remain Task 9. Tasks 9-12 and real model/Muse/dots acceptance are not complete. No VPS/DNS/credential/Relay changes in this increment.
- Details: `docs/WORKSPACE_CAPACITY.md`.

## Task 9: browser identity state foundation, in progress (2026-10-10)

- Added `identity/workspace-ui.js`, a provider-independent frontend state controller, without yet wiring it into INDEX_HTML or exposing a new public login page.
- Each tab stores only its non-sensitive workspaceId. Account/role snapshots are immutable; CSRF remains in closure memory. Legacy app-owned history/identity storage is cleared while unrelated storage and theme preferences are retained.
- Workspace switch/exit aborts requests and closes old subscriptions. Late HTTP JSON, old socket messages/sends and late login completion cannot restore an earlier workspace/account. 401 stops access; 403 refreshes available memberships without an automatic retry loop. Network reconnection is bounded to 3 validated attempts per minute.
- Unconfirmed logout stays pending and cannot silently boot/login again. Auth token query URLs and off-origin requests/return paths fail before traffic. Page teardown preserves the non-sensitive selected workspace for reload.
- Verified: 16 state-controller tests, with 4 regression failures reproduced before correction; complete suite 306/306, 0 failures/skips/cancellations; existing HTTP/WebSocket mock-model smoke passed.
- These are state-controller/unit and backend regression checks, not real DOM, HTML-injection, browser login, three-browser-account or desktop/narrow-screen acceptance. Task 9 remains open: login.html, existing avocado UI wiring/reset, members/nodes/tasks views and protected controls endpoints, evidence/source display, and actual browser acceptance.
- Tasks 10-12, production cutover and real-model/Muse/dots acceptance remain open. No VPS/DNS/credentials/Relay changes.

## Tasks 9-10: UI integration and runtime asset preparation, still in progress

- Added served login and text-only account/workspace/member/node/task/evidence panels; wired the existing avocado UI to authoritative per-tab HTTP/WSS scopes. Scope reset clears private DOM/drafts/attachments, readers/workers/timers and subscriptions before a full presentation reload. Private legacy mode is preserved; public host/Git/shell/cron operations remain denied.
- Added server-authorized controls endpoints for node grants and scoped local/external task progress/cancellation; metadata omits task input/results and reusable credentials. Cancellation still holds external occupancy until exact acknowledgement/lease expiry.
- Fixed expired-cookie cleanup and successful browser-account replacement; other device sessions survive. Invitations support bound new accounts or CSRF-authenticated existing accounts and reject late acceptance after logout.
- Browser fixtures confirmed three users, owner/member/viewer controls, Bob independent A/B tabs and isolated messages. Desktop and 390px login screenshots are outside Git. TLS/cookies and model are explicitly mocked in this loopback browser fixture, not production acceptance. Native confirmation blocked live removal; in-page confirmation replacement is covered by a failed-first reset-cancellation test. Its live recheck and complete logout/node/task/narrow interactions remain pending.
- Materialize now packages auth/UI/collaboration/MCP/account CLI and pinned package manifests, filters test/runtime/private artifacts, preserves existing configuration/database bytes and rejects linked target components before writes. Actual embedded-process integration uses the generated package, and generated MCP/SDK imports are checked.
- Full local suite reached 329/329 with no failures/skips/cancellations; legacy real HTTP/WebSocket mock-model smoke passed. Subsequent expanded manifest/import assertions and materialized-process test passed 4/4; final full-suite log is recorded before commit.
- Tasks 9 and 10 are not complete: live UI gates, atomic start/close/export, single-writer guard, public ingress/TLS and resource preflight remain. Tasks 11-12 and real model/Muse 老镇/dots 玄玑 acceptance remain open. No VPS/DNS/credential/Peer Relay modifications were performed. Details: docs/WORKSPACE_UI.md.

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

## 2026-10-10 Task 10: approved fixes and public-interface local checkpoint

- User explicitly approved correction and retesting. Corrected callback authorization binding, Windows/MSYS preflight paths, an overbroad read-only command assertion, and the ingress test's missing brace. The focused runtime/pairing/connector/Events/preflight suite passed 40/40.
- Added workspace-scoped public pairing and creator reauthorization, deployment-bound public connector OpenAPI, shared pilot REST handling and the bounded owned MCP Events runtime. Callback delivery checks workspace grants and fresh node authority, bounds DNS/HTTP lifetime, aborts on close, and retains encrypted subscription/delivery state across restart. This supersedes the earlier checkpoint's statement that Events cannot be enabled at all; invalid or incomplete authorization still fails closed.
- Implemented the public Caddy template and exclusive candidate renderer. Real Caddy integration passed all 4 tests, including validation/adaptation, certificate-verified routing, raw-path/header boundaries, HTTP/2 and WSS. Upstreams and accounts are synthetic loopback fixtures; production DNS/ACME and the complete real LACK browser behind ingress are not accepted by these tests.
- First full regression exposed one stale browser fixture: its manually copied gateway inventory omitted new dependencies. Reproduced the failure and switched the fixture to the actual materializer, without weakening production authentication, DELETE framing or permission assertions. The targeted browser regression then passed.
- Final full regression passed 372/372, with 0 failures, cancellations and skips, with the verified Caddy binary enabled. HTTP/WebSocket smoke passed with two mock model backends, SQLite restart persistence, private bind and config preservation. Failed-first and final logs remain in the ignored execution ledger, not in Git.
- Task 10 is still open: resource-limited service units, canonical production preflight and actual packaged-browser/API ingress acceptance remain. Task 11 migration/backup/rollback/durable recovery and Task 12 real models/Muse Laozhen/dots Xuanji/sustained VPS coexistence remain open. No production service, DNS, credentials, model endpoint or Tailscale Peer Relay changes were made; this checkpoint is not final delivery.

## 2026-10-10 Task 10: resource-limited deployment assets and fresh read-only VPS evidence

- Added dedicated application/HTTPS systemd assets, separate users/state/private executable paths, MemoryMax 448/128 MiB, CPUQuota 50%/10%, TasksMax 64 and no application auto-restart/writer takeover. No dependencies or reload commands target the existing Relay/proxy services. Unit file contracts are tested, but actual Linux unit/cgroup/signal acceptance remains pending.
- Added canonical deploy/public/preflight.sh and a bounded dependency-free Node collector. Its command set is read-only, with individual deadlines and bounded output/service inventory. It collects service PID/restart evidence, TCP/UDP, resource/pressure/recent-OOM snapshots and DNS. Unknown/failed data, occupied HTTPS, insufficient headroom, existing faults or an unreviewed proxy/IPv6 gate deployment. It never grants deployment permission or reads private keys, environment files or other-site configuration.
- Added deploy/public/README.md with isolation, initial spare-memory budget, readonly commands and activation/rollback/real-agent gates. The per-service CPUQuota values mean roughly 0.5 and 0.1 CPU, not that fraction of the entire two-core machine. Limits are not measured sustainable capacity.
- Watched all 7 new deployment-asset tests fail for missing implementation, then pass. Full regression passed 379/379, 0 failures/cancellations/skips with real Caddy enabled; HTTP/WebSocket mock-model smoke passed.
- Fresh SSH ED25519 fingerprint matched the user-supplied trusted fingerprint. A separate compatible SSH client was needed because Windows keyscan failed its KEX negotiation; verification was retained. Authorized password authentication succeeded; no credential was stored in Git or a command-line argument.
- Read-only VPS evidence: 2 CPUs, MemTotal 1651808 KiB, MemAvailable 1098260 KiB, SwapTotal/SwapFree both 2097148 KiB; cgroup v2 cpu/memory/pids present. Existing chunlack.service active/running, PID 234963, restart count 0, health HTTP 200. tailscaled.service active/running, PID 859, restart count 0, UDP 40000 listening. TCP 443 was unoccupied at observation time. These are snapshots, not continuous Relay functionality or a five-agent capacity proof. The existing Node executable/version was not established.
- Public resolver queries for both lack.chunclaw.top and agents.chunclaw.top returned status 3/NXDOMAIN for A/AAAA/CAA. DNS setup is an external activation prerequisite; user was asked to add only the two A records to 47.108.217.178. No DNS record was created or modified, and no port was opened.
- Task 10 remains open for actual packaged LACK ingress and Linux acceptance. Tasks 11-12 remain open. No production files, services, credentials, model endpoints or Peer Relay configuration were changed. This is not final delivery.

## Task 10 actual ingress defect and Task 11 independent offline preparation

- The actual materialized public runtime behind certificate-verified Caddy reproduces missing identity JavaScript assets and scoped WSS routes. Diagnostics also show the missing read-only provider directory route. The authored Caddy template has not been repaired while the scoped human approval question is unanswered. Cross-workspace members intentionally returns 404/not_found rather than the new test's assumed 403; correcting the test must retain the hidden-resource denial.
- Started only the independent offline portion of Task 11 under the approved plan. Added scripts/migrate-workspaces.cjs, docs/multi-user-migration.md and tests/workspace-migration.test.cjs. The dry-run classifies known tables/counts, unresolved ownership and unknown tables/files; inventories bounded config/memory/research/upload/attachment hashes without printing private payloads or API keys; retains Ollama/provider/custom-model metadata and leaves all source bytes unchanged.
- Implemented actual SQLite online backup with integrity/foreign-key checks and atomic no-replace snapshot publication. The WAL test includes committed rows absent from the main file, leaves the source main/WAL bytes unchanged while the writer stays open, and confirms that writer remains usable. Existing destination, linked/overlapping roots, nonempty candidates and malformed input fail closed.
- This is explicitly planning/backup only. applyMigration and verifyMigration reject execution; no migrationReady or publication marker is created. It is not full migration, whole-application consistent backup, account initialization, rollback, durable task recovery or stage completion. Those remain required, with real evidence, before delivery.
- Six new migration-preparation tests first failed for missing implementation, then passed. Full current-worktree regression: 388 tests, 385 passed, 3 failed, 0 skipped/cancelled. All three failures are the retained actual-packaged-ingress tests above; no full-green or ready-to-deploy claim is made. HTTP/WebSocket mock-model smoke passed.
- All new tests/preparation changes remain local and uncommitted pending the ingress repair gate; published GitHub checkpoint remains 20ee363. No VPS, DNS, real credentials or Relay changes. The original full delivery objective and Tasks 10-12 remain unfinished.

## 2026-10-10 DNS completion and Task 11 snapshot preparation

- Human-authorized DNS change completed: lack.chunclaw.top and agents.chunclaw.top are DNS-only A records to 47.108.217.178. Cloudflare and Google DoH both returned that address with TTL 300; the 18 preexisting dashboard records were unchanged. No VPS/service/port/Relay changes were made.
- Added scripts/workspace-snapshot.cjs, tests/workspace-snapshot.test.cjs and docs/workspace-snapshot.md as offline migration preparation. This is not migration completion, restore readiness or production publication.
- Fresh targeted run: 14 tests, 8 passed, 6 failed, no skips/cancellations. Log: .superpowers/sdd/2026-10-09-multi-user-workspace-delivery/task11-snapshot-tests.log.
- Isolated actual SQLite diagnosis confirmed that reading a WAL-mode backup creates lack.db-wal/lack.db-shm in the owned candidate; current unlisted-file validation rejects it. The candidate remains status=failed and migrationReady=false. The diagnostic source remained readable and its row count unchanged. Fixtures were closed and removed within checked temporary roots.
- A separate bad-FK test fixture fails at setup with SQLITE_CONSTRAINT_FOREIGNKEY; it has not yet reached the snapshot verifier.
- Human approval requested for native journal canonicalization on copied databases only plus recomputed snapshot hashes, the bad-FK fixture correction, and the previously identified precise Caddy routes/assertion correction. No repair has been applied while that approval is pending.
- Existing packaged-ingress failures remain open. The preceding full run was 385/388; no new full-suite green result is claimed. Work is uncommitted and not synchronized as an accepted release. The delivery goal remains active and incomplete.

## 2026-10-10 accepted removal of Open WebUI integration from delivery scope

- The user explicitly does not want Open WebUI connected to ChunLACK. The implementation plan now supersedes its earlier Open WebUI-specific acceptance/setup requirements.
- Keep actual inference Providers separate from Agent connectors, retain Ollama and vendor-neutral routing, and do not reuse or read the earlier Open WebUI key file. The independent Open WebUI service is not changed.
- This increment changes planning documents only. Existing code/config references remain unaudited for this scope correction; no model binding is claimed removed and no new test success is claimed.
- Synchronize only the clean-before-edit implementation-plan amendment. Do not stage this already-dirty status file or any unaccepted snapshot/migration/ingress implementation as a release.
- Repair confirmation and 443 ownership clarification are still pending; the full delivery goal is not complete.

## 2026-10-10 approved minimal repair and complete retest

- Human approved copied-database journal canonicalization, bad-FK fixture repair, precise Caddy route repair, complete regression and read-only TCP 443 ownership inspection. No production takeover, restart or Relay changes were authorized or performed.
- Snapshot preparation now uses SQLite checkpoint/journal conversion only on its newly owned backup databases. Final database hashes are recomputed after canonicalization. Native sidecar retirement replaces filesystem deletion; source journal mode, main/WAL bytes and writer usability are covered by actual SQLite tests. All eight snapshot tests passed. Migration and restore readiness remain false.
- Caddy now admits only the three exact identity JavaScript assets, the exact read-only /api/llm-providers endpoint and GET /ws/workspaces/<bounded-id>. Negative ingress tests retain rejection of unknown assets, provider subpaths and POST to these read/socket paths. Packaged pages and session/Origin/CSRF/API tests passed through real certificate-verified Caddy.
- Targeted regression: 17 tests, 16 passed, 1 failed, zero skipped/cancelled. Complete regression: 396 tests, 395 passed, 1 failed, zero skipped/cancelled. The remaining authored test expected 403 for a cross-workspace WSS handshake; actual response was 404 after successful own-workspace messaging. Human confirmation was requested before changing this additional assertion; no permission check was weakened. Mock-model HTTP/WebSocket/SQLite restart smoke passed.
- Read-only SSH observation at 2026-10-10 11:35:49 UTC: no TCP 443 listener shown by ss -ltnp. chunlack.service active/running, PID 234963, NRestarts 0, MemoryCurrent 108716032; tailscaled.service active/running, PID 859, NRestarts 0, MemoryCurrent 49250304; UDP 40000 and 41641 remained bound to tailscaled. Local 127.0.0.1:3721/health returned 200. This is a snapshot, not continuous Relay functional acceptance.
- A separate certificate-validating public HTTPS HEAD to lack.chunclaw.top/health failed the TLS handshake (curl exit 35). Earlier external TCP connection success does not establish a TLS service or VPS listener ownership. No 443 owner was identified in the host listener snapshot, and public HTTPS is not accepted.
- Logs remain under ignored .superpowers/sdd/2026-10-09-multi-user-workspace-delivery/approved-repair-{targeted,full,smoke}.log. No Open WebUI endpoint or credential was read or used. Code remains local pending the outstanding assertion confirmation; no green release or production deployment is claimed. Tasks 10-12 and the full delivery objective remain incomplete.

## 2026-10-10 independent isolated restore rehearsal

- Continued the approved Task 11 offline restore requirement while the additional WSS assertion correction awaits human confirmation. Added scripts/workspace-restore-trial.cjs, tests/workspace-restore-trial.test.cjs and docs/workspace-restore-trial.md. No production service, port, network, credential or Open WebUI operation was performed.
- The trial requires a verified snapshot and a wholly new disjoint destination under an existing private parent. Copies are exclusive, bounded and hash checked; native SQLite integrity, foreign keys and table counts are independently rechecked in the restored payload. Source snapshots are reverified before accepting a trial marker. Existing destinations, linked parents, overlap, altered evidence and unlisted files are rejected. Interrupted/mutated copies retain a failed marker and cannot be accepted.
- Real SQLite tests reopen original row values, committed WAL messages and unclassified tables; compare original config/archive/evidence/attachment bytes; confirm the source writer remains usable; move the original snapshot away and independently verify the restored payload. No fixtures represent actual vendor execution. Trial success explicitly leaves migrationReady=false, restoreReady=false and applicationConsistency=not_proven; Windows ACL acceptance is still missing.
- Seven new restore tests first failed because the implementation was absent, then passed. Combined actual migration/snapshot/restore tests: 21/21 passed, zero skipped/cancelled. Complete current-worktree regression: 403 tests, 402 passed, 1 failed, zero skipped/cancelled; the sole failure remains the unapproved cross-workspace packaged WSS 403-versus-404 assertion. HTTP/WebSocket mock-model/SQLite restart smoke passed.
- Logs: ignored restore-trial-red.log, restore-trial-targeted.log, restore-trial-full.log and restore-trial-smoke.log in the existing execution ledger. Synchronization scope is only the independently tested offline preparation/rehearsal files and truthful status documentation; the public Caddy changes, packaged-ingress fixture and failing test stay local. This is a development checkpoint, not a full-green release or usable production delivery. Ownership conversion/bootstrap, durable recovery, actual Linux/browser/HTTPS and real model/Muse/dots/co-host acceptance remain required.

## 2026-10-10 additional read-only 443 boundary evidence

- Previous goal turn made concrete progress: implemented and tested independent restore rehearsal, then synchronized the offline preparation checkpoint as 7c0a95b47c25b57cb7cdffde5d86e6338d300afe. The outstanding cross-workspace WSS test assertion remains unmodified pending human confirmation.
- Local Linux test-environment inventory found wsl.exe but its distribution query exited 1 with unusable output; no docker.exe command was found. No usable local Linux/systemd test environment was established, and no environment was installed. A separate bounded process-based output-decoding attempt was rejected before execution and was not retried by another process-launch method.
- Authorized read-only SSH observation at 2026-10-10 11:49:10 UTC: ss showed no TCP 443 listener. Filtered NAT/nft queries showed no 443/DNAT/redirect references, docker was absent, and the systemd socket query showed no 443 reference. These filtered observations are not a complete network topology, firewall, cloud edge or other-network-namespace audit and do not prove a future bind/cutover is safe.
- An unauthenticated, bounded HEAD to the public IP's plaintext TCP443 /health endpoint with the human domain Host received no HTTP response (curl exit 52; HTTP status 000). Earlier strict HTTPS failed TLS negotiation (exit 35). No active service owner or working public HTTPS was established; external TCP connect success alone is insufficient.
- No VPS files, packages, services, credentials, firewall, DNS or Relay settings were changed. Linux service/cgroup/signal acceptance requires a real isolated Linux execution environment. Asked the human for permission to use an independent temporary VPS directory/test service, loopback high ports and bounded CPU/memory, without production cutover, TCP443 takeover, existing-service interruption, global installation or credential changes. Permission is not inferred from the read-only 443 authorization.
- No new test run was needed for these observations. Latest application evidence remains 21/21 offline tests, 402/403 full current-worktree tests and passing smoke. Tasks 10-12 and final delivery remain incomplete; no green release, capacity upper bound, working public HTTPS or real external-Agent acceptance is claimed.

## 2026-10-10 human-authorized isolated Linux acceptance

- Human explicitly approved independent temporary VPS testing, bounded CPU/memory and loopback-only operation without production switch, TCP443 occupation, global software installation or existing credential/service changes. All units used unique names and DynamicUser rather than production identities. Only synthetic fixture data was used; production app/config/data paths were made inaccessible to the test units.
- Fresh preflight established 2 CPUs, cgroup v2 and initially MemAvailable 1117532 KiB, with unused swap. Existing Node is v24.21.0 inside the current service namespace, not the host PATH. Production RootDirectory is /opt/chunlack/jail; its read-only source mounts expose /opt/chunlack/node as /runtime and /opt/chunlack/current as /app. A successful 128 MiB/0.1 CPU transient probe, UID 63885, loaded actual better-sqlite3 (SQLite 3.53.2) and returned integrity=ok. Source program/dependencies were only read-only mounted, not copied from production configuration or changed.
- Initial probe attempts failed before Node execution due to pre-start executable validation and an incorrect assumption about host-versus-service namespace source paths. Each owned failed unit was cleared. No production unit or security parameter was relaxed.
- First offline test archive omitted collaboration/store.cjs dependencies and failed loading: 8 tests, 0 passed, 8 failed. Corrected only the private test bundle by including store/context/policy code, not application behavior or test assertions. Revised transfer SHA256 matched 1cc6c5744a79628c881abc83115bf2788978cb6b8873b84cd84e5b2d7684415e.
- Actual Linux offline migration/snapshot/restore tests passed 21/21, zero skipped/cancelled, duration 2113.730082 ms, exit 0. The transient unit enforced MemoryMax 448 MiB, CPUQuota 0.5 CPU and TasksMax 64 with private temporary storage and no IP address families. This also exercises real POSIX permission branches. CPU accounting was 1.126 seconds. Memory peak was not captured before cgroup teardown; do not infer a footprint, five-agent capacity ceiling or sustained resource acceptance from this run.
- A separate static tracked-code archive (no runtime config, DB, environment, credentials or node_modules) had verified SHA256 53ea7b078d4abf39b3644f5f8bd067893eb9f033988ed9ad3988d7ed41f3b55a. Materialization/public-runtime tests ran under the same caps and an additional private network namespace. Result: 16 tests, 8 passed, 8 failed, zero skipped/cancelled. Failed cases encountered spawnSync python ENOENT; Ubuntu has python3 3.12.3, while public-runtime tests hardcode python and the materializer fixture defaults to python without PYTHON. Even the passing negative materializer assertion can succeed on a missing interpreter, so this is not complete materialization/lifecycle acceptance. No system python alias, global package or product-code repair was applied.
- Asked the human to authorize Python selection compatibility (PYTHON override; Linux python3; Windows python) together with the still-pending cross-workspace WSS 404 assertion correction. No application permission, routing denial or fixture assertions were relaxed. Complete current-worktree Windows evidence remains 402/403 with passing smoke; Linux packaged startup/graceful-shutdown, actual deployment units and whole-stack acceptance remain incomplete.
- Cleanup verified no owned probe/offline/runtime units remained and removed only the checked, root-owned, non-symlink /var/tmp/chunlack-acceptance-1a7fc3595c784843a304938984a4c4c2 tree. Existing LACK PID 234963 and tailscaled PID 859 remained active, NRestarts 0; health HTTP 200 and Relay UDP 40000/41641 listeners remained present. Swap remained unused. This is observed coexistence, not continuous Relay traffic/function proof.
- Evidence handling error: the SCP archive download connection closed, and cleanup erroneously continued without gating on download verification. The archive was not preserved locally. Original journals remained and were subsequently recollected through read-only SSH at 12:21:39 UTC into an ignored journal-terminal JSON transcript (with wrapping/ANSI, not a byte-identical archive). The failed archive and initial harness failures are retained as explicit limitations, not green evidence.
- No TCP443 listener was started, no production/DNS/firewall/Relay/certificate/credential/Open WebUI change was made, and no real inference or Muse/dots execution was performed. Tasks 10-12 and final delivery are not complete. Synchronization is status/evidence documentation only; unaccepted ingress changes remain local.

### 2026-10-10: isolated Linux identity/workspace/connector regression

- Authorization: independent transient units, private loopback namespace, CPU and memory limits; no production switch, global installation, existing credential changes, TCP 443 takeover, or Open WebUI access.
- Tested source revision: `daecf49cdc7987d3678d62914d45a7e58db186bf`. Later repository commits before this run were documentation-only; this run does not include the pending uncommitted Caddy changes.
- Source archive SHA-256: `53ea7b078d4abf39b3644f5f8bd067893eb9f033988ed9ad3988d7ed41f3b55a`. The initial test package omitted `gateway/admin.html`: 118 of 119 tests passed, one failed with ENOENT before its business assertion. Added only that tracked static file from the same source revision; supplement SHA-256 `1f3e2d9e5bc780e0ba395ca1f74b31a43e7c949b4e74474becf7f36058ed8fa3`. No application or test source repair was made.
- Full selected-suite rerun: **119 tests, 119 passed, 0 failed, 0 skipped/cancelled**, 56386.686833 ms, actual Linux Node v24.21.0 and existing native SQLite dependencies.
- Suites: identity-store, identity-session, identity-http; workspace-context, workspace-store, workspace-resources, workspace-capacity, workspace-capacity-gateway, workspace-gateway-boundaries, workspace-websocket, workspace-mcp, workspace-events-runtime; mcp-events-lifecycle and mcp-events-cleanup.
- Unit constraints: DynamicUser, read-only source/runtime/dependency binds, production application/data paths inaccessible, private network namespace, AF_UNIX/AF_INET/AF_INET6 only, MemoryMax 448 MiB, MemoryHigh 384 MiB, CPUQuota 50 percent of one CPU, TasksMax 64, runtime bound 180 seconds. No real model, Muse, dots, or public ingress was exercised.
- Rerun status: ExecMainStatus 0, Result success, MainPID 0, CPUUsageNSec 28241778000; one-second sampling observed at most 106434560 bytes of MemoryCurrent. This sampled figure is not a proven workload capacity limit or continuous service footprint.
- Evidence archive `evidence-complete.tar.gz` downloaded successfully **before cleanup**, with matching server/local SHA-256 `fa92d3d2b411253a3a7f056661528f9395aab90529d916eb778de181581942d8`; contains baseline, first-attempt test and unit logs, rerun logs and cohost checks. Kept locally under ignored `.superpowers/sdd/2026-10-09-multi-user-workspace-delivery/linux-isolated/chunlack-linux-collab-1791635350231-50f3c3b6/`; not committed or uploaded to GitHub.
- Cleanup first attempt stopped on the already-unloaded initial unit. Completed idempotent cleanup on a fresh connection: both owned units LoadState not-found, inactive, MainPID 0; both runtime directories and the exact owned upload directory removed. Final proof UTC 2026-10-10T12:36:30Z.
- Existing LACK PID 234963 and tailscaled PID 859 remained active with NRestarts 0; baseline state matched after tests and after cleanup, health HTTP 200. UDP relay ports 40000/41641 remained listed during post-test checks. No host TCP 443 listener observed after cleanup. These are point-in-time cohost checks, not continuous functional relay traffic proof.
- Gates remain open: pending approval for Python interpreter portability and WSS 404 assertion corrections, Windows full-green regression, Linux packaged application acceptance, actual ownership migration/bootstrap/recovery, production TLS/cutover, real direct model endpoints, Muse/dots event-to-own-computer-to-evidence receipt, full five-Agent workload soak and user delivery. This evidence does not mark Tasks 10-12 or the project complete.

### 2026-10-10: native Linux systemd service-file verification

- Input source commit: `46a0082983f4f4dc8748a2d29f5083dc8a4038ec`; unchanged tracked `deploy/public/chunlack-public.service` and `deploy/public/chunlack-https.service`. Unit-only archive SHA-256 `958e97c7cf874d4f4bc069c3065aae3b62338aabf26a253813928db4efd6f454`.
- Executed real systemd 255.4 verification with `systemd-analyze verify --man=no`, bounded by timeout and an isolated transient unit: DynamicUser, private network, read-only input, protected production paths, MemoryMax 96 MiB, CPUQuota 25 percent of one CPU, TasksMax 32. Neither candidate service was installed, enabled, or started.
- Verification **did not pass**: ExecMainStatus 1 / Result exit-code. The expected independent public deployment binaries `/opt/chunlack-public/runtime/node/bin/node` and `/opt/chunlack-public/runtime/caddy/caddy` do not exist in the current verifier environment. No unknown-directive or candidate unit syntax error was reported, but that absence alone is not successful deployment validation.
- Existing production uses its own separately confirmed runtime/layout; this is not evidence of missing binaries in the working LACK service. Do not install over the existing application or substitute its production unit. Stage real independent runtime components under the approved isolated test scope before repeating native packaged acceptance; no production cutover is authorized by this result.
- Host dependency loading also emitted pre-existing `cloudmonitor.service` warnings about KillMode=none and a legacy PIDFile path. Recorded only; no unrelated service, system Python, global software, network, credentials or TCP 443 changes.
- Evidence archive successfully downloaded and SHA-256 verified before cleanup: `aa6546403b7a94bdb0b5e08dacef257bab78bab0e4f81f583f2a021d06021ddd`. The initial local comparison command had a quoted-variable error; it correctly prevented cleanup, and the corrected literal-hash comparison passed on the already-downloaded archive. Kept in ignored `.superpowers/sdd/2026-10-09-multi-user-workspace-delivery/linux-isolated/chunlack-unit-check-1791635977669-7c7c39f4/`.
- Final cleanup proof UTC 2026-10-10T12:43:50Z: owned transient unit not-found/inactive/PID 0, runtime directory and exact owned upload removed. Existing LACK PID 234963 and tailscaled PID 859 active, NRestarts 0, baseline unchanged, health HTTP 200, no host TCP 443 listener listed.
- Project remains incomplete. Pending test repair approvals, full migration/recovery, real public runtime/TLS cutover and real model/Muse/dots acceptance remain separate gates; no open gate is closed by this check.

### 2026-10-10: native Linux packaged HTTPS integration

- Exercised the **current worktree**, based on commit `44cb387eed03109ed407a8efcce2a7d02095574a`, including the three known pending ingress files: modified Caddy template and the two untracked packaged-ingress test/fixture files. No source edits in this run. Source-only bundle: 140 files, 355657 bytes, SHA-256 `b359b71e01bb6b834f8b220e95898e269ad1b6fe281f2c503b162d22c5f145ad`; no existing config, database, node_modules or private credential files bundled.
- Downloaded [Caddy v2.11.7 official Linux amd64 release](https://github.com/caddyserver/caddy/releases/tag/v2.11.7) to the ignored local test directory, verified against the official SHA-512 checksum, then verified the transmitted archive SHA-256 `727b91701a392de6ebc5027509f548bf39979e5216340d0faed8fa5e69c84f8b`. Caddy was extracted only in the owned temporary test directory, not globally installed.
- Real Linux Node v24.21.0, native SQLite, Python3 materializer via the fixture's existing PYTHON option, OpenSSL test certificate, and actual Linux Caddy exercised `tests/packaged-public-ingress.test.cjs`. All three tests executed: **2 passed, 1 failed, 0 skipped/cancelled**, duration 12105.145548 ms, CPUUsageNSec 4676161000.
- Passed actual materialized LACK script loading over CA-verified HTTPS, and actual packaged HTTP session/Origin/CSRF/current workspace authorization across ingress. Synthetic humans/workspaces only; no real model, vendor Agent, production login, or public DNS certificate issuance.
- Sole failure: line 64 still expects /403/ for the other-workspace WSS upgrade, which returned 404. This matches the earlier Windows result. The third test's later assertions did not execute; do not report its full WSS/agents REST/MCP scope as passed. Assertion repair remains pending human confirmation, as does the separate public-runtime test's Python interpreter portability repair.
- Isolation: DynamicUser, private network namespace, only namespace loopback listeners, MemoryMax 448 MiB / MemoryHigh 384 MiB, CPUQuota 50 percent of one CPU, TasksMax 64, RuntimeMaxSec 180, read-only code/runtime/dependency/Caddy binds, production application/data paths inaccessible. Writable fixture scratch used a bounded 64 MiB temporary mount inside the owned private runtime namespace. Journal reported 114.0M memory peak; this is not a five-Agent capacity result.
- Evidence archive downloaded and server/local SHA-256 matched before cleanup: `86772423e3cc655a22ca0b40bf7fcf53385c6a708f850b51fc339783494e4444`. Preserved under ignored `.superpowers/sdd/2026-10-09-multi-user-workspace-delivery/linux-isolated/chunlack-native-ingress-1791636397027-e786a6ff/`.
- Final cleanup proof 2026-10-10T12:53:20Z: transient unit not-found/inactive/PID 0, runtime directory and exact upload removed; LACK PID 234963 and tailscaled PID 859 active, NRestarts 0, baseline unchanged, health HTTP 200, relay UDP 40000/41641 listed and no host TCP 443 listener listed. No production service switch, credentials, global software, firewall, or existing Relay changes.
- Independent Linux platform evidence has advanced; full-green regression and subsequent dependent acceptance are gated on the two pending test repair approvals. Do not repeat the known failure merely to generate progress. Tasks 10-12 and final user delivery remain incomplete, including actual migration/recovery, production runtime layout/TLS cutover, real direct models, real Muse/dots cloud-computer execution and five-Agent sustained acceptance.

### 2026-10-10: approved interpreter and hidden-workspace assertion corrections

- Human approved both pending test corrections and retesting. Test interpreter selection now honors PYTHON, defaults to python on Windows and python3 on Linux, in public-runtime, materialize-workspace and workspace-capacity-models tests. The packaged cross-workspace WSS assertion now requires the observed hidden-resource 404 rejection. No application authorization, timeout, retry or provider logic was weakened; Ollama and provider-neutral routing remain unchanged.
- Windows first full run passed 403/403, with mock-model smoke and a 16/16 explicit interpreter run. That result preceded the additional same-category workspace-capacity-models interpreter correction and is not full acceptance of the final source revision.
- Two subsequent unchanged final-source full Windows runs each passed 401/403, with zero skips/cancellations. The first failed synthetic preflight and the legacy writer-guard subprocess; the second failed synthetic preflight and browser-fixture readiness. The writer-guard error was spawnSync ETIMEDOUT; preflight returned a null process status instead of zero. Timing/root cause remains unconfirmed, and no timeout was extended. A separate unchanged writer-guard retry passed 1/1.
- Final-source focused Windows regression passed 26/26, zero skips/cancellations, in 58673.7461 ms: the three interpreter-using suites, real certificate-verified packaged Caddy HTTPS/WSS (all three tests), synthetic preflight and browser fixture. Explicit PYTHON path regression passed 20/20, zero skips/cancellations, in 25029.3081 ms. These focused successes do not replace the two failed full regressions or prove timing stability.
- The final mock-model HTTP/WebSocket/SQLite restart smoke passed through the actual package entry tests/smoke.cjs. An initial operator invocation mistakenly used the nonexistent scripts/smoke.cjs and failed before running any smoke assertions; that log is retained separately and is not an application defect or passing smoke result.
- First isolated Linux run after approval passed default-interpreter tests 16/16. Full execution passed 367/378 with 11 failures, zero skips/cancellations: ten failures were caused by the operator's incomplete source bundle (two tracked synthetic TLS fixtures and scripts/public-preflight.sh omitted); one test still invoked hardcoded python and was corrected as described above. Module-load failures reduced the test count. All three actual packaged HTTPS/WSS tests passed, but Linux smoke was not reached after the failed full suite.
- Corrected source bundle contains 143 files, 359829 bytes, SHA-256 b3fddafe8af5f839e51df66aa69463d2863b0881995a90ef165202e649abe58c. It remains local and unexecuted: the promised Windows full-green gate was not met. The fixed TLS files are tracked synthetic fixtures, not operator credentials. No complete final-source Linux acceptance is claimed.
- Failed native-run evidence archive was downloaded and reverified before cleanup, SHA-256 a9adf4ee854b6654ed9c648ab61927685af1c95b3b2e630aced7ec43894b6ed8. Ignored evidence paths: linux-isolated/chunlack-approved-retest-1791638351780-f97b2a2b and approved-fix-retest-1791638300484 under the existing .superpowers execution directory. Failed runs are preserved, not overwritten or converted into accepted markers.
- Final cleanup proof at 2026-10-10T14:06:55Z: owned initial/complete units not-found, inactive, PID 0; owned runtime and upload directories removed. Existing chunlack.service PID 234963 and tailscaled.service PID 859 remained active, NRestarts 0; health returned 200, UDP relay ports 40000/41641 remained listed, and no host TCP 443 listener appeared. This is observed coexistence, not continuous functional Relay acceptance. No production restart/switch, global installation, firewall/DNS/credential change, public listener, real model/vendor execution or Open WebUI access occurred.
- Synchronization is a tested-scope development checkpoint only, not a full-green release or deployment. Next gate: diagnose and reproduce the Windows subprocess/readiness timing failures without weakening assertions, then rerun the complete final-source Windows and isolated Linux suites. Tasks 10-12, migration/bootstrap/recovery, public TLS cutover, real direct model and Muse/dots execution, five-Agent soak and final user delivery remain unfinished.

### 2026-10-10: final-source Windows and isolated Linux complete regression

- Source checkpoint: f426c15a01284b1d687d70dc5ff22519e85fa21c. Working tree was clean before this turn; no product or test source was changed. Continued systematic timing investigation and the already-approved complete regression/isolation scope. The prior turn made implementation progress; its failed runs remain part of the evidence.
- Instrumented timing checks ran four rounds: all eight synthetic preflight cases passed, and all four browser-fixture cases timed out waiting for the owned child readiness marker. No owned child stdout was observed before termination. An initial probe command failed to preload because of Windows path escaping; it ran no tests and is retained separately. Instrumentation may perturb timing, so these are diagnostics, not acceptance runs.
- Three uninstrumented diagnostic rounds each ran both preflight cases and the browser fixture: one browser readiness failure, then two rounds passed. External CPU sampling was 29-67 percent busy (mean 48 percent); a separate host snapshot was 94 percent busy. These observations do not establish CPU pressure, antivirus, or application code as the cause. No unrelated host process was stopped and no timer/assertion was relaxed.
- A separate owned-server health probe passed: first successful /health response at 1602 ms, readiness stdout at 1529 ms. Probe injection was removed from the generated application child. This is a passing startup observation, not evidence that earlier failures were merely missing logs. Intermittent Windows startup/preflight timing remains an unresolved repeatability risk.
- Final unmodified Windows full regression passed **403/403**, zero failures/skips/cancellations, 136113.6611 ms. The actual tests/smoke.cjs entry passed real HTTP/WebSocket, two mock model backends, SQLite restart persistence, private bind and config preservation. No preload or PYTHON override was injected into this acceptance run. Logs and external load samples are under the ignored timeout-evidence-1791641439488 execution directory.
- The complete source-only Linux bundle remained SHA-256 b3fddafe8af5f839e51df66aa69463d2863b0881995a90ef165202e649abe58c (143 files, 359829 bytes), including current test corrections and tracked synthetic TLS fixtures. Application/test source matches the f426c15 checkpoint; documentation added after bundle construction is not native runtime acceptance input. No real configs, databases, credential files or installed dependencies were uploaded.
- Native harness initial execution failed with status 126 before tests: /opt/chunlack/node is a symlink to a runtime directory, not the executable. Read-only stat confirmed /opt/chunlack/node/bin/node is the executable. Corrected only the test runtime bind/invocation, preserving the initial journal/unit evidence. The incomplete first evidence tar is not accepted as an archive.
- Corrected isolated Linux run passed default interpreter selection **20/20**, zero skips/cancellations, 14295.214917 ms. Full native regression passed **403/403**, zero failures/skips/cancellations, 150797.878665 ms, including all real certificate-verified packaged Caddy HTTPS/WSS cases. The actual mock-model HTTP/WebSocket/SQLite restart smoke also passed. Overall unit Result=success, ExecMainStatus=0, CPUUsageNSec=79882321000, MemoryPeak=141533184 bytes; this is test workload evidence, not a five-Agent sustained capacity limit.
- Isolation remained DynamicUser, private loopback network, read-only code/runtime/dependencies/Caddy binds, inaccessible production app/data paths, MemoryMax 448 MiB, MemoryHigh 384 MiB, CPUQuota 50 percent of one CPU, TasksMax 64 and RuntimeMaxSec 900. Every 15 seconds the controller checked original service/PID/restart state, health and available-memory floor; guard was not triggered. No public listener, global install or production unit was created.
- Native archive downloaded successfully and local SHA-256 matched the server before cleanup: caa4465b13a188824d2a40e548e4a46b7d8c1f4ab1f81ff4bc7f12b2e74c1705. Actual counts, successful phase markers and unchanged cohost baseline were inspected locally. Archive includes initial harness failure and corrected execution; retained under ignored linux-isolated/chunlack-approved-complete-1791641906207.
- Final cleanup proof at 2026-10-10T14:26:28Z: both owned units not-found/inactive/PID 0, their runtime directories and exact upload directory removed. LACK PID 234963 and tailscaled PID 859 stayed active with NRestarts 0, /health returned 200, UDP 40000/41641 remained listed, and no host TCP 443 listener appeared. This is bounded coexistence evidence, not continuous Peer Relay traffic/latency acceptance. No production/DNS/firewall/credential/Open WebUI or real vendor/model operation was performed.
- Windows/Linux full-suite and mock smoke gates now have final-source green evidence; earlier intermittent failures are not declared repaired. Task 10 still requires actual deployed unit lifecycle/public TLS acceptance. Current migration applyMigration/verifyMigration remain fail-closed stubs: Task 11 must implement reviewed ownership conversion, bootstrap/quarantine, idempotent publication, complete recovery and HTTP/WSS business acceptance before production can start. Task 12 still requires authorized cutover, real direct model and Muse Laozhen/dots Xuanji own-computer evidence, five-Agent sustained/cohost functional tests and usable handoff. Overall goal remains active and incomplete; this is a verification checkpoint, not final delivery.

### 2026-10-10: Task 11 closed-WAL snapshot prerequisite finding

- Prior goal turn made verified progress: complete Windows/native Linux regression and mock smoke were accepted at the d996a44 documentation checkpoint. Current repository HEAD was rechecked as d996a44b84d967c73eec2d4b009923c90d1ae3cc, with a clean worktree before this increment. No live remote test process remains from that run.
- Continued the approved actual migration task by inspecting the legacy eight-table schema, canonical collaboration schema, identity owner/bootstrap API, workspace paths, gateway schema/lease behavior, public migration gate, existing accounts CLI and snapshot implementation. The six core legacy tables and research sources require conversion, not merely adding workspace_id. Existing account bootstrap can be reused; no parallel identity system or plaintext-password CLI is proposed.
- Authored eight local, unaccepted migration-apply tests for native table conversion and source preservation; verified explicit owner binding, provider/model retention, idempotence, changed evidence rejection, interruption, orphaned message foreign keys, missing pilot evidence and occupied/linked destinations. Test results: 8 executed, 0 passed, 8 failed, zero skipped/cancelled. All failed during snapshot preparation, before reaching migration assertions. This is NOT the intended migration red test and does not justify writing the migration engine yet. No application/migration implementation was changed.
- Systematic diagnosis reproduces an existing snapshot prerequisite defect: a closed gateway database retains journal_mode=wal while its WAL/SHM files are absent. Opening that database read-only for metadata creates empty WAL/SHM files. prepareWorkspaceSnapshot captures file inventory before those reads, then rejects the changed sidecar inventory as snapshot_source_changed, although the source main-file SHA-256 and row count remain unchanged.
- Independent isolated native SQLite reproduction confirmed before wal=false/shm=false, after wal=true/shm=true, journal mode wal, one row retained and identical main-file SHA-256 afbb8759e8409eb28b42b516435844434f3e72d03eb3bc7e3ad187300247bc0d. Diagnostic temporary directories were removed only after checked ownership/path boundaries. No production database, credential or network was accessed.
- The new fixture uses a real closed WAL gateway plus an open main-database WAL writer, which is a legitimate offline-migration condition. Do not force this fixture to DELETE mode, ignore changed input indiscriminately, relax hash/count assertions, or claim the earlier full-green suite covers this new scenario.
- Requested scoped human approval to repair snapshot reading/closed-WAL handling with dedicated regression while preserving main/existing-WAL byte checks, count/integrity validation and non-activatable failure state. No repair was applied pending that response. The new migration-apply test stays local/uncommitted; only this truthful diagnostic status is synchronized. Prior 403/403 results apply to their earlier tested source checkpoint, not to the current local 411-test worktree.
- Task 11 and final delivery remain incomplete. Next sequence: reproduce the snapshot prerequisite with a dedicated regression, make the approved minimal correction, obtain the intended migration-apply red failures, implement actual ownership/schema/quarantine/publication conversion, and run complete migration/recovery/business acceptance before any production cutover. No VPS/public/Tailscale/Open WebUI or real provider/Muse/dots changes in this increment.

### 2026-10-10: independent legacy collaboration conversion implementation

- Revalidated HEAD 7a666c62885234ce7cdccd2994f8c4a9cffcb107 and the single known untracked migration-apply test. Snapshot-read repair approval has not arrived; no existing snapshot, planner, backup, activation or authorization code was changed.
- Added a local dedicated closed-WAL snapshot regression. It failed at the source-directory invariance assertion: main-file SHA-256 remained equal, but lack.db-wal and lack.db-shm appeared. Snapshot preparation succeeded for this main-database case because the planner reads it before the snapshot inventory; the earlier auxiliary gateway case fails after the inventory. Both violate the required source-preservation boundary. The regression remains local/uncommitted, not green evidence.
- A throwaway private-copy diagnostic did not execute because its module reference climbed one directory too far (MODULE_NOT_FOUND). This is an authored diagnostic error, not a product result. Requested separate permission to correct that diagnostic file; did not silently edit or claim the proposed private-copy scheme had been validated.
- Continued the independent conversion portion of the approved Task 11 plan, rather than weakening the snapshot checks or abandoning full migration. Added scripts/convert-legacy-collaboration.cjs, an internal offline component using the existing collaboration schema. It requires a supplied read-only database, a different fresh empty target and current owner membership; it does not open original source databases, publish readiness or provide a new public maintenance route.
- Seven new conversion tests first failed for the absent component, then passed. Combined conversion/workspace-store/workspace-resources regression passed 20/20, no skips/cancellations. Final combined conversion, store/resources, existing migration, snapshot and restore-trial regression passed **41/41**, zero failures/skips/cancellations, 13286.9335 ms. The first test invocation had a PowerShell parsing typo before any tests ran; the corrected unchanged command produced the accepted result.
- Conversion inserts six core tables and optional research session/source tables into one target transaction with deferred FK checks, row-count/integrity verification and a fresh owner-version check before commit. Existing source bytes, Ollama/default legacy provider behavior, custom model strings, original source URLs/excerpts, memory and missing-evidence flags were verified through the existing scoped read APIs. Orphans, unknown Agent senders, malformed JSON, foreign workspace assignment, URL credentials and nonempty targets reject without partial imported rows. SQL-looking model strings and HTML excerpts remain parameterized data.
- Source identity/target paths and live-source snapshot safety remain the caller's responsibility. Unknown tables are preserved in the read-only source and reported with counts, not imported into the active schema; the future complete engine must independently archive and verify them. Custom extra columns, gateway nodes/credentials/leases, files/artifacts, event recovery and publication are not claimed implemented by this component. Historical created_by is operator-assigned data-management ownership, not proof of the legacy message author.
- Limits are 50,000 inventoried rows and a 64 MiB source database, with target max_page_count=16384 (about 64 MiB at the default 4 KiB page size); exceeding a limit fails, never truncates records. Component return migrationReady is always false. No application runtime, public port, model endpoint, credential or VPS/Relay service was changed.
- Synchronization scope is only the tested component/test and truthful migration/status documentation. Two pending red prerequisite/integration test files stay local/uncommitted. No full current-worktree green claim is made: its known closed-WAL and migration-apply failures remain outside the 41-test success, and the former 403/403 checkpoint cannot cover this new source. Task 11 and overall delivery remain incomplete; approval-dependent snapshot repair and full apply/verify/quarantine/publication/recovery/business acceptance are still required before production.

## Approved identity/source-reader repair (2026-10-10)

The owner call now matches requireMembership(userId, workspaceId). Planning,
identity inspection, snapshot descriptions and native backup use a bounded,
hash-checked private database copy including the original WAL. SQLite does not
open the original directory, and source changes fail closed. The closed-WAL
regression and six dedicated source-reader cases pass. The gateway conversion
component's nine tests also pass; historical nodes remain disabled and real
unexpired leases retain capacity.

Targeted tests: 30/30, no skips. Current-tree full regression with Caddy enabled:
434 tests, 426 passed, 8 failed, no skips. All eight failures are the uncommitted
migration-apply integration cases reaching migration_apply_not_ready. Task 11
execution/publication/recovery and overall delivery remain incomplete. The
legacy integration fixture must use actual supported task/capability/attempt
values rather than weakening production protocol checks. See the dated report:
`docs/verification/2026-10-10-identity-snapshot-repair.md`.

This supersedes earlier approval-dependent owner/closed-WAL repair notes; it
provides no production, Linux permissions, real model or real Agent acceptance.
No VPS, credentials, DNS, ingress ownership or Peer Relay changes were made.

## Reviewed migration engine local checkpoint

Actual offline apply/verify and explicit CLI preparation/reviewed application
are implemented. Source snapshots are retained intact in private quarantine;
canonical collaboration/gateway data, scoped files and explicit model grants
are verified before candidate readiness. Original sources stay unchanged,
historical tokens are disabled, live leases retain capacity, and incomplete
candidates cannot activate. Same-plan repeat execution is verification only.
The first CLI test exposed an export-order circular import; its correction was
verified by the same tests. Backup source-change failure cleanup also has a
passing regression.

Final current-source Windows full suite with Caddy enabled: 438/438 passed,
zero skips/cancellations, 237121.7087 ms. The formerly red migration-apply file
is now a tested 11-case integration suite and is included in this increment.
No VPS, credentials, DNS, 443, Relay or production changes were made.

Task 11 remains incomplete pending recovery/restore, actual migrated-runtime
business acceptance, Linux permissions/resources and reviewed treatment of
unsupported permission/data structures. Task 12 real model/Agent/public
production/sustained co-host acceptance remains incomplete. Candidate
migrationReady is not delivery readiness; restoreReady remains false. See
`docs/reviewed-workspace-migration.md` and
`docs/verification/reviewed-migration-engine-verification.md`.

## Reviewed migration recovery checkpoint

- Implemented independent legacy-data materialization from the quarantined snapshot of published or failed migration candidates, plus explicit reviewed recovery and standalone verification CLI modes.
- Preserves original data and configuration, detects tampering/interruption, refuses overlaps, links and occupied destinations. Recovered data remains non-activatable; applicationConsistency is not_proven.
- Current Windows evidence: focused 32/32 and full Caddy-enabled suite 445/445, zero failures, skips or cancellations. See docs/verification/reviewed-migration-recovery-verification.md and docs/reviewed-workspace-recovery.md.
- Task 11 is not complete: old-version business recovery and the remaining integrated multi-user acceptance gates still need evidence. Current-source Linux verification, production cutover, public HTTPS, real models and Muse/dots Agent-owned execution remain separate gates. No VPS or Relay change occurred in this checkpoint; Open WebUI remains excluded.

## Migrated runtime business acceptance checkpoint

- Added actual packaged migration/business/restart/recovery acceptance with three humans, two workspaces and two Agent main replies through isolated local HTTP and cloud HTTPS model mocks. Original source database, WAL, configuration, research URL and missing-evidence marker remain intact.
- Fixed private-memory recall for URL-only/malformed legacy records without rewriting or inventing source content. Fixed private legacy channel startup to load existing SQLite history. Dedicated regressions failed before the fixes and passed afterwards.
- Current Windows focused evidence: 5/5; full Caddy-enabled suite: 450/450, no failures/skips/cancellations. See docs/verification/migrated-runtime-business-verification.md and docs/migrated-runtime-business-acceptance.md.
- Revalidated pinned SSH entry and read-only VPS baseline: LACK health 200, same production/Relay PIDs and zero restarts, relay UDP listeners present, no host 443 listener. Located existing native dependencies without installing or modifying them. Current-source Linux isolated full tests have not yet run.
- Task 11/12 and final delivery remain incomplete: pinned historical release recovery, integrated node lifecycle and bounded five-Agent sustained pressure, current Linux tests, public HTTPS production acceptance, real models and vendor-owned Muse/dots execution remain separate gates. No production cutover or Open WebUI integration.

## Current-source native Linux migration/business regression checkpoint

- Tested source commit 02c6d34833120cc999ab33a174fa2222a266b5b9 using all 251 tracked files from git archive. No application or tracked test source changed in this increment.
- VPS isolated tests passed default Python fallback 20/20, actual packaged HTTPS/WSS 3/3 and full suite 450/450, zero failures/skips/cancellations, followed by standalone real-server smoke with two mock model backends. Focused tests overlap the full suite and are not additional independent cases.
- Preserved initial noexec startup failure, first full 357/385 and second full 447/450 as failed evidence. Corrected only the ignored native harness: executable placement on the owned disk root, a read-only OpenSSL configuration bind, explicit Python 3 for legacy tests and a dedicated writable packaged-fixture leaf. Source otherwise remains read-only; security assertions were not weakened.
- Main trial limits: CPU 50% of one core, memory 256 MiB, 64 tasks, 900-second deadline. Actual memory peak 140136448 bytes and CPU 89.569063 seconds. Fourteen bounded co-host samples preserved health 200, original production/Relay PIDs, zero restarts and UDP listeners; this is sampled coexistence, not functional Relay traffic or sustained five-Agent capacity acceptance.
- Native evidence downloaded with matching SHA256 0af56426fedcf066ee20d611b5ed034448664da850c62e4809d141ad867931ab. Both owned units are not-found/inactive/PID 0 and both verified-owned remote roots removed. Final 2026-10-10T17:38:29Z baseline: LACK PID 234963, tailscaled PID 859, active/NRestarts 0, health 200, six UDP listener rows and no host TCP 443 listener.
- Windows and native Linux now both pass 450/450 for the same source checkpoint. Task 11/12 and total delivery remain incomplete: pinned historical release recovery, integrated node lifecycle, five-Agent sustained complete-round testing, real model/vendor execution and public production acceptance remain independent gates. No production restart/cutover, DNS/firewall/credential change, global install or Open WebUI integration occurred. See docs/verification/2026-10-11-native-migrated-runtime-verification.md.

## Public task initiation and packaged node lifecycle checkpoint

- Found a delivery gap: the actual human task interface could list/cancel external work but could not create it. Added session/workspace/CSRF-bound POST /api/tasks, restricted to a server-challenged five-minute example.com browser pilot and returning sanitized task metadata. Reuses the existing gateway/capacity/lease store, not a parallel queue.
- Added the node-panel public-pilot action with in-page confirmation, text-only receipt, member execution/viewer denial and panel-generation invalidation. Existing avocado styling and owner-only node administration remain unchanged.
- Added an actual generated-service/Caddy HTTPS lifecycle test with three synthetic humans, two workspaces and five paired synthetic nodes: shared single-slot admission, cancellation acknowledgement, pause/resume, PNG upload/result idempotence, active-node revocation, real application reopen and persisted unexpired lease recovery. Synthetic activity is not vendor-owned execution.
- Watched intended red tests: controls/lifecycle 5 passed and 4 failed at missing POST method, shell 8 passed and 2 failed at absent button. Final focused suite 22/22; Windows full suite 457/457, zero failure/skip/cancellation, 205723.4102 ms; standalone smoke passed. See docs/verification/2026-10-11-public-node-lifecycle.md and docs/public-node-task-pilot.md.
- A newly discovered compatibility omission is explicitly pending: UI hides mixed-capability/non-dedicated browser nodes, while the creation API still uses the store's broader inclusion checks. Such API tasks may not complete through the dedicated screenshot facade. Reported to the user and requested a minimal correction plus full re-test; not silently fixed or declared covered by 457 green tests.
- Task 11/12 and overall delivery remain incomplete. Human evidence review/acceptance, the compatibility boundary, new-source Linux verification, real five-model-Agent sustained rounds/co-host functional acceptance, pinned historical recovery, direct real models, production cutover and Muse/dots own-computer execution remain distinct gates. Requested specific data ownership/maintenance and direct-model information; no VPS, DNS, secret, Open WebUI or Relay operation occurred in this increment. Prior Linux 450/450 covers its older source, not this change.

## Identity/snapshot re-test and bounded five-Agent rounds checkpoint

- Existing authorized identity and WAL/private-snapshot repairs were re-tested in the complete current-tree suite; no duplicate production rewrite was required. Historical migration-not-ready failures remain documented and were resolved by the subsequent reviewed engine implementation.
- Added a test-only scenario using actual packaged application, verified Caddy HTTPS/WSS, three synthetic humans, two workspaces with five model Agents each, and five paired idle synthetic nodes. Full rounds require five main replies plus completed task records; auxiliary calls, requests and registrations alone do not count.
- Corrected an authored test-helper manifest-path error after reporting it under the user's continuing correction/re-test authorization. Retained initial unimplemented RED and the 404 failure; unchanged assertions subsequently passed.
- Focused 3/3 passed. Standalone bounded workload ran 62992 ms: 12 complete rounds per workspace, 120 main model calls, 240 total generations, no failed rounds/privacy leaks, generation HTTP concurrency 1. Process RSS is not total VPS/Caddy memory; no real provider/vendor-node or stable upper-bound claim.
- Current Windows complete suite 460/460, zero failures/skips/cancellations, 75518.3834 ms; standalone smoke passed. See docs/verification/2026-10-11-identity-snapshot-and-agent-rounds.md for logs, hashes, reproduction and limits.
- Overall delivery and Task 11/12 remain incomplete. API compatibility omission, human evidence acceptance, current-source Linux, longer resource-limited co-host/functional Relay workload, historical-release recovery, actual providers/vendor computers and production/public HTTPS remain separate gates. No VPS, DNS, credentials, Open WebUI or Relay change occurred.

## Public browser pilot compatibility repair checkpoint

- The previously reported API/facade mismatch is repaired under the user's continuing repair/re-test authorization. Only the fixed browser-pilot human endpoint requires exactly browser.public_read/public before queue mutation; generic gateway capability support and lease/queue policy are unchanged.
- Added a real HTTP regression for mixed capabilities, multiple scopes and both together. Observed intended RED 8 passed/1 failed (201 instead of 403), then focused packaged lifecycle/rounds/control acceptance 13/13 and current Windows full 461/461, no skips/cancellations, plus passing smoke.
- Logs/hashes and scope are recorded in docs/verification/2026-10-11-public-pilot-node-compatibility.md. Historical pending-mismatch statements are superseded by this checkpoint; the rest of the full delivery requirements remain open.
- Trusted read-only SSH preflight obtained fresh baseline: existing LACK and tailscaled active, original PIDs and zero restarts, health 200, six relay UDP listener rows, no TCP 443 listener and approximately 1.06 GiB available RAM. This does not prove functional Relay traffic or authorize production cutover.

## Current public-node source native Linux and bounded co-host checkpoint

- Tested all 260 archived files from product commit 85e72c98f2b5c1fb2c609d293a0c66c46c2dafe0 in the approved private-network/readonly-source systemd isolation. No production cutover, host 443, DNS/firewall, global installation, credential or Relay change.
- Linux default-Python cases 20/20, focused actual packaged HTTPS/node lifecycle/five-Agent rounds 13/13, full 461/461 with zero failures/skips/cancellations and passing smoke. Focused cases overlap the full suite. Windows and Linux now cover the same product-code checkpoint.
- Three-minute synthetic workload completed 40 five-Agent rounds per workspace (80 total), 400 main/800 total generations, zero failed rounds/privacy leaks, generation HTTP concurrency 1. Five paired execution nodes were idle; this is not real vendor execution or all-node pressure.
- Main trial capped at single-core 50%, 256 MiB, 64 tasks and 900 seconds; measured cgroup peak 137404416 bytes and CPU 134756685000 ns. Thirty co-host samples preserved original active services/PIDs/restart counts, health 200 and relay UDP listeners; real Relay latency/loss remains unproven.
- SSH observation interruption was resolved by reading the existing terminal unit, not restarting the trial. Downloaded evidence hash matched 05276afb6ecce6ecc92dda9df7e7def9d9a31ba650f524bdaa04850fa122a90b. Owned units are not-found/inactive/PID 0, verified-owned roots removed, final baseline preserved and SSH closed.
- See docs/verification/2026-10-11-native-public-node-verification.md. Remaining human evidence UI, historical-release restore, direct real providers, vendor-owned computers, production ownership/window/public HTTPS and longer functional co-host acceptance prevent declaring Task 11/12 or total delivery complete.

## Human pilot evidence and explicit owner acceptance checkpoint

Human controls now expose bounded evidence metadata, authenticated image reads
and explicit owner-only acceptance for the existing public browser pilot. Node
revocation preserves human historical reads but prevents new acceptance; late
binary responses and image URLs are cleared across workspace/panel generations.
Fresh Windows full regression: 467/467; focused 42/42; smoke exit 0. Fresh current
source native Linux: default Python 20/20, focused 45/45, full 467/467, smoke exit 0,
180-second synthetic collaboration soak passed with 80 complete five-Agent rounds
and no failures/privacy exceptions. Five registered nodes remained idle; this is
not real vendor execution or a five-busy-node capacity result. 31 co-host samples
and final cleanup retained production LACK/Relay PID/restart/health baseline.
Owned trial services/roots were cleaned, evidence downloaded/hash-verified and
SSH closed. No production cutover, public port, credential or Open WebUI change.

Evidence and scope: `docs/verification/2026-10-11-human-pilot-evidence-acceptance.md`.
Real-browser rendering, direct real models, vendor-owned execution, independent
historical restore and production/public acceptance remain explicit delivery gates.

## 2026-10-11 真人浏览器及低资源完整回归增量

- 真人负责人实际查看图片、独立确认验收、重新读取验收状态通过；成员与只读用户不能验收尚未验收的任务；工作区切换清除待确认和旧图片；390px 移动视口无横向溢出。
- 本地夹具明确是 HTTP/Cookie/Origin/WS 替代传输及合成截图，不作为生产 TLS、Muse/dots 自身执行或真实模型证据。PNG 已补齐完整像素数据和两个回归测试；夹具使用现有 scoped 配对及 taskId 字段，另有专属文件停止信号和退出码 0 试验。
- 默认全量测试文件串行、每文件 90 秒，保留全部文件和用例内部并发。Windows 本轮 470/470，0 失败/跳过/取消，279132.1608ms；后续 HTTP/WebSocket、双模拟模型、重启持久化冒烟退出码 0。此前并行全量失败根因未确认，独立 HTTPS 生命周期 1/1，未用串行通过冒充根因修复。
- 独立公开 DNS 查询确认 lack.chunclaw.top 和 agents.chunclaw.top 均为 47.108.217.178，无需重复添加 A 记录；不等于公网 TLS 或发布验收。
- 本轮仅本地夹具、测试政策和文档增量，没有生产切换，没有改动 VPS 服务、Relay、凭据、DNS 或防火墙。真实模型、老镇/玄玑自身执行、公网 HTTPS、旧数据归属和切换/恢复验收仍未完成。
- 详见 docs/verification/2026-10-11-browser-human-workspace-acceptance.md，使用步骤更新于 docs/public-node-task-pilot.md。
## 2026-10-11 当前 VPS 公网准备及原生预检修正

- 当前生产仍为 /opt/chunlack/releases/e188eae；既有 LACK PID234963、tailscaled PID859、NRestarts 均 0，LACK health200，Relay UDP40000 有监听，未改动或重启。
- 443 当前无 TCP 监听，固定解析的两个公网 HTTPS 探测握手失败；不是已发布状态。VPS 2核，可用约1.05GiB，有限基线的资源/端口/DNS检查清零，deploymentAuthorized 仍为 false。
- 修正正式只读 preflight 对合法 systemd 十六进制转义服务名、journalctl grep 无匹配退出1的兼容；仍保留异常名字、错误、超时、权限诊断和真实OOM阻断。新测试先4失败3通过，再7/7，Windows全量477/477、0失败/跳过/取消，222343.9775ms，冒烟通过。脚本在真实VPS内存执行复验成功，没有安装或写入VPS。
- OOM历史计数62，最近一小时可读日志无匹配，不能声称从未发生或日志完整。辅助诊断failed字段可能匹配描述，原样保留并注明，不用于故障判定。
- 独立DNS查询无两个入口的AAAA答案，无入口及父域CAA答案；无DNS改动。非敏感入口示例和本地Caddy校验通过，未启动/申请证书，激活需复核候选回环端口13721/13722/13723。
- 正式迁移前已请求用户明确旧数据工作区和真人负责人，不猜归属。真实模型、老镇/玄玑自身执行、正式TLS与生产迁移/独立恢复/共存验收仍待完成。
- 证据见 docs/verification/2026-10-11-public-preflight-native-acceptance.md。