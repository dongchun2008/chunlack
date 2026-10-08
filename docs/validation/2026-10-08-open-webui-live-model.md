# Existing Open WebUI live model validation

Date: 2026-10-08.

## Confirmed in this run

- Existing LAN Open WebUI at `http://192.168.10.88:3000` accepted the user-provided API credential.
- Authenticated `GET /api/models` returned three model entries.
- Selected the existing `local-active` model alias, not the specialist personnel-query model or Arena model.
- `POST /api/chat/completions` with a non-sensitive connectivity prompt returned HTTP 200, nonempty text, exactly `OK`, and finish reason `stop`.
- Observed request elapsed time: 1067 ms. One request is not a performance or concurrency benchmark.
- Request used `stream: false`, `temperature: 0`, `max_tokens: 128`. No knowledge-base references, files, tools or tool IDs were explicitly attached.

## Security and scope

The API credential was read from the user-designated private file. Neither its value nor that file was copied into the repository. The credential file was not modified. No API key was created or rotated, and no authentication policy was changed.

The existing endpoint is LAN HTTP, not TLS. This validation used the endpoint explicitly supplied by the user from the local machine; do not expose it publicly or reuse this transport across untrusted networks. Gateway-to-connector traffic must retain its own private forwarding/TLS boundary.

The model catalog's `owned_by` label and alias do not establish which actual GPU, backend or upstream provider executed this request. Open WebUI model-level defaults, filters and pipelines were not independently audited.

## Not yet completed

- This proves real Open WebUI authentication and model generation, not an end-to-end external Agent task from the VPS.
- No VPS gateway activation, node pairing, long-running worker or research-role configuration was performed.
- No production service was restarted and no public port was opened.
- No private knowledge retrieval, three-role research exercise, independent source acquisition or multi-node load measurement was performed.
- Existing 70-test and smoke results belong to the preceding UI revision; no additional regression suite was run for this documentation-only change.

## Next integration boundary

Run a foreground connector on a trusted machine that can reach this LAN endpoint. Keep the Open WebUI key on that machine, distinct from the gateway node credential. Pair the connector through the VPS gateway's authorized private channel, then perform one public-material verification task with the existing evidence gate before enabling additional roles.
