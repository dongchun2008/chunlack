# ChunLACK 多用户、多工作区与真实节点交付 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付可供多个真人在同一或不同工作区使用的私有 ChunLACK，完成老镇、玄玑真实协作接入及双域名安全访问，并证明既有 VPS 服务未受影响。

**Architecture:** 一套应用管理平台账号、成员关系与服务端会话；业务数据、内存状态、模型授权及节点任务严格绑定工作区。应用与节点网关优先在一个 Node 进程内使用同一个授权和容量协调器，Caddy 提供两个 HTTPS 站点；不为用户或工作区启动独立实例。所有开发及迁移先使用独立测试状态，生产修改单独安排。

**Tech Stack:** Node.js >=24 <25、Express 4、ws 8、better-sqlite3 12、Node 标准 crypto/AsyncLocalStorage、现有 Python materialize 工具、标准 Caddy；不新增 Redis、Docker、身份平台或消息代理依赖。

**Spec:** `docs/superpowers/specs/2026-10-09-public-agent-ingress-design.md`，用户已批准其多用户、多工作区版本；本计划尚待用户审阅。

## Global Constraints

- 保留 Ollama、供应商中立路由、每 Agent 模型选择、local-only 与明确授权的云端回退；不硬编码 1Cat、DGX Spark 或特定云供应商。
- `lack.chunclaw.top` 是真人网页，`agents.chunclaw.top` 是受限节点 REST/MCP；不修改根域名、books 子域名或未知用途的记录。
- 底层服务继续只监听 loopback；公网仅申请本次明确批准的 TCP 443，不新增 TCP 80、UDP 443、任意代理或运维管理接口。
- 真人账号与节点凭据分离；禁止共享网页密码、凭据入 Git/聊天/日志或返回模型密钥。工作区 ID 必须与服务器验证的身份及成员关系绑定。
- 最小工作区角色为所有者、成员、只读成员；任务分工不赋予权限。默认不跨工作区共享、委派、检索记忆或下载附件。
- 真人会话 host-only Cookie 必须 Secure、HttpOnly、SameSite=Lax；空闲 30 分钟、绝对 12 小时到期，退出、停用和成员撤销必须终止相关 WebSocket。
- 控制 JSON 256 KiB、截图 2 MiB、附件试点全局总量 20 MiB/七天；有界来源缓存、事件重试和清理周期。
- 第一轮 3 个真人账号、2 个工作区、最多 5 个已注册节点、全局单执行槽；节点租约 90 秒、试点任务期限 5 分钟。在线人数与执行并发分开计量。
- 不改变 tailscaled、Peer Relay、路由或既有防火墙规则，不重启现有服务。生产迁移和切换需要明确维护安排，资源不足时停止新增候选负载。
- 候选进程不能与旧进程共写数据库或目录；不自动迁移生产数据、不自动扩大资源限制、不降低安全要求来凑容量。
- 首轮外部节点任务仅公开 example.com 浏览及截图；真实活动记录和附件链路必须验收，模拟图片、2xx 或 health 不代表交付。
- 每个步骤保留明确失败信息和回滚路径；完整交付前检查本计划末尾的要求矩阵，任何缺失证据保持未完成。

## Review Focus

- 双标签页、异步模型回调及后台定时器重叠：工作区上下文不得被另一请求或会话切换覆盖；任务 4、5、6、8 验证。
- 无成员权限但猜中 taskId、agentId、artifactId 或 eventId：列表、详情、搜索、导出、回调与附件均拒绝越权且不泄露存在性；任务 4、7、11 验证。
- 成员/节点在运行中撤销、租约刚到期或事件重投：旧连接失效，结果不能写回其他工作区，重试不重复完成；任务 2、5、7、8 验证。
- 旧数据缺归属、目录符号链接及 WAL 未同步：迁移不能污染生产、丢记录或扩大可见范围；任务 6、10、11 验证。
- 错误密码洪泛、慢请求、截图超限及外部节点离线：有界内存/连接/队列，正常用户与 Peer Relay 保持可用；任务 2、8、10、12 验证。

## 当前源码依据与文件边界

当前工作区在本轮开始时 `git status --short` 无输出。版本元数据为 4.2.2-hybrid.1；没有因此重新认定生产版本、生产健康或以前测试通过。

