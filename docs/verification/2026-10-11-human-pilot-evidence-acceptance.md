# Human pilot evidence and acceptance regression

## Scope and delivery boundary

This checkpoint adds the authenticated human side of the existing fixed public
browser pilot. It does not replace the general Agent protocol with a browser-only
protocol. Existing provider-neutral routing and Ollama support remain in place.
No Open WebUI connection, private API credential, account credential, DNS,
firewall, production service, or host port 443 was changed.

The source snapshot tested on native Linux is `human-evidence-20261011-a47d`,
based on commit `7e446dc51a8bb3686ba5117b559d20f76d8d226b`, with this checkpoint's
uncommitted, explicitly scoped product/test changes included. It is not a claim
that the base commit alone contains this feature. The bundle contains 260 tracked
files; source archive SHA-256:
`9ae9277638c369b67eadb996dc74a1a87146991dd74538fbcc7cfca4a737f840`.

## Human workflow and access boundaries

- Existing task rows for `browser.public_read` offer a task evidence panel.
- Evidence text is rendered as text, not HTML. Only safe HTTPS source links are
  clickable. The response excludes the execution challenge, node credential,
  lease secrets, raw task input and filesystem location.
- The image is fetched with the verified human session and current workspace,
  not through a node credential or an unprotected static directory. The server
  independently checks the stored image bytes, metadata and retention boundary.
- Switching workspaces or closing the panel discards late responses and releases
  owned image Blob URLs. Fetch consumption checks its workspace generation both
  before and after waiting for the binary body.
- Members and viewers may read evidence for their own workspace. Only its actual
  owner may explicitly accept it, with fresh session/membership, Origin and CSRF
  checks. A role posted in the request does not confer permission.
- The UI enables owner acceptance only after image load, and requires a separate
  in-page confirmation. The server still checks evidence independently; frontend
  controls are not the authorization boundary.
- Node revocation does not erase readable historical human evidence. It prevents
  a new acceptance with HTTP 409 without turning a node-access failure into a
  human-session logout. Foreign task IDs remain indistinguishable from missing
  task IDs. Node bearer credentials cannot impersonate a human.
- `evidence_checked` means bounded fields and file integrity were checked, not
  that Muse or dots actually executed the task. `accepted` records explicit owner
  acceptance with its existing timestamp. This increment does not add an
  `acceptedBy` audit schema or a claim of independent vendor execution proof.

Human endpoints, behind the existing session/workspace transport:

| Route | Purpose | Permission |
| --- | --- | --- |
| `GET /api/tasks/:id/evidence` | Bounded result and acceptance metadata | Workspace read |
| `GET /api/tasks/:id/artifact` | Verified PNG/JPEG bytes, no-store, nosniff | Workspace read |
| `POST /api/tasks/:id/acceptance` | Explicit `{ "confirm": true }` acceptance | Workspace owner |

Path: verified session -> transport action policy -> human workspace facade ->
workspace-bound store -> bounded artifact reader. Existing node upload and
result routes retain their own credential, lease and scope checks.

## Red and repair evidence

Before implementation, HTTP/UI tests reported 35/41 passing with six intended
missing-feature failures. The generated-package real HTTPS lifecycle separately
failed on the missing human evidence route (404). No assertion was relaxed.

The first implementation reported 41/42 passing: the screenshot UI had cached
the image URL API before the fixture supplied it. The correction resolves the
API when creating an image and retains the creating API for that image's cleanup.
The same image/confirmation assertion then passed. A revoked-node approval and
continued-human-session assertion was also added.

## Fresh Windows evidence

Node v24.19.0; Caddy v2.11.7 explicitly enabled, including actual generated-package
HTTPS lifecycle tests with certificate verification.

| Check | Result | Duration |
| --- | --- | --- |
| Focused human controls/UI/HTTPS lifecycle | 42/42, zero failures/skips/cancellations | 16463.646 ms |
| Full project regression | 467/467, zero failures/skips/cancellations | 78873.6978 ms |
| Standalone real HTTP + WebSocket smoke | Exit 0 | See log |

Full regression includes identity enforcement, workspace switching, original
SQLite/WAL snapshot preservation, tamper rejection and non-activating isolated
restore. These are fresh runs, not reused earlier checkpoint results.

Logs are under ignored private scratch
`.superpowers/sdd/2026-10-09-multi-user-workspace-delivery/`:

