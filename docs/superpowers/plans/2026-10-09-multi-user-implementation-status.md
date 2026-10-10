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
