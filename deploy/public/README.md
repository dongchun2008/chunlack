# ChunLACK 公网部署资产与安全门槛

这些文件是待验收的部署资产，不代表 VPS 已部署、不代表已获得生产切换授权。
必须先完成真实环境基线、迁移和回滚验证；不要直接复制后启动服务。

## 范围和隔离

- `lack.chunclaw.top` 面向真人登录和工作区页面；`agents.chunclaw.top` 面向已授权节点的受限 REST/MCP。两者是同一平台的入口，不是每个工作区一套服务。
- 应用只绑定三个不同的回环高端口，由同一个 Node 进程共享身份、容量和任务状态。已存在的 `127.0.0.1:3721` 服务不能复用或停止，必须先查明端口和数据归属。
- 新代码放在 `/opt/chunlack-public/current`，私有应用数据放在 `/var/lib/chunlack-public`，HTTPS 状态放在 `/var/lib/chunlack-https`。分别使用 `chunlack-public`、`chunlack-https` 专用账号，不能共用现有服务账号或写入其目录。
- Node 24 和经过校验的 Caddy 使用 `/opt/chunlack-public/runtime/` 下的专用二进制，不覆盖全局 Node/Caddy 或修改现有站点配置。服务不会执行安装、配对、网络或防火墙命令。
- Tailscale Peer Relay 的进程、配置、UDP 端口和运行方式保持不变；新服务没有依赖或重载现有 Relay 服务的指令。没有修改并不等于已证明持续健康，必须同时取得功能与资源证据。

## 资源预算不是容量承诺

| 进程 | MemoryHigh | MemoryMax | CPUQuota | TasksMax |
| --- | --- | --- | --- | --- |
| 单个应用进程 | 384 MiB | 448 MiB | 50% | 64 |
| 单个 HTTPS 进程 | 96 MiB | 128 MiB | 10% | 64 |

`CPUQuota=50%` 是最多约 0.5 个逻辑 CPU，`10%` 是约 0.1 个 CPU，不是整台
2 核机器各占 50% 和 10%。两个 MemoryMax 合计 576 MiB，是上限，不是预留内存。
预检要求现有可用内存至少 768 MiB，即给这两个上限另留 192 MiB 的初始余量。
这是保守的开始条件，不代表已经测出五个真实 Agent 的持续可用上限。

如限额导致候选服务 OOM、证书或任务超时，先停止本次新增候选服务并保留证据，
不要调大限额、重启同机服务或禁用现有服务来让测试通过。后续调整要有测量和单独决策。
应用使用 `Restart=no`，避免错误启动循环和自动接管写入锁；异常退出后走人工核验恢复。
HTTPS 仅有限重试。Caddy 管理 API 禁用，因此没有 `ExecReload`；切换候选配置仍需维护窗口。

## 只读前检查

`preflight.sh` 是正式部署资产的入口；`scripts/public-preflight.sh` 仍只是早期最小快照，
不能替代这里的完整检查。正式入口依赖可用的 Node、systemd 和标准 Linux 诊断命令，
各子命令有 2 秒和输出大小限制，不使用 shell 拼接执行命令。

在取得只读 SSH 检查许可后，确认已有 Relay 的实际 UDP 端口，再运行，例如：

```sh
NODE_BIN=/opt/chunlack-public/runtime/node/bin/node \
  sh deploy/public/preflight.sh \
  --web-host lack.chunclaw.top \
  --agents-host agents.chunclaw.top \
  --expected-ip 47.108.217.178 \
  --relay-port 40000
```

此处地址、端口只是本项目已讨论的候选值，仍须与当前机器核对。若专用 Node 尚未安装，
可以用已有 Node 收集信息；旧版本会提示待准备专用运行时，不授权升级全局版本。
输出包括 CPU/内存/Swap/磁盘、cgroup v2、TCP/UDP 监听、服务 PID/重启计数/内存、
CPU/内存/IO PSI、最近一小时 OOM 和两个域名的系统解析结果。
不读取私钥、凭据文件、环境文件或其他站点配置；不输出原始内核日志。

- 退出 0：仅表示本次有限快照未发现阻断项，`deploymentAuthorized` 仍然为 false。
- 退出 2：缺失数据、端口占用、资源压力、DNS 不符或现有服务异常，需人工复核。
- 发现已有代理服务时，报告站点清单待复核，不读取可能包含第三方凭据的配置，更不覆盖它。
- UDP 监听和 active 状态不代表 Relay 转发功能正常；系统解析不代表 DNS 所有权、全部 DNS 记录或 CAA 已验证。
- 未核验 IPv6 入口时，发现 IPv6 解析就阻止部署，不能让 ACME 或用户流量随机落到错误机器。

## 候选 HTTPS 配置

使用 `render-ingress.cjs` 从批准的非敏感配置生成新文件，不能覆盖现有配置。
`ingress.chunclaw.example.json` 是仅供入口渲染的非敏感候选示例，不是完整应用配置：
三个回环上游候选端口为 13721、13722、13723，避开既有 3721。激活前必须重新核对
端口并与完整应用配置一致；不能直接用这个文件启动应用或跳过数据迁移和身份初始化。
不要把凭据、私有运行环境或个人数据作为渲染输入。随后使用专用 Caddy 执行
`validate --config <candidate> --adapter caddyfile`，该操作不是服务启动。
TLS 采用 443 的 ACME TLS-ALPN 验证，不占用 80 或 UDP 443；不能关闭证书校验，
也不能为解决签发问题擅自修改 CAA、删除旧解析或开启其他端口。

## 激活前必须补齐的验收

1. 核对 SSH 主机指纹，确认 443 的所有权、两个域名的 A/AAAA/CAA、现有站点和维护窗口；只操作获批准的新域名，不变更根域或其他站点。
2. 用实际生成的 LACK 包验证真人登录、工作区隔离、静态资源、HTTP API、WSS、节点配对和 MCP，全程正常验证 HTTPS 证书。
3. 对实际 Linux/systemd 验证 unit 指令、cgroup 限额、SIGTERM 关闭和重启后的锁/数据库状态；Windows 文件契约测试不是 Linux 服务运行证明。
4. 完成一致性备份、显式数据归属迁移、完整性/外键检查、隔离未知旧数据和回滚演练。不能通过手动设置 migrationReady 跳过。
5. 实测真实模型和 Muse 老镇、dots 玄玑自己的电脑执行、截图、挑战码及结果留存。模拟节点或自建 worker 不能冒充供应商 Agent。
6. 在真人/工作区/节点并用的持续测试期间，同时验证 Peer Relay 功能、PID/重启数、监听和资源；任何既有故障先记录，不趁部署自动修复。

凭据仅放在受控私有环境文件中；不放 Git、命令行参数、网页地址、截图或聊天里。
本阶段没有安装账号、二进制或服务，没有激活公网入口。

2026-10-11 的当前 VPS 只读预检、预检兼容修正和 477 项 Windows 回归结果见
`docs/verification/2026-10-11-public-preflight-native-acceptance.md`。有限基线通过仍不等于
生产激活：443 尚未监听，正式证书、旧数据归属、真实模型与外部 Agent 执行仍待验收。
