# Public runtime lifecycle checkpoint

This is a local development checkpoint, not a production deployment or an external Agent acceptance report.

## Owned startup

- Materialize a versioned code package with `python scripts/materialize.py --output <package>` and install its pinned dependencies in that package, not in an existing service directory.
- Keep the private data root separate from code. The production entry is `<package>/gateway/public-runtime.cjs` with an absolute `LACK_DATA_ROOT`.
- The private data configuration must explicitly contain `multiUser.enabled: true` and `multiUser.migrationReady: true`. Readiness is to be produced by the planned reviewed migration workflow, not by guessing an owner or setting a flag over old data.
- Startup also verifies the existing identity/collaboration schema, SQLite checks, workspace bindings and an active owner for each enabled workspace. It does not migrate or adopt old global messages.
- Required `publicRuntime` settings: distinct HTTPS `webOrigin` and `agentsOrigin`, and an integer `mcpPort`. The existing `httpPort` and `agentGateway.port` must be distinct, non-privileged ports. All three listeners bind only `127.0.0.1`.
- The existing `agentGateway.adminTokenEnv` is a private internal credential, not a publicly usable platform-admin token. Do not put its value in Git, URLs or screenshots.
- One process shares one identity store and one capacity coordinator between web, node REST and MCP. The initial inference/external execution capacity is one global slot, not one slot per workspace.
- Web and gateway remain not-ready until MCP initialization has succeeded. A failed component rolls back the owned listeners and databases.

## Shutdown and writer ownership

- `startLackRuntime()` is explicitly exported. Importing a generated `server.js` no longer starts services, opens application data or registers retained startup timers.
- `close()` stops admission, aborts scoped work, waits for actual local transport settlement, terminates owned WebSockets, closes owned HTTP/database resources and clears owned timers. Remote leases are not misreported as completed or cancelled just because the controller stops.
- A private `.public-runtime.lock` protects the data root. The server requires an opaque in-process writer lease; a second process or the legacy entry cannot substitute a configuration flag or a fabricated lease.
- A stale lock is never automatically adopted. Do not delete it merely because a PID looks absent. Recovery must first confirm the old writer and its listeners are stopped and examine the recorded instance and database state.
- A replaced lock or incomplete shutdown is an error, not permission to start another writer. Production recovery and backup procedures remain part of the following migration/recovery stage.

## Verification boundary

- Local tests exercise the actual materialized package over loopback HTTP, node REST and MCP, including occupied-port rollback, preservation of the unrelated listener, import without side effects, graceful exported shutdown and restart, and rejection of a legacy writer bypass.
- On Windows, the test helper emits the `SIGTERM` event to exercise the cleanup handler. This is not proof of a real Linux OS signal/systemd shutdown; that requires the later Linux deployment checks.
- MCP task/result/screenshot tools and the optional Events runtime are assembled locally. Enabling Events requires a validated persistent encryption key in private environment configuration and approved workspace-specific callback hosts; missing or invalid settings fail before runtime allocation. Subscriptions and delivery receipts persist encrypted credentials, retain workspace attribution, expire within bounded limits and recheck node/creator authorization before network delivery. Shutdown aborts active delivery and joins the owned pump; restart tests check that a delivered receipt does not trigger a duplicate callback.
- Public pairing uses `POST /v1/workspaces/<workspaceId>/pair` on the agents origin. A valid code alone does not override its stored workspace or the creator's current authority. The SDK needs an explicit workspace binding for this route. Real loopback HTTP tests cover pairing, replay, wrong workspace, revoked creator, exact task claim and result/screenshot receipt; these are not deployed vendor-account acceptance.
- `deploy/public/render-ingress.cjs` renders an exclusive candidate Caddyfile from operator-approved origins and ports using `deploy/public/Caddyfile.template`; it does not activate a service or overwrite an existing file. The template separates the human and agents hosts, limits routes, denies legacy management, rejects ambiguous raw paths and strips caller-supplied identity/proxy headers. Workspace selectors still require authoritative backend checks; they are not an authentication grant.
- Real Caddy tests use loopback high ports, an ephemeral explicitly trusted certificate and synthetic upstreams. They exercise config validation/adaptation, SNI/Host boundaries, raw paths, duplicate authorization headers, trusted proxy headers, verified HTTP/2 and WSS. They do not demonstrate the entire materialized LACK browser behind production TLS, DNS/ACME issuance or real Muse/dots execution. Certificate validation is not disabled.
- Run the full regression with `CADDY_TEST_BIN` pointing at the separately verified Caddy test binary; otherwise its two live integration tests report skips. The verified checkpoint ran all 372 tests with zero failures, cancellations or skips, followed by the real local HTTP/WebSocket smoke with two mock model backends and SQLite restart persistence.
- `scripts/public-preflight.sh` is a read-only preliminary baseline collector with fixture tests, not the complete production coexistence gate or permission to deploy. Production resource-limited units, Linux signal acceptance, full preflight, migration, backup/rollback and real providers/Agents remain pending. No VPS, DNS, credentials or Peer Relay changes were made in this checkpoint.
- Ollama remains supported. Provider/model grants continue to be verified server-side; no real provider credentials or model endpoints were modified by this checkpoint.

## Next delivery gates

1. Finish resource-limited service units, complete read-only coexistence preflight and actual packaged-LACK browser/API acceptance behind HTTPS ingress.
2. Finish reviewed migration, durable task/recovery evidence, consistent backup and rollback tests.
3. Confirm trusted VPS access, DNS/443 ownership and a bounded deployment window before changing the production service.
4. Verify a real model, Muse Laozhen and dots Xuanji with matching task IDs, browser activity, original evidence, screenshots and server receipts. Then run the multi-user/multi-node sustained acceptance and deliver the user guide.
