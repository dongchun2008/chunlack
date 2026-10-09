# Muse 私有代理运输 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在本机验证 Muse 代理运输和仅限试点节点的 HTTPS 门面，不入网、不调用 Muse。

**Architecture:** 显式 HTTP CONNECT 代理运输注入既有 AgentClient。独立门面复用既有 store 的节点认证和租约，不开放管理 API、不改原 gateway/server.cjs 的 loopback 绑定。真实端部署与入网在本地验证后单独授权。

**Tech Stack:** Node.js 24、CommonJS、node:http / https / tls、node:test、现有 SQLite；无新增依赖。

**Spec:** ../specs/2026-10-09-private-cloud-agent-pilot-design.md；公共基础见 ../../CLOUD_AGENT_FOUNDATION.zh-CN.md。

## Global Constraints

- 本地测试所有监听只在 127.0.0.1 随机端口；不开放公网、不安装、不读取真实凭据。
- 仅 browser.public_read、public scope、固定 https://example.com/；5 分钟截止、90 秒租约、1 执行槽不变。
- 固定代理与固定 HTTPS 目标；不得直连 fallback、跟随重定向或关闭 TLS 校验。
- 代理通道通过不等于 Muse Agent 被触发；不得用 synthetic_fixture 声称真实执行。
- 正式监听地址、TLS 证书、ACL、入网与目标审批均在真实阶段确认，本计划不配置。

## Review Focus

- 代理拒绝/连接失败时目标未收到任何直连请求（Task 1）。
- TLS 证书错误必须终止，不接受环境变量禁用证书验证（Task 1）。
- 转发路径编码、重复头和任意 Host 不能绕过管理/配对拒绝（Task 2）。
- 节点带有额外研究/私有 scope 时不能通过试点门面领取其他工作（Task 2）。
- 截图上传断连、超限或取消后，不保存成功结果或失控临时文件（Task 2/3）。

## Task 1: 显式代理运输

**Files:** Create sdk/transports/muse-proxy.cjs; Create tests/muse-proxy.test.cjs; Create tests/fixtures/pilot-tls-cert.pem and pilot-tls-key.pem (仅本地测试专用，非生产凭据)。

**Interfaces:** createMuseProxyTransport({proxyUrl, targetOrigin, ca, timeoutMs=40000}) -> fetch-compatible async transport(url, options) returning Response。

代理仅允许 http / https；targetOrigin 必须 HTTPS，无路径、查询或用户信息；每次请求必须同一 origin。固定 CONNECT 目标，目标 Authorization 只在 TLS 隧道内发送，不能进入 CONNECT 请求。ca 是显式测试/部署信任链，不是关闭验证的开关。输入 URL 和头不写入错误消息。

- [ ] 先写并运行失败测试：真实本地代理 + TLS 目标，请求经过 CONNECT；403/超时后不直连；目标 TLS 不受信任拒绝；AbortSignal 关闭连接；目标 origin 改变拒绝。
- [ ] 实现运输：响应最多 2 MiB、上传最多 2 MiB；控制请求为 256 KiB；超限断开；不启用自动代理环境变量或自动重试。
- [ ] 运行 node --test tests/muse-proxy.test.cjs，通过后提交本任务范围。

## Task 2: 仅节点 HTTPS 门面

**Files:** Create gateway/node-facade.cjs; Create tests/node-facade.test.cjs。

**Interfaces:** createPilotNodeFacade({store, artifacts, tls, allowedNodeIds}) -> {server, close}。测试绑定 loopback；真实监听地址必须由后续受审部署入口验证，不提供默认公网绑定。

这次采用 store 层复用，而非 HTTP 透传：新门面没有任意上游字段，不转发用户 Host，也不更改旧网关。它与任务/附件模块使用同一 store 对象，防止结果验证器在两个 store 实例间丢失。此调整只改变外围运输，不创建第二套队列。

允许：安全 GET /health；带节点 Bearer 的 manifest / status / heartbeat；POST /v1/tasks/claim（立即返回任务或 204）；当前租约续期、事件、结果；POST /v1/pilot/tasks/:taskId/artifact（原始 PNG/JPEG，元数据为严格限定的头字段）。没有远程附件下载、配对、创建任务或管理接口。

allowedNodeIds 为空时拒绝启动；节点必须仅声明 browser.public_read 和 public scope。路径使用明确的正则 allowlist，拒绝百分号编码、查询凭据、Origin 和重复 Authorization；taskId 从路径核对。心跳与结果复用 store，不接受调用者身份参数。截图原始 body 最多 2 MiB，上传头只含 leaseId/attempt/eventId/contentType，均严格验证。

- [ ] 写并运行失败测试：真实 HTTPS、安全健康路径、无认证拒绝、管理/配对/任意路径拒绝、非允许节点拒绝、错误 scope/能力拒绝、错误任务归属拒绝。
- [ ] 加入超大 body、编码绕过、重复认证、客户端断连、失效租约测试。
- [ ] 实现固定端点与资源上限（最多 16 连接、40 秒请求、10 秒头超时），close 释放请求与端口。
- [ ] 运行 node --test tests/node-facade.test.cjs tests/gateway.test.cjs tests/pilot-*.test.cjs，通过后提交。

## Task 3: 真实本地传输闭环与报告

**Files:** Create scripts/muse-transport-local-pilot.cjs; Create tests/muse-transport-pilot.test.cjs; Create docs/MUSE_PRIVATE_TRANSPORT.zh-CN.md。

**Interfaces:** 脚本启动专属临时 SQLite、附件目录、本地 TLS 门面与 CONNECT 代理；创建仅公开试点节点，用显式运输领取一次任务、上传 synthetic_fixture、回传结果并收到确认；所有配置及密钥是临时测试数据，无真实账号。

- [ ] 写并运行脚本失败测试，断言 proxy_verified=true、museAgentVerified=false、人工验收未发生、取消/越权拒绝、所有监听关闭与临时文件清理。
- [ ] 实现脚本，不在脚本中加入模型调用或浏览器执行伪装。
- [ ] 运行独立脚本、node --test tests/*.test.cjs 和 node tests/smoke.cjs。
- [ ] 记录实际测试结果、限制和真实接入步骤；仅同步开发分支，不部署。

## 本地通过后的真实接入门槛

用户批准私网目标、节点身份、单一服务端口 ACL、HTTPS 信任链和 Muse 审批后才做一次安全读探测。平台待审批时停止，不重复触发。transport_verified 仍不等于 muse_agent_verified；原生 Muse Agent 触发接口缺乏依据时明确保留未验证，不宣称全部接通。