`lack.py` 是嵌入式源文件，不直接编辑生成的 server.js。现有 SQLite 数据类包括 messages、agents、agent_memory、project_states、pipeline_results、loop_health；消息保存/读取与 Agent 加载没有工作区参数。channels、agents、clients、researchSessions、agentMemories、projectStates 及循环状态为共享 Map；WebSocket 为临时 human 标识，多个广播入口按频道或线程发送。它们是本次必改边界，而非只改反向代理。

`scripts/materialize.py` 当前复制 gateway、sdk 并保留已有配置；新增模块必须纳入生成及部署包。现有 gateway 测试覆盖 `createGatewayStore({dbPath,now})`、createNode、pair、authenticate、enqueueTask、claimTask、submitResult、appendEvent、getTask、listTasks 和撤销/取消/重试；通过受限授权封装复用这些语义，不另建任务队列。既有 scopeId 是数据/能力范围，不代替 workspaceId。

预计新增 identity/、collaboration/ 的小型模块；必要修改集中于 lack.py、materialize、gateway、MCP/SDK 的授权桥接及测试。下文文件名为实现约定；接口字段和异常语义保持一致，新增 schema 必须归类为平台级、用户级、工作区级或明确全局资源。

## 执行方式与通用测试步骤

由本会话直接逐任务执行，不将项目会话交给 dots，不创建其他任务。当前未提供可用独立代码审查工具；完成后使用可用的静态/行为检查和明确证据矩阵，不虚构独立审查。

各任务遵循：先写下文命名测试并运行确认缺失功能失败，再一次性实现相应模块，执行该任务测试及涉及的旧测试，最后只提交该任务范围并同步当前 GitHub 分支。先确认 Node 24 和 better-sqlite3 可运行；不把缺依赖、超时或命令未执行当作测试通过。

命令约定：使用当前可用的 Node 24 可执行文件执行 `node --test --test-reporter=spec tests/<文件>.test.cjs`；全量为 `node --test --test-reporter=spec tests/*.test.cjs`，smoke 为 `node tests/smoke.cjs`。没有 npm CLI 时不改变 Node 或依赖版本，只直接执行已有工具。证据记录实际命令、时间、退出码、通过/失败数量及未覆盖项，禁止仅按预期填写。

### Task 1: 账号、工作区、成员及审计持久化

**Files:** Create `identity/store.cjs`, `identity/policy.cjs`, `tests/helpers/workspace-fixture.cjs`, `tests/identity-store.test.cjs`.

**Interfaces:** `createIdentityStore({dbPath,now=Date.now})` 提供 `createUser({login,passwordHash})`、`createWorkspace({name,ownerId})`、`listWorkspaces(userId)`、`requireMembership(userId,workspaceId)`、`setMembership(actor,{workspaceId,userId,role})`、`removeMembership(actor,{workspaceId,userId})`、`disableUser(userId)`、`close()`。`actor` 为服务器创建的 `{userId,workspaceId,role}`；平台维护调用单独接口，不接受请求中自报维护身份。`authorize(actor,action,resourceOwnerId=null)` 返回允许或抛出固定权限错误。

- [ ] 写 `identity-store.test.cjs`：fixture 定义甲/A-owner、乙/A-member+B-owner、丙/B-viewer；断言甲不能读取 B，乙两区角色不同，丙不能提交任务，最后所有者不能被移除或降级，并发变更后仍至少一名所有者。
- [ ] 运行该测试，确认失败来自新接口缺失而非环境故障。
- [ ] 建 users、workspaces、memberships、invites、sessions、reset_tokens、audit 表和 schema_version，开启外键并事务化成员变更；记录操作者和范围，不记录凭据。设计普通业务资源缺权限时统一 not_found，管理动作缺权限 forbidden。
- [ ] 运行测试及数据库重开/并发事务测试；验证停用账号不会因仍有成员记录而继续授权。
- [ ] 提交新增模块和测试，执行范围化 GitHub 同步。

### Task 2: 密码、会话和有界认证准入

**Files:** Create `identity/passwords.cjs`, `identity/sessions.cjs`, `identity/admission.cjs`, `tests/identity-session.test.cjs`; Modify `identity/store.cjs`.

