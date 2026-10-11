# Direct model versus Agent-node route gates, 2026-10-11

## Newly inspected implementation evidence

The current source at the verified `6d9bc9b` branch checkpoint separates these
interfaces:

- `collaboration/model-transport.cjs`: workspace-scoped direct HTTP GET/POST
  inference transport, capacity budgeting, deadline bounds, cancellation and
  authorization before enqueue/execution and after response.
- `sdk/agent-client.cjs`: outbound Agent task claim, lease heartbeat, event and
  result acknowledgment; workspace/node binding; bounded result retry.
- `gateway/protocol.cjs`: the external task allowlist is
  `research.retrieve`, `research.verify`, `research.summarize` and
  `browser.public_read`. It does not include a general inference task.
- `gateway/research-bridge.cjs`: external research dispatch explicitly requires
  public material. Its small enqueue operation releases the capacity slot
  before waiting for the remote lease; remote inference integration must not
  accidentally hold a local slot while waiting for the same global slot.
- `gateway/node-facade.cjs`: the pilot facade specifically restricts nodes to
  `browser.public_read` and the public scope. This is not a generic model facade.
- `gateway/server.cjs` and `gateway/workspace-access.cjs`: the normal gateway
  revalidates node/workspace credentials and creator authorization around
  operations. The pilot facade is a separate restricted surface.
- `sdk/cli.cjs`: its built-in run command is a fixture. Trusted handlers can
  use AgentClient, but that alone does not supply a generic model bridge.
- The existing Open WebUI worker is a research-specific historical adapter,
  calling that product's endpoint with its own key-file requirement. It is not
  the requested direct 1Cat connector and must not be reused as a shortcut.

The general inference task types in the workspace transport and the external
node protocol are different namespaces. Their names must not be conflated.
A successful research worker is not proof of a generic model-service node;
a generic worker is not proof of Muse/dots native Agent computer execution.

## Network evidence boundary

The earlier bounded probes showed a model catalog accessible from Windows
but no HTTP response from the VPS to the same LAN API. The VPS route query
selected eth0; that alone does not prove a firewall or routing root cause.

This turn read the existing VPS Tailscale status without changing networking.
It reported seven peers. None advertised an endpoint that exactly matched the
known model LAN host. This is an identification failure, not proof that the
model host is absent, offline or unreachable over all private paths. No peer
address scan, model generation request, credential read or tailnet enrollment
was performed.

A private direct-model address has therefore been requested. A limited
loopback SSH reverse-forward test is an alternative only after explicit
approval. It is not being silently established or proposed as an already
accepted permanent service. No Relay setting, subnet route, public model
listener or firewall rule is to be changed to bypass this gate.

## Minimum next verification

1. Identify the direct model host and an approved VPS-reachable private API
   address; retain the source of that identification.
2. Perform a bounded catalog request without Open WebUI credentials. Catalog
   model labels alone do not establish 1Cat engine or GPU topology.
3. Run a single small public-data generation request with explicit timeout
   and token limit; record response validity, elapsed time and backend identity.
4. Verify the same direct Provider route in an isolated workspace runtime,
   including authorization, cancellation, persistence and co-host continuity.
5. If no direct private route is usable, separately design the general outbound
   model-node bridge with typed bounded inference payloads, static local model
   bindings, explicit prompt-data grants and fail-closed authorization. Do not
   broaden the browser pilot facade or introduce arbitrary shell/URL execution.
   Such a bridge needs both core routing integration and tests; an unconnected
   adapter module would not satisfy this delivery gate.

These are pending steps, not claims of implementation or acceptance. Ollama
and direct cloud/local Provider routes must remain supported and neutral.
Muse/dots must still pass their own native task/nonce/computer/screenshot/result
acceptance and must not be replaced by this model transport.

## Delivery status

The accepted bounded component retest and the earlier sustained mock business
trial remain valid within their documented scopes. This inspection introduces
no product change, account enrollment, production switch or new listener.
Real VPS model use, genuine external Agent execution, formal public login/TLS
and combined sustained real-workload acceptance remain open.
