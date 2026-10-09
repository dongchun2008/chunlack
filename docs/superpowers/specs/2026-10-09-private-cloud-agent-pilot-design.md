# Muse / dots 私有云端 Agent 最小试点设计

日期：2026-10-09。状态：设计待审阅；未实现、未部署、未入网。

## 1. 目标与非目标

ChunLACK 保持私有、自托管、供应商中立的协作编排核心。Slack、raft.build 只作为产品参考。真实目标是外部 Agent 接到任务后操作自己的云端电脑并回传成果，不是把云电脑上运行我们的 worker 等同于接入供应商 Agent。

本次仅设计单任务可行性试点，公开无敏感内容、一个执行槽、不自动重试电脑操作。不改 Ollama、模型路由、现有凭据或生产监听；不开放公网入站端口，不安装默认 Gadget SDK，不引入 Redis 或新数据库服务。

## 2. 已阅读的当前实现

| 文件 | 已有能力 / 缺口 |
| --- | --- |
| gateway/protocol.cjs | 仅 research.retrieve / verify / summarize；5 节点、1 执行槽、90 秒租约、256 KiB 消息上限 |
| gateway/store.cjs | 配对、节点 scope、领取、续租、取消、撤销、结果幂等；入队截止时间最多 5 分钟；没有截图验证或附件存储 |
| gateway/server.cjs | 节点接口与管理接口共用本机监听；强制 loopback Host 与绑定；没有健康路径、外部受限门面或 MCP |
| gateway/runtime.cjs | 默认关闭、启用后仅绑定 127.0.0.1；不能直接接收 Muse 私网代理访问 |
| sdk/agent-client.cjs | 可注入 fetch，HTTP 只允许回环；40 秒请求超时、30 秒续租；没有显式代理运输策略 |
| sdk/credentials.cjs | 独立节点凭据和文件权限检查；不是云端 Agent 身份或账号权限证明 |

没有在本轮检查 VPS 服务状态、实际私网地址、ACL 或云端账号权限。源码配置不能当作实时部署证据。

## 3. 反馈证据与不确定性

Muse：用户转来的帮助原文明确使用平台封装 tailscale，3130 HTTP 代理支持 TCP / CONNECT，只出不进。首次目标访问需批准，同地址不同端口可能共用批准。HOME 权限可写；内部说明称 HOME 持久、guest systemd 可监督进程，但仅保存 unit 与 Restart 不保证环境替换后恢复。平台支持实验性，入网身份跨替换保留未知。Node/Python 代理使用、私网目标可达、供应商 Agent 触发均未实测。

dots：用户转来的原始输出确认 Node/Python、工作目录和临时目录权限检查；HOME 不可写；没有 TUN/systemd/tailscale；HTTPS 初次超时后四次成功。命令环境是否同实际电脑、持久性与驻留进程均未知。云端浏览器未登录不等于当前 dot 账号无连接能力。

官方文档：MCP Events 支持 dots，用户需订阅并给出处理指令；要求 MCP 2.0（2026-07-28）、持久订阅与出站 webhook。Secure MCP Tunnel 在我们私网侧运行客户端，将受限 MCP 服务接入受支持产品。当前账号资格、事件与隧道组合可用性以及电脑操作闭环未验证。

## 4. 方案比较与选择

| 方案 | 价值 | 限制 / 选择 |
| --- | --- | --- |
| 云电脑常驻自建 worker | 复用节点 SDK，运行成本低 | 不证明供应商 Agent 被触发；dots 生命周期未知；Muse 仅作先行连通试点 |
| 私网 MCP + 事件驱动原生 Agent | 无需云电脑常驻程序，直接验证 dot 操作电脑 | 新增受限 MCP 边界；账号与组合能力待验证；dots 推荐路线 |
| Slack 消息桥接 / 浏览器模拟登录 | 不作为方案 | 用户已明确不是接入目标，不引入这些依赖 |

共享任务、权限与结果语义；供应商专有运输放在适配器中。不强求 Muse 和 dots 使用相同传输。

