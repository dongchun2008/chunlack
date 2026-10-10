# 2026-10-11 真实旧数据快照及独立副本恢复演练

## 已验证与未验证

本轮使用 VPS 上现有 LACK 的真实数据，不是模拟数据库。完成允许范围内的快照准备、独立目录恢复副本、文件校验、数据库完整性及表行数核对。没有启动恢复后的应用，没有迁移归属，没有切换生产，不能写作完整应用恢复或正式备份验收。

原生程序返回 `migrationReady=false`、`restoreReady=false`、`applicationConsistency=not_proven`。这些门槛原样保留，未手动改为就绪。

## 源数据与隐私边界

生产单元的 RootDirectory 为 `/opt/chunlack/jail`，宿主机 `/var/lib/chunlack` 绑定为其 `/data`。主数据库为 `/var/lib/chunlack/db/lack.db`，57344 字节；配置文件为 `/var/lib/chunlack/config/lack.config.json`，811 字节。生产代码仍指向 `e188eae`。

先由 `workspace-source-reader.cjs` 读取稳定字节到专属临时目录，仅在副本打开 SQLite，不直接打开原库，避免只读 SQLite 在原目录生成 WAL/SHM。临时副本校验后关闭并清理，原始文件的字节稳定性检查通过。

仅输出表名、行数和完整性结果，未输出消息、Agent 内容、账户或凭据值。后续快照流程内部读取并复制配置，可能包含凭据；配置只保存在 VPS 的 root 私有目录，未下载、显示或提交 Git。没有读取本地 Open WebUI 密钥文件，也没有模型请求或外部 Agent 调用。

| 表 | 源副本行数 | 快照行数 | 恢复副本行数 |
| --- | --- | --- | --- |
| agents | 1 | 1 | 1 |
| messages | 13 | 13 | 13 |
| agent_memory | 0 | 0 | 0 |
| loop_health | 0 | 0 | 0 |
| pipeline_results | 0 | 0 | 0 |
| project_states | 0 | 0 | 0 |

源副本 `integrity_check=ok`、外键违规 0；六张表均无 `workspace_id` 列。没有 `identity.db`，不能从机器 root 用户、GitHub 名称或消息用户名猜测真人负责人。

## 受限原生演练

使用源版本 `9abcfde2e01e4fbc66aa57134842a6e72705fb49` 的 Git 源码归档，大小 3870720 字节，SHA-256 为 `852293dcbc59f49ea8bfbbb5f6452860d6a8ee3a177ef0b4e30f77a3d55b6aaf`。未安装全局软件，复用既有专用 Node 和原生依赖。

唯一私有目录为 `/var/tmp/chunlack-offline-restore-20261011-c07f619a`，带本轮所有权标记。解包前验证归档校验和、条目数量、总体积、路径和类型，拒绝绝对路径、越界和链接。脚本在源数据读取前限制库存最多 256 项、总量 16 MiB。

本次实际库存 43 项、85072 字节。调用现有 `prepareWorkspaceSnapshot` 与 `prepareWorkspaceRestoreTrial`，各产生 28 项快照记录。两份校验摘要相同，SQLite 完整性/外键与行数检查通过，文件字节与 SHA-256 验证通过，配置候选保持未就绪。

成功的临时服务为 `chunlack-offline-restore-c07f619a-r1.service`。实际观察到：

- CPUQuotaPerSecUSec=100ms，即约 0.1 个逻辑 CPU，不是整台 2 核机器的 10%。
- MemoryHigh=100663296，MemoryMax=134217728，TasksMax=32，RuntimeMaxUSec=90 秒。
- `PrivateNetwork=yes`、`PrivateTmp=yes`、`ProtectSystem=strict`、`Restart=no`、`KillMode=control-group`。
- 原生产数据 `/var/lib/chunlack` 为 ReadOnlyPaths；只允许本轮私有目录写入并显式绑定该目录。
- systemd-run 等待实际终止，退出码 0、result=success。服务总耗时 10.368 秒，其中包含 8 秒取证等待；不能拿它作为应用吞吐指标。
- 观察到内存峰值 19550208 字节，约 18.6 MiB；最终报告 CPU 消耗 242ms，Swap 峰值 0。

