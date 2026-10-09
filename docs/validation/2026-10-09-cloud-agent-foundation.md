# 云端 Agent 公共基础本地验证

日期：2026-10-09。开发分支：cloud-agent-pilot-foundation。仅本地开发与模拟，不代表 Muse/dots 接入成功。

## 修正与实施

原截图元数据 SQL 有 10 个字段但 11 个占位符，导致首次新增测试 14/19 通过、5 项 SQLITE_ERROR。经用户批准后改为明确的字段列表与 10 个占位符，原 19 项全部通过。

公共基础新增：browser.public_read、public scope 与固定公开 URL、随机校验码、PNG/JPEG 结构与大小验证、附件 SHA-256 及持久元数据、证据归属检查、人工验收状态。现有 SQLite 租约、取消、撤销、去重复用；原研究节点不自动获得浏览器权限。浏览器试点禁止 retry 重跑。

## 实际命令与结果

| 验证 | 命令 | 结果 |
| --- | --- | --- |
| 开发前基线 | node --test --test-reporter=dot tests/*.test.cjs | 75 项通过，退出码 0 |
| 新增测试 | node --test --test-reporter=spec tests/pilot-schema.test.cjs tests/pilot-store.test.cjs tests/pilot-artifacts.test.cjs tests/pilot-result.test.cjs tests/pilot-script.test.cjs | 24/24 通过，无跳过 |
| 独立模拟 | node scripts/cloud-agent-foundation-pilot.cjs | synthetic_fixture、cloudConnected=false、evidence_checked、humanAccepted=false；缺证/取消/重试拒绝；临时目录清理成功 |
| 完整回归 | node --test --test-reporter=spec tests/*.test.cjs | 99/99 通过，无失败、无跳过 |
| 烟雾 | node tests/smoke.cjs | PASS：真实 HTTP + WebSocket、同频道两个模拟模型后端、SQLite 重启持久化、私有绑定、配置保留 |
| 补丁空白检查 | git diff --check | 退出码 0 |

首次尝试 npm test 时环境没有 npm 命令；没有把该命令当成成功验证。随后直接运行 package.json 定义的 Node 入口，完成全套测试及烟雾。没有安装 npm 或修改系统配置。

## 新增覆盖

- 固定目标、非 public scope、额外字段、错校验码、无效时间、缺证拒绝。
- 老研究节点能力保留，跨节点、失效租约、取消、撤销拒绝。
- PNG CRC、截断、尺寸、文件大小、SVG 拒绝；实际 JPEG 编码器生成的 1x1 测试样本接受，缺少结束标识拒绝。
- 截图幂等、冲突、单任务上限、20 MiB 总量上限、7 天终态清理、持久化重开。
- 链接目录、用户路径、失败写入拒绝；丢失或篡改文件不能只靠数据库元数据通过。
- 节点 succeeded 与收件 ack 不等于人工 accepted；跨任务证据拒绝；浏览器任务不重跑。

## 尚未验证或交付

Muse 代理运输、tailnet 访问规则、dots 账号权限及 MCP/Tunnel/Events 组合、真实云端浏览器操作、远程截图传输、云端调度时延、长期负载和故障恢复均未验证。未部署或修改 VPS，未开放端口，未读取/替换凭据。

没有独立代码审阅或生产安全验收。Windows 附件目录 ACL 由操作者配置；JPEG 仅结构检查，不等于完整解码。当前附件模块需显式初始化和调用清理，尚无远程上传接口或后台清理服务。本地 synthetic_fixture 不能当作真实 Agent 执行证据。
