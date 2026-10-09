# 云端 Agent 试点公共基础

## 作用和限制

这是 Muse / dots 接入前的本地公共基础，不是已上线的云端连接器。dots 不接手项目开发。

已实现的边界：独立 browser.public_read 能力、仅 public scope、固定 https://example.com/、任务随机校验码、既有节点身份和租约、独立 PNG/JPEG 附件存储、结果证据绑定和本机人工验收。研究任务与 Ollama / 供应商中立路由保持原路径。

没有实现或开启：Muse 代理运输、私网门面、dots MCP / Events、远程附件上传接口、真实云端账号配对、VPS 部署和后台恢复。

## 运行本地模拟

在仓库根目录、已有依赖和 Node.js 24 的环境执行：

```powershell
node scripts/cloud-agent-foundation-pilot.cjs
```

脚本使用专属临时 SQLite 与目录，自行生成标为 synthetic_fixture 的一像素 PNG。不访问网页、不调用模型、不读取密钥、不启动监听服务，结束后清理自己的临时文件。

成功摘要应包含：mode 为 synthetic_fixture、cloudConnected 为 false、acceptance 为 evidence_checked、humanAccepted 为 false，缺证、取消后结果和重试均被拒绝，cleanup 为 true。

模型回答、节点自报 succeeded、校验码匹配或模拟截图都不能证明真实 Agent 操作。脚本通过只证明本地数据与权限边界。

## 开发接口

- gateway/pilot-schema.cjs：validatePilotInput / validatePilotOutput。
- gateway/store.cjs：复用 enqueueTask、claimTask、renewLease、submitResult；增加 assertPilotLease、getPilotAcceptance、acceptPilotTask 和内部附件元数据方法。
- gateway/pilot-artifacts.cjs：createPilotArtifacts({store, root, now}) 返回 put、get、removeExpired。root 必须是专用目录；每次访问检查链接和文件完整性。初始化注册证据读取器，未初始化时成功结果拒绝。

现有 HTTP 网关没有新增附件路由，不能现在让远程节点提交带截图的任务。acceptPilotTask 只供可信本机操作者调用，不暴露为节点工具。

## 容量、格式与验收

截图单文件最多 2 MiB、边长最多 4096；PNG 仅支持非交错、8 位灰度 / RGB / 灰度加 alpha / RGBA。JPEG 支持常见 8 位 baseline / extended / progressive 的结构检查，不支持所有 JPEG 变体。PNG 校验块 CRC、压缩数据及行长度；JPEG 校验段边界、尺寸、扫描数据和结束标识。结构检查不是完整 JPEG 解码或执行真实性证明。

单任务只存一张；相同 eventId、相同内容幂等确认，换内容拒绝；总量最多 20 MiB，保留最多 7 天。文件 SHA-256 用于防止证据丢失或篡改。生产接入阶段必须启用定期清理；当前本地模块通过 removeExpired 显式清理，不会启动后台计时器。运行中任务不清理，超期租约需要既有 sweep 先处理。

received 表示试点已入库、尚未完成证据检查；evidence_checked 仅表示结构与存储证据匹配；accepted 必须由人核对活动记录和截图后显式确认。ack.accepted 为收件确认，不等于人工验收 accepted。失效、撤销、取消的租约拒绝写入；browser.public_read 不允许用 retry 重跑电脑操作。

任务并发仍为 1、租约 90 秒、截止最多 5 分钟。调度或审批超过期限应报告失败，不自动扩大限制。Linux 附件文件权限为 0600 / 目录 0700；Windows 的实际目录 ACL 由操作者配置，本模块不声明已完成 Windows ACL 加固，试点只使用公开资料。

## 后续

完成本地验证后，分别推进 Muse 受限私网/代理运输与 dots 原生事件执行适配。真实入网、订阅、凭据配置、私网访问规则和 VPS 变更仍需具体授权。
