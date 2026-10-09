# 多用户改造前的本地基线

日期：2026-10-09。用途：实施计划审阅阶段的既有版本验证，不是多用户功能验收或生产部署记录。

## 当前阶段

- 用户已批准多真人、多工作区的设计目标。
- 实施计划为 `2026-10-09-multi-user-workspace-delivery.md`，提交 `0fde4d7`，已发起审阅，尚未收到对该书面计划的确认。
- 本轮开始时 Git 工作区无未提交变更；未发现 identity/、collaboration/ 实现目录或本计划执行 ledger。
- 尚未开始 Task 1，也没有多用户业务隔离、真人会话或多人网页实现可供验收。
- 本轮仅运行既有本地测试，没有安装依赖、修改产品代码、读取生产凭据、改 DNS 或操作 VPS。

## 本轮实际命令及结果

使用已配置的 Node 可执行文件，版本输出 `v24.19.0`。

```text
node --test --test-reporter=spec --test-concurrency=2 tests/*.test.cjs
tests: 139
pass: 139
fail: 0
cancelled: 0
skipped: 0
todo: 0
exit: 0

node tests/smoke.cjs
PASS: real HTTP + WebSocket, two mock model backends in one channel,
SQLite restart persistence, private bind, config preservation.
exit: 0
```

上述命令在仓库目录执行。完整控制台日志位于 Git 仓库之外：

- `C:/Users/dongc/Documents/Codex/lack/artifacts/multi-user-preimplementation-baseline-tests.log`
- `C:/Users/dongc/Documents/Codex/lack/artifacts/multi-user-preimplementation-baseline-smoke.log`

## 证据边界

这些结果证明本轮运行的既有测试及本地 smoke 通过，可作为后续回归比较的起点。smoke 使用模拟模型，不是 Open WebUI、Muse 或 dots 的真实模型/Agent 验证。

它们不证明独立真人登录、工作区隔离、公开 HTTPS、真实节点完整能力、生产迁移或 VPS/Relay 共存已经通过。生产服务状态、本地模型私网可达性、权威 DNS、443 端口和外部平台权限仍须取得现场证据。

## 下一步

收到书面实施计划审阅确认后，在本会话按计划执行 Task 1 起的测试与开发；不把本基线记录视为实现完成。生产切换、旧数据归属和外部账号授权继续保留各自明确门槛，完整交付目标不变。
