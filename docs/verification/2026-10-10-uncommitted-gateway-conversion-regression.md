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
