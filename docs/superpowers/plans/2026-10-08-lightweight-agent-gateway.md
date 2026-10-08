# Lightweight Agent Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建低资源、易管理的外部研究 Agent 接入接口，先完成本地模拟闭环。

**Architecture:** 网关与 LACK 共进程，独立回环监听与鉴权，复用现有 SQLite 依赖。
节点主动长轮询；任务、租约和事件持久化。供应商路由与外部 Agent 委派保持分离。

**Tech Stack:** Node.js 24、better-sqlite3、Node 标准库、现有 Python materializer。

**Spec:** `docs/superpowers/specs/2026-10-08-lightweight-agent-gateway-design.md`

状态：已获确认并实施网关、SDK、管理页和研究桥。本地单元/集成测试记录为 67 项通过；五节点 300 秒测量及完整应用 smoke 均通过，详细边界见 `docs/validation/2026-10-08-agent-gateway.md`。中文使用说明已补充。浏览器桌面/窄屏验收、真实包装器和生产部署尚未完成。下方原始清单保留作为逐项验收要求，不代表全部用例均已覆盖。沿用当前会话内实施方式，不创建其他任务。

## Global Constraints

- 不增加 Redis、消息代理、外部数据库、独立常驻服务或新 npm 依赖。
- 网关默认关闭；启用时显式指定回环端口和管理员凭据引用。
- 不部署、不访问真实模型、不修改生产凭据或现有系统服务。
- 首期仅公开非敏感研究，不开放任意 shell、文件或程序执行。
- 保留 Ollama 和内部 Provider 路由，不硬编码 llama.cpp / 1Cat 的地址。
- 默认 5 节点、1 个在执行网关任务、30 秒长轮询、90 秒租约、256 KiB 正文。
- 本地验证需得到授权后执行；不依据本计划自行执行生产检查或推送。

## Review Focus

- 同一时刻两个节点领取同一任务：仅一个持有有效租约。
- 结果已保存但响应丢失：重试只重放确认，不重复提交或重复生成报告。
- 节点撤销时仍有长轮询和执行任务：停止派单，晚到结果拒绝，不能声称远端已停止。
- Windows 凭据文件 ACL：不能把 POSIX mode 当作保护，不满足条件时拒绝保存。
- 恶意外部结果和伪造来源：不能绕过已有研究证据门禁，也不能访问旧网页管理接口。

## 文件结构

| 文件 | 职责 |
| --- | --- |
| gateway/protocol.cjs | 固定版本、字段白名单、体积与能力校验 |
| gateway/store.cjs | SQLite 事务、节点、任务、租约、事件、清理 |
| gateway/server.cjs | 独立 HTTP 入口、鉴权、限流、长轮询与关闭 |
| gateway/research-bridge.cjs | 内外部研究阶段调度、受限结果映射 |
| gateway/admin.html | 独立管理页，无第三方资源 |
| sdk/agent-client.cjs | 请求、领取、续租、事件、结果、退避 |
| sdk/credentials.cjs | 当前用户专属凭据保存与权限检查 |
| sdk/cli.cjs | 前台 pair/status/run；无后台安装 |
| sdk/fixtures/research-worker.cjs | 仅模拟资料的参考 handler |
| tests/gateway.test.cjs | 存储及 HTTP 边界测试 |
| tests/agent-client.test.cjs | SDK 生命周期、凭据权限测试 |
| tests/research-gateway.test.cjs | 外部研究与原证据门禁整合 |
| scripts/gateway-benchmark.cjs | 有时限、无模型的五节点模拟测量 |
| docs/AGENT_GATEWAY.zh-CN.md | 配对、管理、故障、边界和卸载说明 |
| lack.py | 默认关闭接线；研究阶段适配，不重写旧入口 |
| scripts/materialize.py / Dockerfile | 复制网关运行文件；不安装新依赖 |

## Task 1: 有界协议与持久化状态机

**Interfaces:** `createGatewayStore({dbPath, now})` 返回节点、配对、任务方法及 close。
方法：`createNode(spec)`、`pair(code)`、`authenticate(token)`、
`enqueueTask(input)`、`claimTask(nodeId)`、`renewLease(nodeId, taskId, leaseId, attempt)`、
`appendEvent(nodeId, envelope)`、`submitResult(nodeId, envelope)`、
`cancelTask(taskId)`、`retryTask(taskId)`、`revokeNode(nodeId)`、`cleanup()`。
节点 ID 和 taskId 由服务端生成；凭据只返回一次，数据库保存摘要。

- [ ] 新建协议/存储测试，使用临时数据库和可注入时间。
- [ ] 断言配对 300 秒过期、只能消费一次；旧凭据轮换后无效。
- [ ] 断言两个连接竞争仅一方领取成功；租约 90 秒后旧结果拒绝。
- [ ] 断言相同 eventId/内容重放确认，不同内容返回冲突，取消和撤销不自动重派。
- [ ] 断言所有持久化上限及重开数据库后的任务状态，秘密不出现在存储日志。
- [ ] 实现 protocol/store，遵守规格中的有界计数及 SQLite 索引。
- [ ] 授权后执行 `node --test tests/gateway.test.cjs`；要求所有断言通过。

