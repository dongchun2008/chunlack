# Agent authority migration release gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 将已通过副本验证的 Agent 授权首次迁移纳入现有发布门槛，只允许固定的预期变更，保留未知变更拒绝和数据保护。

**Architecture:** 复用现有四份发布脚本，不另建发布器。默认保持原有结构完全相等检查；只有操作者显式选择 agent-authority-v1 时，才使用独立冻结的结构定义、私有副本数据指纹和绑定候选的兼容性证明。候选验收与回滚门槛必须同时覆盖合法迁移状态，不恢复旧数据库覆盖用户新写入。

**Tech Stack:** Python 标准库 sqlite3、hashlib、hmac；现有 Node、better-sqlite3 和 systemd 隔离测试。不增加运行时依赖或常驻服务。

**Spec:** docs/MCP_ONLY_CONFIGURATION.zh-CN.md；docs/verification/2026-10-18-controlled-copy-migration.json；本计划的 Global Constraints 和 Contract。

## Status and evidence

本计划待人工确认，尚未实施。起点为 cloud-agent-pilot-foundation 的 591252d。既有控制器本地 25 项通过、2 项平台跳过；Linux 27 项通过。副本已验证候选、现网旧版代码副本及候选再次启动，原身份与业务数据保留，故障事务回滚，零新增授权。

当前结构基线提取单元已成功退出且 cgroup 为空，但日志 MESSAGE 空值使结构化目录保存失败。不能将这次观测视为已取得固定目录；任务 1 必须先补齐此项。

## Global Constraints

- 本阶段仅本地和隔离开发测试，不修改或发布生产服务。
- 保持 55 秒前向和 120 秒总恢复窗口，不扩大已有停止目标。
- Linux 测试最多 192 MiB、10% CPU、TasksMax=32、RuntimeMaxSec=90，私有网络，独占可写目录；串行运行，禁止叠加额度。
- 不改凭据、DNS、端口、旧 LACK 或 Tailscale Relay；不授予 API 或工作区访问，不复用 Open WebUI 凭据。
- 不删除遗留 writer lock，不通过恢复旧数据库抹掉用户新数据。
- 默认 discovery-only 和无 migrationContract 的路径保持现有严格行为。
- 保留 Ollama 与供应商中立路由；本次不改模型层、节点协议或 UI。
- identity/workspace-shell.js 的既有无关修改保留，不纳入提交、候选或测试包。
- 所有失败尝试保留；模拟模型、组件检查和私有副本验收均不替代真实外部 Agent 或生产验收。

## Contract

部署私有 settings 只新增可选 migrationContract，值只能为 null 或 agent-authority-v1。未知值在停服务前拒绝。该策略只能与 mcp-only 配合；首次迁移的源身份库必须完全不存在本策略的新增对象和两条组件版本记录，部分迁移状态拒绝。已有迁移库的普通后续发布沿用默认严格路径，不重复授权首次迁移。

结构预期来自已验收的冻结副本，不从本次待发布候选或其输出自动生成。固定目录包括 2 张表、12 个触发器、3 个自动索引，共 17 个对象；校验 type、name、tbl_name 和 SQL 的精确定义，自动索引 SQL 为 null 的语义也必须保留。所有原有对象必须逐项不变，其他数据库结构完全不变。

私有副本中，原有身份与业务表的每条记录必须保留。schema_version 仅允许新增 agent-authority 与 agent-membership-epochs 两条 version=1 记录，原记录不变；新增时间须落在本次迁移区间。epoch 为全部 membership 正确回填，满足格式与外键；初始授权表为空。故障注入必须留下原始状态，重复初始化和旧版打开不得重置 epoch 或改动身份数据。

线上事务只做轻量精确结构检查和已绑定证明验证，不在维护窗口内全量扫描活跃用户数据。完整数据保留检查在私有副本执行，证明绑定候选文件摘要、旧版摘要、结构基线、策略及不含凭据的相关配置摘要；冷备份完成后重新核对源结构，防止预检后结构漂移。

