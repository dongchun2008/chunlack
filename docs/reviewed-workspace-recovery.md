# 经确认的迁移快照恢复

## 用途和边界

本工具从迁移候选的 `quarantine/snapshot` 生成独立的旧数据副本。候选可以是已发布状态，也可以是转换中断后的失败状态；仍在构建的候选不能恢复。

这是离线数据恢复，不是生产回滚按钮。工具不会启动旧版本、停止新版本、覆盖原目录、修改外部身份数据库、注册系统服务、连接模型、开放端口或改动 Tailscale Relay。原数据、迁移候选和恢复副本必须分别保留。

恢复结果始终返回 `migrationReady: false`、`restoreReady: false` 和 `applicationConsistency: not_proven`。SQLite 完整性、外键、表计数和文件哈希通过，不等于旧应用业务恢复已经验收。尤其是旧版本可能忽略这些标志，因此不能手动把此副本指给在线服务，必须另行确认停机窗口、数据归属、版本兼容性和业务验收。

## 前置条件

- 已明确确认恢复范围，使用 `--reviewed`。
- 原候选包含完整、未篡改的隔离快照和有效迁移状态记录。
- 已发布候选的快照必须与迁移清单的哈希和记录一致；失败候选使用状态中的快照编号和快照自身验证，不能将其表述为已发布清单证明。
- 使用绝对路径；目标目录不存在，父目录已存在。源、目标不得重叠，也不得经过符号链接或 Windows junction。
- Linux 目录和文件采用私有权限；Windows 结果会明确标注 `windows_acl_not_verified`，不代替 Windows ACL 审计。
- 保持足够磁盘空间；预检预算为快照文件大小的两倍加 128 MiB。每文件、文件数、深度和总大小均有上限。

## 命令

以下路径仅为示例，请替换为已确认的独立候选路径；不要使用正在运行的生产目录作为恢复目标。

```powershell
node scripts/migrate-workspaces.cjs --recover --reviewed --candidate-root C:\private\lack-candidate --recovery-root C:\private\lack-recovery
node scripts/migrate-workspaces.cjs --verify-recovery --recovery-root C:\private\lack-recovery
```

Linux 使用同样的参数和绝对路径。恢复模式与应用、迁移复验、准备快照模式互斥；复验恢复模式只接受恢复目录，不重新导入数据。

结果仅打印状态、编号、路径和验证边界，不打印配置、模型密钥、密码或证据内容。配置副本本身可能含原有凭据，必须保留在私有目录，禁止加入 Git 或公开上传。

## 输出目录

```text
<recovery-root>/
  recovery-state.json
  recovery-manifest.json
  snapshot-trial/
    restore-trial-state.json
    payload/                   # 完整独立快照及原快照清单
  legacy-data/
    config/lack.config.json    # 准备快照时的配置，迁移就绪标志为 false
    db/                       # 旧表结构数据库，保留未知旧表
    memory/                   # 如原快照中存在
    research/
    uploads/
    artifacts/
    attachments/
  original-config/
    lack.config.json          # 原配置逐字节保留，不自动使用
```

仅物化快照已包含的受控目录，不自行搜索其他目录。可迁移的模型配置保持原样，包括 Ollama 和其他供应商；工具不验证或调用这些模型。外部提供的身份库若未在原快照范围内，不自动恢复；快照也不覆盖迁移后的新增任务或数据，不能无条件切换回旧副本。

## 验证和异常处理

- 校验完整副本清单、文件哈希、SQLite 完整性、外键和表计数。
- 校验原配置字节以及准备配置的禁用标志；独立复验不依赖原候选仍位于原路径。
- 原候选完整性检查只核对隔离快照和其来源证明，不把运行后合法变化的活动数据库误判为快照篡改。
- 原候选、快照在复制期间变化时拒绝发布；恢复异常会保留自身拥有的失败副本，不删除源数据。
- 中断后的副本不能通过独立复验。需要再次执行时选择新的、不存在的恢复目录，不覆盖旧失败副本。

## 后续业务验收

在专用隔离环境中用对应旧版本验证消息、项目、附件和来源链接，再验证多用户隔离、任务生命周期、HTTP/WebSocket 重连及审批边界。新旧版本切换、生产回滚、Linux 当前版本复验、真实模型以及外部 Agent 自身执行证据仍是独立验收项。Open WebUI 不在接入范围内。