## 5. Muse 阶段：先连通，后区分执行身份

流程：Muse 前台测试客户端 -> 平台 3130 代理 -> tailnet-only HTTPS 节点门面 -> loopback 网关。

保留网关 loopback 绑定和 Host 校验；门面只监听明确批准的私网地址，不监听 0.0.0.0，不公开管理界面。转发时固定上游为 loopback，重建固定 Host，不接受调用者指定目标。

首轮门面允许安全健康检查、已配置节点 manifest/status、一次领取、租约续期和对应结果回传。配对由操作者在私网侧进行；不转发 /admin/*，不远程创建任务，不公开配对入口。ACL 限定节点身份、目标端口；不依赖 Muse 针对目标地址的宽粒度批准作为唯一限制。

SDK 保持 HTTPS 要求，通过显式可注入的代理运输适配，代理地址仅来自批准配置，不打印环境变量或认证信息，不自动退回直连。平台待审批时先由人完成安全只读探测，连接器不循环触发审批。不关闭 TLS 校验，不把节点凭据放入 URL、提示词或仓库。

完成一次模拟领任务 / 回传，仅标记 transport_worker_verified。没有原生 Agent 触发与实际电脑操作证据时，不能标记 muse_agent_verified。持久化、systemd、自恢复均留到单次试点通过之后。

## 6. dots 阶段：原生电脑操作闭环

流程：ChunLACK 测试任务 -> 持久事件订阅 -> 出站 webhook -> 指定 dot 对话 -> MCP 领任务 -> dot 云端浏览器 -> MCP 回传 -> ChunLACK 验收。

受限 MCP 服务和 tunnel-client 均在我们的私网侧。它们是可关闭的外围适配，不使主平台依赖 OpenAI。账号许可与隧道组合通过后才部署，不将通用 Responses / Agents API 视为当前 dot 的直接派单入口。

建议工具（均待实现）：

- pilot.read_task：只能读当前绑定节点和试点 scope 中的指定任务。
- pilot.claim_task：立即返回指定任务或空结果，不把现有 30 秒长轮询直接暴露为 MCP 工具；不能领取其他节点任务。
- pilot.heartbeat：只续当前合法租约，截止时间固定，不无限续期。
- pilot.submit_result：验证节点、taskId、attempt、租约及证据，返回稳定收件确认。

认证主体在服务端绑定节点与 scope，不能靠工具参数指定身份。凭据由安全连接配置持有，不返回管理密钥或节点 token 给模型。事件仅含任务 ID、公开任务类型和过期时间，不含密钥、租约或可执行命令。

事件订阅实现 events/list、subscribe、unsubscribe；存储归属、过滤器、到期时间和交付状态。按官方流程验证回调地址、签名与回调挑战，限制目标，阻断 SSRF 和重定向绕过。相同事件去重；通知重试不重试电脑操作；回调 2xx 仅表示接收，绝不修改任务为完成。

首次由用户指定：仅此测试 scope、仅公开网页、只读浏览和截图、不登录、不上传私有文件、不安装、不执行 shell、不发布。事件正文不能扩大授权。取消后拒绝成功结果；正在进行的浏览器动作是否及时停止需实测，不能承诺平台可强制终止供应商电脑。

## 7. 任务与截图边界

新增独立能力 browser.public_read，不能伪装成 research.verify 或降低研究来源校验。任务固定 https://example.com/，带唯一 taskId 与随机关联码；关联码只关联任务，不证明执行真实性。

结果字段：taskId、关联码、固定 URL、标题、执行时间、截图标识、必要的活动证据；服务端明确区分 received、evidence_checked 与人工 accepted。节点报告 succeeded 不自动等于验收通过。

截图不可使用任意 URL 由服务端抓取。试点采用受限附件接口：只接受合法租约、固定 PNG/JPEG、最多 2 MiB、验证文件头与尺寸（边长不超过 4096），随机内部名称、存入专用目录；不支持用户路径、SVG、HTML、远程抓取或公开静态下载。截图通过受限身份读取；总容量不超过 20 MiB、单任务最多一张、最长保留 7 天，清理排除运行中任务。不得把大截图直接塞入现有 256 KiB 消息信封。

附件携带节点身份与租约约束，重复提交幂等；过期或撤销后拒绝。真实 dot 是否能通过工具提交截图二进制/分块数据必须先验证；如果只能返回聊天附件，试点标记 evidence_transfer_blocked，不能假装已完整回传。

截止时间保持现有最多 5 分钟、租约 90 秒，提供受限续租工具。实测若 dots 调度超过期限则失败并记录，不自动延长全局限制。先评估再单独设计云任务截止策略。

## 8. 最小实施顺序与预计文件

1. 审阅本设计；确认账号入口、私网目标、访问规则与现有服务基线。
2. 本地独立实现 browser.public_read schema、证据验证与附件边界，不联云。
3. Muse 显式代理运输与仅节点私网门面；先使用本地模拟代理测试，不发起入网。
4. dots MCP 工具与事件存储/交付；使用本地模拟订阅和回调验证，不触发真实 dot。
5. 两路线分别获得具体配置批准，再执行单任务真实试点；结束后撤销测试访问和订阅。

预计修改 gateway/protocol.cjs、gateway/store.cjs、sdk/agent-client.cjs（仅需要共用扩展时）、docs/MUSE_DOTS_INTEGRATION.zh-CN.md。预计新增 gateway/pilot-schema.cjs、gateway/pilot-artifacts.cjs、gateway/node-facade.cjs、sdk/transports/muse-proxy.cjs、integrations/mcp/pilot-server.cjs、integrations/mcp/events.cjs，以及对应 tests/*.test.cjs 与独立试点脚本。具体文件拆分在实施计划确认，避免重复实现已有租约逻辑。

不修改 lack.py 的模型路由；gateway/server.cjs、runtime.cjs 的 loopback 安全默认保持。部署配置不提前填写真实地址或凭据。新增能力可能影响旧客户端 capability 列表，因此旧研究任务、旧节点及 manifest 兼容必须验证。

## 9. 测试与交付门槛

- 原有研究任务与 Ollama/provider 路由回归，新增能力不绕过 scope、租约和撤销。
- 模拟代理：经过批准代理路径、TLS 不降级、不直连 fallback、超时及取消明确。
- 门面：拒绝管理/配对路径、非固定上游、未授权节点、跨任务读取。
- MCP：重复事件、过期订阅、无效签名、恶意 callback、回调 2xx 不误报完成。
- 结果：伪造截图格式、超大附件、路径穿越、跨节点、过期租约、重复结果冲突均拒绝。
- 真实 dots：事件进入指定对话、本人 dot 的浏览器活动、公开截图、匹配结果及 ChunLACK 持久保存记录齐全；worker 或模型回答不可替代。
- 真实 Muse：先单次代理访问与 worker 闭环；原生 Agent 执行单独验收。
- 试点结束：订阅取消、访问撤销、无残留进程；生产及同机现有服务保持原状。

回滚：关闭新增适配器、取消试点订阅、撤销试点节点/隧道访问；不重置旧数据库、不删除旧研究任务、不自动重启现有服务。截图和审计按批准保留期限清理。

## 10. 待确认事项

当前 dots 账号 MCP / Tunnel / Events 权限、Muse 入网及目标审批、服务级 ACL、可达私网 HTTPS 门面、截图工具传输方式、云 Agent 调度时延，均是实际试点前置条件。任何缺项标记阻塞或未验证，不宣布接通。

## 来源

- 用户在本对话提供的 Muse --help 和内部文档摘录：未独立登录 Muse 核对，不将摘录当作实测连通证明。
- 用户在本对话提供的 dots 原始命令输出及能力评估。
- [OpenAI MCP Events](https://developers.openai.com/plugins/build/mcp-events)。
- [OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)。
- 本轮读取的本地源码：AGENTS.md、PROJECT_CONTEXT.md、ARCHITECTURE.md、gateway 与 SDK 相关文件。