**Interfaces:** `hashPassword(password): Promise<string>`、`verifyPassword(password,encoded): Promise<boolean>`；`createSessionService({store,now,onRevoke})` 提供 `login({login,password,source})`、`authenticate(token)`、`logout(token)`、`logoutAll(userId)`、`resetPassword({token,password})`、`sweep()`、`close()`。登录返回 `{token,csrfToken,user}`，令牌仅当次返回，库中存摘要。`createAdmission({now,maxEntries=2048})` 提供 `enter({source,login}) -> release`，超过限额抛出 retryable rate_limited，不建立无界等待队列。

- [ ] 写测试：`assert.equal(await verifyPassword('different', hash), false)`；未登录/过期/停用拒绝；推进 fake clock 到空闲 30 分钟或绝对 12 小时后拒绝；退出及重置触发 onRevoke；SQLite 字节不含原密码、token 或 csrfToken。
- [ ] 运行确认红灯。加入超长输入、Unicode、重复 Cookie、未知账号通用错误、错误密码饱和、来源缓存最大 2048 的测试。
- [ ] 使用 Node 标准异步 scrypt，初始 N=32768、r=8、p=3、salt=16 随机字节、derivedKey=32 字节、maxmem=64 MiB；编码版本及参数，定时安全比较。该组参数来自 OWASP 的 scrypt 备选配置，先实测，不自动降低。密码按原 UTF-8 输入处理，不 trim/截断；新密码建议 15 至 128 个 Unicode 码点，拒绝非法编码及超过 512 字节。
- [ ] 全局同时最多 1 次哈希运算，入口默认全局每分钟 30 次、每来源 5 次、每 login 5 次；hash/计数入口也覆盖邀请建号和密码重置。使用固定容量、有 TTL 的计数器和有界清理；未知账号验证路径不暴露账号是否存在。
- [ ] 跑真实哈希、会话生命周期及限流测试；记录本机实际耗时/峰值内存，不据此承诺 VPS 数值。提交并同步。

### Task 3: 真人认证接口、邀请和受控维护命令

**Files:** Create `identity/http.cjs`, `scripts/accounts.cjs`, `tests/identity-http.test.cjs`; Modify `identity/store.cjs`.

**Interfaces:** `createIdentityRouter({store,sessions,webOrigin})` 返回 Express router；路径 `/auth/login`、`/auth/logout`、`/auth/logout-all`、`/auth/me`、`/auth/invites/accept`、`/auth/password/reset`、`/api/workspaces` 及 `/api/workspaces/:workspaceId/members`。登录只接受 POST JSON；返回 `__Host-chunlack_session` Cookie 和本会话 CSRF 值，不允许调用者指定 Cookie Domain。维护 CLI 使用 `bootstrap`, `create-workspace`, `issue-reset`, `disable-user` 子命令，仅本机私有状态目录。

- [ ] 写测试：未登录业务接口 401，错误 Origin/缺 CSRF 的修改请求 403；真人 Cookie 不能授权节点入口；新账号必须有合法邀请；已有账号接受邀请必须先登录且账号匹配；邀请 24 小时后或第二次使用失败。
- [ ] 运行红灯。测试会话固定攻击、客户端冒充 userId/role、邀请 URL 凭据访问日志和最后 owner 竞态。
- [ ] 建用户与成员的邀请接受在事务中完成；重置一次性有效期 30 分钟；邀请正文不让未授权用户获得额外工作区信息。bootstrap 密码通过交互隐藏输入或受保护 stdin 输入，不接受命令行参数，不输出 token/密码到正常日志。初始化已有系统拒绝重复 bootstrap。
- [ ] 运行身份 HTTP 集成及审计脱敏测试，提交并同步。

### Task 4: 工作区数据与异步运行上下文

**Files:** Create `collaboration/context.cjs`, `collaboration/store.cjs`, `collaboration/state.cjs`, `tests/workspace-store.test.cjs`, `tests/workspace-context.test.cjs`; Modify `lack.py` 的 SQLite 初始化、dbSaveMessage、dbGetMessages、dbSaveAgent、dbLoadAllAgents、projectStates、各 Map 与循环状态入口。

**Interfaces:** `runWithWorkspace(actor,fn)`、`requireWorkspaceContext()` 以 AsyncLocalStorage 传递冻结的服务器上下文；`createCollaborationStore({db,identity})` 的 `forWorkspace(actor)` 提供 `saveMessage(msg,storeId)`、`getMessages(storeId,limit=1000)`、`saveAgent(agent)`、`loadAgents()`、`saveProjectState(storeId,state)`、`loadProjectState(storeId)`。`createWorkspaceState(workspaceId)` 包含 channels、agents、researchSessions、agentMemories、projectStates、循环状态、指标与缓存；平台级 clients 保存独立授权连接对象，不能直接被业务层全量遍历。

