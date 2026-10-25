# ChunLACK User Guide

Document updated: 2026-10-25. Scope: the owner’s private ChunLACK deployment and everyday use. This revision uses saved records. No network or VPS access was performed, and current availability, configuration, grant count, and running version were not verified.

> Daily entry: [https://lack.chunclaw.top/](https://lack.chunclaw.top/). Sign in with Pocket ID and enter an authorized workspace. Everyday browser access requires no SSH tunnel and no changes to public ports or existing tunnels.
>
> Confirmed historical evidence: on 2026-10-21, dots 玄玑 completed one manually triggered native public-browser task explicitly accepted by the owner; on 2026-10-24, a human reached the workspace through the normal OIDC flow after release. The former does not establish Events, automatic task pickup, or continuous availability. The latter involved no model calls or new tasks.
>
> The multilingual UI is in local development and unpublished. This English guide does not mean the production page already offers language switching or that the language feature has passed acceptance.
>
> 老镇 is the historical Muse identity, which the user says is no longer available. The new identity, 苏婳, has not passed connection or native-task acceptance. Never rename historical 老镇 nodes, grants, or evidence to 苏婳, or use 玄玑’s success to establish 苏婳’s availability. Full platform delivery remains incomplete.

## 1. Getting started

1. Open the daily entry in a browser on Windows, Mac, or another device.
2. Click “使用统一身份登录（Pocket ID）” (sign in with Pocket ID), then the continue button.
3. Complete any required passkey or Windows Hello interaction yourself. Do not send passwords, verification codes, private keys, or tokens to an Agent. Reusing an existing identity session does not mean a new passkey verification occurred.
4. Check the workspace name, account, and role at the top. Historical acceptance concerned workspace `ChunLACK` and its existing owner account. The previous guide recorded platform account `chunlack-owner` and the owner role. The 2026-10-24 record confirms the expected existing owner account and role were visible without publishing the raw account identifier.
5. Wait for `CONNECTED` at the bottom, then send a short message to an existing Agent in `general` if needed. The indicator does not guarantee model or execution-node availability.

You can begin with this nonsensitive, discussion-only message. Sending it makes a model call; it was not sent during this documentation revision:

```text
@1Cat 验收助手 Please explain in three sentences how to organize personal documents.
Separate facts, suggestions, and unknowns. Discuss only in this round: do not call tools, delegate tasks, or execute commands.
```

Enter the complete Agent name, including spaces. “发起协作” (start collaboration) invokes Agents in the current channel and may add model calls. It is not a settings button; do not keep clicking it to retry.

The historical configuration used provider `onecat-direct` and model `qwen38-27b-nvfp4`. This is neither an instruction to install another model nor confirmation of the current configuration.

### Pocket ID reports a timeout, but you seem to be signed in

Signing in to Pocket ID does not necessarily establish a ChunLACK workspace session.

- Return to the daily entry and continue through the normal Pocket ID sign-in flow.
- Treat reaching the correct workspace with the account and role visible as evidence of platform login. `CONNECTED` separately indicates that the page’s live connection is established.
- The first interaction on 2026-10-24 showed `Session ID is missing`, and the application callback did not complete. A new normal flow in the same browser subsequently returned to the authenticated workspace. The record preserves the initial error; account, identity binding, and provider configuration were not changed.
- The record captured neither the callback HTTP status nor the raw WebSocket handshake. The page indicator cannot substitute for those measurements. An earlier Python public TLS handshake failure remains separately recorded with its cause undiagnosed.
- If unauthorized access or timeouts persist, retain the time and a redacted screenshot for the administrator. Do not repeatedly submit an old callback URL.
- Do not copy login callbacks between browsers, replay authorization codes, change keys, relax Cookie or certificate checks, or extend sessions to bypass the problem.
- Stop if previously unapproved permission scopes appear, and have the owner confirm them.

## 2. Platform, devices, models, and Agents

```text
Windows / Mac browser
        |
        | HTTPS + authorized human session
        v
VPS: ChunLACK workspace, orchestration, permissions, and records
        |
        | existing private network
        v
Existing direct inference route -> 1Cat model
```

This describes the established route, not a probe of current network status. The VPS does not load the large model locally. The direct model route does not depend on Open WebUI, adds no Open WebUI integration, and requires no new public model ports.

| Concept | Meaning |
|---|---|
| Device | Windows, Mac, DGX Spark, or another computer providing the runtime environment |
| Model service | Receives inference requests and generates output; it is not an Agent that can operate a computer |
| Internal ChunLACK Agent | Performs assigned work using configured models and authorized tools |
| External Agent | A product’s own executor, such as dots 玄玑 or the unverified Muse 苏婳; Muse 老镇 refers only to the historical identity |
| Connector / worker | A program transporting or executing authorized tasks; running it does not establish that the external product’s own Agent was triggered |

One device can host a model service and multiple Agents. Connecting a model API does not automatically give ChunLACK permission to access that device’s files, desktop, or shell.

## 3. Understanding the interface and language proposal

The table describes existing controls. The 2026-10-24 login record confirms that member, node, task, and Agent-grant controls were visible; it does not establish that each feature was exercised and accepted.

| Control | Purpose and boundary |
|---|---|
| Current workspace | Switches between workspaces where you already have membership; it does not switch models |
| Members | Manages human members and their roles; prompts must not grant permissions |
| Nodes | Manages execution nodes; a listed node is not evidence of accepted real task execution |
| Tasks | Shows execution status; receiving an HTTP request does not mean a task is complete |
| Agent grants | Manages limited grants for external executors; it is not the daily login entry |
| Channel navigation button | Opens the channel and Agent list on the left |
| Add Agent | Opens an inline form to select providers and models already configured and authorized |
| Three onboarding cards | Fill a draft; you still decide whether to send it |
| Workbench | Provides access to project files, runtime charts, and related views; it is not your local file explorer |
| Light/dark button | Changes only the display theme |
| CONNECTED | Indicates that the page’s live connection succeeded; it does not independently establish model, tool, or external-node availability |

On 2026-10-19, the Add Agent form was opened and canceled on the production page without creating an Agent or changing configuration. This is historical page interaction, not a new check for this revision. The 2026-10-24 record shows two visible Agents; it does not establish their model configuration, task permissions, or present count.

### Multilingual UI: in local development, unpublished

The proposed language preference is saved per human user and browser. It is not a workspace setting or an Agent’s model, system-prompt, or output-language setting. Do not assume that different browsers automatically synchronize preferences. Exact storage and switching behavior still require implementation and acceptance.

Language switching concerns interface labels, buttons, and notices. It does not automatically translate chat messages, research conclusions, attachments, logs, historical evidence, or node and grant names. Original content and evidence retain their language; switching the interface does not mean their contents have been translated or verified.

This guide has no published acceptance evidence for the language control’s location, coverage, missing-translation fallback, or preference persistence. Follow the actual production page. Chinese control names and their English explanations in the guides do not promise that English labels already exist in production.

## 4. Adding and assigning work Agents

The historical configuration already included `1Cat 验收助手`. First-time users do not need to add more members immediately. If creation is necessary:

1. Open channel navigation and click “添加 Agent” (Add Agent).
2. Enter a name, model provider, model, system prompt, participating channels, and an optional restricted channel.
3. If the administrator confirms the historical direct route remains authorized and usable, select `onecat-direct` and `qwen38-27b-nvfp4`. Other authorized providers and models should also be selected through neutral configuration. Wait for the model list to load; investigate failures before submitting again.
4. Initially set the participating channel explicitly to `general`. Form defaults may include `general,siphon,code`.
5. Confirm the assignment and scope before creating the Agent. Click Cancel if you are only inspecting the form.

Names and prompts such as planner, reviewer, researcher, and verifier express task roles. These are assignments, not permission roles, and do not require different models for every role.

```text
You are the reviewer. Check the proposal for omissions, risks, and missing evidence.
Separate confirmed facts, inferences, and matters requiring verification. Do not invent sources.
Only offer suggestions in this round. Do not execute commands, modify files, or delegate tasks.
Keep the answer brief.
```

Prompts cannot replace server permission checks. Do not casually remove or relax the Moderator configuration.

### One Agent and multiple Agents

- To address one member, use the complete `@AgentName` and confirm that the Agent belongs to the current workspace and channel.
- Use Start collaboration or the corresponding flow only when discussion among multiple participants is intended.
- Five logical Agents sharing one model do not equal five devices or five simultaneous inference requests.
- The previous guide recorded that ordinary chat did not automatically append reflection or proactive follow-up by default. Explicit collaboration features may add calls. The current implementation was not inspected again for this revision.
- The 2026-10-19 production-workspace model evidence covers one reply from one Agent, not a sustained five-Agent capacity promise. The 2026-10-24 login acceptance added no inference evidence.
- For sensitive material, check every model and executor that may participate. Do not infer data routing only from a name or a `localOnly` label.

## 5. People and workspaces

A private platform can manage multiple workspaces, and one workspace can have multiple human users. Each human should use their own identity rather than share the owner’s session. These are usage and permission principles, not evidence that concurrent use by multiple humans has passed acceptance.

- Pocket ID authentication and ChunLACK workspace membership are separate.
- Signing in to Pocket ID does not imply access to every workspace.
- Assign roles through member management according to responsibilities. Everyday users do not all need owner permissions.
- Manage Agent task assignments separately from human and node access permissions.
- Workspaces, channels, and tasks organize work. Changing research topics usually does not require a separate platform installation.
- After switching workspaces, check members, model authorization, and task scope again. Do not assume automatic sharing.
- The proposed interface-language preference belongs to a human user and their browser; workspace or Agent settings do not make it shared configuration.

## 6. Models, tools, and materials

The 2026-10-19 configuration snapshot used direct inference over the existing private network, explicit model `qwen38-27b-nvfp4`, a 30-second request timeout, a 512-token output limit, and no fallback model. This is a historical snapshot, not a fixed capability guarantee for all tasks. The 2026-10-24 login acceptance did not reconfirm it; it made 0 model calls.

The model layer retains Ollama support and provider-neutral routing. When adding llama.cpp, DGX Spark, or a cloud model, separately confirm the address reachable from the VPS, exact model ID, credential reference, workspace authorization, and a real call. Do not download a large model directly onto the VPS or substitute an Open WebUI address or key for the direct model service.

- Keep keys only in approved private configuration, never in chat, attachments, prompts, or Git.
- Local computer operations require separate controlled execution-node authorization and real acceptance. Browser login cannot replace them.
- Do not use `/bash`, data resets, or automatic loops to test basic connectivity.
- Preserve original source links in research results and mark missing evidence. Model-generated citations still need checking and cannot count as retrieved evidence.
- An attachment control is not complete knowledge-base ingestion and does not guarantee that an entire long file enters the context. If excerpts are needed, provide only relevant, redacted content and identify its coverage. Do not accept excerpts as proof that the entire material was processed.
- `/help` shows the page’s existing help, but a listed command does not mean the account is authorized or the capability has passed acceptance.
- `/stop` is not a guaranteed global emergency stop. Check the actual state of existing requests and independent flows.
- Interface language does not automatically translate input materials, model replies, citations, or evidence. A separate translation task needs its own scope and fidelity requirements.

## 7. Muse and dots 玄玑 connection status

Every status below has an evidence date. Static records do not confirm current endpoints, grants, or external-account availability.

| Item | Saved evidence and boundary |
|---|---|
| [Agent MCP endpoint](https://agents.chunclaw.top/mcp) | The 2026-10-21 integration guide records a protected entry. Denying unauthorized requests is expected; do not enable anonymous access |
| Public OAuth discovery and client recognition | Recorded as published in the same guide. Discovery or client recognition does not grant workspace business permissions |
| Public node REST | The corresponding MCP-only route denies public `/v1` and `/v1/*`; do not bypass this restriction to connect |
| dots 玄玑 | One manually triggered native `browser.public_read` task was accepted by the owner on 2026-10-21. This is not acceptance of automatic dispatch, Events, or continuous availability |
| 玄玑 pilot grant | The record shows 1 temporary grant created and 1 revoked, leaving 0 at the end. Revocation audit and denial afterward were verified. This does not establish the present total grant count |
| Muse 老镇 | Historical identity; the user says it is unavailable. Restoring this account is not a prerequisite for the current connection direction |
| Muse 苏婳 | New identity; account connection, authentication, supported triggering, computer operation, and result return are unverified |
| Windows / Mac / Spark execution nodes | Require separate acceptance. Model APIs, simulated workers, or 玄玑’s single success cannot replace each device’s operational acceptance |
| Events / automatic wake-up | Events were not enabled in the 2026-10-21 pilot. Automatic wake-up and continuous task pickup still lack acceptance evidence |

### The completed 玄玑 single-task acceptance

The [2026-10-21 single-task record](verification/2026-10-21-native-dots-single-task-acceptance.json) states that the owner UI created exactly one public-browser task with a five-minute deadline targeting `https://example.com/`. Its capability was `browser.public_read`, its scopes were `task.read`, `task.claim`, and `task.result`, and the grant’s maximum lifetime was 3600 seconds.

玄玑 received one instruction in its existing native dot conversation, read and claimed the task once, read the title `Example Domain`, took a screenshot, and returned `succeeded`. The challenge matched, task, result, and artifact were bound together, and the saved ACK succeeded. No ordinary worker, Work, or Codex substituted for it. The operator did not claim the task, browse the target, or generate the screenshot on its behalf.

The JPEG was 56,110 bytes and 1165 × 747 pixels. The server download hash matched, the native reply artifact was byte-identical, and the image was visually inspected. Reading, computer use, and the final receipt were observed in the native UI, and the processing indicator ended. The activity description remains a node self-description corroborated by native UI activity and the artifact, not signed hardware attestation. No full underlying primitive trace was exported.

A transport receipt containing `accepted: true`, or status `succeeded`, is not human acceptance. This task separately received the owner’s explicit confirmation and was persisted as `accepted`; confirmation created no new task or grant. The temporary grant was then revoked, and a control probe was denied with `www_authenticate_reauth`, without another sign-in attempt after denial. The record shows unchanged service PIDs, restart counts, and configuration, credential, and product-module hashes. DNS, ports, and Relay were unchanged, and services were not restarted. Relay throughput was not measured.

The record is dated 2026-10-21 in local time and contains execution time `2026-10-20T22:50:43.394Z`. These refer to one task, not two. Acceptance covers only this public-page pilot. It does not establish native duplicate handling, cancellation, timeout, restart recovery, automatic wake-up, or around-the-clock operation.

### Boundaries for another run and for connecting 苏婳

Connection acceptance must include a unique platform task and challenge, the external Agent actually claiming it, activity records from its own computer, a screenshot or other evidence, ChunLACK’s saved result and acknowledgment, and explicit human acceptance. HTTP 2xx, a model reply, or execution by a custom worker cannot replace this evidence.

Another pilot requires renewed confirmation of the actual account, workspace, node, capability, scopes, and lifetime. Do not reuse a revoked `grantId`. Connection discovery may use `chunlack_connections_list`. Upload operations `artifact_begin`, `artifact_chunk`, and `artifact_finish`, and fields such as `leaseId` and `attempt`, must follow the actual tools and task; do not invent them. Review `events.read` and `events.subscribe` separately. Selecting scopes does not establish that Events are enabled. This describes a process and authorizes no new task, grant, or subscription.

For 苏婳, independently check supported connectors, authentication, callbacks, tool visibility, wake-up, and revocation paths, then perform acceptance within an approved scope. Preserve the original identity of historical 老镇 nodes, grants, audits, tasks, and artifacts. Do not rename them, automatically migrate permissions, or count old results as 苏婳’s achievements. Muse Gadgets SDK / BLE is a separate device route, not a prerequisite for cloud-computer integration, and must not be installed under the VPS root account.

A reauthentication notice or `insufficient_scope` may also arise from an expired or revoked local business grant. Check bindings and grant status first; do not loop through login or blindly expand scopes. See the [integration guide](MUSE_DOTS_INTEGRATION.zh-CN.md), [Agent grant administration guide](AGENT_GRANT_ADMIN_GUIDE.zh-CN.md), and [public-browser protocol](public-node-task-pilot.md). The integration guide’s 老镇 account-restoration steps and earlier private-network / Open WebUI history are not the current plan for 苏婳. This guide uses the user’s latest identity clarification and the two newer acceptance records; historical files were not changed.

## 8. Records, performance, and safe use

The 2026-10-19 record covers a real model reply saved in the production workspace and displayed again after a refresh. The 2026-10-21 single-task record covers persistence of the result, artifact, and human-acceptance state. The 2026-10-24 login record observed only a historical completed-task summary. Task-result details were not opened, and complete integrity of all historical data was not proven. Historical model replies cannot count as fresh inference.

A previous Windows isolated experiment verified reply IDs and content hashes after restarting the isolated runtime. This does not establish that all unfinished production tasks automatically resume after a restart.

Historical capacity coordination and budget descriptions do not turn simulated load tests, five WebSocket connections, five logical Agents, or one successful model round into a capacity guarantee for five real nodes operating continuously. Keep tasks short initially and avoid starting multiple long-running loops at once.

Save important outcomes separately in project documents. If the page is empty, times out, or disconnects, do not reset data, delete databases, or remove legacy write locks. Interface translation does not change original history or evidence either.

## 9. Administrator maintenance: distinguish new and old services

Everyday users do not need SSH. These retained read-only examples are for an authorized administrator to run on the VPS; none was executed for this revision:

```bash
systemctl show chunlack-public.service chunlack-https.service -p ActiveState -p MainPID -p NRestarts
curl --fail --max-time 10 https://lack.chunclaw.top/health
systemctl show chunlack.service tailscaled.service -p ActiveState -p MainPID -p NRestarts
```

A 200 response from the health endpoint establishes only that this check passed. It does not replace acceptance of login, models, nodes, or real Relay traffic.

| Service or path | Purpose in existing deployment documentation; not a live check for this revision |
|---|---|
| `chunlack-public.service` | Public ChunLACK application |
| `chunlack-https.service` | HTTPS entry |
| `chunlack.service` | Retained old LACK; do not use its restart commands to maintain the new application |
| `tailscaled.service` | Existing Tailscale / Relay; do not restart or change it for ordinary application configuration |
| `/opt/chunlack-public/current` | Public application code path; its name does not establish the running version |
| `/var/lib/chunlack-public/config/lack.config.json` | Public application configuration path |
| `/etc/chunlack-public/runtime.env` | Private runtime environment file; do not print or commit it |
| `/var/backups/chunlack-release-44af1d844a81` | Historical backup cited by the old guide. Its recorded checks of 552 files and 3 database structures do not confirm the current backup or provide an off-site backup |

The old guide described LACK v4.2.2 / `44af1d844a81` as current. This revision does not repeat that assertion. The 2026-10-24 login record references release-evidence commit `57e859ac465ceec5db1495e52eedac9a5983159b` and payload commit `75a7aca23d5b1be5b606cf8ac78b087062f6964e`. These are historical associations, not proof of the version running now. The older [2026-10-20 controlled-release record](verification/2026-10-20-mcp-release-acceptance.json) and the 33-second interruption described in the old guide belong to that historical release, not a new release or the local multilingual version.

Do not treat the legacy SSH-tunnel address `127.0.0.1:3721` as the daily public entry. The legacy tunnel is only another access path and does not prove login to the new system. This revision changes no public ports or tunnels.

Upgrades and rollbacks still require a maintenance window, resource checks, and a consistent backup. The established controlled-release budget is 55 seconds forward and a 120-second total recovery window; do not bypass failure stop conditions. Retain old versions. Do not overwrite newer business data to roll back code, delete legacy write locks, or run an upstream one-click installer over the existing deployment. Documented paths do not authorize private-credential access or production maintenance.

## 10. Frequently asked questions

| Symptom | Suggested checks |
|---|---|
| Pocket ID is signed in, but ChunLACK still shows its login page | Start a new normal SSO flow from the daily entry and check the workspace session; retain original errors such as `Session ID is missing` |
| The page will not open | Check the daily domain, network, HTTPS, and health endpoint; do not start by opening 3721. Historical acceptance does not mean current availability |
| CONNECTED appears, but the Agent does not reply | Check workspace, complete Agent name, channel, and model errors; do not repeatedly start collaboration |
| Models do not load while adding an Agent | Check provider configuration, authorization, and loading state; do not create duplicates or enter keys |
| The file tree fails to load | Check session and directory scope; do not broaden permissions or reset data |
| History is temporarily empty | Wait for the live connection and history loading, then check the database; do not immediately conclude that data was lost |
| A local computer cannot be operated | Check that device’s execution-connector authorization and real acceptance, not just its model API |
| External MCP is unauthorized | Check client, account, workspace grant, and revocation or expiry; do not enable anonymous access or repeat login in a loop |
| 玄玑 succeeded before but will not pick up work now | The historical pilot grant was revoked and Events were not enabled. A new task needs separate bounded authorization; this is not a continuously available service |
| The Muse identity or name differs | 老镇 is historical and unavailable; 苏婳 needs independent acceptance. Do not rename historical nodes or inherit old grants |
| No language switch or English UI is visible | The multilingual UI is in local development and unpublished; the preference is proposed per human user and browser |
| Messages did not translate after changing language | Interface language does not automatically translate messages, attachments, or evidence; original content is preserved |
| Replies are slow, duplicated, or more costly | Check participant count, collaboration mode, loops, context, and output budgets; first stop repeated submissions |

## 11. Acceptance records and outstanding work

Direct sources used to correct status in this revision:

- [2026-10-21 玄玑 native single-task human acceptance](verification/2026-10-21-native-dots-single-task-acceptance.json): `manual_native_single_task_human_accepted`, `readyForFullDelivery: false`; temporary grant revoked, Events not enabled.
- [2026-10-24 human login acceptance after release](verification/2026-10-24-research-release-human-login-acceptance.json): `human_oidc_workspace_acceptance_passed`, `fullDeliveryComplete: false`; the correct workspace, owner, and `CONNECTED` were visible, with 0 model calls, Agent messages, tasks created, and business grants created.
- [Muse / dots integration guide](MUSE_DOTS_INTEGRATION.zh-CN.md): additional task, revocation, and protocol boundaries. The 2026-10-21 section and earlier history have date limits; the latest Muse identity follows the user’s clarification.

Other source links are retained below and were not individually checked again in this revision:

- [2026-10-19 controlled production release and human login](verification/2026-10-19-controlled-production-release.json).
- [2026-10-19 real 1Cat call and persistence in the production workspace](verification/2026-10-19-onecat-production-acceptance.json): historical model-route evidence, not a new call for this revision.
- [2026-10-20 controlled-release record](verification/2026-10-20-mcp-release-acceptance.json): historical release context.
- [Windows isolated experiment with five Agents over two rounds](verification/2026-10-17-real-five-agent-isolated.md): not acceptance of five VPS nodes or sustained real load.
- [Historical sustained low-budget validation](verification/2026-10-11-low-budget-sustained-validation.md): simulated model, not evidence of current real-model capacity.
- [2026-10-20 delivery-gate audit](verification/2026-10-20-delivery-gate-audit.json) and [2026-10-21 audit](verification/2026-10-21-delivery-gate-audit.json): retain their dates. The two newer acceptance records close some older items, so these audits cannot be used unchanged as the current outstanding-work list.

The previous guide also recorded 10/10 real replies from five logical Agents over two rounds, with restart persistence, in a low-interference isolated VPS environment. This remains a historical isolated result, not acceptance of five external devices, multiple humans, or sustained load.

The records read for this revision do not establish: 苏婳’s native connection; Events, automatic wake-up, or continuous availability for 玄玑; external Agents’ native duplicate handling, cancellation, timeout, or restart recovery; multiple humans and multiple real nodes; real mixed local/cloud inference and fallback; sustained load; actual Relay forwarding quality; or multilingual UI publication and acceptance. Current VPS health, running version, model availability, and grant counts were not verified live either.

The 2026-10-24 post-release human login did happen and must no longer be listed as wholly incomplete. 玄玑’s single-task human acceptance also happened and must not remain generically labeled unconnected. Each success holds only within its own evidence boundaries.

This revision updates only the Chinese and English documentation. It creates no accounts, Agents, nodes, grants, or subscriptions, and performs no installation, model calls, production changes, tests, or live verification. See the complete matching [Chinese user guide](USER_GUIDE.zh-CN.md).