## Task 2: 独立网关 HTTP 与长轮询

**Interfaces:** `createAgentGateway({store, adminToken, now})` 返回
`{server, enqueueTask, close}`。server 由调用方明确绑定 `127.0.0.1`。
任务入队、撤销和服务关闭都唤醒等待者；断开的连接立即释放占用。

- [ ] 测试节点不能调用 admin API、不能领取或读取其他作用域数据。
- [ ] 测试错误凭据、超大正文、重复长轮询、非法版本、跨站请求均拒绝。
- [ ] 测试 30 秒空闲 204、入队立即唤醒、断开和关闭无残留 timer/listener。
- [ ] 实现 server，数据库状态持久化后再发送确认，无原网页路由和 WebSocket 代理。
- [ ] 测试响应丢失后的结果重试，以及撤销正在等待的节点。
- [ ] 授权后执行 HTTP 集成测试，只使用回环临时端口和模拟凭据。

## Task 3: 前台 Connector SDK 和模拟节点

**Interfaces:** `AgentClient({baseUrl, token, fetch, sleep})` 提供
`manifest()`、`status()`、`claim()`、`heartbeat(task)`、`event(task,event)`、
`result(task,result)`、`run(handler,{signal})`。
handler 接收 `{task, signal, reportProgress}`，返回结构化结果，不由任务指定模块。

- [ ] 编写断线退避、90 秒租约续租、重复确认、取消 signal 和进程停止测试。
- [ ] 实现 SDK，退避最大 30 秒；禁止非回环明文 HTTP；请求不输出凭据。
- [ ] 编写 POSIX 与 Windows 专属凭据权限测试；权限失败时不保留明文文件。
- [ ] 实现 CLI pair/status/run 与 fixture，不安装系统服务、不调用真实模型。
- [ ] 授权后执行 `node --test tests/agent-client.test.cjs`。

## Task 4: 轻量节点管理页

**Interfaces:** 管理页只消费 `/admin/v1/*`，Bearer 凭据只存页面内存。
`GET /admin/v1/tasks` 和节点列表必须分页并限制返回字段。

- [ ] 测试未鉴权管理请求拒绝、暂停不再派单、取消状态与实际确认分开。
- [ ] 实现单页节点列表、一次性配对码、任务概览及撤销确认。
- [ ] 使用 textContent 渲染名称和错误，配对码不进入 URL/日志/localStorage。
- [ ] 编写中文操作文档，明确“在线”不代表模型工作正常。
- [ ] 获得浏览器验证授权后检查桌面/窄屏、过期配对、空列表和连接中断。

## Task 5: 研究桥与默认关闭接线

**Interfaces:** `dispatchResearchStage({sessionId, stage, role, input, deadlineAt})`
返回 `{status, output, provenance}`。内部 role 字符串继续走现有 Provider；
`{kind:'external',nodeId}` 走网关，不解释为模型名或任意 URL。
桥只接受研究协议支持的三个 stage，不开放通用工具入口。

- [ ] 编写默认关闭、缺少管理员凭据、端口冲突不影响旧服务的测试。
- [ ] 编写外部 verify/summarize 回到原门禁的测试；伪造 quote、claimId 被拒绝。
- [ ] 编写外部 retrieve 来源保持 unverified、敏感/localOnly 外部任务拒绝的测试。
- [ ] 实现 research-bridge、lack.py 最小接线和 runtime 文件复制。
- [ ] 确保 materializer 保留旧配置，容器数据目录无需新增宿主挂载。
- [ ] 授权后执行 `node --test tests/*.test.cjs`；所有旧 Provider/研究用例仍通过。

## Task 6: 五节点模拟验收和资源报告

**Interfaces:** benchmark 使用临时 SQLite、回环随机端口和 fixture handler。
命令 `node scripts/gateway-benchmark.cjs --nodes 5 --duration-seconds 300`。
到期终止自身客户端并关闭网关，不访问现有端口或进程。

- [ ] 先编写有时限、异常清理与资源采样测试，再实现 benchmark。
- [ ] 经授权测量五节点空闲请求数、CPU、RSS 增量、数据库和 WAL 增长。
- [ ] 注入断线、重复结果、重启恢复，核对任务计数与结果去重。
- [ ] 对照 RSS 增量 32 MiB 和约 10 次/分钟空闲领取的待测目标，如实报告偏差。
- [ ] 更新交付记录，区分本地模拟通过、真实模型未测、VPS 未部署、第三方包装器未接入。
- [ ] 部署和 GitHub 同步单独安排，不在压测脚本中夹带这些动作。

## 完成定义

网关代码、SDK、管理页、中文说明及离线测试全部交付才算本期完成。
只有接口文档或模拟节点不能称为真实 muse.ai/dots 接通。
不得以关闭权限检查、扩大公网暴露或提高生产资源限制来让验收通过。
