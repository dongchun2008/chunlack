# Native Agent conversation isolation

Date: 2026-10-21
Status: proposed design; implementation and native acceptance pending
Inspected repository baseline: `4dd3c9d3318f4021a1960fd22f00281b79057561`

## User requirement

ChunLACK must not fill the owner's ordinary conversation with the native dot
Xuanji with task instructions, progress messages, protocol details or receipts.
Preserve the native Agent requirement: a generic Work task, Codex task, model API
or custom worker is not an equivalent replacement for that Agent and its own
cloud-computer capability.

This is an architectural routing requirement, not merely a collapsed-message UI.
This document does not enable delivery, subscribe to events, restore grants,
create conversations or change production configuration.

## Current evidence and limits

- The accepted single-task native-dot trial is documented in
  [the acceptance record](../../verification/2026-10-21-native-dots-single-task-acceptance.json).
  It used a manually sent instruction in the daily dot conversation. That proves
  one native execution path, not an isolated or automatic dispatch path.
- The trial grant was revoked. This design does not reinstate it. The recorded
  production event mode remains disabled; no production recheck was performed
  for this read-only design task.
- `integrations/mcp/pilot-server.cjs` passes authenticated event subscriptions to
  the event implementation, including the server-resolved grant binding.
- `integrations/mcp/events.cjs` identifies subscriptions by workspace, node,
  exact task, callback URL and, where present, grant ID. Secrets are encrypted
  and authorization is checked again before delivery.
- The current event catalog exposes only `pilot.task_ready` for one exact task.
  Subscription lifetime is at most 300000 ms, capacity is five subscriptions,
  and the payload contains task identity/type/deadline and workspace identity,
  not full task instructions or screenshot bytes. This is not a durable generic
  project queue subscription.
- `integrations/mcp/runtime.cjs` selects authorized queued public-browser tasks
  and delivers at most one event per flush. It does not create native dot
  conversations or verify their identity.
- There is no inspected implementation of a verified independent native-dot
  destination or a main-conversation exclusion policy. An authenticated callback
  proves control of an endpoint, not that it belongs to an isolated conversation.

## Officially documented capabilities

