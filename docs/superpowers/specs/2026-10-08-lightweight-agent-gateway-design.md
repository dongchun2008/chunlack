# ChunLACK 轻量 Agent 接入网关设计

状态：待审阅的实施规格，尚未搭建或部署网关。

## 1. 目标与边界

让 Windows、Mac 和其他 VPS 上的 Agent 主动接入 ChunLACK，领取研究任务、
上报进度并提交可追溯结果。VPS 只做协调，不加载模型，不代理各节点的模型密钥。
用户现有 llama.cpp / 1Cat 双 V100 服务保持不变，Ollama 兼容性保留。

首期只支持公开、非敏感的研究任务；不提供任意 shell、文件读写、程序启动、
远程安装或自动后台驻留功能。SDK 不自动调用任何真实模型。
协议可被不同 Agent 包装器实现，不意味着 muse.ai、dots 已有可用连接器。

不增加 Redis、消息代理、外部数据库、独立常驻服务或新 npm 依赖。
使用既有 Node.js 24、better-sqlite3 和 Node 标准库。
本规格不是生产操作授权，不开放公网端口，不修改现有凭据或系统服务。

## 2. 参考与取舍

- Raft External Agents：外部运行时保留自己的环境，平台授予受限身份。
  https://docs.raft.build/features/agents/external/
- Raft Apps：能力声明与授权分开，事件内容不构成执行授权。
  https://docs.raft.build/developers/raft-apps/build/
- Slack Socket Mode：连接由节点发起，不要求本地节点公开 HTTP 回调。
  https://docs.slack.dev/apis/events-api/using-socket-mode/
- Slack Events API：参考事件确认、重复投递处理，不照搬其协议。
  https://docs.slack.dev/apis/events-api/

先实现 HTTP 长轮询而非 WebSocket，减少连接状态机复杂度。长轮询等待期间
不循环查询数据库；任务入队时由进程内通知唤醒，超时返回 204。
未来可以增加不含任务正文的 WebSocket 唤醒，不改变任务契约。

## 3. 运行形态

```text
同一个 LACK Node 进程
  现有网页入口与 Model Router：维持现状
  Agent Gateway：独立 HTTP listener、独立鉴权、独立路由
    SQLite：nodes / pairings / tasks / events
    内部受限研究桥：只访问指定研究阶段，不调用普通聊天执行循环
          ^
          | 节点主动连接受控私有通道
    Connector SDK / CLI -> 用户选定的外部 Agent 包装器
```

网关默认关闭。启用必须显式提供回环监听端口和管理员凭据环境变量引用；
不预选可能占用的端口。不接受 0.0.0.0、公网或 Tailscale 地址作为首期监听地址。
部署阶段可使用单独的受限 SSH 转发访问网关，不能将旧 LACK 网页端口交给节点。
需要 SSH 时使用限定转发目标的独立账户，不共享 root 凭据；本轮不配置账户。

共享进程降低开销，但不是进程级安全隔离：网关崩溃或资源失控仍可能影响 LACK。
因此全部异常必须被请求边界捕获，连接、正文、事件、队列和存储必须有界。
启动失败记录固定脱敏错误，关闭网关，不降级成无鉴权服务；不影响旧服务启动。

## 4. 配置与管理

建议配置块 `agentGateway`：`enabled` 默认 false；启用时显式提供 `port`、
`adminTokenEnv`。数据库位于现有应用数据目录下 `db/agent-gateway.db`。
任何动态配置不得指定任意数据库路径或模块路径。

管理员凭据与节点凭据完全分离。管理员凭据通过私有环境变量提供，至少
32 个随机字节等效强度；配置和接口只引用它，不显示它。未提供时不启动网关。

管理页由网关自身提供，不能复用旧网页 API 的信任边界。管理员在该页面输入
凭据，前端只在当前页面内存中保存，关闭页面即丢弃；不写 localStorage、URL
或 Cookie。每个管理请求都独立校验 Bearer 凭据，不依赖“来自回环地址”。
不设置跨域允许头；拒绝跨站浏览器请求，动态内容通过 textContent 显示。

页面提供：节点列表、能力、最后活动时间、当前任务、最近错误、配对、暂停派单、
恢复派单、撤销凭据、任务取消和明确的手动重试。初期只设一个管理员身份。
“在线”只表示近期通信，不证明模型可用或节点实际停止了执行。

## 5. 配对与授权

