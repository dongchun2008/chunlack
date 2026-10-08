# Open WebUI 前台研究连接器

模型密钥与 LACK 节点凭据分开管理，均留在本机。默认不安装后台服务、不启用服务器网关、不开放公网端口。

## 配置和启动

在能够访问 Open WebUI 的机器上，用现有 `sdk/cli.cjs pair <私有网关地址>` 配对。节点只声明 `research.verify` / `research.summarize` 能力和 `public` 作用域。网关地址必须是私有 HTTPS 或本机 SSH 回环转发；不要用网关节点密钥代替模型密钥。

PowerShell 示例只含路径和非秘密配置：

```powershell
$env:OPEN_WEBUI_URL = 'http://192.168.10.88:3000'
$env:OPEN_WEBUI_MODEL = 'local-active'
$env:OPEN_WEBUI_API_KEY_FILE = 'C:/Users/dongc/Documents/vps/localapikey.txt'
$env:OPEN_WEBUI_ALLOW_LAN_HTTP = 'true'
node sdk/open-webui-worker.cjs
```

`OPEN_WEBUI_ALLOW_LAN_HTTP=true` 是对现有 RFC1918 内网明文 HTTP 的显式许可，不代表 TLS。只用于受信任局域网，不跨公网或不可信网络发送该密钥。节点到 VPS 的网关连接仍保留 TLS/SSH 边界。

节点凭据默认在用户家目录 `.chunlack/connector.json`，也可通过 `LACK_NODE_CREDENTIALS_FILE` 指定已有文件。SDK 检查节点凭据权限。模型密钥文件由用户管理；连接器拒绝符号链接、过大文件和不合法内容，但不会替你修改该文件的 ACL。请保持该文件仅当前用户可读，不放入共享或版本控制目录。

## 边界

- 仅处理公开核验和汇总，不执行检索、任意脚本、shell 或文件任务。
- 核验必须覆盖全部结论，每条支持证据必须引用已提供来源中的精确摘录；外部节点自己提交的来源不能变成可信来源。
- 汇总仅排列已支持结论 ID，不生成额外叙述或事实。
- 模型只调用一次，不自动重试生成；回传结果的重试复用原有事件身份。
- 模型请求不显式附加知识库、工具或文件；Open WebUI 自身的模型默认配置和过滤器仍需单独审核。
- 原始错误响应和密钥不输出；失败任务不会伪造成功结果。
- 按 `Ctrl+C` 停止。模型服务是否真正停止生成、是否产生费用由上游决定。

## 本地真实闭环试点

在上述环境变量已设置时运行：

```powershell
node scripts/open-webui-node-pilot.cjs
```

脚本独立获取 Open WebUI 官方公开资料，用临时内存数据库和回环网关，执行一个真实核验任务，再通过现有 LACK 证据门禁。原始网页不可达、模型输出不合规或证据不足时失败退出，没有 synthetic facts 兜底。没有模型密钥进入任务或报告。

该试点不等于 VPS 已启用、节点已经永久配对，也不证明真实多角色协作或私有知识库可用。VPS 接入需要另行完成私有网关部署和持久配对。
