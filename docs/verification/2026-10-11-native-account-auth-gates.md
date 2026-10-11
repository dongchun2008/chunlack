# Native account access and MCP authentication gates

## Scope and checkpoint

- Observed on 2026-10-11; checkpoint recorded at 12:29:34 UTC.
- Reviewed source revision: a9ce03e0415a7a78b845adb2104d3aaff22eb9f0.
- This was a read-only UI/source review, not a native Agent acceptance test.
- No connection, plugin, tunnel, subscription or credential was created.
- No form was submitted, no model was called, and no VPS operation occurred.
- Unrelated conversation contents and account identifiers are not reproduced.

## Fresh visible account evidence

| Surface | Observation | What it does not prove |
| --- | --- | --- |
| Muse | Existing signed-in page displayed the Agent name Lao Zhen. Settings exposed Connectors and Permissions. | A ChunLACK connection or successful task execution. |
| Muse Connected list | The displayed list contained Browser; no ChunLACK connector was visible. | Absence of every possible connector outside this list or inability to create a supported connector. |
| ChatGPT Plugins | The page loaded as signed in and exposed Add custom MCP server. | Installation success, usable tools in Xuan Ji's conversation, or computer-task acceptance. |
| Custom MCP form | Connection choices included Server URL and Tunnel. Authentication choices were OAuth, No authentication, and OAuth or no authentication. No direct static Bearer field was visible. | That any configured server would be reachable, authorized or compatible. |
| Platform Tunnels | The selected organization's page displayed No tunnels yet and a Create tunnel button. | Effective Read + Manage + Use permissions, a linked ChatGPT workspace, or any working tunnel. |

The custom MCP form was cancelled without entering a server address or
credential. Muse settings remained a view-only panel; no setting was saved.
No message was sent to either Agent and no native dot conversation was opened.

## Source boundary and compatibility inference

The targeted authentication inspection of
`integrations/mcp/pilot-server.cjs`, lines 49-58, showed:

- The HTTP handler rejects methods/paths other than `POST /mcp`.
- Host must match loopback and exactly one Authorization header is required.
- The header must begin with `Bearer `; the credential is passed to RPC handling.
- There is no OAuth discovery or authorization route in this inspected handler.

`integrations/mcp/runtime.cjs` and the local pilot plan were also searched for
authentication/discovery declarations in this pass. This was a targeted review,
not a complete audit of every identity service, proxy or deployment route.
It therefore does not prove that the whole repository lacks OAuth support.

Inference: a static node Bearer contract alone does not establish compatibility
with the observed OAuth-oriented custom MCP form. The end-to-end authentication
route must be reviewed and, if absent, implemented and verified before direct
public native dots acceptance. Do not select No authentication as a workaround,
embed credentials in a URL, or inject a shared token for unauthenticated callers.
OAuth client credentials are not interchangeable with the node Bearer token.

## Official documentation checked

The official [custom MCP server guide](https://developers.openai.com/api/docs/guides/custom-mcp-server)
lists server URL/tunnel connection choices and OAuth, no-authentication and
mixed authentication. It describes static OAuth client configuration,
CIMD and DCR. Workspace security restrictions still apply.

The official [Secure MCP Tunnel guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
distinguishes Platform tunnel permissions from ChatGPT custom MCP access.
It describes a client inside the private network forwarding MCP requests over
an outbound HTTPS path. A tunnel is transport, not authorization to run a task.

The approved public HTTPS direction is unchanged. An empty tunnel list is not
a blocker for that direction and is not a reason to install tunnel-client or
alter the existing Tailscale Relay.

## Next delivery actions and retained gates

1. Review the complete public MCP authentication route against the observed
   client contract; establish whether a suitable OAuth boundary already exists.
2. If an adapter is needed, design and test it without disabling node/workspace
   authorization. Keep authenticated identity, membership and revocation checks.
3. Complete the separately gated public HTTPS and formal identity publication
   steps before requesting a real external connection. Fixture TLS is not
   production HTTPS acceptance.
4. Validate Muse and dots separately with an approved unique browser task,
   lease/attempt/challenge, native activity evidence, screenshot upload and
   persisted ChunLACK receipt. A worker, model response or HTTP 2xx is insufficient.
5. Obtain a VPS-reachable direct model private API address, or separate approval
   for the bounded loopback forwarding trial. Do not reuse Open WebUI credentials
   or infer model reachability from account UI.

No production resource budget was accepted in this pass. No release window was
consumed. Existing test results were not rerun or upgraded into broader claims.
Overall delivery remains incomplete.