1. 管理员创建节点，指定固定 Agent 名称、允许的研究能力和任务作用域。
2. 服务端生成 128 位随机的一次性配对码，有效期 5 分钟，只显示一次。
3. CLI 通过隐藏输入读取配对码，向 `/v1/pair` 兑换 256 位随机节点令牌。
4. 配对码在一个事务中被消费，数据库仅保存配对码和令牌的 SHA-256 摘要。
5. 节点保存自己的令牌，以 Authorization 请求头访问接口。

凭据不能出现在命令行参数、URL、日志、截图或示例仓库中。令牌不是模型密钥。
CLI 凭据文件放在用户专属目录：POSIX 权限 0600，Windows 显式限制为当前用户
和必要系统账户；不能确认保护成功时拒绝落盘，不声称 mode 0600 能保护 Windows。
不修改工作目录以外的其他文件权限。

节点不能注册新权限、自行变更作用域或创建其他节点。客户端能力声明只用于
匹配，实际权限取服务端授权的交集。撤销立即阻止后续请求并取消待领任务；
执行中的节点可能仍在本地运行，UI 必须说明撤销不是强制终止远端进程。
首期令牌持续有效直至撤销，便于管理；重配对轮换后旧令牌立即失效。

## 6. 协议 v1

以下路径均属于独立网关，不挂到旧网页入口。

| 方法与路径 | 权限和行为 |
| --- | --- |
| POST /v1/pair | 唯一不要求令牌的业务接口；校验一次性配对码并限速 |
| GET /v1/manifest | 已认证节点；返回版本、限制和实际授权，不泄露其他节点 |
| GET /v1/agents/me | 节点自身资料 |
| POST /v1/agents/me/heartbeat | 合并在线状态和能力报告，不授予新权限 |
| POST /v1/tasks/claim | 原子领取自身作用域内任务；无任务最多等待 30 秒 |
| POST /v1/tasks/{id}/heartbeat | 校验 owner、leaseId、attempt 后续租 |
| POST /v1/tasks/{id}/events | 校验所有权并幂等提交进度或取消确认 |
| POST /v1/tasks/{id}/result | 校验租约、状态、大小和结构，幂等保存结果 |
| GET /v1/events?cursor=... | 读取自己的取消等控制事件，不消费或修改事件 |
| POST /admin/v1/nodes | 仅管理员；新增节点并创建配对码 |
| GET /admin/v1/nodes | 仅管理员；节点与任务概览，不返回凭据摘要 |
| POST /admin/v1/nodes/{id}/{pause,resume,revoke,pair} | 仅管理员 |
| GET /admin/v1/tasks | 仅管理员；分页读取受限字段 |
| POST /admin/v1/tasks/{id}/{cancel,retry} | 仅管理员；显式操作 |

任务创建由进程内研究桥调用，不对节点提供。管理页初期不提供任意指令框。
所有输入使用固定字段白名单；未知协议版本或不支持的任务类型直接拒绝。
错误使用固定 code 与 traceId，不回显 Authorization、输入正文或内部堆栈。

任务字段：`protocolVersion: 1`、`taskId`、`traceId`、`researchSessionId`、
`taskType`、`targetNodeId`、`scopeId`、`input`、`deadlineAt`、`leaseId`、`attempt`。
结果字段：`protocolVersion`、`taskId`、`leaseId`、`attempt`、`eventId`、`status`、
`output`、`sources`、`claims`、`missingEvidence`、`usage`。
来源、引用和来源缺失字段与现有研究门禁映射，不把外部 status 当作事实依据。

任务类型仅为 `research.retrieve`、`research.verify`、`research.summarize`。
协议不接受可执行脚本、shell command 或工作区路径作为运行参数。

## 7. 任务状态与可靠性

状态：queued -> leased -> running -> succeeded / failed。
领取使用 SQLite 事务，租约 90 秒，工作期间每 30 秒续租。
租约到期进入 needs_attention，不默认重派，避免旧节点仍运行时重复执行。
管理员确认后可以手动重试，attempt 递增并生成新 leaseId，最多 3 次尝试。
旧租约结果返回 409，不能覆盖新尝试。状态变化先持久化再响应。

取消：queued 直接 cancelled；leased/running 进入 cancel_requested，通知节点。
节点确认后 cancelled；无法确认则保留“取消未确认”，到租约到期进入
needs_attention。不能把收到取消请求展示为“远端已停止”。撤销节点同理。

