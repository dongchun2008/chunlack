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
