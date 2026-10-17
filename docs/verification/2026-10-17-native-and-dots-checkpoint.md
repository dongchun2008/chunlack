# VPS 真实五 Agent 与 dots 接入核对

日期：2026-10-17。性质：阶段取证，**不是完整交付或接入验收通过**。

## 后续批准与复验（2026-10-18）

用户已明确批准目录映射修正、限定记录同步和独立 dots 公共客户端创建。以下是新证据，不覆盖下方初始失败记录。

### VPS 原生真实五 Agent 已通过

- 运行编号：`chunlack-native-five-c594ea354f54`。仍使用下方固定提交和 79 文件源码包，不包含未提交界面改动。
- 仅补齐新建独占目录的映射：代理映射自己的套接字目录；测试进程只读映射源码、工具和套接字，只给 scratch 和本轮夹具目录写权限。保留 PrivateTmp、nobody、私有网络、NoNewPrivileges 和 ProtectSystem=strict。
- 实际限额：测试单元 176 MiB / 单核 9% CPU / 28 Tasks / 90 秒，代理 16 MiB / 单核 1% CPU / 4 Tasks，合计 192 MiB / 10% CPU / 32 Tasks，两者均禁用 swap。
- 两轮分别取得五个 Agent 的真实回复，用时 6,644 ms 和 4,103 ms；10 次真实推理全部成功、失败为 0、峰值同时模型请求数为 1。不是五路模型并发。
- 三个合成测试账户、两个工作区；五个 Agent 位于同一测试工作区。另一工作区 viewer 的模型访问被拒绝。不是三个真人持续协作验收。
- 两轮任务均完成且活动分支归零；隔离运行时重启后，10 条回复的编号与内容哈希保持一致。真实 HTTPS/WSS 和证书校验保留。
- 测试单元 MemoryPeak 为 101,695,488 字节（约 97 MiB），CPUUsage 为 3,003,272,000 ns。这是该短测的测量，不是生产容量或整机峰值。
- 临时测试与代理均已停止，MainPID 为 0，专属 cgroup 无进程。四项保护服务的 PID、重启数及 active 状态不变，带证书校验的 HTTPS 健康检查为 200，Relay UDP 监听仍在。
- 原始报告 SHA-256：`0b825acf66e00d9795a108dba25e53100f5b1ece4f6216340009732f593f92483`；本轮运行器 SHA-256：`533c404096c4ec948ccdb10a6d755f33ae1f82fc42aa21283e5e3866046950e88`。原始报告和临时运行器保留在私有测试目录，不在此次限定提交中。

### dots 独立客户端已创建，但尚未接入

- Pocket ID 2.14.0 中已保存独立的 `ChunLACK dots` 公共客户端。没有生成或读取 Client Secret。
- 唯一回调为 `https://chatgpt.com/connector_platform_oauth_redirect`，无通配符。公共模式自动要求 PKCE；“跳过同意页面”关闭。
- 保存后的“API 访问”页明确显示未获得任何 API 的访问权限。没有授予 Agent API 或工作区访问，没有启用 M2M，没有修改真人登录或 Tailscale 客户端。
- 客户端 ID 和非密钥配置摘要仅保存到私有 `chunlack-dots-client.json`，新文件 ACL 关闭继承，仅允许当前用户、SYSTEM 和本机 Administrators 访问；客户端 ID 不写入本文或仓库。
- 尚未在 dots 提交连接、完成 OAuth 授权或建立事件订阅，更没有通过其自身云端电脑执行验收。

下一阶段仍需持续真实负载和 Relay 质量测量、当前部署的真人新登录，以及 Muse/dots 原生电脑任务与证据回传验收。开启 API、客户端白名单、节点及工作区授权均须遵守独立批准的范围；不能由本次客户端登记推定已经获准。

## 初始源码边界（2026-10-17）

- 本地 HEAD 为 `2d0b1ce26b1bfad55365802a28631cf574d6ec0b`。
- `identity/workspace-shell.js` 的既有未提交改动仍被保留，未覆盖、撤销或打包。此前已保存独立补丁，并发现其移除 Agent 授权管理界面，因此不作为本轮验收源码。
- 固定提交的独立源码包包含 79 个文件，SHA-256 为 `118f55942489e84f637e3e6c703e3281240e2599e9b4aef6824db705de826ee7`。
- 本轮不修改应用源码、凭据、生产配置、Pocket ID 客户端或 Relay，不切换生产。

## 模型通道的上一轮证据