`eventId` 在节点身份范围内唯一，关联 taskId、attempt 和规范化 JSON 内容哈希。
相同 eventId 和内容重试返回原确认；内容不同返回 409。已确认结果的重试可以
重放确认，但先检查当前身份是否仍有效。确认结果只表示已保存，不表示结论真实。
服务重启后恢复持久化任务；未过期租约保留，到期任务不自动重复派发。

## 8. 资源上限

- 默认最多 5 个已启用节点，每节点最多 1 个等待中的长轮询请求。
- 网关默认全局最多 1 个 leased/running/cancel_requested 任务；这不是旧聊天流程的全局限流。
- JSON 正文最大 256 KiB，超限在解析前拒绝；每任务最多 5 个来源、25 条候选结论。
- 每节点每分钟最多 60 次请求；配对失败全局每分钟最多 20 次，不维护无界 IP 计数表。
- 长轮询等待 30 秒；空闲超时后增加 0-2 秒随机抖动；错误退避 1/2/4/8/16/30 秒。
- 节点成功请求更新 lastSeen；空闲长轮询不另加心跳，不逐条写成功心跳日志。
- 最多 1000 个未清理任务、100 条进度事件/任务、10000 条事件总量；达到上限拒绝新增，不删除未结束任务。
- 终态任务和事件保留 7 天；审计错误保留 30 天；字段和总行数受限。
- SQLite WAL、busy timeout、定时小批量清理；不在请求路径做全表扫描或 VACUUM。
- 数据库页数上限目标 64 MiB，WAL 另行监测；该上限不是整个目录或磁盘的硬配额。

验收记录五节点空闲时请求数、CPU、RSS 增量和数据库增长。资源目标为网关
新增 RSS 不超过 32 MiB，五节点空闲领取约 10 次/分钟；这些是待测目标，不是已测承诺。
若原生依赖、缓存或负载使目标不成立，先报告并调整范围，不提高 VPS 限额掩盖问题。

## 9. 研究桥与信任边界

内部模型调用继续使用现有 Provider。外部 Agent 使用网关任务，不伪装成
`/chat/completions`，也不要求外部 Agent 共享模型凭据。

研究阶段调用统一为 `dispatchResearchStage({sessionId, stage, role, input, deadlineAt})`。
role 为内部 Agent ID 或显式 `{kind: 'external', nodeId}`，旧配置字符串保持兼容。
外部节点收到的输入仅为该阶段必要材料，不下发整个聊天或私有记忆。

首个端到端试点使用服务端预置的公开资料快照：外部核验返回的引用必须匹配
服务端已有 sourceId 和正文；外部汇总只返回已有 supported claim ID 的排序。
复用现有核验和汇总门禁，不新增宽松的备用解析路径。

外部检索结果先作为 unverified 材料保存，不能因为节点提供 URL、哈希或
“verified”标签就成为可信来源。在服务端网页抓取安全边界及独立获取原文机制
完成前，不自动将外部新来源提升为 supported，也不宣称真实联网研究已闭环。
私有/敏感研究及跨角色 localOnly 的外部执行保证不在首期范围内，直接拒绝。

## 10. SDK、管理与未覆盖能力

提供 Node.js 24 的 SDK 和 CLI：pair、status、run。SDK 将领取、续租、退避、
取消通知及幂等结果封装起来；具体 Agent 包装器实现任务 handler。
`run` 必须显式选择内置 fixture 或事先安装的可信包装器，不从任务正文动态
加载模块或执行命令。默认 fixture 只处理固定模拟资料，不调用模型。

CLI 只在前台运行。Windows 服务、macOS LaunchAgent、自动更新、OAuth、
WebSocket 唤醒、MCP/A2A 标准协议兼容、文件上传及供应商专用包装器均不在首期。
不自动安装 Slack/Raft SDK，也不调用它们的服务。

## 11. 验收与发布边界

先本地测试：鉴权、配对复用、越权、租约竞争、过期结果、去重、取消、
撤销、重启恢复、正文/队列/连接限额、SDK 断线、证据门禁、默认关闭与旧功能回归。
HTTP 集成测试只在回环临时端口运行，数据在一次性目录，不读生产配置或凭据。
五节点模拟验收不得调用付费模型。测试通过不等于双 V100 或第三方产品已经接通。

部署、真实模型验证、真实节点凭据配置和 GitHub 发布另行明确执行。
