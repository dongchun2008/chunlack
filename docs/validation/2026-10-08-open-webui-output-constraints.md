# Open WebUI output constraints follow-up

Date: 2026-10-08.

## Changes and checks

- Added explicit `tool_choice: none`, an empty tool declaration, and JSON-object response format.
- Adapter rejects tool-call/function-call replies even if they also contain valid verification JSON. No tool execution path was introduced.
- Updated request-shape assertions and added unsolicited-tool-call refusal coverage.
- Initial parallel suite: 74 passed, 1 failed. Existing `HTTP isolates admin permissions, wakes polls and removes disconnected waiters` observed zero waiting polls where one was expected after a fixed 20 ms wait; subsequent asynchronous fetch failure was also reported.
- Serial recheck, `node --test --test-concurrency=1 tests/*.test.cjs`: 75 passed, 0 failed, 0 skipped.
- `node tests/smoke.cjs`: PASS for HTTP, WebSocket, mock model coexistence, SQLite restart persistence, private bind and configuration preservation.

The serial pass does not resolve or conceal the original test's timing fragility. Its fixed-delay synchronization should be addressed separately; production timeout/concurrency limits were not increased.

## Real validation: failed

An assisted-source local gateway task, with the independently acquired official public excerpt described in the preceding record, failed closed with `model_http_400`.

A bounded diagnostic confirmed that the upstream validation rejects an empty `tools` array and requires omitting that field or providing an actual tool. Providing actual tools is outside this connector's scope. Thus the empty array added in this follow-up is a compatibility defect; no trusted research conclusion or real-node acceptance is claimed.

Proposed correction pending user confirmation: omit `tools: []` while retaining explicit no-tool selection, JSON response mode and reply-side refusal. Repeat the bounded public verification task. The current revision must not be treated as ready for production research.

No VPS configuration, production credentials, model configuration, public listener or persistent worker was changed. No certificate checks were disabled. The direct local public-source acquisition limitation remains unresolved.
