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
- TLS, Caddy ingress, DNS, production resource caps, production migration, VPS coexistence and real providers/Agents are not accepted by these lifecycle tests.
- MCP task/result/screenshot tools are assembled locally. Events delivery is intentionally fail-closed: `publicRuntime.events.enabled: true` currently rejects startup rather than advertising an unwired subscription runtime. Approved callback grants, encrypted persistent event state, delivery cancellation and vendor account permissions still need to be completed and tested.
- Public pairing and the public route/header allowlist still require real ingress acceptance. A successful node-registration UI or an internal store pairing test is not proof that an external Agent can complete pairing through the deployed public gateway.
- Ollama remains supported. Provider/model grants continue to be verified server-side; no real provider credentials or model endpoints were modified by this checkpoint.

## Next delivery gates

1. Finish public HTTPS ingress, protocol/pairing/event assembly and read-only coexistence preflight.
2. Finish reviewed migration, durable task/recovery evidence, consistent backup and rollback tests.
3. Confirm trusted VPS access, DNS/443 ownership and a bounded deployment window before changing the production service.
4. Verify a real model, Muse Laozhen and dots Xuanji with matching task IDs, browser activity, original evidence, screenshots and server receipts. Then run the multi-user/multi-node sustained acceptance and deliver the user guide.
