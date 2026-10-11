# Direct inference route recovered from authorized project history

Date: 2026-10-11. Scope: historical address lookup, exact peer identification,
two read-only HTTP requests and one bounded inference request from the VPS.
No installation, file write, service restart, route/ACL change, port opening,
Tailscale enrollment, Open WebUI credential use or production activation.

## Historical evidence versus current evidence

The related project's `docs/2026-09-25-readonly-baseline.md` recorded the
model backend bound to its own `127.0.0.1:8106`, with a separate existing
OpenAI-compatible model router on port 8080. Its recorded active alias was
`local-active`, targeting `qwen38-27b-nvfp4`. These September runtime/GPU
parameters were not revalidated here and must not be reported as current.

An older model/policy diagnosis identified DNS name
`jarvis-llama.tail19f0ed.ts.net`. Its policy-library 8443 and Open WebUI 3000
routes are not model API endpoints for ChunLACK.

The current VPS `tailscale status --json` result was filtered by that exact
DNS name or `HostName=jarvis-llama`; other peers were not printed or probed.
The match was online, with IPv4 `100.72.70.102`. Enrollment/online alone would
not prove service reachability; the following actual HTTP probes do.

## Current VPS request results

```json
{
  "base_url": "http://100.72.70.102:8080/v1",
  "health_http_status": 200,
  "health_router": "llama-openai-router",
  "health_active_alias": "local-active",
  "health_active_model": "qwen38-27b-nvfp4",
  "health_elapsed_s": 2.449,
  "models_http_status": 200,
  "model_ids": ["local-active", "unlimited-ocr-cpu", "qwen38-27b-nvfp4"],
  "models_elapsed_s": 0.023,
  "generation_http_status": 200,
  "requested_model": "qwen38-27b-nvfp4",
  "returned_model": "qwen38-27b-nvfp4",
  "max_tokens": 8,
  "request_count": 1,
  "output": "OK",
  "finish_reason": "stop",
  "prompt_tokens": 17,
  "completion_tokens": 2,
  "total_tokens": 19,
  "generation_elapsed_s": 0.205
}
```

The generation prompt was only `Reply with exactly OK.`. No account secret
or business data was sent. Requests used the literal identified Tailscale IPv4,
Python HTTPConnection, Connection: close, a 64-KiB response limit, and no
redirect-following or ambient HTTP proxy. The two GETs had six-second socket
timeouts; the single POST had a twenty-second socket timeout. These are socket
timeouts, not a proven monotonic whole-response deadline. All requests finished.

VPS SSH used the previously pinned ED25519 host key and known-hosts file.
The approved login secret was entered only at the masked SSH password prompt;
it is not part of this record or an executed command/file. No model API key or
Authorization header was needed for the three requests on this existing private
route. This is not permission to expose that router without authentication.

## Interpretation and remaining gates

The endpoint is the existing direct inference router, not Open WebUI. Preserve
its current private binding/network path. Select the explicit model ID for the
initial ChunLACK trial; an alias can change independently. The reported response
ID and router health do not independently attest the live 1Cat/vLLM executable,
GPU count, fallback behavior or launch parameters.

This closes the missing VPS-reachable direct API address gate. It does not
prove workspace Provider integration, persistence, restart behavior, sustained
capacity, native Muse/dots task execution, production TLS or delivery readiness.
It was one request, not a concurrency/performance benchmark.

No Relay service or configuration was changed. This narrow probe did not
measure Relay throughput/latency or independently repeat a whole-host service
baseline, so it cannot establish an end-to-end Relay performance guarantee.

Next: use this route in the approved isolated ChunLACK Provider trial, retaining
the existing single-inference admission limit. OAuth written-spec/plan review
and native external-account authorization gates remain separate.
