# 2026-10-11 旧数据根目录 v2 归档验收

## 范围与状态

用户批准旧数据根目录兼容设计及开发测试。新快照、准备状态与独立恢复标记采用 v2，完整记录有界源库存和空目录；v1 仍可读取，但必须明确标注原允许清单的部分覆盖。未知文件只保存在私有 `archive/legacy-root`，不自动激活、导入工作区或推断归属。

本轮同步的是已测试的开发分支代码，不是生产发布。VPS 原生全根目录验收、应用恢复、公网 HTTPS 和真实外部 Agent 验收仍须取得独立证据。

## 真人归属确认

用户已明确选择工作区名称 `ChunLACK`、真人负责人登录名 `chunlack-owner`。账号待创建，尚未初始化密码；不使用 VPS root、GitHub 用户或 Agent 名称代替真人身份。确认名称不等于建立账号、分配模型权限或切换生产。

## 实现与审查修正

- 全根目录库存有界：4096 源条目及 4096 载荷记录，目录计入预算；每文件 64 MiB，总量 512 MiB，源路径深度 12，清单 2 MiB。
- 来源文件与目录在准备前后核对身份和字节，链接、特殊文件、越界、并发变化及非空回滚日志失败关闭。
- 原配置、未知数据库和仓库文件保留；已知 SQLite 数据库采用标准化备份，普通 `.db/.sqlite` 附件不按扩展名误当数据库打开。
- 恢复、候选迁移、失败恢复共同识别目录记录和 v2；独立校验拒绝缺失或未声明的空目录。
- 独立只读审查发现普通附件误分类、旧计划深度限制、Windows 大小写重叠三项问题。真实文件系统与实际迁移/恢复回归先复现三项失败，再修正为 3/3 通过。
- 原生 Linux 权限仍须实测；Windows 不声称已证明 Linux 私有权限。

## 本地证据

环境：Windows，Node v24.19.0，已有 Caddy v2.11.7，没有安装全局软件。

初次不带 `CADDY_TEST_BIN` 的全量运行退出 0：489 项中 482 通过、7 项真实 HTTPS/WSS 集成跳过，耗时 369873.3384 ms。该运行不能写作全部通过。

随后仅在测试进程设置 `CADDY_TEST_BIN`，运行：

```powershell
node --test --test-concurrency=1 --test-timeout=90000 tests/*.test.cjs
node tests/smoke.cjs
```

全量退出 0，489/489 通过，失败、跳过、取消均为 0，耗时 397584.1194 ms。冒烟退出 0，覆盖真实 HTTP/WebSocket、两个模拟模型后端、SQLite 重启持久化、私有绑定及配置保留。此处真实 TLS 不等于公网证书验收，模拟模型也不等于外部 Agent 的电脑能力。

此前一个全量运行因具体审查风险被主动中止，退出 -1，保留为中止证据，不计为通过。定向旧/新快照与迁移测试 43/43、审查回归 3/3 均已观察实际退出 0。

## 1Cat 现场核对及未通过项

用户指定先用 1Cat，并参考现有 Open WebUI 参数；未接入 Open WebUI、调用其 API 或读取其密钥。既有推理路由的 `/v1/models` 返回 `qwen38-27b-nvfp4`。

一次直接后端小请求 HTTP 200，返回模型一致，输出 `OK`，22 输入 token、2 输出 token，客户端耗时 574 ms。VPS 通过已存在的 Tailscale 私网访问该路由，健康与模型列表均 HTTP 200；未改变任何监听、路由、Tailscale 配置或 Relay 服务。

独立一次性 ChunLACK 实例使用真实 HTTPS/WSS、真人会话、工作区模型授权和现有 Provider 路径，经只监听回环的有界测试转发器调用真实 1Cat。最多允许三次推理、每次输出最多 32 token，实际路由日志记录两次成功请求。另一工作区账号访问该工作区被拒绝。

试点未全部通过：重启后 `/api/tasks` 的 `localTasks` 没有已完成记录。源码 `collaboration/task-control.cjs` 明确使用有界内存 Map，且声明持久恢复/外部租约账本独立。因此不能据此声称本地任务历史已持久化，也不能将该试点记为完整真实模型验收。保留失败断言，后续须明确持久本地任务记录的最小实现范围；不删断言凑通过。

测试脚本还先后因模块相对路径与非法供应商 ID 退出，已修正测试输入并保留日志；这些不是生产故障。所有试点进程和一次性数据由自有 fixture 关闭/清理，未创建正式 `chunlack-owner` 账号。

## 当前生产基线

UTC 2026-10-11 00:57 的只读采样：生产 LACK PID 234963、Tailscale PID 859，均 active/running、NRestarts=0；LACK `/health` HTTP 200；Relay UDP 40000 保持监听；TCP 443 无监听；生产发布仍为 `e188eae`。可用内存 1112908 KiB，Swap 使用 0，磁盘可用 32360920 KiB，load1 为 0。

