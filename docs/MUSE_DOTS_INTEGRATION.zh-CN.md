# Muse / dots 接入说明

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
