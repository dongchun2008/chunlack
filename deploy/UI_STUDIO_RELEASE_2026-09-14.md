# LACK Studio release acceptance, 2026-09-14

## Published release

- Application release: `6c37342c03728173b09dea85927e5fe153d5fcf3`.
- Previous release retained: `/opt/chunlack/releases/56ec5ba`.
- Active release: `/opt/chunlack/releases/6c37342`.
- `/opt/chunlack/current` was switched after a stopped-service backup.
- Backup, offline restore check, switch and health readiness took 3 seconds in
  the deployment script. LACK was intentionally stopped/started once; this is
  not a zero-downtime release.
- HTTP remains loopback-only at `127.0.0.1:3721`. Browser access is through an
  SSH tunnel, for example local `127.0.0.1:13721`.
- Generated `server.js` and the dependency lockfile matched the old release
  byte-for-byte. The existing private Node runtime and matching dependencies
  were reused. No OS package, firewall, provider credential or relay change.

Archive SHA-256:

```text
1b01323c62926dc1e2378237828db0b80a5e61df27467b8335aaa7208b7a2382
```

## Automated verification

- All 15 existing regression tests passed in a low-privilege, resource-limited
  systemd test process on the VPS.
- Existing smoke test passed: HTTP, WebSocket, two simulated model providers,
  SQLite restart persistence, private bind and configuration preservation.
- Generated frontend JavaScript syntax passed; HTML element IDs were unique and
  required legacy and Studio interaction IDs were present.
- A disposable instance using the production jail/resource policy completed one
  full five-Agent discussion round. All five provider routes and all five
  replies were observed. Later Agents received the first Agent's prior reply.
- The same isolated round check passed 100 HTTP health requests and traversal
  rejection. Models were synthetic; no paid or real provider calls were made.

The smoke test's database persistence result is NOT a claim that the known
channel-history reload issue is fixed.

## Browser verification

Desktop viewport: 1280 x 720. Mobile viewport: 390 x 844.

- Actual new interface rendered with no browser console errors in the tested tab.
- Empty-channel onboarding and prompt cards rendered.
- Clicking a prompt card filled the composer with zero messages sent.
- Light/dark theme toggle worked.
- Mobile navigation opened and closed after channel selection; the document
  width was exactly 390 pixels, without horizontal overflow.
- Workspace menu, graph modal and repository-tree modal opened and closed.
- Agent edit opened, provider/model selection was saved in the disposable
  instance, and subsequent replies used the selected mock route.
- Browser message submission and five-Agent responses were visible.
- Thread panel opened, accepted a synthetic reply and closed.
- Shift+Enter inserted a newline without sending.
- The live production page was opened after publication and displayed the
  Studio layout, the existing Moderator and CONNECTED status.

## Failures and verification limits

- The Windows shell lacked an `npm` command. Tests were therefore run with the
  already installed private VPS runtime, not by installing global software.
- The first disposable configuration omitted `requiresApiKey: false` for the
  loopback mock providers. It produced a first-reply timeout. Only the mock
  configuration was corrected; production authentication was not weakened.
- The legacy `acceptance.cjs exercise` rerun failed at `shared prior context 4`.
  It sends several overlapping mention-prefixed messages and inspects a first
  provider call. Mentions do not restrict dispatch, and context retains only
  eight recent relevant messages. This runner was not counted as passing and
  was not rewritten in this UI release. A separate single-round check above
  verified actual five-Agent participation and ordered shared context.
- The draft-replacement native confirmation stalled the in-app browser control
  channel. That disposable tab was closed. Automated confirmation dismissal and
  draft preservation after dismissal remain unverified; no reset was accepted.
- Full native Add Agent prompt flow, attachment file picker, destructive CRON
  confirmation, exhaustive keyboard access and reduced-motion emulation were
  not fully exercised. Their existing handlers were retained.
- A temporary mock-driver launch used a root-only evidence path; its runnable
  copy was placed outside that private directory and run as `chunlack`.
- Real models, long-duration load, the existing history reload defect, global
  queue enforcement and local computer connectors are outside this UI release.

## Backup and post-publication checks

Private backup directory:

```text
/opt/chunlack/backups/20260914-studio-predeploy
```

The backup contains the application data archive, unit, private provider
environment, previous release pointer and checksums. It was extracted into a
separate `restore-check` directory; 513 file hashes matched the stopped source.
Restored SQLite integrity was `ok`. This was an offline restore check, not a
second production restart or an off-host backup.

After publication:

- Live configuration checksum remained identical.
- Database integrity and all table counts matched the backup, including zero
  messages and one existing Agent. No synthetic Agent entered production.
- Served HTML matched the new release file byte-for-byte.
- All 20 production health probes succeeded; maximum observed latency 36.53 ms.
- LACK active PID: 234363, automatic restart count: 0.
- Tailscale active PID remained 859, restart count 0, BackendState Running,
  reported health list empty; relay UDP 40000 remained listening.
- Every originally running service was still active at the publication check.
- Available memory after cleanup: 1112 MiB; swap used: 0; no new kernel OOM entry
  was observed during the deployment window.
- Test service and mock model stopped; temporary systemd fixture unit removed.
  Test ports 3722 and 13870 no longer listened. Private test data/evidence remain.

## Rollback and evidence

For an approved rollback, stop only `chunlack`, point `/opt/chunlack/current`
back to the retained `56ec5ba` release, then start and health-check only LACK.
Do not overwrite newer live data with the backup merely to roll back this UI.
The deployment script automatically selected the old release on a failed gate;
this path was prepared but not triggered by the successful publication.

Private evidence is in `/opt/chunlack/evidence/20260914-studio`, including
regression logs, unsuccessful legacy acceptance logs, successful five-Agent
round results, backup comparisons and post-deployment results. The operator
script is `/opt/chunlack/publish-studio-20260914.sh`. Credentials, raw backups and
private configuration were not committed to GitHub.
