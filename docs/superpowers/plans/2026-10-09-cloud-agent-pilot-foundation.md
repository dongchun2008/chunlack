# 云端 Agent 试点公共基础 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为公开网页单任务试点实现可测试的任务、证据和附件基础，不接入真实云端账号。

**Architecture:** 复用现有 SQLite 节点身份、scope、租约、取消和结果幂等。新增 browser.public_read 的严格校验与本地附件服务；证据验收和节点报告成功分开。保持所有服务 loopback，不启用云端网络适配。

**Tech Stack:** Node.js 24、CommonJS、node:test、better-sqlite3；无新增运行时依赖。

**Spec:** ../specs/2026-10-09-private-cloud-agent-pilot-design.md

## Global Constraints

- 一个执行槽、90 秒租约、任务截止最多 5 分钟，现有 256 KiB JSON 上限不变。
- 首轮唯一网页 https://example.com/，public scope；不支持 shell、登录、任意 URL 或私网浏览。
- 附件只接受 PNG/JPEG、最多 2 MiB、边长不超过 4096、单任务最多一张、总量最多 20 MiB、最长保留 7 天。
- 不更换凭据，不读密钥文件，不开公网端口，不部署或重启 VPS，不安装软件。
- 保留 Ollama、供应商中立模型路由及旧研究能力；dots 不接手开发。
- 本计划只覆盖公共基础；Muse 代理/私网门面与 dots MCP/Events 分别在后续计划中实现。
- 下列测试和提交命令是待执行步骤；本文不宣称已经运行或通过。

## Review Focus

- 添加第四种 capability 后旧节点/研究任务仍可用，新能力不自动授予旧节点（Task 2）。
- 正常 JSON 结果与截图分别回传时，遗漏截图不能被标记证据完整（Task 4）。
- 结果请求与取消/撤销同时发生时，失效租约不能提交成功或创建孤儿附件（Task 3）。
- PNG/JPEG 签名正确但头部截断、尺寸异常或正文不完整，不当作有效截图（Task 3）。
- 相同 eventId 不同内容、同任务不同截图，不能覆盖已有证据（Task 3/4）。

## Task 1: 严格公开网页任务与结果 schema

**Files:** Create gateway/pilot-schema.cjs; Create tests/pilot-schema.test.cjs.

**Interfaces:**
- validatePilotInput(input) -> {url, challenge}：只接受 url、challenge；URL 精确匹配 https://example.com/；challenge 是 32 字节随机数的 base64url 编码（43 字符）。
- validatePilotOutput(output, input) -> normalizedOutput：只接受 url、challenge、title、executedAt、artifactId、activityEvidence；标题非空最多 500 字符；executedAt 有效 UTC ISO 时间；artifactId 为随机 UUID；activityEvidence 是非空文字最多 2000 字符，作为待人工核验声明而非真实性证明。

- [ ] 写失败测试：合法输入通过；任意目标、额外字段、凭据字段、错 challenge、缺截图标识、无效时间和超长标题拒绝。
- [ ] 执行 node --test tests/pilot-schema.test.cjs，确认模块缺失导致失败。
- [ ] 实现两个纯校验函数，使用现有 GatewayError；不发网络请求，不执行浏览器。
- [ ] 执行同一测试，全部通过后仅提交本任务两个文件。

## Task 2: 将新 capability 接入现有任务边界

**Files:** Modify gateway/protocol.cjs; Modify gateway/store.cjs; Create tests/pilot-store.test.cjs.

**Interfaces:**
- TYPES 增加 browser.public_read；节点 capability 数量上限随合法类型数量调整，不扩大节点授权。
- enqueueTask 仅对新类型调用 validatePilotInput；scope 必须为 public，仍要求目标节点显式声明能力和该 scope。
- submitResult 仅对新类型成功结果调用 validatePilotOutput；failed 仍保留既有结构，不要求截图。

- [ ] 写失败测试：显式新节点可领取公开试点；旧研究节点拒绝新任务；非 public scope 拒绝；错误 URL 拒绝；全部三个研究能力兼容。
- [ ] 执行 node --test tests/pilot-store.test.cjs，确认新增能力尚不存在导致失败。
- [ ] 在既有验证入口插入新 schema，不修改 SQLite 原有状态机、并发或截止限制。
- [ ] 执行 node --test tests/pilot-store.test.cjs tests/gateway.test.cjs tests/research-gateway.test.cjs，通过后仅提交相关文件。

## Task 3: 受租约保护的本地截图服务

**Files:** Create gateway/pilot-artifacts.cjs; Modify gateway/store.cjs; Create tests/pilot-artifacts.test.cjs.

**Interfaces:**
- store.assertPilotLease(nodeId, {taskId, leaseId, attempt}) -> task：不允许 cancel_requested、撤销、过期、其他节点和非试点任务。
- createPilotArtifacts({store, root, now}) -> {put, get, removeExpired}。
- put(nodeId, lease, {eventId, contentType, bytes}) -> {artifactId, sha256, sizeBytes, width, height}：固定允许格式、随机内部文件名、文件 0600 / 目录 0700；禁止用户路径、URL、符号链接和根目录外访问。
- get(nodeId, taskId, artifactId) -> metadata + bytes：节点归属和 scope 校验，无公开文件服务。
- removeExpired() -> count：仅清理超过 7 天且非运行中任务附件。

