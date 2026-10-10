# 经审阅的工作区离线迁移

这是生成独立迁移候选的工具，不是生产切换或自动部署工具。**`migrationReady: true` 只表示本工具已完成候选转换与校验；不表示 Linux、恢复、真实模型、外部 Agent 或业务验收已通过。`restoreReady` 仍为 false。**

## 输入和安全边界

- 源是旧 LACK 的数据根目录，必须存在 `config/lack.config.json` 和 `db/lack.db`，不是整个代码仓库或机器根目录。
- 候选和快照使用新的独立目录，不覆盖、重用或删除既有目录。已有成功候选仅允许按同一计划再次校验，不重新导入。
- 必须提供已有的有效身份数据库、真实工作区 ID、当前所有者 ID，以及显式模型授权清单。工具不生成管理员密码，不扩大权限，不修改源身份或既有凭据。
- 保留 Ollama 和供应商中立配置。模型授权中的 Provider ID、模型 ID 必须匹配实际旧 Agent；这一步不调用任何模型，不要求 Open WebUI。
- 源主库、已有 WAL 和身份源必须在读取阶段保持稳定；源变化即失败。持续写入的生产源应先安排 LACK 自身的维护／暂停窗口，不能停 Peer Relay 或删除 WAL／SHM 来绕过检查。
- 单文件上限 64 MiB；快照和候选均有文件数量、总字节数和目录深度限制。还会检查候选所在磁盘的剩余空间。这些不是实际 VPS 性能上限证明。
- Windows ACL 尚未获得独立验证。敏感输入、快照及候选应位于你控制的私有目录；Linux 验收必须另行确认私有权限和资源预算。

下面的绝对路径只是示例，不是当前 VPS 路径。不要在 VPS 上照抄 Windows 路径，不要把真实凭据或这些运行文件提交 Git。

## Windows 命令示例

先在私有目录准备身份源、真实 ID 和模型授权文件；目录的父目录必须已经存在。模型授权格式示例仅用于说明，必须替换成已有配置中的真实 ID，不能使用通配符：

```json
{"your-provider-id":{"models":["your-exact-model-id"]}}
```

```powershell
Set-Location 'C:\Users\dongc\Documents\Codex\lack\temp-chunlack'
$node = 'C:\Users\dongc\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$source = 'C:\ChunLACK-private\source-data'
$target = 'C:\ChunLACK-private\new-candidate'
$snapshot = 'C:\ChunLACK-private\reviewed-snapshot'
$identity = 'C:\ChunLACK-private\identity-source.db'
$planFile = 'C:\ChunLACK-private\reviewed-plan.json'
$grantFile = 'C:\ChunLACK-private\model-grants.json'
$workspaceId = 'replace-with-real-workspace-id'
$ownerId = 'replace-with-real-current-owner-id'
```

1. 生成预览，核对所有者、表计数、文件哈希、未解决项与 Provider／模型。以下以独占创建方式输出 UTF-8 无 BOM 的计划文件，不覆盖已有审阅记录。

```powershell
$preview = & $node scripts/migrate-workspaces.cjs --source-root $source --target-root $target --workspace-id $workspaceId --owner-id $ownerId
if ($LASTEXITCODE -ne 0) { throw 'Migration preview failed' }
$planBytes = [Text.UTF8Encoding]::new($false).GetBytes(($preview -join "`n") + "`n")
$stream = [IO.File]::Open($planFile, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
try { $stream.Write($planBytes, 0, $planBytes.Length); $stream.Flush() } finally { $stream.Dispose() }
```

2. 准备独立快照。此时返回的 `migrationReady` 必须为 false。快照不是恢复验收，也不会启动服务。

```powershell
& $node scripts/migrate-workspaces.cjs --prepare-snapshot --source-root $source --snapshot-root $snapshot
if ($LASTEXITCODE -ne 0) { throw 'Snapshot preparation failed' }
```

3. 只有确实审阅上述计划、身份和模型授权后，才执行带 `--reviewed` 的命令。

```powershell
& $node scripts/migrate-workspaces.cjs --apply --reviewed --plan-file $planFile --snapshot-root $snapshot --identity-source $identity --grants-file $grantFile
if ($LASTEXITCODE -ne 0) { throw 'Reviewed migration failed; do not activate candidate' }
```

4. 在尚未投入运行的候选上再次离线校验。同一计划重复执行第 3 步也只校验既有成功候选，不重复插入业务行。

```powershell
& $node scripts/migrate-workspaces.cjs --verify --plan-file $planFile
if ($LASTEXITCODE -ne 0) { throw 'Candidate verification failed' }
```

## 成功后的目录

- `config/lack.config.json`：保留源模型配置及必要凭据，增加显式工作区模型授权；不要公开或上传此文件。
- `db/lack.db`：按所选工作区转换的旧核心协作数据及研究记录。
- `db/identity.db`：经验证身份源的独立副本；原身份源不改。
- `db/agent-gateway.db`：工作区绑定后的节点和任务；旧令牌／配对码不复用，旧节点停用，有效租约保留占用，待执行任务需重新授权。
- `workspaces/<workspace-id>/`：旧记忆、研究、上传、附件及历史文件的工作区副本。
- `artifacts/public-pilot/workspaces/<workspace-id>/`：经过元数据与原图哈希校验的受支持截图；不会生成替代证据。
- `quarantine/snapshot/`：完整保留本次受支持快照，包括原表、未知表、原配置及原文件；不作为活动 Agent 或事件状态使用。
- `migration-manifest.json` 与 `migration-state.json`：离线候选的文件哈希、数据库计数、绑定和发布状态。

未受支持的根目录内容、额外权限／数据结构或图像不能当成已完成迁移。当前图像转换只支持受限 PNG，其他格式必须显式适配或复核。旧 MCP Events 数据保留在隔离快照，不自动激活或发送旧事件。

## 失败与恢复

无审阅许可、所有者无效、模型未授权、证据缺失／变化、路径链接、目标占用、源变化或校验失败均会停止；CLI 返回非零状态及脱敏错误，不输出 API 密钥。

已经创建的失败候选保留为诊断资料，配置维持 `migrationReady: false`。不要修改标记、重新封装清单或覆盖失败目录来强行启动；后续应通过明确的恢复／回滚验收流程处理。工具不会删除源、失败候选或原服务，也不会修改 DNS、占用 443 或重启 Relay。

候选一旦正常运行，业务数据库和文件会发生合法变化，因此本工具的离线文件清单校验不是日常健康检查器，不应当作运行期自动重启门槛。实际切换前还必须完成 Linux 隔离、恢复、真实模型、真实 Agent、多人工作区及共驻服务验收。