回滚允许原始结构或完整且精确定义匹配的迁移结构；中间、未知、同名异定义状态不得标为恢复成功。任何回滚都保留用户新配置、上传和数据库新写入。

## Review Focus

- 同名表或触发器定义被替换，名称看似正确但约束或副作用不同，必须拒绝。
- 证明过期、被替换，或候选、旧版、配置、策略在验证后变化，必须在停机前拒绝。
- 源库已部分迁移，或在预检与冷备份之间结构漂移，必须停止发布而非补修数据库。
- 迁移后失败且用户已有新写入，旧版恢复必须保留新写入，不回灌历史备份。
- 大字段、BLOB、Unicode、空值和大量记录的指纹计算必须有界、保留类型，不输出原始用户记录或 HMAC 密钥。

## Files and interfaces

修改以下四份脚本，保留现有打包文件集合，不新增发布运行依赖：

- deploy/public/release-control/2026-10-17/release-discovery-safe-20261017.py：固定策略与精确目录、证明绑定、候选和回滚门槛。
- deploy/public/release-control/2026-10-17/stage-schema-compatibility-20261017.py：私有副本数据证明、候选与旧版及重复启动结果。
- deploy/public/release-control/2026-10-17/test-release-discovery-safe-20261017.py：真实 SQLite 和实际运行时回归。
- deploy/public/release-control/2026-10-17/rehearse-operational-release-20261017.py：策略传递与故障回滚演练，仍明确其 HTTP fixture 边界。

说明同步到 docs/MCP_ONLY_CONFIGURATION.zh-CN.md，实际结果新增独立验收 JSON，不改写历史失败记录。

在控制器中定义共享接口；既有 schemas(root, tick, cold) 返回数据库相对路径到 SHA-256 的映射，默认调用不变：

- validate_migration_contract(profile: str, value: object) -> str | None：仅接受上述策略和配套 profile。
- schema_details(root: Path, tick, cold: bool) -> dict[str, list[tuple[str, str, str, str | None]]]：包含自动索引等对象定义，只读、有界。
- verify_schema_transition(before: dict, after: dict, contract: str, allow_baseline: bool = False) -> str：只返回 unchanged 或 agent-authority-v1，否则拒绝。
- copy_data_fingerprint(root: Path, key: bytes, tick) -> dict：流式、保留值类型的行多重集 HMAC 与计数，密钥不进入输出。
- verify_copy_migration(before: dict, after: dict, contract: str, phase: str) -> None：核对原记录、精确版本新增、epoch、零新授权和幂等性。
- verify_compatibility_proof(report: Path, settings: dict, candidate: Path, current: Path) -> dict：核对私有文件所有者、权限、无符号链接，以及候选、旧版、策略、配置和源结构绑定。

## Task 1 Fixed contract and private-copy verification

**Consumes:** 已验收副本、现有 schemas() 和 SQLite 事务行为。

**Produces:** 上述前五个共享接口及其固定目录；默认严格路径不变。

- [ ] 修正只读目录观察器：获取完整日志字段并检查 MESSAGE 类型；缺字段或空值必须报告不完整，不能视为成功。继续读取同一个已结束单元，不重复启动探针。
- [ ] 从已验收副本 /var/lib/chunlack-schema-trial-95feb3a3029d 提取 17 个对象及精确定义，连同已验收记录和候选模块摘要冻结；副本缺失时先重做同等验收，不能从新的待发布候选学习预期值。
- [ ] 编写并运行 RED 用例，至少覆盖默认严格、未知策略、错误 profile、合法新增、同名 SQL 被篡改、多余或缺失对象、原对象改变、部分迁移。
- [ ] 增加真实 SQLite 数据用例：删除或覆盖旧记录、额外版本组件、错误版本或时间、epoch 缺失或错绑、新授权非空、BLOB/Unicode/空值和重复行；错误输入必须拒绝。
- [ ] 在现有控制器嵌入独立冻结目录并实现共享函数；数据指纹不使用待测逻辑生成期望值，不加载新候选作为校验器，不输出账户数据。
- [ ] 运行完整控制器测试，保留既有 27 项及平台差异，记录实际总数、通过、失败、跳过和退出码；不得把子断言数量当成独立测试数。
- [ ] 通过后仅提交共享契约及相应测试；不包含无关 UI 或私有数据。

