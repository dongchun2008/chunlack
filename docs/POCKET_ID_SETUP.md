# ChunLACK / Pocket ID 接入说明

状态：本地实现与测试中，尚未启用生产登录。Pocket ID 发现接口已只读确认；
专用客户端配置已有建立记录，但安全替换密钥尚未就绪；真实用户登录、
Muse/dots 授权和公网发布均未完成验收。

**2026-10-12 当前凭据门槛：** 对用户指定私有 JSON 的检查仅输出状态，
未输出凭据值；`clientSecret` 仍为空，`requiresSecretReplacement` 为 true。
此前新客户端密钥曾意外出现在工具记录中，不得继续使用。需要用户在
Pocket ID 撤销该密钥并替换，将新值安全保存到原指定私有文件；不要发到
聊天或提交 Git。仅修改标记不能替代撤销和更换。此过程不修改 Tailscale
或其他应用的客户端，也不自动启用生产登录。

最新本地全量已通过 552/552；Linux 尚有两项临时测试证书生成超时，详见
[本轮验收记录](verification/2026-10-12-test-boundary-revalidation.md)。
以下较早测试数字保留为历史证据，不是当前生产版本状态。

**2026-10-12 本地修正已复验，尚未允许据此直接发布：** 最终全量测试
541/541 通过，0 失败、0 跳过；烟雾测试通过。已修正旧回调与新登录发起的
竞态、响应流取消等待不完整、废弃浏览器记录耗尽容量，以及超时后本地登录
关联恢复和容量满额时的会话签发顺序。真实 Pocket ID 登录仍未验收，详见
`verification/2026-10-12-oidc-boundary-repair-validation.md`。

HTTPS 补测记录：`verification/2026-10-11-windows-https-supplement.md`。补测通过
不代表真实 Pocket ID、Muse/dots 或生产发布已验收。

## 两类登录不要混用

- 真人登录：浏览器通过 Pocket ID 证明身份，ChunLACK 创建自己的会话。
- Agent 接入：需要另行验证面向 MCP 的 API 资源、权限范围和客户端授权。
- 本文实现前者。Pocket ID 的 ID token 不是 ChunLACK Agent API 凭据。
- 工作区成员资格和所有者身份仍由 ChunLACK 管理，不从邮箱或 groups 自动推导。

## 使用现有 Pocket ID，新增专用应用

已确认的 issuer：`https://pockid.chunclaw.top`，不带末尾斜杠。
已批准的唯一回调：`https://lack.chunclaw.top/auth/oidc/callback`。

ChunLACK 使用单独的 Pocket ID OIDC 客户端，不复用现有 Tailscale 或其他
应用的 Client ID/Secret，不修改它们的回调和访问权限。已有专用客户端配置
时不重复创建；先完成上文密钥替换，并核对该客户端的回调、PKCE、用户同意
和授权用户范围。客户端应使用授权码流程、PKCE S256、
`client_secret_basic` 和 RS256 签名。当前适配器只接受这些组合，不会降级
为 plain、未签名令牌、其他 issuer 或任意回调。

Client ID 可用于配置；Client Secret 只进入受限环境文件，不发送到聊天、
不加入仓库，不写入浏览器存储。本地配置中只保存环境变量名。

```json
{
  "identity": {
    "oidc": {
      "enabled": true,
      "issuer": "https://pockid.chunclaw.top",
      "clientId": "REPLACE_WITH_DEDICATED_CLIENT_ID",
      "clientSecretEnv": "LACK_POCKET_ID_CLIENT_SECRET"
    }
  }
}
```

这段配置应合并进隔离候选环境的配置，不是覆盖整份配置。它仅在多用户
运行时生效。未设置 `enabled: true` 时，不发起发现请求。
启用后若发现、证书、能力或密钥检查失败，候选运行时启动失败，不绕过认证。

## 账号必须明确绑定

先建立 ChunLACK 真人账号，再根据 Pocket ID 经确认的 `(issuer, sub)` 绑定。
`sub` 是稳定用户标识，不是昵称、邮箱或工作区名称。
ChunLACK 中拟定的负责人为 `chunlack-owner`，工作区为 `ChunLACK`；
该名称本身不代表真实账号或绑定已经建立。

