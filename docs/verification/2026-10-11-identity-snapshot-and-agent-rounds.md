# 身份、快照及五 Agent 轮次复验

日期：2026-10-11。依据用户允许修正与完整复测的授权执行；本轮是本地隔离验收，不是生产发布。

## 身份和快照链路

当前代码已经包含正确的 `requireMembership(ownerId, workspaceId)` 调用，以及主库和 WAL 的私有稳定副本读取。原始修正及当时的失败记录见 `2026-10-10-identity-snapshot-repair.md`，后续正式迁移实现消除了那份历史记录中的迁移未实现失败。本轮不重复重写这些代码，也不覆盖历史验收记录。

本轮完整回归重新覆盖所有者授权、撤权、源库完整性、已关闭 WAL、持续打开的 WAL 写入者、空 WAL 保留、快照篡改、候选不可激活、迁移和恢复。源读取和快照相关用例均通过。Windows ACL 不确定性仍按原边界报告，不将 Windows 测试当作 Linux 权限证明。

## 本轮补齐的验收程序

- 新增 `tests/helpers/packaged-agent-scenario.cjs`，复用已有打包服务、真实 Caddy TLS、HTTPS 身份登录和 WSS 工作区会话。
- 在现有测试夹具增加受控配置回调；不增加生产接口，不改模型路由核心、认证规则、响应冷却或共享执行槽。
- 三个虚构真人会话分属两个工作区。每个工作区五个不同模型 Agent，共十个逻辑 Agent；另有五个实际配对但空闲的合成执行节点。
- 每轮通过真实 `/ground` 触发，必须取得五个不同 Agent 的主回答、对应五个模型主请求，并验证新任务记录完成且没有活动分支，才累计成功轮次。反思等辅助模型请求单独计数。
- 模型提示词及三个工作区订阅会话检查外工作区标记；重复轮号拒绝执行。保留原有 2200 ms 冷却，使用 2350 ms 的轮间等待。
- 新增有界独立脚本 `tests/workspace-agent-soak.cjs`。时长范围 1000 至 1800000 ms，每工作区最多 1000 轮，模拟模型延迟至多 500 ms。达到轮数上限但未达到请求时长不能算持续验收通过；中断也不报成功。

两个模型供应商均是本机回环 HTTP 测试服务，没有真实云模型、真实密钥或 Open WebUI。测试不替换实际 Agent 协作处理器。五个配对节点没有执行任务，不能将它们算成五个忙碌的外部 Agent。

## 实际结果

- 定向用例：3/3 通过，0 失败、跳过、取消，12836.5779 ms。四个完整工作区轮次、20 次主模型请求、40 次总生成请求。
- 有界持续运行：请求 60000 ms，实际工作负载 62992 ms；两个工作区各 12 轮，共 24 个完整轮次、120 次主请求、240 次总生成请求。0 失败轮、0 隔离错误，生成 HTTP 最大在途数为 1。
- 持续试验主进程观测峰值 RSS 121.91796875 MiB，CPU 14015 ms，轮耗时 P95 为 4981 ms。该 RSS 不含 Caddy 子进程，包含测试与打包应用；不是 VPS 整机资源、服务资源上限或长期内存稳定性证明。
- Windows 当前工作树完整回归：460/460 通过，0 失败、跳过、取消，75518.3834 ms，退出码 0。定向用例已包含其中，不额外累计。
- 独立冒烟：真实 HTTP/WebSocket、同频道两模拟后端、SQLite 重启持久化、私有绑定和配置保留通过，退出码 0。

保留失败证据：新增用例第一次因尚未实现夹具和脚本而失败；实现后又因夹具使用了不存在的 manifest 路径，出现 404（2 通过、1 失败）。按已授权修正为 SDK 的 `/v1/manifest` 加工作区头，并检查返回绑定，随后同一用例通过。未放宽断言或隐去失败记录。

## 可重复命令

使用已有 Node 24、Python、OpenSSL、项目依赖和 Caddy，不安装全局软件。将 `CADDY_TEST_BIN` 指向现有 Caddy 文件，然后在仓库执行：

```powershell
node --test --test-reporter=spec tests/packaged-agent-rounds.test.cjs
node tests/workspace-agent-soak.cjs --duration-ms 60000 --max-rounds 100 --mock-delay-ms 100
node --test --test-reporter=spec tests/*.test.cjs
node tests/smoke.cjs
```

脚本只在拥有的临时目录和回环随机端口运行。测试夹具清理其拥有的进程、连接、计时器及目录；不能使用真实账户、凭据或生产数据替代虚构样本。

## 日志校验

日志保存于忽略的 `.superpowers/sdd/2026-10-09-multi-user-workspace-delivery/`，不提交运行时日志或密钥。SHA-256：

| 日志 | SHA-256 |
| --- | --- |
| `agent-rounds-red.log` | `b40095eef25d668efc690321057efb9e8081d021e6c25d405b917eef550f941d` |
| `agent-rounds-first.log` | `fd5b88051bd7a49674f730f3f471540931f886e2a26da73dec63883ec45df1cc` |
| `agent-rounds-retest.log` | `0e5e0d3bc1107222862ba9853d510f8d796ae6d352959951b879f30328d9d820` |
| `agent-rounds-soak.log` | `620626a06bd71a17dea0a0bbb5f39cb988737aa99b06986382bf490b6b0b228b` |
| `identity-snapshot-and-rounds-full.log` | `e3ee29abecafc3836b52b6c91020b1675b16841564b22424c63d48ac13188fec` |
| `identity-snapshot-and-rounds-smoke.log` | `f11986f4ca6071992a388765ca44f0a4d23d1332a8d0f6a1603c5cd04cec79cb` |

## 仍需分别完成

当前增量的 Linux 复验、VPS 资源受限持续共存及 Relay 实际通信验证、直接真实模型、生产数据归属和维护窗口、DNS/证书/公网实际登录、Muse 老镇与 dots 玄玑自身电脑任务证据仍未完成。之前的 Linux 450/450 是旧源码检查点，不能覆盖本轮 460 项代码。

另外，网页公开任务创建 API 对混合能力、非专用 public 浏览节点的兼容遗漏仍未修正；不能因为 460 项通过就宣布该边界已覆盖。该问题及人类证据验收入口仍是后续交付事项。

本轮未访问 VPS、生产重启/切换、修改 DNS/防火墙/凭据、占用主机 443、改变 Tailscale Peer Relay 或连接真实外部平台。60 秒合成压力不是硬件稳定上限，当前结果不等于系统全部交付完成。
