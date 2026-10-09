# Muse / dots 接入说明

## 2026-10-09 私有云端电脑接入方向更新

本节优先于下文较早的路线建议。Slack 和 raft.build 仅作为产品设计参考，不是接入依赖；不推进 Slack 桥接。Muse Gadgets 设备路线与 Muse 云端电脑路线不同，不能把前者的蓝牙要求套用到后者。

用户提供的 Muse 帮助原文明确：其 tailscale 是平台封装命令，不是上游 CLI；私网通过运行环境外的 3130 HTTP 代理访问，只出站、TCP、不接受入站。不要自行安装 tailscaled。首次目标访问需要用户批准，批准可能覆盖同一地址的其他端口，因此必须另设私网服务级访问限制。运行时替换后的身份保留和自建程序恢复尚未验证。

用户提供的 dots 输出只确认命令环境具备 Node/Python，工作目录权限检查可写、三次公开 HTTPS 请求成功；不能确认该环境就是持久云端电脑，也不能确认长期运行。目标是当前 dot 接到任务后实际操作自身云端电脑，不是 worker 代替 dot 执行。

[MCP Events](https://developers.openai.com/plugins/build/mcp-events) 官方说明支持 dots，要求 MCP 2.0、持久订阅存储及出站 webhook；[Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) 提供私网侧出站连接，不需要私有服务公开监听。但当前账号权限、隧道与事件组合、真实电脑执行及结果回传均待验证。MCP 隧道不赋予浏览器通用私网访问，云端接入仍意味着选定任务数据进入供应商系统。

当前代码没有上述代理适配、MCP Events 服务或浏览器任务类型。详细范围、接口边界与验收见 [双路线试点设计](superpowers/specs/2026-10-09-private-cloud-agent-pilot-design.md)。该设计待审阅，不代表实现、部署或入网已完成。

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
