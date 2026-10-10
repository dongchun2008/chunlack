# 2026-10-11 公网准备及 VPS 原生预检复验

## 本轮结果

完成当前 VPS 的只读检查、预检脚本两项兼容修正和完整 Windows 回归 477/477。失败、跳过、取消均为 0，耗时 222343.9775 ms；后续 HTTP/WebSocket、双模拟模型、SQLite 重启持久化、私有绑定与配置保留冒烟测试通过。

没有启动公网服务，没有申请证书，没有修改 VPS 文件、账号、服务、DNS、防火墙或既有凭据，没有重启 LACK 或 Tailscale Relay。候选脚本在 SSH 会话内存中执行，使用既有专用 Node；密码只用于已有登录，未写入命令、文件、Git 或取证输出。

## 当前生产基线

固定 SSH 主机指纹核对后登录 `47.108.217.178`。只读观察窗口为 UTC 2026-10-10 22:52 至 23:00 左右，换算北京时间为 2026-10-11 06:52 至 07:00。

| 项目 | 当前证据 |
| --- | --- |
| 生产版本路径 | `/opt/chunlack/current` 指向 `/opt/chunlack/releases/e188eae`，未被候选版本替换 |
| LACK 服务 | `chunlack.service` active/running，PID 234963，NRestarts=0 |
| LACK 健康 | `http://127.0.0.1:3721/health` 返回 200，curl 退出 0 |
| Tailscale | `tailscaled.service` active/running，PID 859，NRestarts=0 |
| Relay 监听 | UDP 40000 仍由 PID 859 监听；未测实际转发吞吐、延迟或丢包 |
| 公网 443 | TCP 无监听；两个域名固定解析到 VPS 的 HTTPS 探测均 TLS 握手失败，curl 退出 35 |
| 公开新服务 | `chunlack-public.service` 与 `chunlack-https.service` 均未安装、未运行 |
| CPU | 2 核，load1m=0，最近预检 CPU PSI avg10=0.11 |
| 内存 | 系统可见 1651808 KiB，可用 1102160 KiB，约 1.05 GiB；不是并发容量测量 |
| Swap/磁盘 | Swap 2097148 KiB 未使用；磁盘可用 32370872 KiB |
| OOM | 历史计数 62；最近一小时可读内核日志无匹配记录，不代表历史从未发生 OOM，也不保证日志完整性 |

正式预检的最终状态为 `BASELINE_CLEAR_NOT_DEPLOY_AUTHORIZATION`、`gates=[]`、`deploymentAuthorized=false`。这只是有限时点快照；不能用它替代发布、迁移、Relay 功能或容量验收。

## 原生输出暴露的两项兼容问题

1. `systemctl list-units` 有 188 行，其中合法文件系统检查实例名包含字面 `\x2d`。原来的名字正则拒绝这种 systemd 转义，造成 `service_inventory_unknown_or_exceeds_bound`。现在只接受原字符集或完整两位十六进制转义，不解码、不拼 shell，仍按单独 argv 查询；异常名字仍阻断。转义形式依据 [systemd v255 官方 unit 文档](https://raw.githubusercontent.com/systemd/systemd/v255/man/systemd.unit.xml)。
2. 本机 `journalctl --grep` 实际返回 1，stdout、stderr 均为空，无超时或权限诊断。原来仅认可退出 0，造成 `kernel_oom_history_unknown`。现在只把退出 1 且无 stderr、输出为空或标准无记录标记视作零匹配；其他退出码、超时、权限诊断和异常输出仍为未知。无匹配的语义依据 [systemd v255 journalctl 官方实现](https://raw.githubusercontent.com/systemd/systemd/v255/src/journal/journalctl.c)。

新增七项回归先复现 4 项失败、3 项通过，再修正为 7/7：合法转义、拒绝异常名字、保留真实失败服务阻断、无匹配的两种输出、保留错误/超时/权限阻断、保留真实 OOM 阻断。所有测试仍要求 `deploymentAuthorized=false`。

辅助诊断文件中的 `failed` 数组使用整行词匹配，可能命中描述中的 failed；它不是服务状态证据。该原始文件保留，不用于认定服务故障。正式预检按状态列及 `systemctl show` 属性判断，没有把描述文本当作失败状态。

## DNS 和 HTTPS 候选

- VPS 系统解析及此前独立公开 DNS 查询均确认两个 A 记录为 `47.108.217.178`，不重复添加记录。
- 2026-10-10T23:01:16.3468476Z 的 Cloudflare HTTPS DNS 查询，两个入口 AAAA 查询均 Status=0、无 AAAA 答案；两个入口及父域 `chunclaw.top` 的 CAA 查询均 Status=0、无 CAA 答案。原始 JSON 的缺失 Answer 记为 null，不代表存在记录。
- DNS 时点查询不能代替 ACME 签发结果、未来缓存状态或所有权核验，不修改任何记录。
- 本地渲染采用 `https://lack.chunclaw.top`、`https://agents.chunclaw.top` 和三个候选回环上游端口 13721/13722/13723。Caddy 2.11.7 validate 退出 0；仅校验配置，没有运行公网入口或申请证书。
- 校验保留已有的冗余转发头和格式警告，没有为消除警告改动无关模板。
- `deploy/public/ingress.chunclaw.example.json` 仅供入口渲染，不是完整应用配置或迁移授权，激活前需重新核对端口。

## 私有取证

下列文件保留在 `.superpowers/sdd/2026-10-09-multi-user-workspace-delivery/`，没有上传原始机器日志或凭据到 Git：

- `vps-public-preflight-diagnostics-20261011.json`：兼容问题的原生子命令输出元数据，包含前述辅助 failed 字段限制。
- `vps-public-preflight-after-20261011.json`：修正后正式预检和既有 LACK 健康结果。SHA-256 为 `abf5cd30af6a1b2a49765cb815f6a321714640effd5ec4bfadcd06d0d7defd48`。
- `public-aaaa-caa-20261011.json`：独立 DNS 查询结果。
- `preflight-native-output-red.log`、`preflight-native-output-green.log`、`preflight-native-output-full.log`、`preflight-native-output-smoke.log`：RED、定向、全量和冒烟结果。
- `public-candidate-00b0c9f/`：非敏感渲染输入、候选配置与校验日志。配置 SHA-256 为 `864a8e9dda5c03ade3ae7d19f3e8593e53c66c604989fd1e4f396483a2ad806e`。

本轮只有预检脚本在真实 Linux 运行；不能把 Windows 477 项写作原生 Linux 477 项。此前当前业务代码 Linux 隔离 467 项结果另见 `2026-10-11-human-pilot-evidence-acceptance.md`。

## 激活前尚需完成

旧频道、消息和 Agent 的明确工作区归属、真人负责人，以及一致性备份与独立恢复；完整身份初始化和生产配置；维护/切换及回滚条件；正式公网证书与登录；直接真实模型；Muse 老镇和 dots 玄玑自身云端电脑执行及证据回传；真实忙碌节点与 Relay 功能共存。已请求用户指定旧数据归属，不会猜测或手动设置 migrationReady 绕过。
