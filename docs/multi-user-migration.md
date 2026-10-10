# 多工作区旧数据迁移：离线准备进展

当前只实现 dry-run 盘点和 SQLite 一致性备份。**不是已完成的数据迁移，也不能用于生产激活。**
`applyMigration` 和 `verifyMigration` 暂时明确拒绝执行；不会写入 migrationReady，
不会生成成功发布标记，不会覆盖源数据或已有候选目录。后续完整迁移、恢复、验收仍在实施计划中。

## 只读盘点

```sh
node scripts/migrate-workspaces.cjs \
  --source-root /absolute/old-data \
  --target-root /absolute/new-candidate \
  --workspace-id ws_explicit \
  --owner-id user_explicit
```

两个根目录必须独立、互不包含，路径及父目录不允许符号链接/目录联接；
目标目录必须不存在或为空。默认命令只打印 JSON 报告，不创建目标或更改源文件。
省略归属可以用于盘点，但会明确报告需要选择工作区和所有者，不能视为已授权迁移。

报告包含旧库表名、计数和工作区列情况；六类已知业务表与研究表按既有表清单分类，
未知表列为待隔离/复核，不把未知数据当作可以删除。对配置、memory/research、上传和附件
生成有界文件清单和哈希；未分类根目录项、大文件及特殊文件需继续复核。
这份有界盘点不是完整的候选清单，也不是未来 apply 的免复核授权。

Ollama、供应商 ID、旧 Agent 的自定义模型仅作为安全元数据显示；原配置字节不修改。
报告不输出配置中的 API 密钥、模型接口凭据、JSON 记忆正文或附件内容。
源身份库若缺失，报告需要独立账号初始化；不猜测所有者、不建立虚假账号或自动合成密码。
如源身份库已存在，显式所选 owner/workspace 的现有关系也必须核验。

## 一致性备份 API

```js
const {backupDatabase}=require('./scripts/migrate-workspaces.cjs');
const snapshot=await backupDatabase({
  sourcePath:'/absolute/old-data/db/lack.db',
  targetPath:'/absolute/private-snapshots/lack.snapshot.db',
});
```

调用 SQLite 在线备份 API，而非复制正在写入的主文件/WAL。源连接只读，
不会停止源写入者、强制 checkpoint 或调用任何服务管理命令。
私有临时副本通过 integrity_check/foreign_key_check 后，用同文件系统硬链接进行
原子“不覆盖已有文件”发布；文件系统不支持该方式时失败，不退回覆盖型 rename/copy。
这里只证明数据库快照一致，不证明六类表已转成工作区 schema，也不证明配置、
附件和多个数据库在同一应用时刻取得了完整备份。

目标备份目录须已存在且受控。快照、源数据、真实账号、令牌和报告存放 Git 外；
示例不能指向正在使用的生产目录。目录权限、保持时长和整套回滚将在后续实现中确认。

## 当前测试及未完成项

本地测试覆盖非空目标、根目录重叠/联接、配置错误、未知表、原字节/来源链接保留，
以及实际 WAL 数据进入 SQLite 备份、源写入者保持可用和目标不被覆盖。
测试使用独立合成数据库；没有复制 VPS 的真实业务库或读取其凭据。

仍需实现：显式归属转换、未知数据隔离、完整附件引用验证、幂等版本清单、
原子候选发布、失败恢复、整套回滚、持久任务/审计恢复，以及三账号/两工作区、
模型/节点/研究来源的完整验收。入口修复和真实模型/Muse/dots 验收也未完成。
不能把此准备阶段当作第 11 阶段完成，更不能宣称整个系统可交付。

## 已实现的旧协作表转换组件（不是完整迁移）

`scripts/convert-legacy-collaboration.cjs` 提供私有离线 API
`convertLegacyCollaboration({source,target,identity,workspaceId,ownerId,defaultModel})`。
输入是调用者已安全打开的只读数据库副本，输出必须是另一份全新的空数据库；
调用者仍负责数据库连接、路径边界、私有目录及快照验证。
这不是直接读取原始在线库或修复关闭 WAL 读取问题的入口。

组件复用现有协作 schema，不建立平行存储。六类核心表以及可选的研究会话/来源
在一个目标事务中转换，核对行数、完整性和外键；父消息可以在导入顺序后方。
孤立引用、未知 Agent 作者、坏 JSON、带凭据的来源链接、非所有者，以及已有工作区
归属都会拒绝转换；失败不保留部分导入行，不覆盖已有库。
Ollama 的旧默认行为、自定义模型、原始 URL、摘录及缺证标识保持为原始数据。
`created_by` 是经操作员确认的数据管理归属，不是对历史消息真实作者的验证；
返回报告明确标注 `operator-assigned-not-author-verified`。

未知表留在源副本并返回名称和计数，**外围完整迁移仍须将其保存在隔离档案并复核**。
附加自定义列、文件映射、附件引用、网关节点/租约/凭据和事件不由这个组件迁移。
输入上限为 50,000 行和 64 MiB 数据库；目标上限为 16,384 个 SQLite 页
（默认 4 KiB 页约为 64 MiB），超限明确失败，不截断数据。

专项与既有离线回归通过 41/41。组件始终返回 `migrationReady=false`，不会打开端口、
启动服务、复制节点令牌或写入生产配置。`applyMigration`/`verifyMigration` 完整入口仍关闭；
关闭 WAL 数据库读取的回归尚未通过，等待最小修正确认。

## 2026-10-10 source-reader and owner repair checkpoint

The closed-WAL source preservation defect is fixed and its regression passes.
A private, stable main/WAL copy is recovered only inside an owned directory;
planning, inspection and native backup never open the operator original through
SQLite. Source changes or unsupported journals fail closed. Existing source
hash/count requirements and non-activatable preparation remain in place.

The gateway conversion's nine tests pass after correcting the identity API
signature. It still does not implement whole migration activation. Current full
regression: 434 tests, 426 passed, 8 failed, no skips. Actual apply/verify, complete
quarantine/file handling, failure recovery and production acceptance remain
unfinished; see `verification/2026-10-10-identity-snapshot-repair.md` for scope,
evidence and remaining requirements. Original grant/provider/Ollama support is
not removed. No production or credential changes are included.