这不是 Relay 业务吞吐或应用一致性证明，不据此直接部署或重启现有服务。

## 私有证据与剩余门槛

运行日志、原始 SSH 输出和真实模型试点脚本保存在忽略目录 `.superpowers/sdd/2026-10-11-legacy-root-archive/`，不上传真实配置、数据库、凭据或生产库存清单。

所有快照及恢复仍保持 `migrationReady=false`、`restoreReady=false`、`applicationConsistency=not_proven`。完整交付还需原生全根目录归档、应用一致性备份与恢复、真人账号初始化及明确资源授权、受控发布和回滚、两个公网入口验收、完整真实模型链路、Muse 老镇/dots 玄玑自身执行与证据回传、忙碌节点及 Relay 业务共存验证。当前不宣称系统可直接交付。

## VPS 原生演练的阻断及结束状态

归档源码提交 `ed9b00e13646ca9cd82c30d717f0cbaafd980bfa` 已同步到 GitHub 开发分支，并从该提交生成 3942400 字节源码 tar，SHA-256 为 `989cfb3e48bec041a36768eb4dd07bfb458d3137e04f90cdccd79cffcf050e20`。解包前验证大小、哈希、路径、类型和容量；只在本轮 0700 root 私有目录操作，源码及上传文件为 0600。

两次真实源数据演练均在创建快照前终止，没有产生快照或恢复副本；第一次诊断过度隐藏错误，第二次仅加入安全阶段/错误码，定位为 `source_inventory / trial_source_entry_limit`。没有删除未知文件、过滤缓存或放宽源数据保护。首次目录 `/var/tmp/chunlack-root-v2-20261011-a6b4d927`、诊断目录 `/var/tmp/chunlack-root-v2-20261011-b8cfa761` 保留失败取证，不能算备份或恢复验收。

两次单元实际保持 CPUQuotaPerSecUSec=100ms、MemoryHigh=100663296、MemoryMax=134217728、TasksMax=32、RuntimeMaxUSec=90 秒、PrivateNetwork/PrivateTmp=yes、ProtectSystem=strict、原 `/var/lib/chunlack` 只读、本轮根目录显式绑定且仅该目录可写。退出码均为 1，包含 8 秒取证等待；第一轮实际服务 CPU 116ms、内存峰值约 20.1 MiB、Swap 0，诊断轮 CPU 103ms、峰值约 17.6 MiB、Swap 0，不是吞吐测量。

随后以另一个只读、禁止网络的 metadata 单元核对完整源目录，仅统计文件类型/大小，不读取文件内容：实际 1344 项、515 文件、829 目录、9734656 字节，未超过设计上限 4096，未观察到链接或特殊类型。`build-cache` 占 1277 项、9594218 字节，不能将此前浅库存 43 项称作完整根目录。metadata 单元退出 0，耗时 1.027 秒、CPU 111ms、报告内存峰值 516 KiB、Swap 0。

失败原因是本次演练脚本的 256 项保守上限，而非证明 v2 产品代码无法保存真实目录。已向用户请求仅将演练库存限额调整至 2048；总量 16 MiB、CPU/内存/时间/只读与网络隔离均不变。收到明确答复前，不自动扩大预算或跳过 `build-cache`。

UTC 2026-10-11 01:11 的结束采样：LACK PID 234963、Tailscale PID 859、NRestarts=0、active/running，LACK `/health` HTTP 200；Relay UDP 40000 保持由 PID 859 监听，TCP 443 仍无监听，生产发布 `e188eae` 不变。可用内存 1122800 KiB、Swap 使用 0、load1 为 0。三个试验单元 MainPID 均为 0，仅清除了两项自有失败单元的失败标记，不操作业务服务。

这仍是有限共存采样，不证明 Relay 转发业务或应用恢复。真人名称已确认，但账户尚未创建；公网入口和整体交付仍未完成。

## 原生 Linux 新增回归验证

UTC 2026-10-11 01:14，在既有 VPS 的独立代码目录使用 Node v24.21.0 和既有原生依赖，执行本轮两个新增测试文件。只使用合成 fixture，不使用生产数据，不安装全局软件：

```sh
node --test --test-concurrency=1 --test-timeout=70000 \
  tests/workspace-snapshot-root-coverage.test.cjs \
  tests/workspace-snapshot-review-boundaries.test.cjs
```

单元 `chunlack-root-v2-regression-b8cfa761.service` 使用与前述演练相同的 CPU/内存/任务数/90 秒预算、PrivateNetwork/PrivateTmp、原数据只读与自有目录绑定。systemd-run 实际退出 0：12 项通过，失败、跳过、取消均为 0，Node 报告 18103.830655 ms；服务实际耗时 18.694 秒、CPU 1.865 秒、内存峰值约 63 MiB、Swap 峰值 0。宿主包装器耗时 19.151 秒，不能混同于 Node 用例耗时或生产吞吐。