## Task 2 Formal stage and controller integration

**Consumes:** Task 1 的接口、固定目录及现有 stageHashes、preparedHashes、显式 Agent 客户端批准列表。

**Produces:** 受控迁移可通过、未知变化仍拒绝的副本证明和事务门槛。

- [ ] 编写 RED：仅有 status=passed 但缺绑定证据必须在停机前失败；候选、旧版、配置、策略、源结构任一漂移均失败。
- [ ] 编写 RED：Transaction 候选门槛接受精确完整迁移；回滚门槛仅接受原始或完整迁移结构，拒绝部分与未知结构；默认路径仍严格相等。
- [ ] 编写 RED：冷备份后源结构漂移在代码切换前被拒绝；迁移后故障恢复旧版仍保留新配置、上传及数据库新写入。
- [ ] stage 在复制完成后捕获副本基线；显式策略下运行候选、实际旧版副本、候选再次启动，并验证数据、结构、完整性、外键、健康与 writer lock 清理。无策略路径保留原两次启动及严格检查。
- [ ] 私有兼容性证明只保存版本、固定目录摘要、源码摘要、必要配置摘要及结果，不保存原始行或指纹密钥；由 preparedHashes 绑定。preflight 在停止任何目标服务前核验证明；冷备份后再次核对源结构。
- [ ] 将现有 candidate_schema_changed 与 rollback_schema_incompatible 两处检查接入显式契约；保留原始备份和 manifest，不自动删表、修库、删锁或恢复旧数据库。
- [ ] 原服务生命周期 fixture 增加显式策略的成功与回滚场景，验证默认兼容与资源总额；不将该 fixture 当作真实 TLS 或实际数据迁移验收。
- [ ] 本地全量控制器与原限额 Linux 验证全部通过后，重新执行实际数据库与旧版代码副本验收和故障注入，保留每份报告。
- [ ] 独立复核通过后更新说明及独立验收记录，秘钥扫描、限定路径提交并同步 GitHub。不得发布生产。

## Verification commands and acceptance

本地使用现有显式 Node 与隔离源码路径，不隐式回退到生产依赖：

~~~powershell
$env:CHUNLACK_TEST_NODE = 'C:/Users/dongc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
$env:CHUNLACK_TEST_PRODUCT_ROOT = 'C:/Users/dongc/.cache/chunlack-tests/mcp-full-XjFlHt/source'
& C:/Python/Python313/python.exe -B deploy/public/release-control/2026-10-17/test-release-discovery-safe-20261017.py
~~~

Linux 使用新独占目录、显式相同候选哈希和原限额，不与其他压测并行。源码和依赖只读，仅 scratch/results 可写；停止后核验 MainPID=0、cgroup 为空、真实终止日志与四项原服务 PID/重启计数不变。单元 GC 后的默认 Result=success 不能作为成功退出证据。

验收要求：所有既有回归保留；上述拒绝场景和真实副本成功场景均具备证据；默认行为兼容；没有未知结构被放行，没有用户新写入被覆盖。失败则保留诊断并停止，禁止自动增大超时或资源限制。

## Delivery boundary

本计划完成后只代表正式发布门槛的本地与隔离验证完成。生产发布仍需要新的限定维护授权、一致性备份、回滚与共宿服务核验。真实 Muse 老镇、dots 玄玑自身电脑的任务执行证据，以及实际五节点持续协作验收仍是独立交付门槛，不能用模型调用数、模拟节点或健康接口代替。