[Tasks and memory](https://learn.chatgpt.com/docs/dots/tasks-and-memory)
describes dot-created independent cloud threads, with task-specific instructions
and context. It also describes shared relevant memory and dot notes. Separate
visible task conversations therefore must not be advertised as strict memory
isolation.

[Computers and apps](https://learn.chatgpt.com/docs/dots/computers-and-apps)
describes the dot's own cloud computer and separate cloud threads. It does not
establish that every delegated thread inherits that computer, its signed-in
sessions or identical plugin authority. That combination remains unverified.

[MCP Events](https://developers.openai.com/plugins/build/mcp-events) delivers an
event into the subscribing chat. The server receives a callback URL, not a
documented general-purpose native-dot conversation selector. A successful HTTP
response acknowledges receipt, not execution or completion.

Sources were opened on 2026-10-21. These statements establish a candidate route,
not current-account or end-to-end acceptance.

## Proposed behavior

### Separate three responsibilities

1. The owner's daily native-dot conversation remains for the owner. Do not type,
   paste or deliver task traffic there by default.
2. A separately verified native task destination receives the minimum necessary
   task context. Its exact capability, identity and authorization must be proven
   before calling it an isolated Xuanji execution route.
3. ChunLACK remains the authoritative task, progress, evidence, receipt and human
   acceptance store. Its existing task view is the normal place to read logs.

Proposed flow:

```text
ChunLACK workspace / owner / node / exact task
    -> authenticated, owner-confirmed isolated destination
    -> native Agent execution, if separately proven
    -> structured result + artifacts into ChunLACK

Owner's daily dot chat: no routine dispatch, progress, receipt or retry messages
```

### Default quiet policy

- Keep routine progress, protocol errors, event acknowledgments and technical
  diagnostics in ChunLACK, not the daily chat.
- Store screenshots and reports in the existing artifact/evidence flow; do not
  paste base64, leases, nonce values or raw tool JSON into the daily chat.
- If the owner chooses notifications, send one concise terminal summary or one
  actionable approval/failure request to an explicitly selected destination.
  Default is no daily-chat notification, including on successful completion.
- Deduplicate notices by task and state transition. A transport acknowledgment
  alone must not generate a success notice.
- Do not delete or rewrite previous trial messages, the owner's draft or saved
  dot notes as a substitute for preventing future interference.

### Fail closed on destination uncertainty

- No independent destination is currently established by this design.
- Do not guess a destination from a dot name, display label, callback hostname,
  MCP `_meta`, an arbitrary client-supplied thread ID or a URL query parameter.
- Keep any UI-observed conversation reference private and owner-scoped. It is
  evidence for owner confirmation, not an authorization credential.
- If the selected route is missing, expired, revoked, replaced or unreachable,
  pause dispatch and report its state in ChunLACK. Never silently fall back to
  the daily conversation, another owner, another workspace or a generic worker.
- A separate route does not grant additional tool, file, shell, browser or
  network permissions. Existing account/client/workspace/node/task and lease
  checks remain authoritative.
- Server-side routing can minimize exported context. It cannot guarantee that
  the vendor's dot memory or cloud-browser sessions are independent.

## Options considered

| Option | Assessment |
| --- | --- |
| Continue in the daily dot chat, with shorter messages | Does not meet the requirement; rejected as the default route. |
| Separate, native-dot-managed task destination | Preferred feasibility target, but same-Agent computer access and subscription placement require proof. |
| Dedicated Work/Codex task or custom worker | Potentially useful as a different node type; not a silent substitute for Xuanji. |
| Separate external account or Slack/Teams channel | Adds identity, cost or external-service dependencies; not selected or configured by this design. |

## Minimal implementation boundary, conditional on feasibility

First prove the vendor route. Do not add a dispatcher or a database migration
merely because separate cloud threads are documented.

If feasibility succeeds, reuse the existing application process, SQLite event
store, authenticated task tools, callback validation and bounded delivery loop.
No new Redis, broker, always-running browser, GPU process or service is planned.

An owner-confirmed destination record would need to bind the relevant workspace,
owner/account, client, node, exact task/subscription and callback fingerprint,
with pending/approved/revoked/expired states. A display label alone cannot mark a
route approved. The final schema and whether extra storage is necessary remain
implementation decisions after feasibility and design approval.

Do not broaden the five-minute exact-task pilot into an indefinite queue in this
change. General research/development queues are a separate delivery gate.

Candidate affected files, not an approved edit list:

- `integrations/mcp/events.cjs`: explicit destination approval binding, if needed.
- `integrations/mcp/runtime.cjs`: reject delivery without an active approved route.
- `identity/workspace-shell.js` and its owner API: route status/approval and quiet
  notification controls, if existing management abstractions can support them.
- Existing MCP, event, workspace and packaged-runtime test suites: destination
  mismatch, revocation, persistence and no-main-chat-fallback coverage.

Inspect those management APIs before deciding exact product edits. Production
rollout, event activation and new business authorization remain separate gates.

## Staged plan and acceptance

### Stage A: approve this architecture and verify vendor feasibility

Read-only UI inspection may locate the supported independent task entry. Any
instruction to the native dot, creation of a new task conversation, event
subscription or grant must be explicitly included in the next approved pilot.
Do not send a setup instruction into the daily chat without the owner's consent.

Require evidence that an independent task belongs to the intended native dot,
has the intended cloud-browser capability, can access only its approved task,
and returns artifacts through ChunLACK. A generic child task is insufficient.
If this capability is unavailable, report the limitation rather than marking
isolation complete or silently changing the execution identity.

### Stage B: bounded local and isolated implementation

After feasibility and approval, implement only the proven route using existing
authorization and event components. Test wrong owner/workspace/node/task,
unapproved destination, altered callback, expired/revoked grant, retry,
duplicate delivery, cancellation and restart. None may fall back to the main
chat or expand permissions. Preserve existing callback TLS/SSRF protections.

### Stage C: one real isolated native task

Use one public, non-sensitive task with bounded authorization and no concurrent
daily-chat input from automation. Capture the independent destination, native
computer activity, task/nonce correlation, screenshot, persisted receipt and
human acceptance. Observe the daily chat before and after, without exporting
unrelated private conversation content, and confirm that it received no task
body, progress stream or receipt. Confirm that any notification matches the
owner's explicit policy, and revoke the temporary grant/subscription afterward.

Cancellation must be checked against actual remote execution; revoking access
alone does not prove that an already-running remote action stopped.

### Stage D: controlled release and broader delivery gates

Only after the isolated native route passes may it enter the existing release
process with backup and rollback protections. Keep old LACK, Tailscale Relay,
credentials, DNS and ports unchanged. Preserve the broader delivery audit;
this feature does not complete Muse, real multi-user, mixed-provider, source-
verified research, physical-node or sustained-load acceptance.

## Decision needed

Approve the quiet, fail-closed isolated-destination design and one bounded
feasibility pilot. No claim of native conversation isolation is made until
Stage C has evidence and human acceptance.