- [ ] 写测试：A/B 同名 general 频道、同名 moderator/agent、同名线程仍只能读取各自内容；所有业务访问缺上下文失败；并行 `Promise.all` 及延迟回调不串区。SQL 外键拒绝跨区 parent/thread/agent 关联；schema 清单中新表未归类测试失败。
- [ ] 运行红灯。加入搜索/导出/pipeline_results/loop_health 的跨区负路径，不只测试消息列表。
- [ ] 为六个既有 SQLite 数据类及新增研究/来源元数据添加非空 workspace_id 和复合唯一键/必要外键，通过迁移模块提供候选 schema，旧代码函数转为受约束委托；禁止业务层原始无范围 SQL。内存 Map 进入 workspace state；不使用全局 mutable currentWorkspace。
- [ ] 运行新测试及 providers/research 既有测试；私有旧模式仅可明确进入本机 legacy context，启用多人或公网模式则禁止自动 fallback 到 legacy。提交并同步。

### Task 5: HTTP/WebSocket 全路径授权与连接撤销

**Files:** Create `collaboration/transport.cjs`, `tests/workspace-http.test.cjs`, `tests/workspace-websocket.test.cjs`; Modify `lack.py` 的 app/server/wss 创建、连接、message switch、onHumanMessage 和所有 broadcast 函数。

**Interfaces:** `createWorkspaceTransport({identity,sessions,state,webOrigin})` 提供 `httpContext(req,res,next)`、`authorizeUpgrade(req)`、`attach(ws,principal)`、`authorizeMessage(ws,message)`、`broadcast({workspaceId,channelId,threadId,payload})`、`revoke({userId,sessionId,workspaceId})`、`close()`。会话查询、Origin 和成员验证在 upgrade 前完成；每个消息动作映射 policy。

- [ ] 写真实 ws 和 HTTP 测试：伪造 username/userId 不改变发送身份；只读不能通过 slash 命令、join、research、agent 管理或直接 WS 帧触发修改/模型调用；跨区 general、thread_update、agents_list、Ralph 状态不会泄漏。
- [ ] 运行红灯。断言现有 openThreadId 和 storeId 相同仍不跨区广播；甲/乙两标签页独立；成员撤销或 session expiry 后旧 WS 关闭且重连拒绝。
- [ ] 为每个 HTTP 路径、slash 命令和 WS type 建显式动作清单，未知动作默认拒绝；有副作用请求验证 CSRF 和精确 Origin。服务端 sender 取账号身份，不信任前端 set_username。只允许已授权频道订阅，后台广播使用 task 捕获的 workspaceId。
- [ ] 有界 payload、连接和 close lifecycle；针对浏览器合法 WSS 及恶意跨站握手执行网络测试，提交并同步。

### Task 6: Memory、文件、模型及研究证据隔离

**Files:** Create `collaboration/resources.cjs`, `tests/workspace-resources.test.cjs`, `tests/workspace-models.test.cjs`; Modify `lack.py` 的 AGENT_MEMORY_DIR、WORKSPACE_ROOT、RESEARCH_DIR、STACK_ROOT、THREAD_REPO_ROOT、skills、embeddingCache、PUBLIC_MEMORY_SUMMARY、provider 目录及后台维护入口。

**Interfaces:** `createWorkspaceResources({dataRoot,identity,providerCatalog})` 提供 `paths(actor)`、`safePath(actor,relative)`、`authorizeProvider(actor,providerId,modelId)`、`cacheKey(actor,{kind,userId,resourceId})`。持久文件置于经过服务器 ID 解析的 `workspaces/<workspaceId>/...`，个人记忆另含 userId；全局 providerCatalog 存私有 credential reference，输出只含获授权服务的无密钥摘要。

