# 现有 2C2G VPS 部署评估

检查时间：2026-09-12 22:25 至 22:28，Asia/Shanghai。
通过 SSH 密码认证登录后执行只读检查。未安装软件、修改配置、重启服务或部署 LACK。
本报告不保存登录凭据、主机指纹或访问地址。

## 结论

CPU 和磁盘能够支持个人低并发、外部模型 API 模式的 LACK 试运行。
当前主机存在反复 OOM 和 DNS 解析超时，暂不适合直接新增长期运行服务。
先排查并缓解这些问题，再进行有资源限制的部署与共存验证。
本次未运行 LACK，因此不能把资源余量等同于实际容量或稳定性验收结果。

## 实测资源

| 项目 | 观察结果 |
|---|---|
| 系统 | Ubuntu 24.04.2 LTS，x86_64，Linux 6.8.0-63-generic |
| CPU | 2 vCPU |
| 内存 | 系统可见总计 1613 MiB，可用约 1213 MiB |
| Swap | 0 |
| 根盘 | 40 GB，已用约 3.7 GB，可用约 34 GB，ext4 |
| 即时 CPU | vmstat 后续 1 秒样本显示约 99% 至 100% idle |
| 历史负载 | 首次 uptime 的 1/5/15 分钟负载为 0.74 / 33.11 / 61.12 |
| 内存压力 | 后续 memory PSI full avg300=32.65，说明前 5 分钟存在明显停顿 |
| 应用端口 | 未发现 3721 监听冲突 |
| 软件 | Python3、Git 已有；Docker、Node、npm 未在 PATH 中发现 |

即时空闲与此前严重负载并存，短时样本不足以证明高峰期有余量。

## Tailscale peer relay

- tailscaled 为 active/running，版本 1.102.3。
- Tailscale 状态为 Running、Online=true、Health=[]。
- 已配置 RelayServerPort=40000，并观察到对应 UDP 监听。
- 服务 cgroup 当前内存约 47.8 MiB，历史峰值约 115.3 MiB。
- 进程 RSS 约 43.3 MiB，与 cgroup 内存为不同统计口径。
- 网络计数器的短时样本未见新增错误或丢包，但未做 relay 吞吐压力测试。

## 当前阻碍

1. 内存不足：最近 7 天内核日志记录 22 次 Out of memory 杀进程，均为
   unattended-upgr。最近一次为当天 22:21:12，所杀进程匿名 RSS 约 1.24 GiB。
   apt-daily 和 apt-daily-upgrade 的 Result 均为 oom-kill。
   这发生在部署 LACK 之前；具体内存增长原因尚未完成诊断。
2. DNS：对 Docker Hub Registry、Docker 软件源、DeepSeek 和 npm Registry
   的 curl 检查均在约 4 秒后报告 Resolving timed out；独立 resolvectl
   查询在 8 秒限制内未返回结果。不能据此断言这些服务本身不可用。
   当前解析由 systemd-resolved 和 eth0 上的云内网 DNS 提供；查询路由走
   eth0，未观察到它们被路由到 Tailscale 接口。DNS 超时根因尚未确定。
3. 运行条件：需要准备 Docker/Compose；本机资源紧张时，镜像构建也可能
   造成竞争。不能直接套用原推荐 4C8G 的部署余量判断。

## 建议的后续步骤（尚未执行）

1. 排查 DNS 解析链路，恢复软件源和模型端点解析；保留 relay 配置。
2. 诊断自动更新进程的 OOM，评估新增 2 GiB Swap 及内存约束。
   Swap 是缓冲措施，不等于增加实际内存，也不能代替处理异常内存占用。
   不建议简单永久停用安全更新。
3. 优先在其他机器构建镜像后导入，或在资源问题解决后选择低峰构建。
4. LACK 初始可试设容器内存上限 512 至 640 MiB、CPU 上限 0.5 核，限制
   Node 堆并保留原生模块和进程开销空间；这些是试运行起点，需根据实测调整。
5. 仅使用外部模型 API，先串行测试 1 至 2 个 Agent，关闭多候选采样、
   多视角生成和非必要后台任务。暂不增加本地模型、浏览器或向量数据库。
6. 保持应用私有访问，并观察 LACK 与 relay 同时运行时的 RSS、CPU、PSI、
   OOM、响应延迟和 relay 吞吐，再决定是否长期共存或升级内存。

此前部署代码及测试说明见 [部署指南](README.md) 和 [验证记录](VERIFICATION.md)。
