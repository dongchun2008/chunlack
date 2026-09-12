# VPS 修复后只读复查

检查时间：2026-09-12 22:54 至 22:55，Asia/Shanghai。
对照 [首次评估](VPS_ASSESSMENT_2026-09-12.md)。此次未修改服务器配置、安装软件或重启服务；检查结束后已退出 SSH。

## 已确认的改善

- 2 GiB Swap 已启用，当前使用量为 0，并在 /etc/fstab 中配置持久化。
- 系统可见内存仍为 1613 MiB，可用内存约 1183 至 1195 MiB。
- 根盘可用空间约 32 GB，Swap 文件占用了部分磁盘空间。
- 1/5 分钟负载约 0.11/0.13；短时 CPU 样本约 99% 至 100% 空闲。
- 内存压力 PSI 的 avg10 和 avg60 为 0，avg300 已降至约 0.07 至 0.08。
- 从首次检查结束的 22:28 至本次结束的 22:55，未检出新增内核 OOM 杀进程日志。
- DNS 查询恢复，所检查域名的解析均在毫秒级至约 0.12 秒完成。
- Tailscale 为 Running、Online=true、Health=[]，服务约占 48 MiB。
  ActiveEnterTimestamp 仍为 2026-08-22，未观察到 relay 服务重启；端口 40000/UDP 仍在监听。

## 网络复测

测试为不携带 API 密钥的 HTTPS 请求，并未执行付费模型调用。

| 目标 | 结果 | 解释 |
|---|---|---|
| DeepSeek API 根地址 | HTTP 401，约 0.096 秒 | DNS、TCP、TLS 和 HTTP 可达；不代表密钥、额度或模型已验证 |
| Docker 软件源 GPG 文件 | IPv4 复测 HTTP 200，约 0.80 秒 | 软件源当前可达；首次测试曾被重置 |
| Docker Hub Registry | 首次 4 秒、IPv4 复测 8 秒均连接超时 | DNS 成功，但到 443 的 TCP 连接未完成 |
| npm Registry | 首次和 IPv4 复测均 TLS 握手超时 | DNS 成功，复测 TCP 约 0.21 秒建立，TLS 未完成 |

复测设置连接阶段超时 8 秒、请求总超时 15 秒；失败发生在连接阶段。
目前不能把网络问题称为 DNS 故障，也不能断言远端服务本身不可用。
直接从 Docker Hub 拉镜像和从 npm Registry 安装依赖仍有阻碍。

## 仍需验证

- 自动更新服务仍保留历史 failed/oom-kill 状态，两项 timer 仍启用。
- 两项服务 MemoryHigh/MemoryMax/MemorySwapMax 均为 infinity，未配置服务级内存限制。
- vm.swappiness 仍为 0；Swap 确实启用，但尚未验证内存压力下的实际缓冲效果。
- 观察窗口约 27 分钟，尚未覆盖下一轮自动更新运行，不能确认 OOM 已根治。
- Docker、Node、npm 仍未在 PATH 中发现，3721 端口仍空闲。
- 未运行 LACK，未进行 relay 高流量与 LACK 共存压力测试。

## 当前判断与下一步

资源条件已改善，可以继续准备受限的轻量部署，但还不具备直接拉取镜像完成安装的全部条件。
下一步应解决镜像和依赖的交付路径，例如在可联网环境构建镜像后导入 VPS；
同时验证自动更新任务在新增 Swap 后的表现，再根据实测决定是否调整内存策略。
后续 LACK 仍从单用户、外部模型 API、少量 Agent、受限 CPU/内存配置开始，
并持续以保留 relay 服务资源为约束。
