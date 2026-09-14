# Avocado palette release, 2026-09-14

## Release and scope

- Published application: `e188eaea31314d2138313129d4daf607865e49aa`.
- Previous release retained: `/opt/chunlack/releases/6c37342`.
- Active release: `/opt/chunlack/releases/e188eae`.
- CSS-only change. Generated server, frontend JavaScript and HTML structure
  were compared with the previous release and were unchanged. Lockfile matched.
- No provider, model, permission, port, OS package or Tailscale configuration
  was changed. Existing private Node runtime and dependencies were reused.

## Validation

- All 15 existing regression tests passed.
- Existing HTTP/WebSocket, simulated-model and persistence smoke test passed.
- Disposable UI inspected at 1280 x 720 and 390 x 844.
- Light/dark themes, mobile navigation and channel selection worked.
- Draft starter populated the composer without sending a message.
- Desktop and mobile document widths matched the viewport, with no horizontal
  overflow in the checked states. No browser console errors were observed.
- Computed foreground/background contrast ratios: light primary buttons 5.82:1,
  channel heading 12.77:1, welcome copy 5.42:1, dark primary button 8.47:1.
  These are selected solid-color checks, not an exhaustive accessibility audit.
- The actual production page was refreshed after confirming its composer was
  empty. It displayed the avocado theme and CONNECTED state.

## Deployment and preservation

- Stopped only LACK for a consistent backup, then switched the release pointer.
- Backup/restore-file check, version switch and readiness took 3 seconds.
- Private backup: `/opt/chunlack/backups/20260914-avocado-predeploy`.
- Offline restore comparison matched 513 files; SQLite integrity was `ok`.
- Live config checksum and all database table counts were preserved.
- Production health: 20/20 successful checks, maximum observed latency 38.83 ms.
- LACK PID after the planned restart: 234963; automatic restart count 0.
- Tailscale PID remained 859, restart count 0, BackendState Running and empty
  health warnings. Relay UDP 40000 remained listening.
- All originally running services remained active at the publication gate.
- Cleanup left production HTTP bound only to `127.0.0.1:3721`; the disposable
  test service and port 3723 were stopped. Test data/evidence retained privately.
- Available memory after cleanup: 1104 MiB; swap used: 0.

Evidence: `/opt/chunlack/evidence/20260914-avocado`.
Guarded deployment script: `/opt/chunlack/publish-avocado-20260914.sh`.

For an approved rollback, stop only LACK, select the retained `6c37342` release
via `/opt/chunlack/current`, start LACK and check readiness. Do not overwrite
newer live data merely to roll back this palette. An automatic rollback guard
was prepared but not triggered in this successful deployment.

Archive SHA-256:
`dd073570188f353c59b5c137efec84b260e3d49c7b7e47439fd5738f362a4fd5`.

Real model onboarding, history reload, global admission control, native dialog
automation and long-duration stability were not requalified by this palette
release. Existing limitations remain as documented in the Studio release record.