- [ ] 写测试：同名 Memory/skills/研究来源在两区互不可见；路径穿越、junction/symlink 和其他工作区绝对路径拒绝；缓存相同文本不复用未授权用户数据；成员不能读配置密钥或绑定未获授权模型。
- [ ] 运行红灯。加入独立异步维护、模型回退时工作区白名单/local-only 校验，以及既有 SIPHON 搜索失败不会生成 synthetic facts、原始链接保留的回归用例。
- [ ] 文件/配置/缓存/summary 与后台维护均使用冻结工作区上下文；模型接口只返回获授权 id/models/capabilities，不返回 credential reference。保留现有 Provider Adapter 与策略，把授权作为调用前附加边界。多人模式默认禁止尚未通过控制边界测试的 shell/Git/任意文件工具；明确显示禁用原因，不伪装功能可用。
- [ ] 新测试与 providers、research、工具边界回归全部通过；证明模型私密输入不进入其他区的 Memory/摘要/审计正文。提交并同步。

### Task 7: 节点、MCP、SDK、附件和事件的工作区授权

**Files:** Create `gateway/workspace-access.cjs`, `tests/workspace-gateway.test.cjs`, `tests/workspace-mcp.test.cjs`; Modify `gateway/store.cjs`, `gateway/server.cjs`, `gateway/node-facade.cjs`, `gateway/pilot-artifacts.cjs`, `gateway/pilot-openapi.cjs`, `gateway/research-bridge.cjs`, `integrations/mcp/pilot-server.cjs`, `integrations/mcp/artifact-upload.cjs`, `integrations/mcp/events.cjs`, `integrations/mcp/webhook-transport.cjs`, `sdk/agent-client.cjs`, `sdk/transports/muse-proxy.cjs`。

**Interfaces:** `createWorkspaceGatewayAccess({store,identity})` 返回 `forNode(authenticatedNode)` 与 `forHuman(actor)`；封装既有 enqueue/get/list/claim/result/cancel/retry 接口，认证后的节点含服务器绑定 workspaceId。任务返回值新增 workspaceId，scopeId 继续表示原有范围；公开节点任务不能省略服务端归属。SDK 校验收到的工作区与本节点配置一致，不允许响应改变身份。

- [ ] 写测试：A 节点猜中 B 的 taskId/leaseId/artifactId/eventId 仍拒绝；伪造 body/header workspaceId 不切换身份；真人 member/viewer 与 node token 不能用 admin 接口；附件上传、回调重投和完整任务结果保持在同一区。
- [ ] 运行红灯。测试相同 eventId 在不同区按明确范围去重、撤销中的任务取消与最终结果竞态、重新授权设备须使用新逻辑节点凭据。
- [ ] 为 nodes/tasks/results/events/artifacts/subscriptions/outbox 归类并迁移 workspaceId，MCP principal 和 OpenAPI REST 都经过同一封装；服务器节点绑定优先，客户端字段只允许匹配。现有协议版本可接受新增字段，私有 legacy 兼容只在明确关闭多人模式时开放。
- [ ] 运行全部既有 gateway/pilot/Muse/MCP/SDK 测试，确保精确领取、截图上传、租约、三次尝试和幂等仍正确，提交并同步。

### Task 8: 全局容量、公平队列及自动协作生命周期

**Files:** Create `collaboration/capacity.cjs`, `tests/workspace-capacity.test.cjs`; Modify `gateway/runtime.cjs`, `gateway/store.cjs`, `gateway/research-bridge.cjs`, `lack.py` 的模型调用、Agent 委派、Ralph/Moderator 与后台任务启动。

**Interfaces:** `createCapacityCoordinator({maxActive=1,maxQueued=100,now})` 提供 `submit({workspaceId,taskId,deadlineAt,kind,run,signal})`、`cancel(taskId)`、`status(workspaceId)`、`close()`。同一进程内应用与网关共享实例，持久租约由 store 提供；启动先恢复仍有效租约，不能把已运行外部任务当空闲。执行申请按工作区轮转，每区等待上限 20，超限拒绝并报告，不创建无界 Promise 链。

- [ ] 写测试：A/B 同时排队时最大 active 始终 1，A 持续提交不饿死 B；截止、撤销和 signal abort 清除排队任务；重启存在有效节点租约时不同时放行新任务；无人确认高风险操作不会自动扩大权限。
- [ ] 运行红灯。测试 lease expiry 恰逢取消/重投、递归 Agent 委派及 model timeout，正常后续任务仍可执行。
- [ ] 编排任务的等待状态不占执行槽；一次模型请求或一个真实外部执行租约占槽，内部规划步骤不可持槽再递归申请造成死锁。远端取消未确认时保持占用/隔离到租约终止，记录 remote cancellation 未证明。普通失败有限重试，超过次数转 needs_attention，委派深度与次数使用显式配置和审计。
- [ ] 本地阶梯负载分别统计真人连接、模型请求、完整 5 Agent 一轮任务；不以单请求成功冒充协作完成。跑生命周期回归，提交并同步。

