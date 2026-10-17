# Agent OAuth discovery-only enrollment

This opt-in mode prepares the public MCP OAuth discovery path before an
external Agent client has been enrolled. It is not a usable Agent connection
and does not resolve a vendor-side callback failure by itself.

Set `publicRuntime.agentOAuth.enabled` and `discoveryOnly` to `true`, keep
`clientIds` empty, and set `publicRuntime.events.enabled` to `false`.
The canonical HTTPS issuer, resource, same-origin JWKS URI, and existing
human-login `browserClientId` are still required. Do not reuse that human
client as an Agent client. No new secret is needed for discovery.

## Boundaries

- Only the existing two exact public resource-metadata GET/HEAD paths work.
- The MCP endpoint rejects all business/protocol calls, including valid
  signed Agent tokens and existing opaque paired-node tokens. No task,
  artifact, event subscription, or connection list can be obtained there.
- The runtime does not create its Agent authority manager or start event
  delivery. Enabling events alongside discovery-only is a startup error.
- Readiness, loopback binding, origin checks, and human authentication stay
  in force. This is not a global shutdown of existing human workflows,
  internal gateway services, or other LACK instances.
- Empty clients remain invalid in normal access mode. Malformed flags,
  discovery-only with OAuth disabled, and nonempty enrollment lists fail
  closed. Mutating the input configuration cannot activate a live verifier.

## Later activation

First obtain the vendor's actual callback and register a dedicated client.
After explicit approval, add only that client's identifier, disable
discovery-only, and restart through the controlled release procedure.
Access still requires the verified user binding and an explicit local
workspace/node grant; enrollment is not authorization. Configure and approve
event delivery separately. Never substitute a dummy client, wildcard
callback, unrestricted metadata-client access, or the human-login client.

Production activation requires its own backup, rollback, ingress checks,
and protected-service baseline. Local or isolated tests are not evidence
that dots or Muse has executed a real cloud-computer task.
