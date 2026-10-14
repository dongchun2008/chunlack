# Muse / dots 接入说明

## 当前优先路线：私有部署、公网 HTTPS 接入

本节优先于下方历史私网、Slack 和 Gadgets 路线。用户已选择公网 HTTPS
方案；“私有部署”指 ChunLACK、工作区、权限和数据由用户自行管理，不代表
所有外部连接必须使用 VPN。Slack、Raft 只作产品设计参考，Open WebUI 不接入。

截至 2026-10-14，新候选公网 HTTPS 与真实 Pocket ID 登录已通过验收，旧
LACK 和 Relay 保持原状；网页已创建直接 1Cat 验收助手并取得模型回复。
自动反思、额外追问及点名路由修复已通过本地全量 600/600 和 Linux 隔离
专项 31/31，代码已同步，但尚未更新候选后端或完成修复后的真实页面复验。
专项测试不等于完整 Linux 或真实外部 Agent 验收。
Muse/dots 真实账号连接与原生电脑任务闭环仍未通过，下面不是已经接通的承诺。
详见 [当前交付状态](DELIVERY_READINESS_2026-10-11.zh-CN.md) 和
[真实登录验收](verification/2026-10-13-approved-candidate-staging.md)。

### 三个入口分开使用

| 对象 | 入口与用途 | 不代表什么 |
| --- | --- | --- |
| 真人用户 | `https://lack.chunclaw.top`，登录、选择工作区、派单与验收 | Pocket ID 登录不自动授予所有者权限 |
| 外部 Agent | `https://agents.chunclaw.top`，使用专属授权访问受限任务接口；MCP 路径为 `/mcp` | 不能使用真人 Cookie、Pocket ID 的 ID token 或全局管理凭据替代节点授权 |
| 模型服务 | 在 ChunLACK 中配置独立 Provider、模型和工作区授权 | 模型 API 不是 Muse/dots 的原生电脑执行接口 |

公网方案不要求在 Muse 或 dots 云端电脑安装 Tailscale，也不要求使用 Secure
MCP Tunnel。当前账号能否添加对应认证方式的自定义连接器、能否自动触发
Agent，仍须分别实测；有 `/mcp` 服务不等于供应商账号已接受连接。

### 当前认证与探测边界

- 无凭据的 GET `/v1/manifest` 与 POST `/mcp` 已实测返回 401，只证明请求到达拒绝路径，不证明认证后调用成功。
- `/mcp` 不是浏览器网页：当前只接受 POST。GET `/mcp` 返回 404，不能据此判定服务不存在。
- 外部 Agent 域名的公网白名单不提供 GET `/health`。不要照搬内部节点门面的健康路径；该路径本次实测返回 404。
- 现有 MCP 使用专属节点 Bearer 认证；Agent OAuth 资源认证、受保护资源发现及对应认证挑战尚未就绪。若供应商连接器只接受 OAuth，应停止在能力确认阶段，不能填入真人 Cookie、ID token 或管理密钥绕过。
- 线上入口配置与当前模板渲染哈希存在尚未解释的差异，不自动重渲染或覆盖。真实账号授权、工具发现和原生执行必须另行验收。

证据见 [外部入口只读检查](verification/2026-10-14-external-agent-ingress-readonly.md)。

### Muse 老镇与 dots 玄玑分别如何验收

1. 先完成正式 HTTPS、真人账号与工作区授权，再由所有者分别登记专用试点
   节点。首轮仅授权 `browser.public_read` 和 `public`，不授予 shell 或私人文件能力。
2. 老镇使用该账号受支持的自定义连接器/API/MCP 方式配置；玄玑使用该账号
   受支持的自定义 MCP 方式配置。认证是否兼容、工具是否可见、授权是否可
   撤销都要实际验证。不可用时记录阻碍，不用普通 worker 代替。
3. 各自完成工作区绑定的安全配对/授权。一次性配对信息、节点令牌和 OAuth
   凭据只进入批准的安全配置渠道，不粘贴到普通对话或工作区频道。
4. 由你在 ChunLACK 的“节点”面板发起一次“公开浏览试点”。每个 Agent
   单独领任务，使用自己的云端电脑打开 `https://example.com/` 并截图。
5. 核对 taskId、随机校验码、网址、标题、执行时间、截图、原生电脑活动记录
   及 ChunLACK 保存的回执。负责人查看证据后，另行点击人工验收。
6. 若首次通过人工通知才开始执行，只能标为“人工触发闭环通过”；自动接单
   还需要单独证明受支持的事件/订阅能唤起该 Agent。HTTP 2xx 不是执行完成。
7. 完成取消、超时、重复提交、暂停/撤销检查后，才能确认该节点可用于相应
   范围的任务。断线或取消请求已发送不代表远端已经停止。

完整页面流程见 [公开浏览试点](public-node-task-pilot.md)。两个 Agent 的结果
分别记录，不能用一个通过推定另一个通过。当前均未达到真实接通验收。
五个节点登记不代表五个任务并发；初始共享执行槽仍为一个。

