# Deployment preparation verification (2026-09-08)

Environment: Windows, Node v24.19.0, Python 3.13. Docker is not installed on this
workstation. No VPS access or actual model credentials were used.

## Passed

- `node --test tests/providers.test.cjs`: 15/15 passed.
- Generated JavaScript server, launcher, inline frontend scripts and JSON parse.
- Ollama and compatible model routing, provider-specific fallback, explicit cloud
  fallback permission, local-only generation policy and unknown-provider errors.
- Missing credentials, static model discovery fallback, queue recovery, secret-free
  routing log fields and actual HTTP timeout against a deliberately slow mock server.
- Legacy SQLite provider migration retains Ollama rather than adopting a cloud default.
- Embedding selection stays independent of chat; cache keys use namespace/full text;
  persisted incompatible vectors are invalidated while source memory text is retained.
- Workspace file path traversal and symlink rejection; direct shell disabled by default.
- `node tests/smoke.cjs`: real generated server starts, exposes HTTP health and
  provider APIs, sends complete Agent provider fields over WebSocket, routes messages
  to two local synthetic backends in one channel and restores Agent edits after restart.
- Runtime generator preserves existing operator configuration on repeated execution.
- Compose YAML/example JSON parse; host publication is loopback-only and root is read-only.
- `npm audit --omit=dev --audit-level=moderate`: found 0 vulnerabilities after updating
  uuid and overriding qs to the patched compatible series. This is the registry's
  point-in-time advisory report, not a guarantee about all upstream code.
- `git diff --check`: passed for tracked source changes.

## Target VPS checks still required

- SSH identity/access, OS and architecture, existing services, resource headroom and ports.
- Docker/Compose version and image build, native SQLite binary, non-root data permissions.
- Container health and restart, private tunnel or authenticated reverse proxy.
- First configuration and key provisioning, real provider connectivity and quota.
- Two actual model backends collaborating, including a private local server when available.
- Consistent backup and recovery into a disposable new volume, retaining the original.

## Remaining product scope

The router is centralized but still embedded in lack.py. Native Anthropic/Gemini,
streaming, cost budgets, complete provider health tracking, a separate Tool Gateway
and public multi-user authentication remain future work. Local-only generation
checks do not enforce privacy across shared channels or externally configured memory
providers. This deployment is for a trusted owner over a private access path.
