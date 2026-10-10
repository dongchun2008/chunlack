# Shared workspace execution capacity

## Current implementation

The multi-user runtime creates one coordinator and passes that same instance to
the model transport and the gateway store. A database-backed node lease and an
actual provider HTTP request compete for the same execution capacity. An
orchestrator waiting for a remote result does not occupy another slot.

Default bounds are deliberately conservative:

| Boundary | Limit |
| --- | --- |
| Concurrent execution slots, across all workspaces | 1 |
| Waiting model operations plus queued node tasks | 100 total, 20 per workspace |
| Root task lifetime | At most 5 minutes |
| Root model/remote enqueue steps | 50 by default; a configured smaller bound is inherited |
| Nested delegation depth | 3 by default |
| Delegations without model calls | Also bounded by the root step setting |
| Gateway retry attempts | Existing maximum of 3; no automatic remote retry |
| Research result waiters | 32 |
| Server-owned root metadata | 100 records; no prompts, credentials or results |

Round-robin selection is per workspace. Authenticated node polling makes a
remote waiter eligible; an offline queued node cannot indefinitely block model
traffic. Temporary handoff reservations expire. Provider grants and human
membership are rechecked before queueing, before HTTP execution and before
returning output. Model discovery remains readable to an authorized viewer;
generation and embeddings do not acquire that viewer's execution authority.

Ollama and provider-neutral OpenAI-compatible routes are retained. Public mode
does not use the old unbounded per-agent promise chain or global Ollama recovery
timer. Private legacy mode keeps its existing behavior.

## Cancellation and delegation

Root identity is taken from the verified workspace context. An owner can cancel
a task in that workspace; a member can cancel only a task they created. Caller
claims cannot replace root ownership. Depth, step and optional estimated-cost
reservations are inherited rather than reset in child tasks.

Queued local operations are removed on cancellation. Running local operations
are signalled, but retain their slot until the transport actually settles. A
remote cancellation first becomes `cancel_requested`; its database lease keeps
the slot until an authenticated, matching terminal acknowledgement or expiry.
Late responses and mismatched lease attempts cannot release or complete a task.

External research enqueue spends a root step but releases the enqueue operation's
temporary slot before waiting for the persisted task. Root cancellation reaches
that task. Closing the bridge cancels waiting enqueue operations and requests
cancellation of pending tasks, without creating later orphan tasks.

Budget exhaustion, cancellation and authorization revocation propagate through
Ollama/cloud retry and fallback as task failures, not as successful error-string
agent replies. Public background generation/embedding without an existing task
receives its own bounded, server-owned root.

## Evidence and delivery boundary

Local automated verification on 2026-10-10: 290 tests passed, zero failures,
skips or cancellations, followed by the HTTP/WebSocket mock-model smoke test.
This includes a real child process proving that an active external lease and an
unconfirmed remote cancellation both block embedded provider HTTP traffic.

The local stress fixture uses real loopback HTTP and synthetic model responses:
two workspaces each completed 12 rounds, with all 5 distinct agents completing
each round. Total: 24 complete rounds, 120 model requests, zero failed rounds,
maximum observed simultaneous model HTTP requests: 1. These are not human
connection counts, a VPS soak test, a real-model throughput result or a measured
safe VPS upper limit.

Root metadata is currently bounded in memory. `completed` means its active
callbacks settled, not that human acceptance, evidence verification or a real
external-agent receipt passed. Durable root recovery/audit belongs to the
remaining migration/recovery stage. Persisted external leases already recover
before new model dispatch. Estimated-cost accounting is not verified billing;
without trustworthy price/usage input it cannot promise a money ceiling.

The multi-user UI, unified lifecycle/materialization, migration/recovery,
production deployment and real model/Muse/dots acceptance remain delivery gates.
This capacity increment alone is not permission to switch the VPS to public mode.
