# 2026-10-09 复验与接入条件

## 当前实际结果

- 默认并行测试：75 / 75 通过，0 失败。
- 冒烟首跑：临时测试服务器 health 等待超时，未取得启动日志。失败不能隐藏，根因尚未确认。
- 冒烟单独复跑：通过 HTTP、WebSocket、双模拟后端、SQLite 重启持久化、私有监听与配置保留检查。复跑通过不证明首次超时根因已消除。
- 真实 Open WebUI 核验：直接抓取官方网页，临时 loopback 网关领取并完成 1 项任务，现有来源引文校验通过；模型阶段 6636 ms。
- 模型入口：现有 LAN Open WebUI 的 local-active。没有改变该实例配置。
- 原始来源：https://docs.openwebui.com/reference/api-endpoints/
- 摘录 SHA256：8f0dedb4c94e91ce1aef9701e9451142394f101a504140ab38eaa86fa47feffb。

这证明现有本机试点在本轮可运行，不证明长期稳定性、真实多 Agent 完整流程或 VPS 全链路通过最终验收。

## Muse 条件已确认

用户提供的文档目录 muse_gadgets_sdkkey.txt 存在，本轮仅检查文件元数据，没有读取密钥内容，也没有认证 Muse 账户。

用户确认没有可运行官方 Linux Gadget SDK 的 Bluetooth LE 节点。因此 Muse Gadgets 真实配对和自动协作暂不实施。不在现有 VPS 安装默认 SDK，不绕过官方配对，也不凭 token 臆造模型 API。

## dots / Slack

官方已有 dots 的 Slack 消息连接功能，但本轮没有用户账户 Slack 授权、测试会话身份或真实回复证据。项目仍没有 dots 自动派单适配器。看到产品连接入口与完成账户授权、完成 LACK 自动协作是三个不同状态。

可先由用户在 dots 桌面界面完成官方 Slack 授权，在专用测试会话发一条无敏感内容的消息并确认由自己的 dot 回复，再评估受支持的自动任务桥接。无需在 VPS 上开放公网端口。

## 本轮交付

更新 [Muse / dots 说明](MUSE_DOTS_INTEGRATION.zh-CN.md)，补充 Gadgets 独立路径、默认权限风险和 Slack 验收分层。没有新增产品适配代码或修改生产服务。

现有本机试点启动见 [Open WebUI 使用说明](OPEN_WEBUI_NODE.zh-CN.md)。VPS 长期节点、Muse / dots 实际自动协作与检索核验汇总三角色真实全流程尚未交付；不能对整个平台宣布最终验收通过。
