# dots 云端电脑接入试点

## 当前状态

本地模拟 dot 的 MCP 任务与事件通路已实现，尚未接入真实 dots 账号或云端电脑。

目标通路是：ChunLACK 创建受限任务，事件通知 dots，dots 领取该任务，使用自己的电脑执行，再通过 MCP 上传证据并提交结果。自建 worker 或服务器抓取不能代替真实 dots 电脑操作。

## 本地验证

在依赖齐全的仓库根目录运行：

```powershell
node scripts/dots-mcp-local-pilot.cjs
node --test tests/pilot-mcp.test.cjs tests/mcp-artifact-upload.test.cjs tests/mcp-events*.test.cjs tests/webhook-transport.test.cjs tests/dots-mcp-local-pilot.test.cjs
```

脚本通过真实 loopback HTTP MCP 和本地 HTTPS 签名回调，验证通知、精确领取任务、分块上传合成 PNG、保存结果、去重和取消订阅。没有运行 dots 浏览器。输出 `mode: mock_dot`、`dotsAgentVerified: false` 是刻意保留的验证边界。

## 已实现接口

`integrations/mcp/pilot-server.cjs` 提供 `POST /mcp`，当前仅绑定 `127.0.0.1`。服务端把已认证身份绑定到指定节点，调用参数不能自选身份。

- 发现：`server/discover`，声明 `2026-07-28` 版本子集。
- 工具：读取与精确领取指定任务、续租、事件记录、结果提交。
- 图片：开始上传、顺序分块、完成上传；有编码、大小、归属与租约检查。
- 事件：列出、订阅和取消 `pilot.task_ready`，仅针对单个批准任务。

订阅回调使用签名挑战，订阅秘密加密持久化。生产回调传输要求明确主机白名单、HTTPS、公开 IP 检查和 DNS 地址固定，不跟随重定向。本地试点显式注入 localhost 测试传输，没有关闭生产地址检查。

事件接收 HTTP 2xx 只表示收到通知，不表示任务完成。重复通知不得重复执行电脑操作。

## 本次修复的授权边界

`createPilotEvents` 新增可选的 `authorizeCleanup(principal, taskId)`，只用于取消订阅，默认仍采用原 `authorize`，保持现有调用兼容。

试点为它单独检查节点有效性和任务归属，因此任务完成后可以取消自己的订阅。执行、订阅和发布事件仍使用原执行授权，不因清理授权扩大权限。其他节点、撤销身份和不属于节点的任务不得获得清理权限。

## 真实接入前的步骤

1. 确认当前 dots 账号支持所需 MCP、事件和私网 Tunnel 能力；不能根据终端可用推断这些权限已具备。
2. 在用户私网内准备可访问 ChunLACK 的受限 MCP 服务及出站隧道。当前代码没有安装或配置真实隧道。
3. 单独配置节点身份、加密密钥、回调白名单和可信证书。凭据只存私有配置，不发到聊天或 Git。
4. 实测客户端与当前 MCP 子集的兼容性。尚未验证真实协议客户端，也未实现所有历史 MCP 协议形式。
5. 用户批准一次事件订阅和一个公开网页任务后，验证事件到达、dots 自身浏览器活动、匹配截图、结果落库四项证据。
6. 测试后取消订阅、释放凭据权限；失败必须如实记录，不能换成 worker 冒充 dots。

## 试点限制

订阅上限 5 个、TTL 最多 5 分钟，通知最多重试 3 次，事件记录有容量上限。本地脚本手动调用投递，不是常驻调度服务。长期运行所需的调度、容量清理、监控及生产恢复仍需独立验证。

测试证书和私钥只用于 localhost，不能用于生产。`evidence_checked` 表示证据格式与归属检查通过，不表示真实网页已访问，也不等于用户验收通过。