### Task 9: 网页登录、工作区切换和成员操作

**Files:** Create `identity/login.html`, `identity/workspace-ui.js`, `tests/workspace-ui.test.cjs`; Modify `lack.py` 的 INDEX_HTML、初始化、connect、fetch 路径及成员入口。

**Interfaces:** 前端通过 `/auth/me` 和 `/api/workspaces` 获取账号/可访问工作区，每标签页独立保存非敏感 workspaceId；业务 HTTP/WS 携带该选择器。服务端返回真实角色与能力，菜单呈现只是体验层，不能代替服务端校验。logout 先终止订阅/重连，再撤销会话；401/403 不无限重连。

- [ ] 写测试：登录失败不显示工作区数据；切换清空旧消息、Agent/Memory/图谱/附件/研究列表；乙两个标签页 A/B 不互相切换；viewer 的按钮禁用且直接请求仍拒绝；用户移除后返回可访问工作区或无权限界面。
- [ ] 运行红灯。测试返回内容和用户显示名的 HTML 注入、登录/邀请回跳仅同源、旧 history/sessionStorage 不残留敏感工作区状态。
- [ ] 保留牛油果配色和既有工作流，新增最小登录/退出、选择工作区、成员邀请/角色/撤销、节点授权和任务进度入口；任务保留研究来源、缺证标识及模型选择信息，不显示密钥。
- [ ] 执行真实浏览器桌面/窄屏、三账号和双标签页测试，截图保存于 Git 外，证据区分 DOM 检查与实际操作。提交并同步。

### Task 10: 运行生成、双域名入口与部署预检

**Files:** Create `gateway/public-runtime.cjs`, `deploy/public/Caddyfile.template`, `deploy/public/chunlack-public.service`, `deploy/public/chunlack-https.service`, `deploy/public/preflight.sh`, `deploy/public/README.md`, `tests/public-runtime.test.cjs`, `tests/public-ingress.test.cjs`; Modify `scripts/materialize.py`, `lack.py` 的应用初始化与关闭接口。

**Interfaces:** 嵌入式 SERVER_JS 导出 `startLackRuntime({config,dataRoot,identity,capacity}) -> Promise<{server,wss,close}>`，直接运行保留显式本机 legacy 入口；`startPublicRuntime({config,dataRoot,env})` 在一个进程创建 identity、LACK、gateway、MCP 与 capacity，共用明确实例并监听独立 loopback 端口，要求 multiUser.enabled=true 和迁移完成。`close()` 按停止领任务、终止连接、保存状态、关闭 store 顺序执行。

- [ ] 写测试：materialize 输出含 identity/collaboration/gateway/sdk/MCP 文件且保留已有私有配置；未启用隔离、未迁移、绑定非 loopback、同目录已有 writer 或身份服务初始化失败时拒绝启动，不回落到原无鉴权服务。
- [ ] 运行红灯。测试 SIGTERM/启动半失败后没有遗留监听、定时器、SQLite 写者或队列；代理未知 Host/异常编码路径/重复授权头默认拒绝。
- [ ] 标准 Caddy 配置两站点，限制必要路由并转发 WSS，清理不可信代理身份头；运维管理端口不在代理白名单。禁用 HTTP challenge、自动 HTTP 重定向与 HTTP/3，只试 TLS-ALPN-01；443/CAA/DNS 不满足则停止，不开放 80 或关闭 TLS 验证。
- [ ] 合并应用初始 MemoryMax=448 MiB、CPUQuota=50%、TasksMax=64；Caddy 初始 128 MiB、10%、64。它们是待测硬上限，不是内存预留或容量保证；不再额外启动每区 Node 服务。候选与现有进程并存须通过预检，预算不够则先停止候选，报告需要维护窗口或硬件调整。
- [ ] preflight 只读取服务/PID/restart count、TCP/UDP 监听、内存/swap/PSI/OOM 和当前代理站点，不读取无关凭据；任何端口冲突、未授权 DNS 覆盖或既有服务异常列为阻塞。用标准 Caddy validate 及真实本地 TLS/HTTP/WSS 集成验证，提交并同步。

