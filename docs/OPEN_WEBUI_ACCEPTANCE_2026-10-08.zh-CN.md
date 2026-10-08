# Open WebUI 节点交付验收

日期：2026-10-08。范围：本机 ChunLACK、临时 loopback 网关、现有局域网 Open WebUI；不是 VPS 长期节点部署。

## 确认结果

| 项目 | 结果 |
| --- | --- |
| 默认并行单元及集成测试 | 75 / 75 通过，0 失败 |
| 冒烟测试 | HTTP、WebSocket、双模拟后端、SQLite 重启持久化、私有监听、配置保留通过 |
| 人工提供官方摘录 + 临时节点 + 真实核验 | 完成 1 项，现有引文证据门通过，模型阶段 4532 ms |
| 直接 HTTPS 官方页面抓取 + 临时节点 + 真实核验 | 完成 1 项，originalSourceAcquired=true，证据门通过，模型阶段 8988 ms |
| 真实汇总适配器调用 | 通过，输出仅包含已知 claimIds: [C1] |

模型入口：用户现有 Open WebUI 的 local-active。未验证底层 GPU 或推理服务归属；这些测量不是吞吐量或稳定并发上限。

原始来源：https://docs.openwebui.com/reference/api-endpoints/

直接抓取的摘录 SHA256：8f0dedb4c94e91ce1aef9701e9451142394f101a504140ab38eaa86fa47feffb。

人工提供摘录 SHA256：838a93997224694bf7370ff0ea0c46cd297ba37e41c5d6761d22129edd9d9272。人工模式不声称脚本独立抓取或验证发布者真实性。来源抓取此前失败、本轮成功；网络长期可靠性尚未证明。

## 本轮修正

去掉模型请求中的空 tools 数组，保留 tool_choice=none、JSON 输出要求及回复侧工具调用拒绝。不会执行模型返回的工具，也不会对研究失败静默重试生成。

网关 HTTP 测试改用有上限的状态等待，避免 20 ms 固定等待导致的误判；测试专用长轮询窗口调整为 3 秒。生产网关参数没有修改。

## 使用入口

本机可复现试点及长期 worker 配对步骤见 [Open WebUI 节点说明](OPEN_WEBUI_NODE.zh-CN.md)。独立运行试点不需要长期节点凭据。长期 worker 需要先启用并配对实际私有网关；这一步没有在 VPS 上执行。

直接抓取模式：设置说明中的模型环境变量，移除 OPEN_WEBUI_PILOT_EXCERPT_FILE 后运行 node scripts/open-webui-node-pilot.cjs。

人工摘录模式：按说明设置 OPEN_WEBUI_PILOT_EXCERPT_FILE。两种模式不会自动互相降级。

Muse / dots 见 [接入说明](MUSE_DOTS_INTEGRATION.zh-CN.md)：官方途径已核对，但产品专用自动接入未实现、未授权实测。

## 未交付或未证明

- VPS 私有网关启用、持久配对、开机运行和真实节点的 VPS 全链路验证。
- Muse Connector 注册审核、dots 专用自动派单及产品真实调用。
- 检索员、核验员、汇总员完整真实多 Agent 工作流；本轮真实核验和独立汇总不是该全流程验收。
- 持续负载、费用、五节点实际协同上限、故障恢复长期验证。

没有重启 VPS 或 Open WebUI，没有开放公网端口，没有更换凭据或删除 Ollama 支持。未获得本轮 VPS 服务健康新证据，不声称对其重新验收。
