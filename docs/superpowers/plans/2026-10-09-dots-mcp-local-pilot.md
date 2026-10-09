# dots MCP 与事件本地验证 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在本机验证受限 MCP 工具、事件订阅及通知、任务和截图回传，不连接 OpenAI 或真实 dots。

**Architecture:** 私网侧适配器复用现有 store / artifacts，固定认证主体映射试点节点。事件与工具共同服务于公开单任务；MCP 门面不包含模型推理或电脑自动化。dots 真正操作自己的云端电脑属于之后的真实验收。

**Tech Stack:** Node.js 24、CommonJS、内置 HTTP/HTTPS/DNS/crypto、现有 better-sqlite3、node:test；不安装 tunnel-client，不引入 Redis。

**Spec:** ../specs/2026-10-09-private-cloud-agent-pilot-design.md。

## Global Constraints

- MCP Events 目标协议为 2026-07-28；按官方 server/discover、events/list / subscribe / unsubscribe、tools/list / call 契约验证，不把本地 JSON-RPC 测试当官方产品兼容验收。
- 默认不监听；本地入口仅 loopback 随机端口，测试回调也仅 loopback，真实部署仅私网出站隧道。
- public scope、固定公开网页、单执行槽、5 分钟截止、90 秒租约不变。
- 不读真实密钥、不创建真实订阅、不登录、不入网、不改 VPS。
- 事件 HTTP 2xx 只记录通知接收，不自动完成任务或授予新权限。

## Review Focus

- MCP 工具参数中的 nodeId / scope / URL 不能扩大服务端绑定授权（Task 1）。
- 大截图分块上传必须有总量、顺序和过期上限，不能以分块绕过 2 MiB 限制（Task 2）。
- 回调 DNS 重绑定、IPv4-mapped IPv6 和重定向不能进入私网（Task 3）。
- 重启、重复事件或回调 2xx 不应重跑电脑任务，也不能误报 succeeded（Task 3/4）。
- 撤销权限后，已保存订阅与未完成附件上传必须停止（Task 2/3）。

## Task 1: 受限 MCP 工具门面

**Files:** Create integrations/mcp/pilot-server.cjs; Create tests/pilot-mcp.test.cjs; Modify gateway/store.cjs (仅增加指定任务领取原语，如现有 claim 无法安全选任务)。

**Interfaces:** createPilotMcp({store, artifacts, resolvePrincipal, events}) -> {handleRpc}。resolvePrincipal 从认证连接映射固定 nodeId/public scope；HTTP 包装仅接受 POST /mcp，拒绝未认证、任意路径和跨站 Origin。

工具：pilot.read_task({taskId})、pilot.claim_task({taskId})、pilot.heartbeat({taskId,leaseId,attempt})、pilot.submit_result({envelope})。read_task 不泄露节点密钥、其他任务/项目；claim_task 立即返回指定任务或空，不采用 30 秒 HTTP 长轮询，也不能先领到别的任务再拒绝。必要时 store 新增 claimPilotTask(nodeId,taskId)，复用同一全局执行槽和租约逻辑。

- [ ] 写并运行失败测试：协议发现、工具 schema、认证绑定、指定任务、安全空结果；跨节点/额外 scope/任意工具拒绝。
- [ ] 实现上述接口，严格字段列表，JSON-RPC 错误不输出秘密、路径或堆栈；限制 JSON 256 KiB。
- [ ] 运行 node --test tests/pilot-mcp.test.cjs tests/gateway.test.cjs tests/pilot-store.test.cjs，通过后提交。

## Task 2: MCP 截图传输与租约

**Files:** Create integrations/mcp/artifact-upload.cjs; Modify integrations/mcp/pilot-server.cjs; Create tests/mcp-artifact-upload.test.cjs。

**Interfaces:** createArtifactUpload({store, artifacts, now}) -> {begin, chunk, finish, discardExpired}。

begin 绑定 node/task/lease/attempt/contentType，返回随机 uploadId；chunk 只接受规范 base64、连续序号、最多 64 KiB 解码数据；finish 用 artifacts.put 检查最终图像和租约，返回 artifactId。一个任务一个在途上传，总计最多 5 个 / 10 MiB，上传有效期不超过当前租约且最长 90 秒；禁止任意 URL、调用者路径。分块状态仅内存，重启后明确失效，不能虚报持久成功。节点失效时释放缓存。

- [ ] 写并运行失败测试：真实 PNG/JPEG 逐块上传、重复同块幂等、不连续/冲突块拒绝、2 MiB+1 字节拒绝、额外 base64 垃圾拒绝、跨节点/租约/撤销/重启拒绝。
- [ ] 实现受限缓存；finish 之后复用基础结果验证，不自动人工验收。
- [ ] 运行 node --test tests/mcp-artifact-upload.test.cjs tests/pilot-artifacts.test.cjs tests/pilot-result.test.cjs，通过后提交。