### Task 11: 旧数据副本迁移、恢复与全量本地验收

**Files:** Create `scripts/migrate-workspaces.cjs`, `scripts/workspace-acceptance.cjs`, `docs/multi-user-migration.md`, `tests/workspace-migration.test.cjs`, `tests/workspace-e2e.test.cjs`。

**Interfaces:** `planMigration({sourceRoot,targetRoot,workspaceId,ownerId})` 返回分类/数量/未归属报告，`applyMigration(plan)` 仅操作独立目标副本，`verifyMigration(plan)` 检查完整性及可读性；CLI 默认 dry-run，apply 必须显式参数和归属选择。使用 SQLite 一致性备份处理 WAL，不复制正在写入的数据库文件后宣称完成。

- [ ] 写测试：源数据库、JSON 记忆、来源链接及附件保持不变；六类旧表和节点数据计数对应、候选数据库 integrity_check/foreign_key_check 通过；未知归属隔离；第二次迁移无重复；模拟中途失败后候选不能启动且源版本可恢复。
- [ ] 运行红灯。测试真实 WAL、非空目标目录、符号链接、缺附件、旧 Agent 的 Ollama provider 及自定义模型配置。
- [ ] 实现原子候选发布标记、版本清单及离线恢复，不自动删除源或覆盖旧配置；acceptance 脚本跑真实 HTTP/WS、3 账号/2 工作区、混合本地/云模拟模型与节点任务，并记录完整链路和来源。
- [ ] 执行全部旧/新测试、smoke、独立 Muse/dots 本地 pilots 和稳态负载；验证断开重连、状态重开、超时/取消、限流与回滚。测试失败先分类根因；不删除或放宽断言换取通过。
- [ ] 生成本地验收报告，列明模拟/真实边界及仍未验证项，提交报告模板与代码，真实数据留 Git 外并同步。

### Task 12: 生产基线、公网发布、真实节点与最终交付

**Files:** Create `docs/multi-user-quickstart.md`, `docs/muse-dots-connection-guide.md`, `docs/delivery-acceptance.md`; Update `deploy/public/README.md` 的实际操作记录模板。生产状态、截图、令牌、证书和私有配置不进入仓库。

**Interfaces:** 使用 Task 10 的只读 preflight、Task 11 的迁移/验收命令及 Task 7 的受限节点接口；公开入口不直接使用 loopback 运维接口或原 3721 服务。真实流程为任务创建 -> 授权通知 -> 节点领取 -> 自身浏览器执行 -> 有效截图/证据 -> 回传确认 -> 网页展示。

- [ ] 先解决受支持的远程操作入口；此前 SSH workflow 被工具拒绝且尚无可信会话，不能用其他执行路径绕过。核对用户提供的 ED25519 指纹后才能信任主机。无法取得入口时继续可做的本地任务，并将上线保持未完成。
- [ ] 在改动前获取 fresh baseline 和备份/恢复证据，核对 Peer Relay 实际 UDP 服务及业务连通性，不用 TCP 截图或 PID 存活代替。确认两个子域名权威 DNS 的现有用途和 TCP 443 占用；新增记录须仅指向本次 VPS，不改变根域名或其他站点。
- [ ] 用户明确确认旧数据归属及维护安排后才迁移/切换 LACK；不触碰 Tailscale/Relay。候选先受限试运行，可信证书签发成功且全路径认证完成后才启用双域名公网路由；未授权公网探测和原服务对照必须同时通过。
- [ ] 私有配置中接入现有 Open WebUI 内网模型，验证至少一组真实模型请求、按 Agent 分配和授权策略；密钥只从已授权的私有配置引用，过期/无权限时请求用户安全更新，不打印旧密钥。无法路由内网时不得开放该模型公网端口，也不能用模拟请求替代。
- [ ] 老镇使用其受支持第三方连接器保存节点凭据；玄玑使用受支持自定义 MCP 及 Events，在账号允许的范围内设置订阅和签名回调。公网方案不依赖 Tailscale 3130 或 OpenAI Tunnel，但官方支持、账号能力、授权及外部 Agent 真实触发仍需逐项验证。创建账号连接或录入凭据时由用户完成相应安全确认，不把宽泛实施批准当作外部平台权限授予。
- [ ] 两端各执行唯一 taskId/challenge 的 example.com 标题/截图任务，保留其自身云端浏览器活动、时间、截图及 ChunLACK 入库确认；两端都通过后再验证同工作区任务的分工/转交及结果展示。不用 VPS 抓图、SDK worker 或合成图片冒充外部 Agent。
- [ ] 在约定窗口做有界持续负载：3 真人、2 工作区、最多 5 节点、全局 1 个执行，分别计量完整 5 Agent 一轮完成率、错误/超时、资源、Relay 延迟/丢包及服务重启次数。原服务恶化时立即停止新增负载并暂停候选，不自动动 Relay 或扩大预算；报告实测上限而非保证无限用户。
- [ ] 最终逐项填写证据矩阵，包含 URL、账号建号/邀请/工作区切换/模型与节点选择/任务发起/来源查看/审批/暂停撤销/故障恢复说明，提供 Muse 与 dots 各自实际配置步骤及支持限制。仅在所有要求证明后称交付；否则明确剩余阻塞，不缩小目标。
- [ ] 范围化 GitHub 同步最终代码和无敏感资料，验证提交成功；不自动合并 main 或修改仓库可见性。

