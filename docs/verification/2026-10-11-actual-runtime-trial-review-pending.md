# Actual-backup authenticated runtime trial: review pending

Date: 2026-10-11. The completed native conversion and recovery evidence is
`2026-10-11-actual-backup-workspace-conversion.md`; its result is unaffected.

A separate authenticated runtime test was prepared under the privately owned
`/var/tmp/chunlack-actual-migration-20261011-7fd316ba/runtime-business-821f946c`.
Only its owner marker and two test programs were created/uploaded. No runtime
unit, operational data copy, packaged runtime or login session was started.
No production service, owner account, credential or public listener was changed.

Independent static review identified three defects in these new disposable
test programs, not in product code:

1. The message schema uses `store_id`, not the assumed `channel_id`; the test
   would fail before runtime startup. Queries and history grouping need the
   actual schema field.
2. Controller exceptions during polling/assertion/report creation can bypass
   terminal owned-unit cleanup. The existing timeout is not equivalent to an
   observed stopped unit; exception-safe evidence and ownership-checked cleanup
   are required.
3. Child process `exit` does not establish stdout/stderr drain or log-stream
   completion. Shutdown and no-secret checks require `close` plus stream finish.

No authenticated actual-backup runtime acceptance is claimed. These defects
were disclosed before execution. Product behavior and production configuration
have not been altered to accommodate the test.

Proposed next correction scope is only the two private test programs. Preserve
the originals, use distinct correction evidence, validate the stated schema and
lifecycle boundaries, then execute the bounded private-network trial. Keep CPU
10%, memory high/max 160/192 MiB, tasks 32, runtime 180 seconds, protected frozen
candidate/snapshot/recovery and original-service before/after checks. Do not
expand limits or switch production if the test fails.

## Subsequent read-only native check

A pinned-host-key SSH check of the frozen candidate's SQLite schema used
`mode=ro&immutable=1`, without creating a connection writer or sidecar. It
confirmed `messages.store_id` exists and `messages.channel_id` does not.
The Agent table has the expected `workspace_id`, `provider` and `model` columns.
This corroborates the first review finding against actual converted data;
it is not an authenticated business-test result.

The new runtime trial unit was `not-found`/inactive with PID 0. Its operational
copy, package, native report and host result did not exist, confirming the trial
had not started. Original LACK PID 594652 and Tailscale PID 859 were still
active/running, restart count 0, and original LACK health returned 200. No
mutation, production switch or live account creation was performed.
