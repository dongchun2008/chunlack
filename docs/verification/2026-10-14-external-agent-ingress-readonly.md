# External Agent ingress: read-only evidence

Date: 2026-10-14. No service reload, configuration write, credential change or task claim.

## Method and limitations

HTTPS checks ran on the VPS through the existing pinned-host SSH transport. Curl used the public Agent hostname and `--resolve` to reach its existing loopback TLS listener, with normal certificate verification, a 3-second connection timeout and an 8-second request timeout. No node token, login cookie or OAuth credential was sent.

This verifies the local HTTPS ingress for that hostname. It is not proof of connectivity from Muse/dots, public DNS behavior on every client, successful authenticated calls, or an external Agent task.

## Results

| Request | HTTP result | WWW-Authenticate |
| --- | --- | --- |
| GET `/health` | 404 | absent |
| GET `/mcp` | 404 | absent |
| GET `/.well-known/oauth-protected-resource` | 404 | absent |
| GET `/.well-known/oauth-protected-resource/mcp` | 404 | absent |
| GET `/v1/manifest`, no credentials | 401 | absent |
| POST `/mcp`, empty JSON, no credentials | 401 | absent |

All six curl requests exited 0 with successful TLS validation. HTTP 401/404 are the observed application responses, not successful authentication.

## Source mapping

- `integrations/mcp/pilot-server.cjs` accepts only POST `/mcp`, rejects missing Bearer authorization, and requires a trusted loopback upstream Host. It does not currently issue an OAuth resource-metadata challenge.
- `gateway/public-runtime.cjs` wires `resolvePrincipal` to the node store's `authenticate()`, not the Pocket ID OAuth access-token validation path.
- `deploy/public/Caddyfile.template` exposes POST `/mcp` and selected `/v1` routes on the Agent hostname. It does not expose that hostname's `/health` or OAuth discovery paths. The internal node facade's `/health` is not a public Agent endpoint.

## Configuration comparison caveat

The deployed `/etc/chunlack-public/Caddyfile` SHA-256 was:
`bd809ebcec0b336fd78f5f65607718322f15d4f13b28e696c3f4041e3b69ecb4`

It did not byte-match a render of the current repository template with the known origins and three current backend ports. The cause has not been established; it may be a prior generated configuration difference. This comparison does not prove a fault or an unauthorized change. The live file was not overwritten, re-rendered, or reloaded.

An earlier diagnostic intentionally stopped before reading configuration content because it expected JSON while the service uses a Caddyfile. Its failure is not a service failure; no service was changed.

## Remaining acceptance gates

1. Reconcile the deployed ingress configuration with the intended reviewed route policy before any future ingress change; never overwrite an unexplained difference.
2. Implement and verify the approved Agent OAuth resource-server path, discovery and challenges without reusing the human-login client's credentials or granting workspace access from login alone.
3. Confirm each supplier account's supported authentication and MCP/REST protocol, including its client registration requirements.
4. Verify dedicated node/workspace binding, authenticated tool discovery and revocation.
5. Prove native cloud-computer execution, matching task/challenge/screenshot evidence and saved results separately for Muse and dots. Manual and automatic triggering remain separate gates.

Health, unauthorized-request rejection and synthetic tests do not satisfy these remaining gates.