刚完成的独占 Unix 套接字探针在显式设置 `0600` 后通过：私有网络中的 nobody 进程读取模型列表得到 200，目标模型存在；直接访问模型地址仍被网络命名空间阻止。该探针没有执行模型生成，不是五 Agent 验收。

## 本轮 VPS 原生五 Agent 尝试

独立运行编号：`chunlack-native-five-326f84b9439b`。

1. 固定源码包哈希验证通过，复制 79 个源码文件。
2. 独立复制 4,452 个生产依赖文件，共 38,831,985 字节；逐个核对源文件和副本 SHA-256，不更改源文件权限、不运行依赖安装器。依赖清单哈希为 `328d45f49bbdc12cccec01d6f9509e6ef741d23c006934ac097f536e8b2e2ab6`。
3. 独立复制 Caddy，核对既定二进制 SHA-256。
4. 运行器计划合计限制 192 MiB、单核 10% CPU、32 Tasks；测试单元 90 秒，模型代理单元另有有界退出时间。
5. 代理单元启动失败，systemd 报 `226/NAMESPACE`：`PrivateTmp` 内未映射本轮独占套接字目录，目标路径不存在。错误位于新增测试运行器，不能据此判定产品或模型故障。
6. 五 Agent 测试单元未启动；没有执行本轮推理、讨论或重启持久化断言。**本轮验收未通过。**
7. 失败代理已停止：MainPID 为 0，专属 cgroup 无进程。失败报告保留，没有把失败状态改为成功。

当时的修正提案仅补齐独占目录映射，保留 PrivateTmp、私有网络、只读源码和工具、最小可写目录及全部原有资源限额；当时尚未实施。后续批准和通过结果见上方 2026-10-18 记录。

## 对现有服务的影响检查

本轮前后，旧 LACK、Tailscale、当前公网应用及 HTTPS 四项服务均 active，MainPID 和 NRestarts 未变。带证书验证的公网 HTTPS 健康请求返回 200；UDP 40000 监听记录为 4 条。

这证明本轮未观察到这些服务重启或健康接口中断，**不证明 Relay 实际吞吐、延迟或持续负载质量不受影响**。

## dots 页面当前实际证据

在已登录的 ChatGPT 插件页，通过“添加 → 添加自定义 MCP 服务器”打开未提交表单。填写公开地址 `https://agents.chunclaw.top/mcp`，查看“高级 OAuth 设置”。未填写密钥、未点击创建、未授权。

| 字段 | 页面实际显示 |
| --- | --- |
| 客户端配置方式 | 自定义 OAuth 客户端 |
| 精确回调 URL | `https://chatgpt.com/connector_platform_oauth_redirect` |
| 授权网址 | `https://pockid.chunclaw.top/authorize` |
| Token URL | `https://pockid.chunclaw.top/api/oidc/token` |
| 授权服务器基础地址 | `https://pockid.chunclaw.top` |
| 资源 | `https://agents.chunclaw.top/mcp` |
| DCR | 不可用，未发现注册 URL |
| CIMD | 不可用，服务器未声明支持 |
| 可见权限项 | `openid`、`task.read`、`task.claim`、`task.result`、`events.read`、`events.subscribe` |
| OIDC 配置 | `https://pockid.chunclaw.top/.well-known/openid-configuration` |
| 用户信息端点 | `https://pockid.chunclaw.top/api/oidc/userinfo` |

表单当前显示 token 认证方式 `none`，不代表最终客户端已经配置或获批。权限项可见也不代表已授权。此前“页面超时、回调未取得”的阻碍已有新的实际页面证据，不能再当作当前已确认阻碍。

下一步应使用独立 Agent 客户端，精确登记上述回调，不复用真人登录或 Tailscale 客户端。创建凭据、启用资源访问和工作区节点授权是分离的安全步骤，需要在各自授权范围内执行。尚未创建任何 dots 连接、订阅或访问授权。

## 初始快照的交付门槛与当前变化

- VPS 上原生真实五 Agent 两轮及重启持久化：已由上方 2026-10-18 短测满足，不代表持续压力验收。
- 多真人、多工作区的持续真实模型负载测试及适用并发上限，不以 Windows 两轮或本轮未启动的测试替代。
- Relay 的实际质量证据，不以监听端口存在替代。
- 当前部署的真人 Pocket ID 新登录与使用路径验收。
- dots 和 Muse（老镇）原生 Agent 使用自身云端电脑执行并回传证据；不能用自建 worker 或模型响应冒充。
- 连接、撤销、故障恢复、权限边界及最终使用文档的交付核对。

Ollama 和供应商中立路由均保留；不接入 Open WebUI，不推定模型名称已经证明底层 GPU 拓扑。