- [ ] 写失败测试：有效小截图可存读；2 MiB+1 字节、4097 像素边长、SVG、截断 PNG/JPEG、符号链接根目录拒绝；20 MiB 总量封顶；一任务一附件；重复 eventId 同内容返回同确认，不同内容冲突。
- [ ] 增加取消、撤销、过期、跨节点、路径穿越、失败写入与重启恢复测试，验证失败无成功元数据、无覆盖旧证据。
- [ ] 执行 node --test tests/pilot-artifacts.test.cjs，确认未实现失败。
- [ ] 实现独立附件元数据表与固定目录文件存储；PNG 检查块完整性、尺寸、CRC 与结束标识，JPEG 检查段边界、尺寸与结束标识。明确结构检查不等于完整图像解码或证明执行真实性。
- [ ] 上传临时文件后最终提交元数据前再次检查租约；失败删除本次临时文件，绝不删除别人的附件。数据库确认与文件提交采用可恢复协议，重启清理孤儿仅限专用目录。
- [ ] 执行本任务及 Task 2 测试，通过后仅提交相关文件。

## Task 4: 结果证据绑定与验收状态

**Files:** Modify gateway/store.cjs; Create tests/pilot-result.test.cjs.

**Interfaces:**
- 试点结果入库前验证 artifactId 对应当前 node/task、已成功保存并且未过期；客户端不得指定 evidence_checked 或 accepted。
- 新增独立 pilot_acceptance 元数据；状态 received / evidence_checked / accepted。结构和附件校验通过可标记 evidence_checked；accepted 只能由本机操作者调用 store.acceptPilotTask(taskId)；本阶段不新增远程审批 API。
- store.getPilotAcceptance(taskId) -> {state, artifactId, acceptedAt}，既有研究任务 getTask/submitResult 返回结构不变。

- [ ] 写失败测试：无附件或其他任务附件拒绝；匹配附件与结果存储且只为 evidence_checked；不自动 accepted；人工接受需任务成功且证据完整；重复结果稳定确认、改内容冲突。
- [ ] 测试取消、过期和撤销之后回传拒绝；先结果后附件不能误报完整；结果 payload 的节点自报字段不能提升验收状态。
- [ ] 执行 node --test tests/pilot-result.test.cjs，确认未实现失败。
- [ ] 实现验收元数据和服务器端绑定；不把 challenge、截图或活动文字单独作为真实性证明。
- [ ] 执行 node --test tests/pilot-result.test.cjs tests/pilot-artifacts.test.cjs tests/pilot-store.test.cjs，通过后仅提交相关文件。

## Task 5: 本地模拟交付与后续门槛

**Files:** Create scripts/cloud-agent-foundation-pilot.cjs; Create docs/CLOUD_AGENT_FOUNDATION.zh-CN.md.

**Interfaces:** 脚本使用临时 SQLite 与附件目录、真实 store 接口、固定公开任务和标为 synthetic_fixture 的截图；不访问云账号/真实网页、不读凭据、不自动 accepted；结束输出一份无密钥的结构化验证摘要并清理自己的临时目录。

- [ ] 添加本地模拟正常结果、缺证和取消用例，模拟证据绝不标记为 Muse/dots 真实执行。
- [ ] 执行 node scripts/cloud-agent-foundation-pilot.cjs，期待模拟 evidence_checked、人工验收未发生、缺证和取消拒绝。
- [ ] 执行 npm test 和 npm run smoke；报告实际结果、预先存在故障和未验证项，不以单个成功用例替代回归。
- [ ] 更新使用说明，明确本阶段尚无远程附件接口、MCP 服务、代理门面或真实节点连通；提交并按用户要求同步 GitHub。

## 后续独立阶段（本计划不执行）

### 2026-10-09 执行记录

用户批准计划及修正测试错误后，在当前会话独立分支 cloud-agent-pilot-foundation 实施，不委派 dots。Task 1-5 的公共基础代码、测试、模拟脚本和使用说明已实现；新增测试 24/24，完整回归 99/99，本地模拟与烟雾测试通过。详见 ../../validation/2026-10-09-cloud-agent-foundation.md。

执行决定：在现有干净 checkout 使用独立开发分支，没有新建额外 worktree；保留 main 不变。测试先整体 RED，再单次主体实现及已获准 SQL 修正，采用一个经过完整回归的实现提交，未按任务分别提交。没有独立审阅者或真实云端验收，不声称完成生产安全验收。

执行环境没有 npm 命令，直接运行 package.json 对应的 node --test tests/*.test.cjs 与 node tests/smoke.cjs，不安装工具。Windows ACL 不由新附件模块配置；首轮仅公开数据。PNG 支持非交错 8 位常见格式，JPEG 为结构验证而非完整解码，这些限制已写入使用说明。

Muse：受限节点门面、显式代理运输、模拟代理与 ACL 验证后，再批准真实入网；不尝试自动触发未确认的 Muse Agent 接口。

dots：受限 MCP 工具、附件上传工具、事件订阅/签名/回调验证与 tunnel-client 配置；首先确认账号支持及截图传输，再授权单任务真实浏览器测试。

真实上线前：只读取 VPS 服务基线、备份必要配置、明确私网目标/ACL/撤销方式；未经具体批准不变更任何服务。超过现有 5 分钟截止时间只报告失败，不自动提高限制。
