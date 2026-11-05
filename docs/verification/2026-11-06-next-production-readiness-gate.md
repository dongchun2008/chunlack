# Next production-readiness gate (not a publication approval)

Date: 2026-11-06

## Confirmed in this phase

The newly authorized isolated prepare/success/rollback sequence completed 3/3,
without retries. The original parent-directory metadata checks were preserved.
Forward receipt: 37.592 seconds (limit 55). Rollback transaction: 41.899 seconds
(limit 120); this is not a separately measured post-fault recovery segment.
Late injected writes were retained. This is not production acceptance.

## Exact product delta to verify

The candidate contains 66 tracked product files versus a baseline of 57:
9 additions, 11 modifications, no removals, 46 unchanged hashes.
These are distinct from the three private rehearsal-harness edits.

Additions:
- `deploy/public/Caddyfile.template`
- `identity/chat-messages.js`
- `identity/display.js`
- `identity/help-assets.cjs`
- `identity/help.js`
- `identity/help/en.md`
- `identity/help/zh-CN.md`
- `identity/i18n.js`
- `identity/messages.js`

Modifications:
- `collaboration/capacity.cjs`
- `collaboration/model-transport.cjs`
- `collaboration/task-control.cjs`
- `gateway/admin.html`
- `identity/login.html`
- `identity/workspace-shell.js`
- `identity/workspace-ui.js`
- `package-lock.json`
- `package.json`
- `public/index.html`
- `server.js`

## Proposed next authorization, not yet granted

One fresh read-only SSH preflight, remote limit 20 seconds and total local limit
35 seconds, with no automatic retry, plus local preparation of an inactive
formal package. No additional Linux units or production publication.

Check final source and dependency hashes, code/config/data ownership, candidate
and deployed typed entry resource policies, backup capacity, compatibility-proof
age, and restoration restrictions. Do not read credential values or modify
production configuration. The fixed candidate's typed CPU request is 20%; the
live deployed entry policy remains unknown, not assumed from its legacy template.

Stop and report any mismatch. A stale compatibility proof is not silently
refreshed and does not authorize another unit. Publication, service start/stop,
backup creation/restoration and any new Linux quota need their own explicit scope.

## Evidence limits carried forward

- Prepare's lifecycle true value is a runner summary, not a formal FD gate.
- Raw active/final resource receipts were not separately downloaded.
- Three-database row/schema preservation is supported by aggregate receipts;
  database names and per-table details were not saved in this phase.
- Root read-only binding plus successful lease checks is not a direct EROFS test
  or a complete kernel mount-tree observation.
- Four service baselines and three configuration hashes passed; this is not a
  comprehensive listener or Relay-specific health revalidation.
- Two Socket 10038 warnings remain recorded, one per SSH session.

## Production delivery still required

After explicit maintenance approval and successful publication, verify actual
Chinese/English UI and help, Pocket ID callback and workspace isolation, provider-
neutral routing without Open WebUI integration, research provenance/budget/timeout
and no-retry boundaries, and the user handover. External-Agent vendor acceptance
must remain distinct from local interface support and prior one-shot tests;
missing vendor login or authorization must be reported, not bypassed.