## 2026-10-09 私有云端电脑接入方向更新

本节是早期私网方案记录，当前公网路线以上文为准。Slack 和 raft.build 仅作为产品设计参考，不是接入依赖；不推进 Slack 桥接。Muse Gadgets 设备路线与 Muse 云端电脑路线不同，不能把前者的蓝牙要求套用到后者。

用户提供的 Muse 帮助原文明确：其 tailscale 是平台封装命令，不是上游 CLI；私网通过运行环境外的 3130 HTTP 代理访问，只出站、TCP、不接受入站。不要自行安装 tailscaled。首次目标访问需要用户批准，批准可能覆盖同一地址的其他端口，因此必须另设私网服务级访问限制。运行时替换后的身份保留和自建程序恢复尚未验证。

用户提供的 dots 输出只确认命令环境具备 Node/Python，工作目录权限检查可写、三次公开 HTTPS 请求成功；不能确认该环境就是持久云端电脑，也不能确认长期运行。目标是当前 dot 接到任务后实际操作自身云端电脑，不是 worker 代替 dot 执行。

[MCP Events](https://developers.openai.com/plugins/build/mcp-events) 官方说明支持 dots，要求 MCP 2.0、持久订阅存储及出站 webhook；[Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) 提供私网侧出站连接，不需要私有服务公开监听。但当前账号权限、隧道与事件组合、真实电脑执行及结果回传均待验证。MCP 隧道不赋予浏览器通用私网访问，云端接入仍意味着选定任务数据进入供应商系统。

2026-10-09 当前状态：公共基础、Muse 显式 TLS CONNECT 运输、受限 HTTPS/REST/OpenAPI 门面、dots MCP / Events、受限截图上传和 SDK 指定任务能力均已在开发分支实现。本轮完整测试 139/139 通过，HTTP/WebSocket/SQLite 冒烟和两个独立本地试点通过。真实云端 Agent 闭环、正式私网部署与凭据集成仍未完成。使用入口见 [当前交付清单](CLOUD_AGENT_DELIVERY_2026-10-09.zh-CN.md)、[SDK 说明](SDK_PUBLIC_PILOT.zh-CN.md)、[Muse 运输](MUSE_PRIVATE_TRANSPORT.zh-CN.md) 和 [dots 云端电脑](DOTS_PRIVATE_COMPUTER.zh-CN.md)。本地测试通过不代表已部署、入网或真实云端电脑已执行。

Muse 的名称是老镇；初心是用户在中转消息中的签名，不是另一个 Agent。dots 的玄玑需要以真实事件和电脑活动单独验收。本项目不会把编程会话交给 dots。

## 历史路线资料

以下 2026-10-08 的说明保留为历史背景，其中“未实现”表示当时状态，不能用于判断当前接口。Slack 不再作为接入目标；Gadgets token 不用于云端电脑连接，也不替代 ChunLACK 节点令牌。当前以以上更新和交付清单为准。

核对日期：2026-10-08。Muse 指 muse.ai 的 Meta Muse；dots 暂按 OpenAI ChatGPT dots 理解。如果指其他同名产品，需要确认产品地址。

## 当前边界

ChunLACK 已有带配对、租约、取消和权限边界的节点协议与 Node.js SDK。Open WebUI worker 是真实模型适配器。通用 SDK 不等于官方产品适配器：目前没有注册 Muse Connector，也没有实现 dots 专用派单 API 或 MCP 服务。

本轮不开放公网端口，不调整 VPS 服务，不更换凭据。保留 Ollama 与供应商中立路由。

| 方向 | 作用 | 状态 |
| --- | --- | --- |
| LACK -> 外部节点 -> Agent | Agent 领取研究任务并回传结构化结果 | SDK 已有，产品专用适配待实现 |
| Muse / dots -> LACK 工具 | 云 Agent 查询或操作 LACK | 官方 Connector / MCP 门面未实现 |
| LACK -> 模型 API | 模型生成回答 | 不等于调用完整 Muse / dots Agent |

## Muse 官方路径

官方 Connector Platform 要求提交端点、认证、scope、API 或 MCP 工具说明、测试账户和演示，经过审核。工具应标明读、写、敏感写；敏感写每次审批。获批连接器才进入发现入口。参考：[Muse Connector guidelines](https://muse.ai/platform/docs)。

我们的最小设计建议：先提供只读任务状态和带来源研究结果查询门面，再考虑审批后的任务创建。这些不是已上线接口。当前私有网关不能直接作为 Muse Connector：云端可达性、认证隔离和审核都未完成。不得直接公开管理 API。

如果希望 LACK 主动把工作交给 Muse，需要确认受支持的执行入口并实现受限 worker。不能从 Connector 文档推断存在 Muse 自动派单 API，也不能把 Meta 模型推理 API 当作 Muse Agent API。

## OpenAI dots：人工监督接入

官方支持通过 ChatGPT 桌面端连接自己的电脑；授权后 dot 可以创建本地 Work / Codex 任务并使用本地 skills。确认 Allow access 后启用，Revoke access 可撤销。参考：[Getting started with your dot](https://help.openai.com/en/articles/20001530-getting-started-with-your-dot)。

1. 在有 ChunLACK checkout 的 Windows / Mac 上完成官方电脑授权，先检查文件访问范围。
2. 给 dot 明确的本地 Work / Codex 任务，让它阅读本说明和 Open WebUI 节点说明。
3. 首次仅让它读取脱敏报告，由你核对结论、来源和缺证标记。不要把密钥文件放进可访问的项目范围。
4. 不允许 dot 自行部署、公开服务、安装守护进程或更换密钥。
5. 自动领取 LACK 任务仍需专用执行适配。本轮资料未确认公开 dots 派单 REST API；ChatGPT 订阅不是模型 API key。

这是官方电脑授权与本地任务的人工监督组合，不是已验证的 dots 自动派单。提示词禁止访问凭据并不是文件隔离，应同时限制实际权限。

首次任务示例：

```text
在本机 ChunLACK 项目中阅读接入文档，只读取脱敏测试报告。
总结哪些研究结论已有原始来源，哪些缺证。
不要读取 localapikey.txt 或 connector.json，不部署、不修改服务。
输出结论、来源 URL 和缺证标记，等我确认。
```

## 自动协作验收门槛

1. 产品专用、已审阅的 handler，只声明实际支持的 research.verify / research.summarize 与 public scope。
2. 一次性配对；节点密钥与模型密钥分开保存，不给云 Agent 发送密钥。
3. 保留 claimId、sourceId、原始 URL、精确引文；缺证返回 insufficient_evidence。
4. 拒绝未知工具、任意命令、编造来源和重复执行；验证撤销、取消、超时及错误处理。
5. 真实产品任务闭环后才标记“已接通”。

资源策略：沿用轻量队列与一个并发执行槽，不引入额外 Redis、消息代理或 GPU 服务。五个节点在线不代表五个任务同时生成。

## 2026-10-09 补充：Muse Gadgets 是另一条路径

用户已有 Muse Gadget SDK token。本机仅确认文档目录下 muse_gadgets_sdkkey.txt 存在，没有读取、打印或提交密钥。token 不是模型 API key，也不是 Muse Connector Platform 的应用凭据。

官方 [Linux Device SDK](https://github.com/facebookincubator/muse-gadget-sdk/tree/main/linux) 提供设备配对、消息发送以及设备命令；它不等于已实现的 LACK 同步模型接口。Linux 节点需要 Bluetooth LE，并在 Muse 手机应用的 Settings > Devices 启用 Developer mode 完成配对。

重要风险：官方默认命令包含 system.run、file.read、file.write。Muse 获得安装账户的权限，如果该账户可以 sudo，Muse 也可以。因此不能直接将默认 SDK 安装到现有 VPS 的 root 账户，也不能仅靠提示词声明来限制 shell。

建议的新适配范围（待用户确认，不是已实现功能）：隔离 Linux 节点，专用无 sudo 账户，修改执行器使其只允许有限研究任务与状态操作；禁止默认 shell 和任意文件访问。研究结果仍通过 LACK 的来源与引文校验，发送聊天消息不作为任务成功证据。设备云会话、任务关联、超时、取消和恢复必须实际验证后才交付。

参考 [SDK token 使用条款](https://gadgets.muse.ai/sdk-terms)：个人、非商业用途，限自己的 Muse 账户；SDK 为实验性、非受支持产品。不得用个人 token 构建访问其他人 Muse 数据的共享服务。这里建议的隔离限制只是待验证设计，不声称已经有效实施。

### dots 的 Slack 入口意味着什么

官方 [dots 入门说明](https://help.openai.com/en/articles/20001530-getting-started-with-your-dot) 确认可以在桌面端配置 Slack 消息通道。看到连接入口说明产品有此功能，不证明你的账户已完成授权、能实际回复或 LACK 已接通。

区分三个验收层级：

1. 官方功能：dots 可以连接 Slack。
2. 账户连通：在专用测试会话发送一条无敏感数据的消息，收到本人 dot 的回复，确认会话身份与权限。
3. LACK 自动协作：还需要 LACK 的 Slack 适配、任务关联、可靠结果回传、取消及权限校验。本项目尚未实现这层。

不要将普通 @ChatGPT 企业 Slack 助手、Codex Slack 集成和自己的 dot 视作同一套认证或执行入口。也不要未经产品支持确认，就假设另一个 Slack bot 发出的消息一定会触发 dot。

首轮推荐人工监督 Slack 对话；自动桥接方案必须在该账户实测后再设计，避免消息循环、重复派单或把无依据聊天回复当作已核验结论。
