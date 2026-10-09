# Muse 自定义连接器接入前核对

本方案用于把 Muse 自身的任务执行和云端电脑能力接入 ChunLACK，而不是在 Muse 电脑中运行一个冒充 Muse 的 worker。当前只准备接口说明，不创建连接、不读取凭据、不部署私网服务。

## 官方能力和验证边界

Meta 的说明确认：可以要求 Muse 为列表外的服务创建 Custom Connector，由 Muse 引导取得 API 信息并管理相关凭据。这使 ChunLACK 自定义连接器成为可评估路线。

官方来源：[How Muse works with Connectors](https://www.meta.com/help/artificial-intelligence/1687253048996149/)。这份说明没有提供自定义连接器的统一协议、认证规范或外部唤醒 API；部分连接器支持主动更新，不代表自定义连接器也具备同样能力。

## 先发给 Muse 的核对要求

```text
我希望你通过官方 Custom Connector 功能接入我的私有 ChunLACK 多 Agent 平台。
目标是你领取批准的任务，使用你自身的云端电脑执行，再回传结果及证据；
不是安装自建 worker，也不是接入 Slack、Raft 或模型 API。

本轮仅评估。不要创建连接、读取或申请凭据、登录 Tailscale、发起网络探测、
安装软件、启动后台任务或修改配置。请依据当前平台提供的说明回答：

1. 自定义连接器可接 REST API、MCP，还是仅支持特定平台？是否需要 OpenAPI？
2. 是否支持 Authorization: Bearer 的凭据管理，而不把密钥写进对话或代码？
3. 自定义连接器的实际请求是否能走官方 Tailscale 通道及运行时 HTTP CONNECT
   代理？请区分连接器后端、云端终端和浏览器，不能因其中一项可用而推断其他项。
4. 是否支持可信 CA 的私网 HTTPS？不允许关闭证书验证。
5. 是否可以请求 JSON、处理 HTTP 204、提交原始 PNG/JPEG 二进制，以及设置
   X-Pilot-Lease-Id、X-Pilot-Attempt、X-Pilot-Event-Id 请求头？
6. 收到我的明确任务指令后，能否由你调用连接器领取任务，再使用你自身浏览器
   打开 https://example.com/、读取标题、截图，并通过连接器上传截图和结果？
7. 是否能在执行期间每 30 秒检查并续租，收到取消或租约失效立即停止？
8. 外部系统能否通过受支持的方式自动唤醒你？如果不能，是否可先由我在对话中
   发起一次任务？不要用自建常驻轮询替代你的 Agent。

请逐项给出“官方支持”“当前实测”“未知”或“明确不支持”，附依据。
未知项不要推测成功；不要向我索取真实密钥。本轮没有可直接使用的服务地址。
```

## 当前 ChunLACK HTTPS 接口

接口来自 `gateway/node-facade.cjs`，不是服务已部署的承诺。当前进程只能监听 `127.0.0.1`；Muse 中的 localhost 指 Muse 的机器，不能拿它代替 VPS 地址。后续需要独立批准私网转发、可信 TLS 和节点配置。

| 方法与路径 | 请求 | 作用与边界 |
| --- | --- | --- |
| GET `/health` | 无凭据 | 状态和 `pilot_only` 标识；不代表模型或 Agent 可用 |
| GET `/v1/manifest` | 节点 Bearer 凭据 | 协议版本、节点能力、范围、限制；适合作为获批后的首个认证只读检查 |
| GET `/v1/openapi.json` | 节点 Bearer 凭据 | OpenAPI 3.0.3 接口说明，不内嵌服务器地址或凭据；实际 Muse 导入兼容性待验证 |
| GET `/v1/agents/me` | 节点 Bearer 凭据 | 当前节点信息；仅在确有需要时使用 |
| GET `/v1/tasks/{taskId}` | 节点 Bearer 凭据 | 只读查看自己的公开任务、截止时间和验收状态，不返回租约或领取任务 |
| POST `/v1/tasks/claim` | JSON `{"taskId":"<approved taskId>"}`，旧调用可用 `{}` | 有 taskId 时只领取指定任务；不会退回其他任务。空对象仍按旧队列规则领取。无任务或执行槽位不可用时 HTTP 204 |
| POST `/v1/tasks/{taskId}/heartbeat` | JSON `taskId`、`leaseId`、`attempt` | 续租并查询取消状态 |
| POST `/v1/tasks/{taskId}/events` | 协议事件 JSON | 记录开始、进度或取消；带稳定事件编号 |
| POST `/v1/pilot/tasks/{taskId}/artifact` | 原始 PNG/JPEG | 上传实际截图，不接受图片 URL、SVG 或模型生成图片代替证据 |
| POST `/v1/tasks/{taskId}/result` | 协议结果 JSON | 提交结果；成功结果须引用已存储且属于该任务的图片 |

除 `/health` 外，以上接口使用 `Authorization: Bearer <node credential>`。JSON 请求使用 `Content-Type: application/json`。节点必须在预批准列表内，且只有 `browser.public_read` 能力和 `public` 范围；不给 Muse 管理员或配对接口权限。

REST 试点现在支持先读取指定任务，再按批准的 taskId 精确领取。新增接口复用原任务归属和领取检查，不新增管理员权限。指定任务已被领取、已取消、已结束、已过期或执行槽位占用时，不改领其他排队任务。调用者不得把 HTTP 204 当成重新执行或改领其他任务的授权。

OpenAPI 的认证和接口能力不等于 Muse 已支持导入。服务地址须在真实私网配置获批后单独设置，不使用测试证书部署。该说明提供受限连接器操作契约，结果提交只描述有实际证据的成功分支；不要求用假结果掩盖执行失败，也不为真实 Muse 自动唤醒提供接口。

## 任务与证据约定

领取成功返回 `protocolVersion`、`taskId`、`taskType`、`scopeId`、`input`、`deadlineAt`、`leaseId`、`leaseUntil`、`attempt` 等字段。只允许 `browser.public_read` 和 `public`，目标固定为 `https://example.com/`；`input.challenge` 是服务生成的随机校验码，应原样保留。

截图上传的请求头：

```http
Authorization: Bearer <secure-store reference resolved at request time>
Content-Type: image/png
X-Pilot-Lease-Id: <claimed leaseId>
X-Pilot-Attempt: <claimed attempt as decimal text>
X-Pilot-Event-Id: <stable unique upload event ID>
```

不要把以上占位符直接当成真实值发送。图片最多 2 MiB、宽高最多 4096 像素；必须先上传并取得真实 `artifactId`，再提交成功结果。

成功结果字段如下，仅说明格式，不是执行记录：

```json
{
  "protocolVersion": 1,
  "taskId": "<claimed taskId>",
  "leaseId": "<claimed leaseId>",
  "attempt": 1,
  "eventId": "<stable unique result event ID>",
  "status": "succeeded",
  "output": {
    "url": "https://example.com/",
    "challenge": "<original input.challenge>",
    "title": "<actual browser title>",
    "executedAt": "<actual UTC time with milliseconds ending in Z>",
    "artifactId": "<stored screenshot UUID>",
    "activityEvidence": "<actual Muse browser activity record reference or description>"
  }
}
```

`attempt` 必须使用领取值，不固定为示例中的 1。标题最多 500 字符，活动证据描述最多 2000 字符；不要编造访问时间、图片编号或活动记录，也不要在证据中包含凭据。格式检查通过只能得到 `evidence_checked`，最终仍由用户核对实际 Muse 活动并验收。

执行期间约每 30 秒续租，租约最多 90 秒且不超过任务截止时间，任务最多 5 分钟。收到 `cancel_requested`、认证拒绝或租约失效就停止，不提交成功。结果或图片重试必须沿用相同事件编号和相同内容；不要自动重领或重做浏览器工作。

## 从评估到一次真实验证

1. Muse 先返回上述能力核对结果，确认私网请求主体、认证和上传方式。
2. 兼容性明确后，用户另行批准专用节点、私网服务配置和一次网络检查。凭据通过安全配置交付，不进入聊天或 Git。
3. 首先只检查健康和认证 manifest；不在探测阶段领取任务。
4. 用户批准唯一公开网页任务，由 Muse 领取并使用自身电脑执行。先采用用户在 Muse 对话中手动启动，不假设外部自动唤醒。
5. 验收任务编号、校验码、实际浏览器活动、截图和 ChunLACK 落库结果，测试后停止并撤销不再需要的访问。

## 当前尚未完成

真实 Muse 自定义连接器兼容性、私网部署、可信证书、凭据配置、实际截图上传与自身电脑执行均未验证。本阶段已新增本地任务读取、精确领取和 OpenAPI 接口及回归测试，但未读取真实凭据或操作 VPS。本地模拟测试不能替代真实接入验收。
