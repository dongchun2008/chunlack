# 迁移业务当前源码 Linux 隔离复验

## 验证对象与结果

测试源码固定为 `02c6d34833120cc999ab33a174fa2222a266b5b9`，由 `git archive HEAD` 打包全部 251 个跟踪文件；未包含本机运行数据、操作员凭据或未跟踪文件。源码压缩包 1675160 字节，SHA256 为 `b9338fa0b3a0c92e7ea8f098e21a08136a48ca0eae6bf4ca7cd0df45a74eef04`。

环境为既有 VPS 的 Linux、Node v24.21.0、Python 3.12.3、原生 SQLite 依赖及独立测试 Caddy 2.11.7。沿用固定 SSH 主机指纹，未修改凭据或全局软件。

| 验证 | 通过 | 失败 | 跳过 | 取消 | 时长 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 不设置 PYTHON 的默认解释器专项 | 20 | 0 | 0 | 0 | 14010.439974 ms |
| 实际打包 HTTPS/WSS 定向复验 | 3 | 0 | 0 | 0 | 10716.532125 ms |
| 当前源码完整 `tests/*.test.cjs` | 450 | 0 | 0 | 0 | 165385.53415 ms |

所有阶段及测试服务退出码为 0，无 todo。定向项是完整套件的重叠覆盖，不累加为 473 项独立测试。完整套件和独立 smoke 显式使用 `/usr/bin/python3`，兼容旧测试中的 `process.env.PYTHON || 'python'`；默认解释器专项另行取消 PYTHON，实际验证 Python 3 回退。未安装全局 python 别名。

独立 `tests/smoke.cjs` 通过实际 HTTP、WebSocket、两个模拟模型后端、SQLite 重启持久化、私有监听及配置保留断言。完整套件包含真实迁移、三位用户/两个工作区、来源保存、当前打包程序旧兼容恢复，以及实际 Caddy 的 HTTPS/WSS 测试。模型后端均为隔离模拟服务，不属于真实供应商验收。

## 隔离、资源与共存证据

- 单独测试 unit 使用 RootDirectory、PrivateNetwork、PrivateDevices、ProtectSystem=strict、NoNewPrivileges；不挂载生产数据、配置或密钥，仅只读复用既有运行时和依赖。
- 主测试 CPU 配额为单核的 50%，MemoryMax=256 MiB、TasksMax=64、RuntimeMaxSec=900。共存监测另限 CPU 5%、内存 32 MiB、16 个任务。
- 实测主 unit MemoryPeak=140136448 字节，约 133.65 MiB；累计 CPU 89569063000 ns，约 89.57 秒。运行时间为 2026-10-11 01:33:16 至 01:36:30 CST。这是测试负载测量，不是五 Agent 长时稳定容量上限。
- 该通过轮共存日志包含 14 次间隔约 15-16 秒的采样，均记录 LACK health=200、原 LACK PID 234963、原 tailscaled PID 859、零重启和六行 Relay/Tailscale UDP 监听；宿主 TCP 443 始终未出现监听。采样不能证明间隔内无任何短暂波动，也不等于 Relay 真实业务流量验收。
- 测试服务、模型模拟器和 Caddy 均处于私有网络命名空间。未启用公网入口、未修改 DNS/防火墙、未重启或切换生产 LACK、未更改 Relay 配置。

## 失败记录及最小测试环境修正

本轮没有修改应用或跟踪测试源码。先前失败保留在证据包中，没有覆盖为成功结果：

1. 初始启动在运行 Caddy 前退出 126：VPS `/run` 为 noexec。测试二进制移到本次独立磁盘目录，仍只读挂入隔离服务；不更改宿主挂载策略。此轮尚未执行业务测试。
2. 首次完整轮 385 项、357 通过、28 失败：旧测试缺少显式 Python，且 OpenSSL 默认配置未挂入隔离根目录；部分模块加载失败减少了测试总数。修正为完整套件显式 Python 3，并单独只读挂载 `/etc/ssl/openssl.cnf`，不读取宿主私钥目录。
3. 次次完整轮 450 项、447 通过、3 失败：实际打包入口夹具在只读源码下需要独立可写目录。仅为其指定叶目录增加本次专属可写挂载，源码其余部分保持只读。三项先定向通过，再完整复验 450/450，随后 smoke 通过。

没有关闭 TLS 验证、放宽认证/CSRF/Origin、放宽来源或跨工作区隔离断言，也没有过滤或跳过失败测试。

## 证据归档及清理

本地忽略证据目录为 `.superpowers/sdd/2026-10-09-multi-user-workspace-delivery/linux-isolated/chunlack-migrated-business-02c6d34/`。

| 证据 | SHA256 |
| --- | --- |
| `evidence.tar.gz`，含通过轮、失败轮日志及最终隔离脚本 | `0af56426fedcf066ee20d611b5ed034448664da850c62e4809d141ad867931ab` |
| `evidence/default-python.log` | `e44427947809595960bba23c557f7f41efa5389a456cf0ed8121e81107a76fdb` |
| `evidence/packaged-ingress.log` | `0158c8ecc57b923539cb1346116eafef11871fd1d3779ec1626718d8ce94c65a` |
| `evidence/full.log` | `98a2d7e2a3b1867bcaaeae49d5be98fc8576b5143992e8d904821c37294770b4` |
| `evidence/smoke.log` | `2682a8ad10a54d082e60a99229d562b855cb7c1eb9e01c2760f6d470d286e02e` |
| `evidence/cohost.log` | `cf268cc121e94232f356f5159579b2cadb81fdad72fc8def915313c1ad0de086` |

下载后本地压缩包哈希与远端一致，随后确认本轮两个 unit 均 not-found、inactive、MainPID=0。核对两个独立根目录的所有权标记、非链接、绝对边界后才清理；不触碰生产路径。

最终清理时间 2026-10-10T17:38:29Z，即北京时间 2026-10-11 01:38:29：临时运行目录和上传目录均不存在，LACK/Tailscale 仍为原 PID、active、NRestarts=0，health=200，宿主 TCP 443 监听数 0，UDP 监听行数 6。可用内存 1122952 kB，SwapFree=2097148 kB。

## 仍未交付的独立门槛

Windows 450/450 和本轮 Linux 450/450 现在覆盖同一源码检查点，但不自动升级迁移候选的交付/恢复就绪标志。Task 11/12 和总交付仍未完成：独立固定历史发行版恢复、集成节点生命周期、五 Agent 完整讨论的持续压力与共存业务验收、公网 HTTPS 正式切换及用户使用验收、真实模型、Muse 老镇/dots 玄玑自身云端电脑执行仍需各自证据。

Open WebUI 不在接入范围。本轮未调用其接口或读取其密钥。Ollama 及供应商中立路由保持不变；自建 worker 成功不能代替 Muse/dots 自身 Agent 执行成功。
