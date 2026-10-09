# Muse 私有接入试点

## 当前能用的范围

已实现可重复运行的本地传输试点，不是已经接入真实 Muse Agent。

`sdk/transports/muse-proxy.cjs` 提供显式 HTTP CONNECT 代理传输，目标使用 HTTPS 并验证证书。节点凭据只发送给 TLS 内的目标服务，不发送给代理；代理失败不会回退直连。

`gateway/node-facade.cjs` 提供仅限公开网页试点的 HTTPS 节点接口，使用预批准节点列表和节点凭据。当前只允许监听 `127.0.0.1`，不直接部署在 Tailscale 地址或公网地址上。

自定义连接器可使用认证的 `GET /v1/openapi.json` 获取接口说明，使用 `GET /v1/tasks/{taskId}` 只读核对任务，然后通过 `POST /v1/tasks/claim` 的 `taskId` 参数精确领取。旧版 `{}` 请求保持兼容。指定任务不可领取时返回 204，不会转而领取其他任务。

详细约定见同目录的 `MUSE_CUSTOM_CONNECTOR_PREFLIGHT.zh-CN.md`。接口准备完成不代表真实 Muse 连接器已验证兼容；当前仍没有实际私网服务地址可交付。

## 本地验证

在仓库根目录运行，要求项目依赖和 Node.js 已安装：

```powershell
node scripts/muse-transport-local-pilot.cjs
node --test tests/muse-proxy.test.cjs tests/node-facade.test.cjs tests/muse-transport-pilot.test.cjs
```

脚本创建本地代理、测试节点和临时数据库，使用合成图片完成任务与结果往返，最后释放资源。`proxyVerified: true` 只表示本地 CONNECT 通路通过；`museAgentVerified: false` 表示尚未调用真实 Muse Agent。

## 真实接入前仍需完成

1. 由用户批准 Muse 官方私网集成配对与指定机器访问。不要另装通用 VPN 客户端绕过平台权限。
2. 核对 Muse 提供的代理配置，明确使用其私网代理通道；不把代理地址或凭据提交到 Git。
3. 为私网部署设计单独的受限转发和可信证书配置。目前的 loopback 服务不能直接当成已部署的私网入口。
4. 验证 Muse 执行程序是否支持 CONNECT、VM 替换后的恢复和身份保留。
5. 单独确认触发 Muse 自身 Agent 的受支持方式。运行自己的 worker 不等于调用 Muse 自身 Agent。
6. 使用 Muse 实际云端浏览器打开批准的公开页面，回传匹配任务编号、校验码、截图和活动记录，再由用户验收。

本阶段没有安装 Muse 连接器，没有读取真实凭据，也没有操作 VPS 或真实账号。

## 安全限制

- 当前仅支持固定的公开网页任务，不授予 shell、Git、文件访问或任意内网浏览权限。
- 图片、消息、租约、并发和存储均有上限；证据检查与人工验收分开。
- `tests/fixtures/pilot-tls-key.pem` 是公开的 localhost 测试私钥，不是生产凭据。严禁将该证书或密钥用于实际部署。
- Windows 生产目录 ACL 需单独配置；本地测试不构成生产权限审计。
