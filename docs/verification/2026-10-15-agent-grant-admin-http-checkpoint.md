# Human Agent-grant administration checkpoint, 2026-10-15

Status: local development only. The known runtime fixture correction remains
awaiting explicit approval; no production or full-delivery claim follows.

## Changes

- Existing `identity/http.cjs` now accepts a trusted authority and mounts
  workspace-owner GET/POST/DELETE grant routes beside member administration.
- Existing session, exact-Origin, JSON and CSRF validation are reused. Agent
  tokens cannot replace human sessions. Creation/deletion reject extra body
  fields instead of trusting caller-supplied roles or workspace identities.
- Existing authority adds a bounded owner-only administrative listing. Stale
  records remain visible for revocation; listing does not grant execution.
- The public-runtime facade forwards list/grant/revoke only after authority
  binding and rejects them during shutdown. The embedded server passes this
  trusted facade to the identity router; no new listener is introduced.
- The visual panel is not implemented in this checkpoint. Human HTTP routes
  have been exercised, but packaged end-to-end human administration still needs
  its own acceptance coverage.

## Tests

Ignored TAP reports are in
`.superpowers/sdd/2026-10-14-agent-grant-routing/`.

- `admin-http-red.tap`: 7/7 new tests failed before implementation because the
  endpoints did not exist (HTTP 404).
- `admin-http-green.tap`: 7/7 passed, zero failures/skips/cancellations,
  2219.3734 ms. Real SQLite authority, real session authentication and real HTTP
  router exercise create/list/revoke/audit, Bearer rejection, CSRF/Origin/JSON,
  member/viewer denial, cross-workspace privacy, injected fields, node/subject/
  client checks, duplicates, role changes and disabled endpoint behavior.
- `admin-related.tap`: 46 executed, 45 passed, one failed, zero skipped or
  cancelled, 25715.154 ms. Covers the above plus existing identity HTTP, grant
  routing/discovery/budget and new public runtime assembly tests.

The related command attempted a negative name filter, but the known runtime
test was still executed. Preserve the actual 45/46 result: its failure is the
previously reported `nodeId` versus `id` assertion in
`tests/public-agent-runtime.test.cjs:117`. No new failure was reported in this
run. Its later revocation assertions still have not executed successfully.

This is not a full repository run, constrained Linux acceptance, production
rollout or native Muse/dots acceptance. No production, Pocket ID application,
credential, model route, DNS, ingress or Relay configuration was changed.
Changes remain local and uncommitted pending the known repair and validation.

## Next gates

Correct the known fixture only after approval, verify the full runtime/admin
path and visual administration, run full/local and scoped native regressions,
then continue exact ingress, restore invalidation, native protocol and separately
approved Pocket ID/vendor enrollment. Do not treat these endpoints as permission
to create a live client or expand a real workspace grant.
