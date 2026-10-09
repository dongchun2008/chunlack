# SDK：指定任务与截图回传

本说明适用于已有授权的 `browser.public_read` 试点节点，不是 Muse 或 dots
真实账号已经接入的声明。真实 Muse 凭据代理与私网通道的组合仍待验证。

## 新增接口

- `readTask(taskId, signal)`：读取指定任务，不领取、不泄露租约。
- `claimTask(taskId, signal)`：精确领取指定任务；返回 `null` 表示没有领取成功，绝不自动改领其他任务。
- `uploadArtifact(task, {bytes, contentType, eventId}, signal)`：上传 PNG/JPEG 原始字节，返回包含 `artifactId` 的确认。
- 原来的 `claim(signal)`、`run()`、`event()`、`heartbeat()`、`result()` 保持可用。

`bytes` 使用 Buffer 或 Uint8Array，大小为 1 字节到 2 MiB。默认
`contentType` 为 `image/png`，JPEG 必须明确设置 `image/jpeg`；网关仍会
验证真实图片结构。事件编号默认随机生成；同一次调用的网络重试会复用
编号和图片字节副本，最多发送三次，间隔 1 秒、2 秒。

HTTP 400/401/403/409/413/415/429 不重试，取消信号立即停止本次调用。
只有得到有效 `artifactId` 才视为确认；超时后应核对服务端状态，而不是
假定请求没有执行。跨调用恢复上传时，应保存并复用原来的 `eventId` 和
完全相同的图片。不要在日志中记录节点令牌或完整授权头。

## 受信任执行程序中的调用顺序

```js
const {randomUUID}=require('node:crypto');
const {AgentClient}=require('../sdk/agent-client.cjs');

// config、transport、selectedTaskId 由受信任的本地程序提供。
// transport 可使用已验证的 TLS CONNECT 适配器；不要关闭证书校验。
const client=new AgentClient({
  baseUrl:config.gatewayOrigin,
  token:config.privateNodeToken,
  fetch:transport,
});
const details=await client.readTask(selectedTaskId,signal);
const task=await client.claimTask(details.taskId,signal);
if(!task)throw new Error('指定任务未领取，请停止本次执行');
await client.event(task,{type:'started'},signal);

// 下面的执行者必须真正使用自己的浏览器。
// screenshotBytes、title、executedAt、activityEvidence 来自实际执行记录。
const state=await client.heartbeat(task,signal);
if(state.status==='cancel_requested')throw new Error('任务已取消，请停止');
const artifact=await client.uploadArtifact(task,{
  bytes:screenshotBytes,
  contentType:'image/png',
  eventId:randomUUID(),
},signal);
await client.result(task,{
  status:'succeeded',
  output:{
    url:details.input.url,
    challenge:details.input.challenge,
    title,executedAt,activityEvidence,
    artifactId:artifact.artifactId,
  },
},signal);
```

示例是顺序说明，不是可直接运行的浏览器执行器。较长操作需持续续租，
并在取消、租约失效、鉴权失败时停止。调用新增方法不会自动启动 Muse、
dots 或任何云端电脑，也不会授予 shell、文件或生产部署权限。

## 验收边界

本地 TLS/CONNECT 和合成图片测试只证明接口行为，不证明云端 Agent
执行过浏览器任务。真实接入仍须验证账号授权、私网访问、真实浏览器
活动记录、截图与任务校验码匹配，以及 ChunLACK 服务端结果留存。
自动证据校验不能代替人工验收。本轮不开放公网端口、不修改 VPS 或凭据。
