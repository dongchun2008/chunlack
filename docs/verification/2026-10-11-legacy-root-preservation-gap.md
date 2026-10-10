# 2026-10-11 旧根目录数据保全缺口

## 新的直接证据

本轮只读核对真实 VPS 旧数据及已准备快照的未解决清单，没有修改业务代码或生产数据。UTC 检查时间为 `2026-10-10T23:25:53.778Z`，北京时间为 2026-10-11 07:25 左右。

`/var/lib/chunlack` 有以下 12 个未分类根目录，模式均为 0700。子条目数量仅由 readdir 得出，没有查看其内容；也未检查每个子条目的类型。

| 根目录 | 直接子条目数 |
| --- | --- |
| .github | 1 |
| agent_memories | 1 |
| build-cache | 1 |
| git | 0 |
| home | 0 |
| jspace | 1 |
| k8s | 0 |
| lack_repos | 1 |
| lineage | 1 |
| logs | 2 |
| thread_repos | 0 |
| workspace | 2 |

这些名字和数量不证明具体内容、用途或可丢弃性。特别是，不能因 SQLite 的 agent_memory 表为 0 行，就推断 agent_memories 目录为空或全部记忆已经恢复。也不能根据名称把工作目录、仓库目录和 lineage 当作缓存删除。

## 对之前验收结果的影响

之前的 28 项快照记录及其独立恢复校验仍然成立，但只覆盖工具声明的配置、数据库及已知目录范围。未分类根目录没有作为内容或空目录结构纳入该快照，因此它不是整个旧数据根目录的完整备份，更不是全部记忆、仓库、文件工作成果或应用恢复验收。

原有三个未解决项继续成立：`unclassified_root_entry`、`explicit_ownership_required`、`owner_identity_requires_bootstrap`。`migrationReady=false`、`restoreReady=false`、`applicationConsistency=not_proven` 均未变更。不会借助准备快照的成功状态绕过这些门槛。

## 后续设计范围，尚未批准实施

已向用户提出扩大私有归档范围的确认请求。待确认后先提交兼容设计审核，不能把早先的测试通过当作新格式已批准或已实现。

设计需处理以下要求：保全未分类文件及空目录结构；明确快照版本和旧格式读取/拒绝策略；限定归档路径、条目数、体积及权限；拒绝越界和链接；保持未知数据未归属，不进入 Agent 执行上下文；保留源数据变化检测和所有就绪阻断；完成本地全量及受限原生复验。需要协调快照、验证、独立恢复及相关消费方，不只添加一个文件夹名字。

本轮没有写产品代码、改归档格式、扩大实际复制范围、启动或切换生产，也没有修改旧凭据或同机服务。旧数据归属与真人负责人仍需用户明确指定；真实模型和 Muse 老镇/dots 玄玑自身执行仍待验证。

## 私有证据

本地证据为 `.superpowers/sdd/2026-10-09-multi-user-workspace-delivery/offline-restore-20261011-c07f619a/unclassified-root-metadata.json`，SHA-256 为 `f88725d9a9ad9b81c0141a5577077b6c862a66c3a6b1471bc1080f9641dbec1d`。只包含路径元数据、原生未解决代码及未就绪标记，没有消息正文、配置内容或凭据值。

相关历史范围及限制见 `2026-10-11-existing-data-offline-restore-trial.md`。业务代码未变，不重复同一套模拟测试制造进展。
