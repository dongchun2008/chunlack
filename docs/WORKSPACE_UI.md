# Multi-user workspace UI: local implementation status

## Implemented source

- The existing avocado chat UI now boots through verified account and workspace
  metadata in explicit multi-user mode. The explicit loopback legacy mode keeps
  its original initialization path. Missing mode/identity scripts fail closed.
- Each tab remembers only its non-secret workspace ID. CSRF stays in memory;
  HTTP and WebSocket selectors come from verified memberships. Changing scope
  clears private content, aborts requests/readers, stops timers/workers, closes
  subscriptions and reloads the legacy chat presentation before reuse.
- `/login` and the main page provide sign-in, sign-out and bound invitation
  acceptance. Password fields clear before submission. An invalid session cookie
  is expired; a successful account switch revokes only the replaced browser
  session, not the account's other devices.
- Members, nodes and task progress have separate panels. Owners manage members
  and node grants; members can execute and cancel their own tasks; viewers have
  read-only controls. UI restrictions are convenience only. The backend checks
  current membership, CSRF and individual resource ownership on every request.
- Destructive panel actions require an in-page confirmation, cancelled on close
  or scope reset. One-time invitation/pairing values are not rendered or stored;
  an explicit copy action is offered. Model/node credentials are never displayed.
- Source panels retain original HTTPS links and acquired excerpts as text.
  Missing links/excerpts or unmatched claim references are marked as missing
  evidence. A reference alone is not represented as independent verification.
- Public host-file/Git/shell/cron operations remain unavailable. Agent model
  selection keeps provider-neutral grants and existing Ollama support.

## Evidence boundaries

- Unit DOM tests prohibit dynamic HTML in the workspace shell. Embedded chat
  tests cover attribute escaping and Agent-detail injection. These are not
  screenshot/layout acceptance.
- Backend integration uses real local HTTP, WebSocket, SQLite, passwords and
  sessions. Runtime integration now launches the materialized deliverable, not
  a manually copied list of dependencies.
- The manual browser fixture uses three disposable accounts, two workspaces and
  separate cookie names per loopback proxy. Its HTTP/cookie adapter and model
  are explicitly mocked; its yellow badge says NOT PRODUCTION. No production
  TLS or real model/Muse/dots acceptance can be inferred from this fixture.
- Browser interaction confirmed three accounts, owner/member/viewer controls,
  independent A/B selections, removal clearing only the affected workspace,
  switching back to an authorized workspace, and logout clearing both active
  tabs of the same session. Node create/pause/resume/revoke and mock-model task
  progress were exercised against the actual local embedded backend. Revoked
  nodes no longer offer management actions; succeeded tasks do not offer cancel.
- The native confirmation issue was isolated to the in-app browser. The in-page
  replacement and DELETE body-framing correction passed live Chrome checks and
  failed-first tests without weakening production JSON/CSRF/authentication.
- Agent provider/model metadata and granted model selection were checked in the
  browser. A separately labelled rendering-only evidence fixture checked exact
  original links, malicious excerpts remaining text, zero injected images and
  missing evidence. It is not a real research retrieval or verification result.
- Desktop, 390px chat and 390px evidence-panel screenshots are outside Git.
  Chrome viewport override applied to the selected test tab, not every tab;
  screenshots of unchanged desktop tabs were not counted as narrow-screen proof.
- These UI checks do not establish final system delivery, production TLS, real
  provider availability or Muse/dots execution. Those remain separate gates.

## Runtime asset preparation

`scripts/materialize.py` includes identity, collaboration, gateway, SDK, MCP,
account-maintenance CLI and pinned package manifests. It excludes test workers,
runtime data and credential files, preserves existing private configuration and
databases, and rejects linked output components before the first write.

This does not implement the remaining Task 10 atomic startup/close and writer
guard, public ingress preflight, Task 11 migration/restart audit, or Task 12
production and real-agent acceptance. VPS, DNS, private credentials and Peer
Relay have not been modified by this local increment.