## Task 3: 持久事件订阅与安全出站交付

**Files:** Create integrations/mcp/events.cjs; Create integrations/mcp/webhook-transport.cjs; Create tests/mcp-events.test.cjs; Create tests/webhook-transport.test.cjs。

**Interfaces:** createPilotEvents({dbPath, encryptionKey, authorize, transport, now}) -> {list,subscribe,unsubscribe,publish,deliverDue,close}。encryptionKey 必须是独立注入的 32 字节密钥；仅本地测试生成临时 key，不读取/创建真实凭据。订阅 secret 使用 AES-256-GCM 加密保存，日志不含 callback/secret；SQLite 文件需平台权限保护。

只支持 pilot.task_ready，过滤固定 node + task + public。subscribe 根据认证主体、回调 URL、事件名和规范过滤器生成稳定 ID；ttl 默认 5 分钟、最多 5 分钟，拒绝无期限；最多 5 个订阅和 100 个通知。先签名发送一次性 30 秒挑战，必须 2xx 且常量时间比较 challenge 才激活。验证缓存最多 30 秒，更新 secret 必须重验证；首轮无需长周期轮换，两条路线不共享凭据。

publish 仅发送 taskId、taskType、deadlineAt；签名为 Standard Webhooks HMAC-SHA256，精确覆盖 eventId.timestamp.body，使用 whsec_ 的规范 base64 密钥（解码 24-64 字节）。签名对照官方示例测试，不安装新库。事件 ID 跨通知重试保持，最多 3 次、延迟 1/2 秒；410/413 不重试。过期任务/订阅、取消或撤销后停止交付。

createWebhookTransport({allowedHosts,lookup,ca,timeoutMs=10000}) 固定 HTTPS、端口 443、显式回调主机白名单；每次连接解析并验证所有地址，任一非公开地址即拒绝，再固定连接已验证地址并保留原 hostname 的 TLS 校验；拒绝重定向，响应最多 256 KiB。生产允许目标需独立核对，不凭文档示例猜测域名。

本地回调测试使用专门注入的 TLS receiver / 测试 transport；生产地址策略不可用 testMode 放宽。验证纯地址策略与真实本地 TLS 连接分开，不向公网发送任何测试请求。

- [ ] 写并运行失败测试：挑战失败/过期/签名错误、跨主体取消、idempotent subscribe、加密重启恢复、错误 key 拒绝、重复事件、2xx 不改任务状态、410/413 不重试。
- [ ] 加入 IPv4/IPv6、mapped 地址、DNS 重绑定、重定向、无效证书、回调超时、撤销后待投递停止测试。
- [ ] 实现订阅/投递模块，授予权限不来自事件正文；默认不会自行启动后台循环。
- [ ] 运行 node --test tests/mcp-events.test.cjs tests/webhook-transport.test.cjs，通过后提交。

## Task 4: 本地完整模拟和真实接入说明

**Files:** Create scripts/dots-mcp-local-pilot.cjs; Create tests/dots-mcp-local-pilot.test.cjs; Create docs/DOTS_PRIVATE_COMPUTER.zh-CN.md。

**Interfaces:** 模拟订阅端收到签名事件后，走真实本地 MCP HTTP 请求领取任务、分块提交 synthetic_fixture 截图和结果。它是 mock_dot，不是玄玑；不能声称调用过真实电脑。

- [ ] 先写脚本失败测试，断言 event_received、task_claimed、artifact_saved、result_recorded 且 dotsAgentVerified=false；重复通知不重复执行；关闭订阅后不再派单。
- [ ] 实现专属临时状态与完整清理，不调用模型、云端接口或 tunnel-client。
- [ ] 运行独立脚本、node --test tests/*.test.cjs 和 node tests/smoke.cjs；记录实际计数和边界。
- [ ] 形成真实接入说明，注明账号 MCP/Tunnel/Events 权限、隧道关联、凭据安全配置、单任务授权、截图回传能力和撤销步骤；仅同步开发分支。

## 真实接入验收

真实入网和单次订阅须用户具体批准。玄玑实际操作 example.com 的浏览器活动、公开截图、正确 task/challenge 和 ChunLACK 保存结果缺一不可。截图如果无法由实际 dots 工具传回，标记 evidence_transfer_blocked，不用模拟脚本替代。不开放公网端口、不修改旧凭据，不将官方组件能力等同于账号已可用。

来源：[MCP Events](https://developers.openai.com/plugins/build/mcp-events)、[Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)，2026-10-09 核对。
