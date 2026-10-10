# 当前工作树本地全量回归记录（2026-10-10）

## 结论

本轮不满足发布或最终交付条件。只同步这份报告，不提交失败组件或未通过的新增测试，不切换生产。

## 测试对象与证据

- 基线提交：`3f8f9d92e444d51e2b48466cfaaffe447832f9d6`。
- 测试对象是包含本地未提交迁移开发的当前工作树，不是上述提交的纯净检出。
- 本地未提交文件：`scripts/convert-legacy-gateway.cjs`、`tests/gateway-migration.test.cjs`、`tests/workspace-migration-apply.test.cjs`、`tests/workspace-snapshot-closed-wal.test.cjs`。
- 运行环境：Windows；Node.js `v24.19.0`。
- 命令：`node --test --test-concurrency=1 'tests/*.test.cjs'`。
- 结果：428 项，406 项通过，17 项失败，5 项跳过，0 项取消；退出码 1。
- 测试耗时：123641.0517 毫秒。
- 本地原始日志：`.superpowers/sdd/2026-10-09-multi-user-workspace-delivery/current-tree-full-regression.log`；不上传运行日志或运行数据。
- 日志 SHA-256：`31f377b48da0e9b9f11fde4dc754d3897abeb55e47e8831fe669d89c07105fe8`。

## 失败项分组

1. 新网关转换测试 8 项失败。组件误将对象传给要求 `requireMembership(userId, workspaceId)` 的身份接口，合法所有者被拒绝，相关转换及回滚断言未达到预期执行阶段。这不是越权放行，但也不能以拒绝所有请求宣称权限功能正确。
2. 实际迁移集成测试 8 项失败，在快照阶段出现 `snapshot_source_changed`。这些测试尚未证明数据转换、幂等验证、证据检查、发布或恢复正确。
3. 已关闭 WAL 数据库的快照回归 1 项失败。主库哈希保持一致，但原本不存在的 `-wal`／`-shm` 旁文件被创建；源目录保持不变的断言失败。不能只凭主库哈希相同就接受此行为。

上述修正仍待对应人工确认，本轮没有修改它们，没有放宽断言或将失败改为跳过。

## 跳过项与证据边界

5 项跳过均为实际 Caddy HTTPS／WSS 入站测试：3 项打包后的登录、API、WSS 验证，2 项 TLS 路由及 HTTP/2／WSS 验证。本轮没有执行这些验证，不视为通过；仅从日志的 `SKIP` 标记不能确定具体环境缺失原因。

原有 5 项网关／模型共享容量测试在本轮均通过，但不能代替迁移后有效租约的验收，也不能代替五 Agent 完整轮次的持续压力测试。

## 生产与最终交付边界

本轮只执行本地测试。没有连接 VPS、切换生产、修改凭据、DNS、443 或 Tailscale Relay。没有接入或使用 Open WebUI。没有调用真实模型或外部 Agent。

本轮结果不更新原先纯净源码检查点的通过计数，不把当前工作树称为全绿。实际迁移、生产生命周期、公网 HTTPS、真实模型，以及 Muse（老镇）和 dots（玄玑）使用自身云端电脑执行并回传证据的验收仍未完成。总目标保持未完成。

## 后续补测：使用已有 Caddy，消除环境跳过

通过只记录环境变量名称的运行时探针确认，这组测试读取 `CADDY_TEST_BIN`；前次测试进程未设置它。已有隔离工具目录内的 Caddy 可用，版本命令返回 `v2.11.7`。本次只在测试进程中设置变量，未修改源代码、系统环境、生产配置或全局软件。

```powershell
$env:CADDY_TEST_BIN = [IO.Path]::GetFullPath('.superpowers/sdd/2026-10-09-multi-user-workspace-delivery/tools/caddy-2.11.7/caddy.exe')
# 使用同一 Node.js v24.19.0 运行，以下命令的 node 指该解释器。
node --test --test-concurrency=1 'tests/*ingress*.test.cjs'
node --test --test-concurrency=1 'tests/*.test.cjs'
```

- 入站专项：10 项全部通过，0 项失败、跳过或取消；退出码 0；耗时 17531.6757 毫秒。原先跳过的 5 项实际 Caddy HTTPS／WSS 验证均已执行并通过。
- 当前工作树全量复测：428 项，411 项通过，17 项失败，0 项跳过、取消或 todo；退出码 1；耗时 149107.7264 毫秒。
- 17 项失败仍集中在前文记录的 8 项网关转换、8 项迁移集成和 1 项已关闭 WAL 快照测试。合法所有者校验错误及源目录旁文件问题仍未修正，相关迁移验收不能宣布通过。
- 全量复测时的已提交基线为 `de8854210ed02f8fd5ce5136f502fe91db0397b7`，即只增加前次回归报告；未提交的 4 个开发文件保持原有状态。
- 专项日志：`.superpowers/sdd/2026-10-09-multi-user-workspace-delivery/current-tree-ingress-with-caddy.log`；SHA-256：`ed4a5d323031c885556dd6a79604b3a4cca1bdd3060be1b03996230538f6badf`。
- 全量日志：`.superpowers/sdd/2026-10-09-multi-user-workspace-delivery/current-tree-full-with-caddy.log`；SHA-256：`4f94b6bf59461a5d1da47cb5c7261407587ec16370a5113d614981dcc8a24d1d`。
- 测试结束后的只读进程检查：本地 `caddy` 进程数量为 0。此检查不证明其他进程或 VPS 服务状态，本轮没有访问 VPS。

前次的 406／17／5 结果保留为历史记录，不被改写。补测使用本地隔离 TLS 配置，不等于真实公网域名、生产切换、模型或外部 Agent 的验收。这里只同步证据报告，仍不提交或发布失败开发组件。后续首先需要人工确认身份接口与快照读取链路的最小修正范围，再进行修复及完整复测。