本阶段只提供受信任的本机维护接口，不提供可被网页调用的任意绑定接口：

```js
const {createIdentityStore} = require('./identity/store.cjs');
const store = createIdentityStore({dbPath: absoluteCandidateIdentityDbPath});
try {
  store.linkExternalIdentity({
    issuer: 'https://pockid.chunclaw.top',
    sub: verifiedPocketIdSubject,
    userId: existingChunlackUserId
  });
} finally {
  store.close();
}
```

上述是维护接口说明，不是让用户直接对生产库执行的命令。
绑定前必须核实双方账号与备份。一个 issuer 下，一个外部身份只能绑定一个
本地账号，一个本地账号也只绑定一个外部身份。未知身份拒绝登录，不自动开户。
解绑会撤销该用户已有本地会话；解绑记录保留，不支持删除后自动重新绑定。
需要更换身份时另行执行经审核的恢复流程。

## 数据迁移与回滚

新增的 `external_identities` 属于用户级数据，保存在现有 `identity.db` 中。
身份 schema 从 v1 升到 v2，正常启动不会自动升级旧库。
显式 `createIdentityStore({dbPath, migrate: true})` 可升级；工作区迁移程序仅在
隔离目标副本上使用该参数。生产迁移必须有一致性备份与维护窗口。

快照保存完整身份数据库；登录 state、nonce、PKCE verifier 只在内存中存活
最多五分钟，不进入快照。重启后未完成的登录需要重新开始。
旧程序拒绝 v2；回滚时须恢复匹配的旧版程序和升级前数据库，不能只回滚程序。
恢复后的旧会话撤销与绑定审核仍须纳入正式恢复验收，不能用文件复制成功代替。

## 用户使用方式

1. 打开 ChunLACK 登录页，选择“使用统一身份登录（Pocket ID）”。
2. 在确认页点击继续，由浏览器转到已有 Pocket ID 服务。
3. 完成身份认证后返回 ChunLACK；只显示该本地账号已加入的工作区。
4. 若当前已登录另一个账号，先明确退出，再登录新身份；不能静默切换账号。
5. 点击 ChunLACK 的退出，只退出本地会话，不宣称同时退出所有 Pocket ID 应用。

已有本地密码登录暂时保留，作为单独、主动选择的恢复入口，而非失败时自动
绕过认证。若 Pocket ID 禁用用户，本地已建立会话不会因此立即失效；紧急撤销
需同时在 ChunLACK 禁用/解绑账号。自动同步与上游单点登出尚未实现。

## 资源和边界

- 不新增数据库服务、容器、监听端口或身份提供商。
- 复用现有 HTTPS 入口和 Node 进程，不修改 Tailscale Relay。
- 最多 32 个待完成登录、2 个并行换令牌请求；每次上游请求最多 15 秒、256 KiB。
- 浏览器关联最多 256 项；未完成登录的记录五分钟过期，已认证会话关联保留至
  会话最长寿命。密码验证成功后先预留关联容量，再同步签发和登记会话；满额
  拒绝不会创建隐藏会话或挤掉正常会话。过期记录按后续操作触发回收。
- 关闭会等待响应流取消完成；超时明确报告关闭不完整，保留写锁并拒绝第二个
  写入者。不得为了重启直接删除锁；需先确认旧进程和未结束操作、执行受控恢复。
- 登录发起沿用受限准入。当前使用直连 socket 地址；反向代理后的用户共用
  来源限额，适合小规模试点，扩大真人用户数前需单独设计可信来源识别。
- 不保存上游 access/refresh/ID token；会话仍使用安全的 HttpOnly host cookie。
- 不接入 Open WebUI；模型路由和 OIDC 身份认证是独立功能。

## 正式验收仍须完成

本地模拟签名令牌的通过只证明协议实现，不证明真实 Pocket ID 已登录。
仍需专用客户端配置、真实浏览器往返、两个真人账号的工作区隔离、禁用/退出、
代理 TLS、恢复/回滚与资源验收。Muse 老镇和 dots 玄玑需分别完成原生 Agent
领取任务、电脑执行、证据回传，不用模拟 worker 替代。

参考：
- https://pocket-id.org/docs/introduction
- https://pocket-id.org/docs/guides/apis
- https://github.com/panva/openid-client