验证覆盖深度上限、目录预算、未知内容归档、空目录完整性、来源变更、链接拒绝、v1 兼容、未知版本拒绝、普通数据库扩展名附件及实际候选迁移/失败恢复。这不是原生 Linux 489 项全量回归，也不是生产真实目录的归档成功证据；Windows 专属语义以 Windows 全量证据为准。

真实源目录演练仍等待用户确认 2048 项库存上限，其余预算和保护条件不变。该批准尚未收到，未提前调整。

## Approved 2048-entry real-root trials (2026-10-11)

The user explicitly approved raising only the private trial source-entry cap from 256 to 2048. Product limits and all other trial budgets were unchanged: 16 MiB source total/per-file, depth 12, CPUQuota 10%, MemoryHigh 96 MiB, MemoryMax 128 MiB, TasksMax 32, RuntimeMaxSec 90, original source read-only, PrivateNetwork/PrivateTmp, strict filesystem protection, and a single fresh private writable trial root per run. No production restart, cutover, public listener, global install, credential, DNS, or Relay configuration change occurred.

Tested Git source: `047e2b0191c5f1e3391b9cc228a2691dd861b1c8`. Source archive SHA256: `24de9600ab2732868f5fc0d994733dbf549647097e8273808a323ed0162770b7` (3942400 bytes). The diagnostic helper is private/ignored and is not production code.

### Actual terminal results

- `chunlack-root-v2-ce432f8a.service`: exit 1 at the final source-inventory equality assertion, after archive and independent restore checks. Runtime 45.442 seconds, CPU time 3.744 seconds, memory peak 79.7 MiB as reported by systemd, swap peak 0. This passed the former source-entry gate, but did not pass overall acceptance.
- One bounded retry used a fresh private root and a helper that retained before/after inventories and reported differences without printing source contents. All equality checks remained strict; no assertions or source entries were skipped.
- `chunlack-root-v2-ea822ec9.service`: exit 1, `stage=source_stability_after_restore`, `code=trial_source_changed_after_restore`. Runtime 46.181 seconds, CPU time 3.809 seconds, memory peak 73.0 MiB as reported by systemd, swap peak 0.
- Retry source inventory: 1344 entries, comprising 515 files and 829 directories, totaling 9734656 bytes. The snapshot has 1349 typed records including derived records; this is not a source-entry count.
- Retry before/after path sets match. All source file byte counts and SHA256 values match. Exactly one source directory in `lack_repos` changed `mtimeMs` and `ctimeMs`; its writer and the cause of the metadata change have not been established. This does not prove the source was quiescent throughout the run.
- Before reaching that final failure, the helper completed v2 snapshot coverage/path/kind checks, independent restored file hashes and directory checks, copied SQLite integrity and foreign-key checks, copied database table-count comparisons, and recursive private/root-owned/no-link permission checks. These passing component checks do not turn the failed overall trial into a pass.
- Copied `lack.db` counts: agents 1, messages 13; agent_memory, loop_health, pipeline_results, project_states each 0. The trial never opened the original source database with SQLite.

### Cohost protection and retained evidence

Fresh post-trial observations at `2026-10-11T02:28:53.807377+00:00`: LACK PID 234963 and Tailscale PID 859 both active/running with NRestarts 0; LACK health HTTP 200; existing IPv4/IPv6 UDP 40000 listeners still owned by PID 859; no TCP 443 listener; production release still `/opt/chunlack/releases/e188eae`; available memory 1108240 KiB and used swap 0. These are process/listener/health observations, not proof of end-to-end Relay traffic quality.

Both own test units were confirmed terminal with MainPID 0 and exit status 1 before their failed flags were reset. Afterwards both were inactive/dead with MainPID 0. The root SSH session was closed. Private trial roots, logs, manifests, inventories, restored copies, host-run reports, and post-trial summary were retained as failure evidence; no production data or private artifact was committed to Git.

### Decision and remaining gate

**Overall real-root acceptance remains failed, not waived.** The approved 2048 cap is sufficient for the observed inventory, and neither run exceeded resource budgets. The remaining failure is source directory metadata instability across the complete archive/restore trial, not source-entry capacity or restored file corruption.

Do not retry indefinitely, ignore directory timestamps, exclude build-cache/lack_repos, increase resource limits, or stop production merely to obtain a green result. A separately reviewed consistent-source approach or an explicitly agreed maintenance window is required before claiming source stability and application-consistent recovery. Existing readiness flags remain `migrationReady=false`, `restoreReady=false`, `applicationConsistency=not_proven`; no account bootstrap, migration, public HTTPS publication, or production cutover is authorized by these trial results. Earlier Windows 489-test and native synthetic 12-test results remain their original, narrower evidence and were not rerun or relabeled as this real-root acceptance.
