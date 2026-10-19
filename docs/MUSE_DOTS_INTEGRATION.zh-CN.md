# Muse / dots 接入说明

## 当前路线和状态（2026-10-20）

私有部署采用公网 HTTPS：平台、数据和授权由你管理，外部 Agent 通过受保护接口协作。Slack、Raft 只作设计参考；不依赖 Open WebUI，不要求为这条公网路线安装 Tailscale 或 Secure MCP Tunnel。

当前发布 `44af1d844a81` 已通过受控发布及服务端复核，保留 552 文件的一致性备份和旧版本。实际中断 33 秒。见[发布验收](verification/2026-10-20-mcp-release-acceptance.json)和[使用手册](USER_GUIDE.zh-CN.md)。本次发布后真人浏览器登录尚未复验；内置浏览器附着超时不可解释为网站故障。

| 对象 | 入口或状态 | 边界 |
|---|---|---|
| 真人 | https://lack.chunclaw.top/ | Pocket ID 认证后仍须具备工作区成员资格 |
| 外部 Agent | https://agents.chunclaw.top/mcp | 专用公共 PKCE 客户端、访问令牌和本地工作区／节点授权分别检查 |
| 公开 OAuth 发现 | 已发布 | 发现信息不是业务授权 |
| dots 玄玑 | 已发布一个专用客户端标识允许名单 | 工作区／任务授权为 0，尚未完成真实连接及原生电脑任务 |
| Muse 老镇 | 最新已知账号暂不能登录 | 回调、认证兼容、原生任务触发和结果回传仍待确认 |
| 公网节点 REST | MCP-only 模式关闭 `/v1` 及 `/v1/*` | 不为绕过供应商限制而开放匿名或管理接口 |
| 事件 | 生产投递仍关闭 | 自动唤起外部 Agent 未验收，不能声称已自动接单 |

旧文档中的“仅 POST”“OAuth 资源发现未就绪”“当前空客户端名单”均是历史状态，不适用于当前发布。当前无效凭据的 GET／有效 JSON-RPC POST `/mcp` 返回 401 和资源发现挑战；公网 `/v1` 及测试子路径返回 404。畸形请求可能先被解析器拒绝，不用其错误码替代正常协议的认证验收。

## dots 玄玑：下一次单任务试点

1. 在已登录的官方自定义 MCP 界面核对端点及专用公共客户端。保留 PKCE 和用户同意，不复用真人或 Tailscale 客户端，不填写虚构 Secret。客户端标识按既定私密渠道保存，不贴入本说明或普通聊天。
2. 最终创建连接和授权前，由本人确认实际接收方、工作区、节点、能力、范围和期限。首次仅为公开网页试点，不授权 shell、私人文件、生产维护或任意网址操作。
3. 通过所有者界面为专用节点创建有界授权：读取、领取、回传任务所需的 `task.read`、`task.claim`、`task.result`。若要自动唤起，再单独核对事件能力、回调安全策略及 `events.read`、`events.subscribe`；当前事件关闭，不把勾选 scope 当作已经启用。
4. 客户端先调用 `chunlack_connections_list`，明确选定 `grantId`。平台创建唯一任务编号和随机校验码，任务仅为用玄玑自己的云端浏览器打开 https://example.com/、读取标题并截图。
5. 玄玑领取该任务，执行真实浏览器动作，回传任务编号、校验码、网址、标题、执行时间和截图。核对原生电脑活动记录及 ChunLACK 保存的结果和收件确认，由本人验收。
6. 人工叫醒后成功，只能标记“人工触发闭环通过”。自动接单须另行证明事件进入真实 dot 对话并触发其自身执行，HTTP 2xx 不代表完成。
7. 补验去重、取消、超时、暂停／撤销和恢复，核对远端是否实际停止；试点结束撤销临时授权及订阅。保留脱敏记录，不重复执行同一任务制造成功数。

以上是待执行流程，不是已接通或自动授权。浏览器未就绪或账号能力不明时停止相应试点，不把普通 worker、服务端抓取网页或模型生成的答案冒充玄玑电脑动作。

## Muse 老镇：恢复账号后验证

老镇与玄玑分别验收，不能以其中一端成功推定另一端可用。恢复老镇账号后，先只读核对受支持的自定义连接器、认证方式、精确回调、工具可见性、撤销方式及任务触发。若产品只提供调用工具而没有受支持的唤醒路径，应如实标记，不承诺自动接单。

再按相同的唯一任务、随机校验码、公开网页、原生动作、截图、平台回执和人工验收闭环测试。Muse Gadgets SDK／BLE 是另一条设备路线，不是云端电脑接入条件，也不部署到 VPS root 账户。初心是用户中转消息签名；Muse 名称为老镇。

## 通用节点与资源

Windows、Mac、DGX Spark 分开登记身份和已核实能力。设备提供运行环境，模型服务提供推理，Agent 接任务执行；同一台机器可承担多种角色，但接入模型 API 不会自动赋予文件、桌面或 shell 权限。所有本地／云模型仍走供应商中立路由，保留 Ollama。

初期不增加 Redis、额外消息代理或 GPU 服务；保持有界队列与保守执行并发。五个逻辑 Agent、五个节点在线、五个同时推理请求是不同指标，不能从单轮成功推断全天候容量。

管理流程见[外部 Agent 授权](AGENT_GRANT_ADMIN_GUIDE.zh-CN.md)、[连接路由](AGENT_CONNECTION_ROUTING.md)、[公开浏览试点](public-node-task-pilot.md)。最新未完成项见[逐项审计](verification/2026-10-20-delivery-gate-audit.json)。

## 历史说明：不作为当前配置或接入步骤

以下原样保留早期私网、Slack、Gadgets 和旧协议路线。其中“已实现／未实现”只代表当时状态；当前路线以上文及独立验收记录为准。

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
