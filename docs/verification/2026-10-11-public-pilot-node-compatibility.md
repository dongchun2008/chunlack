# 公网浏览试点节点兼容边界修正

用户已授权后续修正和完整复测。本轮修正此前明确列出的 API 与截图回传接口授权不一致；未改动生产服务、凭据或 Relay。

## 修正范围

网页的 `POST /api/tasks` 是受限的 example.com 浏览试点，不是通用研究任务提交接口。现在先以真实真人工作区身份读取目标节点，保留原有 `capability_denied`、`scope_denied` 和未知节点处理，然后要求恰好一个 `browser.public_read` 能力及一个 `public` 范围；混合节点返回 `403 facade_scope_denied`，不创建任务。

节点读取与入队均经过现有工作区授权封装，没有开放管理接口、改变节点凭据或降低截图上传限制。通用底层队列仍保留多能力节点与其他任务协议的能力；本次没有把全部平台限制为浏览试点，也没有更改暂停、恢复、撤销、共享执行容量或租约规则。

## 测试证据

- 新用例先真实失败：期望 403，但混合能力节点创建任务返回 201。修正前控制接口套件 8 通过、1 失败，11476.873 ms。
- 新用例覆盖混合能力、多个范围、两者同时混合，均要求入队前拒绝且任务列表为空。既有正常节点、权限、外区、CSRF、20 项队列上限继续验证。
- 定向控制接口、真实打包 HTTPS 节点生命周期、五 Agent 完整轮次：13/13 通过，无跳过或取消，12352.662 ms。
- Windows 全套回归启用实际 Caddy：461/461 通过，无失败、跳过或取消，73252.7081 ms，退出码 0。
- 独立真实 HTTP/WebSocket、两个模拟模型、SQLite 重启和配置保留冒烟通过，退出码 0。

忽略的 `.superpowers/sdd/2026-10-09-multi-user-workspace-delivery/` 日志及 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| `node-compatibility-red.log` | `43cc3d771f0f1c42145bd10b9412a968bf8cc7fece1660ee7c565e91b1eb7383` |
| `node-compatibility-focused.log` | `5ef7aca94bc90d6365f89f904219a7d21e48d5d24df8a898e3d62645fde7e90a` |
| `node-compatibility-full.log` | `d712557fd9d7f43e9077bfd24b3481d5f36773c1ad2cfbb097a31e2458e33a46` |
| `node-compatibility-smoke.log` | `f11986f4ca6071992a388765ca44f0a4d23d1332a8d0f6a1603c5cd04cec79cb` |

这解决了兼容遗漏，不等于真实 Muse/dots 浏览器已执行任务。人类证据验收入口、当前版本 Linux 隔离验证、持续生产共存、真实模型、DNS/证书和生产切换仍需独立完成。
