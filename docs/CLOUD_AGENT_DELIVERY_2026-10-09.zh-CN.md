# ChunLACK 接入交付清单

日期：2026-10-09。范围：已批准的公开云端电脑单任务试点。

## 当前交付结论

本地协议与 SDK 可以交付用于隔离试点；尚未达到 Muse/dots 真实节点直接投入持续使用的条件。不能把本说明当作 VPS 发布完成、真实账号已接通或全部平台能力已经验收的证明。

| 能力 | 已实现与已测试 | 尚缺环节 |
| --- | --- | --- |
| Muse 老镇接入 | TLS CONNECT、固定 HTTPS 目标、节点鉴权、REST/OpenAPI、任务读取/精确领取、原始截图上传与结果回传 | 安全凭据代理是否兼容 3130 通道、真实私网访问和原生 Agent 执行 |
| dots 玄玑接入 | MCP 工具、持久事件订阅、签名验证、受限回调、分块截图和任务结果回传 | 账号 Tunnel/Events 权限、真实订阅与浏览器执行、实际截图传输 |
| 既有通用节点 | SDK 旧 API 保持兼容，配对、权限、租约、取消和幂等测试通过 | 每台 Windows/Mac/Linux 的受信任 handler 和实际运行验收 |
| 模型服务 | 既有供应商中立路由、Ollama 和 OpenAI-compatible 相关测试回归通过 | 本轮未重新验证双 V100、DGX Spark 或 Open WebUI 的真实模型调用 |

DGX Spark、Windows、Mac 是设备；模型 API 是推理服务；真正领任务、使用工具、交付结果的程序才是 Agent 节点。通用 SDK 不自动把设备或模型变成完整执行 Agent。

## 已完成验证

完整 `node --test --test-reporter=spec tests/*.test.cjs`：139 通过、0 失败、0 取消、0 跳过，退出码 0。

`node tests/smoke.cjs`：真实本地 HTTP/WebSocket、两个模拟模型后端、SQLite 重启持久化、私有绑定和配置保留通过，退出码 0。

`node scripts/muse-transport-local-pilot.cjs`：proxyVerified=true，取消上传及管理接口拒绝，清理完成；museAgentVerified=false。

`node scripts/dots-mcp-local-pilot.cjs`：签名事件、MCP 领取、附件和结果留存、去重与取消订阅通过，清理完成；dotsAgentVerified=false。

新增 SDK 测试包含真正的本地 TLS/CONNECT 请求和有效 PNG 测试图片。上传确认丢失后沿用事件编号、保留图片字节副本、最多三次尝试；取消拒绝不重试。先前测试错误是把 boolean false 与 numeric 0 比较，现已修正并通过完整复验。

## 使用与真实接入顺序

1. 在已有 Node.js 24 和项目依赖的隔离开发环境运行上述命令；不要运行到生产状态目录，不使用真实密钥进行模拟测试。
2. 已有授权执行程序按 SDK 说明读取指定任务、精确领取、续租、上传真正执行产生的截图、提交结果。领取返回 null 时停止，不换领其他任务。
3. 为真实试点确认 VPS 私网 IP/域名、受信任 HTTPS 证书、仅服务端口的网络限制以及独立公开试点节点。不复用管理权限，不公开现有管理 API。
4. Muse 使用平台支持的客户端私网通道；不安装 tailscaled，不让 Agent 复制节点密钥进聊天或代码。先验证凭据放置及代理通道兼容性，无法证明时停止，不改用明文 token 绕过。
5. dots 使用私网侧 Secure MCP Tunnel 和受限 MCP 服务；核对账号权限、组织/工作区关联、真实回调主机及可用截图回传方式后，才建立一个有期限的任务订阅。
6. 两个 Agent 分别领取唯一编号的单个 example.com 任务，实际打开自己的云端浏览器，读取标题并截图，回传任务编号、随机校验码、执行时间与活动证据。
7. 人工核对浏览器活动、截图与服务端记录；通过后才标记 accepted。测试完成取消试验订阅、停止额外服务并核对原有服务健康。

## 不能省略的验收条件

- 收到 webhook 2xx 只是通知收件，不是 Agent 完成任务。
- `evidence_checked` 只是结构和存储证据校验，不是人工验收。
- 模拟图片、服务端抓网页或模型回答不能代替真实云端电脑操作。
- 任一真实通道受阻，记录具体原因，禁止降级到公网、跳过 TLS 或换成 worker 冒充原生 Agent。
- 本轮执行槽为 1、租约 90 秒、任务截止最多 5 分钟；五台在线不等于五项任务并发执行。
- 生产还须验证进程恢复、私有数据隔离、权限撤销、清理、备份与回滚；本地临时状态清理不能证明生产生命周期可靠。
- 本轮不部署、不改凭据、不开放公网端口，不影响现有 Tailscale relay 服务。

## 官方路径与证据边界

Meta 公开说明支持让 Muse 创建自定义连接器并使用安全凭据存储，但没有据此证明本账号的凭据代理能够穿过 3130 私网通道：[Muse Connectors](https://www.meta.com/help/artificial-intelligence/1687253048996149/)。内部 CLI 与代理细节来自用户和 Muse 提供的说明，并非本轮直接读取官方内部文件。

OpenAI 官方文档确认 dots 可使用 MCP Events，且订阅与事件触发受工作区控制：[MCP Events](https://developers.openai.com/plugins/build/mcp-events)。

Secure MCP Tunnel 的客户端运行在能访问私有 MCP 服务的环境内，通过出站 HTTPS 工作；需要隧道身份、运行凭据以及组织与工作区权限：[Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)。以上组件支持不等于当前账号已经具备权限或已完成真实接入。

正式私网启动入口、Muse 安全凭据适配、真实账号配置与持续运行仍属于下一阶段，不能把现有本地模拟入口直接当生产启动脚本。