| Log | SHA-256 |
| --- | --- |
| `human-evidence-focused-fixed.log` | `f6a92b5bd34dbc0dac4aef2462ded25c725d608cedc043ddee35d098fa4183fe` |
| `human-evidence-full.log` | `aa9cdeb908239642a358240bb3fcadfc0e9a37e905e521ec5113a484633e0679` |
| `human-evidence-smoke.log` | `f11986f4ca6071992a388765ca44f0a4d23d1332a8d0f6a1603c5cd04cec79cb` |

## Fresh native Linux and bounded co-host evidence

An owned transient test unit on the existing VPS used a separate root, private
network namespace, private devices, read-only source/dependencies, independent
test databases and high loopback ports. Limits: CPU 50% of one core, memory
256 MiB, 64 tasks and 900-second runtime. Its separate read-only co-host monitor
was capped at CPU 5%, memory 32 MiB and 16 tasks. No global software was installed.
Linux Node v24.21.0, Python 3.12.3, Caddy v2.11.7; downloaded Caddy archive matched
the pinned SHA-256 before extraction. Archive traversal/link/size checks passed.

| Check | Result | Duration |
| --- | --- | --- |
| Default Python runtime/config checks | 20/20, no skips | 15568.192817 ms |
| Human controls/UI/HTTPS/Agent-round focused checks | 45/45, no skips | 52617.73115 ms |
| Full project regression | 467/467, no failures/skips/cancellations | 214483.242167 ms |
| Real HTTP + WebSocket smoke | Exit 0 | See archive |
| Requested 180-second synthetic HTTPS/WSS collaboration soak | Exit 0, duration met | 181427 ms sustained |

Soak measurement: 3 human sessions, 2 workspaces, 5 logical Agents per workspace,
80 completed full rounds (40 per workspace), 400 main model requests and 800 total
generation requests. Failed rounds 0; privacy failures 0; maximum simultaneous
model HTTP requests 1. Five paired nodes were idle (`nodesExecutedTasks=0`).
Total harness duration 187105 ms; round p95 2294 ms. This is neither a real-model
nor five-busy-node capacity claim. Main cgroup memory peak 138465280 bytes;
aggregate CPU usage 144558424000 ns includes its complete test sequence.

31 co-host samples retained existing LACK PID 234963 and tailscaled PID 859,
zero restarts, active state, HTTP health 200 and six monitored UDP listeners.
No host TCP 443 listener appeared. The final post-cleanup observation at
2026-10-10T19:11:37Z retained the same baseline. This is sampled coexistence
evidence, not a measurement of Relay traffic throughput, latency or loss.

The monitor transient unit had already been auto-unloaded at cleanup, so stopping
both units in one command returned `not loaded` and the chained deletion did not
run. Cleanup was then explicitly gated on both units being inactive with PID 0,
exact canonical paths and owner markers. Only the owned `/run` and `/var/tmp`
trial roots were removed. Both units were observed not-found/inactive, both roots
absent and SSH closed. No production restart occurred.

Downloaded evidence archive was hash-verified before deleting the remote trial:
`eb83c1b90fc11f0f8941e3c5772bb823982a56fee322feb076e8c513346a7568`.
Private local archive:
`.superpowers/sdd/2026-10-09-multi-user-workspace-delivery/linux-isolated/chunlack-evidence-20261011-a47d/evidence.tar.gz`.
Caddy's version query emitted the known HOME/XDG fallback warning in the isolated
root; actual TLS fixtures and all tests passed. It is not suppressed as evidence.

## Remaining real-use gates

- A rendered real-browser UI/image acceptance session; DOM tests manually invoke
  image load and are not proof of viewport layout or a real browser image decode.
- User-authorized direct local/cloud model address, model ID and safe credential
  reference. Mock responses do not validate llama.cpp, 1Cat, Spark or cloud APIs.
- Muse (老镇) and dots (玄玑) account permissions, supported notification/task
  path and their own cloud-computer activity, screenshot and correlated receipt.
- Independent historical-release restore, actual production data ownership and
  maintenance/cutover window.
- Public DNS, certificate and human login deployment, plus real busy-node and
  Relay business-traffic coexistence acceptance.

This checkpoint is a verified development increment, not final production
delivery or permission to claim all external Agent capabilities are connected.
