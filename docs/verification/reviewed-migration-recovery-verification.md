# 经确认的迁移恢复验证记录

## 本轮变更

- 新增离线 `workspace-migration-recovery.cjs`：从已发布或失败的迁移候选隔离快照物化独立旧数据副本。
- 新增命令行 `--recover --reviewed` 和 `--verify-recovery`；保留原迁移和准备快照入口。
- 新增 7 项实际 SQLite、文件、路径和命令行恢复测试，不替换原有断言。
- 补充中文操作说明 `docs/reviewed-workspace-recovery.md`。

## 实测结果

环境：Windows，Node v24.19.0；完整测试设置 `CADDY_TEST_BIN` 指向已有的 Caddy 2.11.7。

| 测试 | 通过 | 失败 | 跳过 | 取消 | 时长 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 迁移、恢复试验、只读源库检查定向测试 | 32 | 0 | 0 | 0 | 51174.1167 ms |
| 完整本地 `tests/*.test.cjs` 测试 | 445 | 0 | 0 | 0 | 188917.5128 ms |

两次命令退出码均为 0；完整测试使用 `--test-concurrency=1`，无 todo。新增恢复测试实施前，实际红测定位到缺少恢复模块和 CLI 不识别恢复模式，并非环境跳过。

本地日志位于忽略目录 `.superpowers/sdd/2026-10-09-multi-user-workspace-delivery/`，不将运行数据或凭据提交到 Git：

- `migration-recovery-focused.log` SHA256: `e19245dc65b316bf841bd7b8d5e3dc44b69db80cf1afbde4622f8b7e911bdf33`
- `migration-recovery-full.log` SHA256: `9e17c94f569c1cb64a89a116932fee44e850688cbcc7601b44cbfa15a4e992c1`

## 验证覆盖

- 恢复旧结构数据库、未知旧表、原配置、原始来源文件，原数据库、WAL 和活动迁移候选字节保持不变。
- 迁移转换中断后仍可恢复快照；迁移失败候选和恢复副本均不自动激活。
- 缺少明确确认或快照已篡改时，不创建恢复目标。
- 占用目录、重叠目录和链接路径被拒绝，原有文件不被覆盖。
- 恢复数据字节或就绪标志被篡改时复验失败。
- 恢复中断后保留标记为失败的独立副本，原候选不变。
- 原候选移走后，恢复副本仍能独立复验。
- 实际 CLI 恢复和复验成功，标准输出和错误输出不包含测试凭据。
- 完整套件覆盖原有身份、工作区权限、任务网关、真实 HTTP/WebSocket 和 Caddy 验证。

## 不能据此认定完成的项目

本轮仅验证离线数据恢复和本地回归。`migrationReady`、`restoreReady` 均为 false，`applicationConsistency` 为 `not_proven`。未启动旧版应用验证业务恢复，未切换生产，未改动 VPS 或 Tailscale Relay，也未证明 Windows ACL 已完成审计。

原快照范围之外的身份库、迁移后新增数据和其他未清点目录不自动回滚。当前新增源代码还需 Linux 隔离复验；旧版本的 Linux 结果不能替代此次验收。生产维护窗口、数据归属、多用户业务场景、持续压力、公开 HTTPS 以及 Muse 老镇、dots 玄玑自身云端电脑执行证据仍按总计划单独验收。Open WebUI 不属于接入目标。