## 验收证据矩阵

| 要求 | 所属任务 | 必须取得的证据 |
| --- | --- | --- |
| 独立账号、邀请、恢复与注销 | 1-3、9 | SQLite 摘要检查、真实浏览器及 HTTP 会话测试 |
| 同区协作、跨区不同角色和成员撤销 | 1、4、5、9 | 3 账号/2 区矩阵及旧 WS 失效 |
| 消息/Agent/Memory/研究来源/文件/后台隔离 | 4、6、7、11 | 同名资源、越权 ID、缓存、搜索导出、重试与后台负路径 |
| 用户与节点凭据分离，模型与节点按区授权 | 3、6、7 | REST/MCP/WS 互换凭据拒绝及模型调用前策略记录 |
| 原 Ollama、llama.cpp/OpenAI-compatible 和云模型共存 | 6、11、12 | 旧 provider 回归及至少一组真实已有节点模型请求 |
| 委派、Moderator、Memory、预算及自动协作 | 4、6、8、12 | 有效工作区任务链路、受限审批和完整轮次结果 |
| shell/文件/Git 不越权 | 6、7 | 未验收能力禁用；启用项的路径、命令和审批边界测试 |
| HTTPS、HTTP/WSS、CSRF、撤销及拒绝管理路径 | 3、5、10、12 | 两个真实域名及未授权/跨站/未知 Host 网络测试 |
| 数据迁移、持久化与恢复 | 10、11、12 | 副本计数、完整性检查、重启恢复及回滚演练 |
| 老镇真实完整能力 | 7、12 | 正式连接器、真实浏览器活动、challenge、截图及网页结果 |
| 玄玑真实完整能力 | 7、12 | 订阅事件、真实浏览器活动、challenge、截图及网页结果 |
| 2C2G VPS 及既有 Relay 稳定 | 8、10、12 | fresh baseline、持续负载和前后业务对照，不只是 health |
| 可直接使用与可维护 | 9、12 | 用户操作验收、两端接入说明、备份/撤销/升级/回滚说明 |
| GitHub 同步与敏感资料排除 | 各任务 | 范围化提交/推送结果，秘密和运行资料不入库 |

## 尚需现场证据的条件

- 受支持且可信的 VPS 操作入口、当前 TCP/UDP 服务及资源基线。
- 权威 DNS 管理中 lack/agents 子域名用途、443 占用及证书条件。
- 生产旧数据归属、维护切换安排、候选并存资源是否足够。
- Muse/dots 正式账号自定义连接器/事件权限、实际授权及凭据安全录入。
- VPS 对现有私有模型服务的真实可达性及有效凭据。

这些条件不阻止在计划获准后先完成本地实现和测试，但均阻止对应生产验收项被标记完成。本轮只是形成实施计划，没有安装依赖、修改产品代码、执行产品测试或改动生产配置。

参数参考：[OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)、[Node.js 24 crypto](https://nodejs.org/docs/latest-v24.x/api/crypto.html)。身份、会话及隔离安全参考以已批准设计中的官方链接为准。