## 初次失败及修正

初次临时服务退出 226/NAMESPACE，程序未开始执行。其专属日志明确报告 `/var/tmp` 下本轮目录在 mount namespace 中不存在。原因是临时配置启用 PrivateTmp，却遗漏本轮目录的 BindPaths；这是演练配置错误，不是业务数据或 Relay 故障。

`PrivateTmp` 隔离 `/tmp`、`/var/tmp`，而 BindPaths 可提供单元专属目录映射，依据 [systemd v255 官方执行环境文档](https://raw.githubusercontent.com/systemd/systemd/v255/man/systemd.exec.xml)。重试只加入本轮目录绑定，未移除网络隔离、原数据只读保护或提高资源预算。确认失败单元 MainPID=0、退出 226 后，仅清除该专属单元的失败状态，用新单元重试；原始失败记录保留。

## 共存与结束状态

成功演练前后 LACK PID=234963、Tailscale PID=859，均 active/running，NRestarts=0；LACK 健康检查均为 200。UTC 2026-10-10T23:20:06.747Z（北京时间 2026-10-11 07:20 左右）结束核验显示两个试验单元均 not-found/inactive、MainPID=0，对应 cgroup 均不存在。没有常驻试验进程。

私有副本和取证保留，占磁盘 8616 KiB。目录模式 0700、root 所有；两份配置归档模式 0600、root 所有，未发现链接。它们仍在临时目录，不承诺长期保存，不能代替正式备份目录、保留策略或应用一致性证明。

这是有限共存采样，没有测试 Relay 实际转发吞吐、延迟或丢包，不能声称完整 Relay 功能验收。

## 取证校验和

私有证据位于本地 `.superpowers/sdd/2026-10-09-multi-user-workspace-delivery/`，不将原始配置、数据库、快照或可能含私人文件名的清单上传 Git。

| 证据 | SHA-256 |
| --- | --- |
| vps-production-data-metadata-20261011.json | bd902019c4457cf93fe112ef411497a133123cd057d6c1741dbab752e51a6f1c |
| vps-production-db-aggregate-20261011.json | 51e7815a9a8acb701985b14511fff72e94768de8eadbe63b3f8230805e4d8030 |
| offline-restore-20261011-c07f619a/native-trial-r1.log | 86bbd5e6db8b7d45fd41fe37315166dd56e89bc19a7ef638d58f6379e976ae69 |
| offline-restore-20261011-c07f619a/final-state.json | 5d06f2128bdb8d11af77f33dd5b09790b1ef4474f643ae6abbb8296fc80b35fa |
| VPS 私有 trial-report.json | 4f74693410e7f7ca025b6cadbcc4980840133a9635f464378cf7ea958a919337 |
| VPS 私有快照 manifest.json | 46334e203989c4638db5410b91c9606a64cd162532a8e917df937b132dda34e4 |

本轮没有修改业务源码。此前同一业务候选及预检代码的 Windows 回归 477/477、冒烟通过另见 `2026-10-11-public-preflight-native-acceptance.md`；本次是新增的真实数据原生演练，不是原生 Linux 477 项全量回归。

## 仍待完成的正式迁移与交付

原生清单仍有 `unclassified_root_entry`、`explicit_ownership_required`、`owner_identity_requires_bootstrap` 三类未解决项。库存只覆盖既有工具配置的数据库/目录允许清单，不是全部源目录的无遗漏备份。

正式迁移需要用户明确旧数据工作区与真人负责人，核对未分类数据范围，建立身份及资源授权，证明应用级一致性、正式备份和应用恢复，再完成生产 HTTPS/登录、真实模型、Muse 老镇/dots 玄玑自身执行和真实忙碌节点/Relay 共存。不会猜测归属、丢弃未知数据、复用 Open WebUI 或把准备快照的就绪标记强改为 true。
