# Direct model API reachability preflight

This read-only checkpoint advances the real-provider deployment gate. It is not
generation acceptance, identification of the 1Cat engine, or hardware evidence.

## Observations

| Surface / UTC time | Probe | Result |
| --- | --- | --- |
| Local Windows, 2026-10-11 09:37:54 | Known direct LAN API, `GET /v1/models` | curl exit 0, HTTP 200, valid JSON model catalogue |
| VPS, 2026-10-11 09:38:15 | Same URL, `GET /v1/models` | No HTTP response recorded; urllib raised `URLError` |
| VPS, 2026-10-11 09:41:15 | Read-only `ip -j route get` for the model host | Command exit 0; selected device `eth0` |

The catalogue reported `local-active`, `unlimited-ocr-cpu`, and
`qwen38-27b-nvfp4`. A catalogue ID does not prove the engine, active backend,
model weights, GPU architecture, or successful inference.

The exact private URL and raw local/VPS evidence remain in the ignored, owned
release-preparation directory. No credential file or provider key was read.
Neither probe sent an Authorization header. Proxy use was explicitly disabled;
the calls used a short bounded deadline and capped model-list response reads.
The read probes do not authorize unrestricted future use of the endpoint.

The VPS error report did not capture the underlying `URLError.reason`. It must
not be described as a proven timeout, firewall rejection, missing subnet route,
or permanent inability to connect. The route lookup proves only the selected
device at that time, not that every private-network mechanism is unavailable.

## Deployment consequence

- Windows-to-API catalogue reachability is established for this checkpoint.
- VPS-to-API reachability and deployed real generation remain unverified.
- Do not copy a Windows-reachable LAN base URL into the VPS production provider
  configuration and assume it works.
- A verified, authorized private network path or a controlled local-node model
  transport is needed before accepting this route. The exact integration path
  must be checked against the existing provider/node abstractions; this note
  does not claim that a new transport has already been implemented or enrolled.
- Preserve provider-neutral routing and explicit workspace/provider/model grants.
  Do not silently redirect to Ollama, a cloud model, or another catalogue alias.
- Do not repurpose/reconfigure the existing Relay as a subnet router, publish
  model ports, or widen node/network permissions to bypass this failed check.

## Actions explicitly not taken

No model-generation request, model download, paid API call, Open WebUI
configuration/login/key reuse, network/DNS/firewall change, service restart,
production data change, owner-account creation, or public release occurred.
The client checked the previously known direct API rather than the Open WebUI
UI/login endpoint; underlying endpoint software was not identified in this run.

This result neither invalidates nor broadens the completed native 30-minute
authenticated-business trial. Complete five-participant model-task capacity,
applied-limit capture, direct real-provider generation, and native Muse Laozhen /
dots Xuanji task-and-evidence acceptance remain separate required gates.
