# Open WebUI foreground node implementation and acceptance

Date: 2026-10-08.

## Delivered

- Local Open WebUI adapter with immutable model/credential configuration, explicit LAN HTTP opt-in, bounded model response, request cancellation and deadline.
- Foreground worker reusing existing gateway SDK and protected node credentials; no background installer.
- Verification and extractive summary output validation; no retrieval, arbitrary host tools or executable task fields.
- Public-source local pilot script and Chinese operating guide.

## Recorded checks

- `node --test tests/*.test.cjs`: 74 passed, 0 failed, 0 skipped, including four new adapter tests.
- Direct local Node HTTPS acquisition of the official public source failed with `ECONNRESET` before a trusted conclusion could be formed. An isolated Python urllib HTTPS acquisition attempt also failed. Certificate validation was not disabled.
- The official source was independently readable through the web tool. A separate assisted-source pilot used its short original endpoint/description excerpt with explicit provenance; this did not simulate a successful local source HTTP fetch.
- Assisted-source gateway -> SDK -> actual Open WebUI verification task failed closed with `invalid_model_json`; gateway reported task failure rather than a supported conclusion.
- A separate bounded diagnostic generation returned HTTP 200, `application/json`, finish reason `tool_calls`, null/non-string message content, and no reasoning text. Tool arguments and response bodies were not printed.

No model-requested tool was executed by the connector. A natural-language instruction not to use tools is insufficient to ensure that the upstream returns a final structured answer. The adapter currently rejects such replies but does not explicitly send `tool_choice: none` or JSON response mode.

## Status

Implementation and mock/HTTP regression checks passed; REAL VERIFICATION ACCEPTANCE FAILED. This is not a live VPS integration or a successful real research conclusion. The earlier plain `OK` generation test does not establish research-format compatibility.

Proposed next step, pending user confirmation: send explicit no-tool selection and supported structured-output settings, preserve strict output/evidence gates, and repeat one bounded public verification task. Do not execute unsolicited tools, enlarge public exposure, raise production concurrency, or manufacture missing source material to pass the test.

The model key stayed in the user-designated private file. Node identity and gateway state in this pilot were temporary and in memory; no permanent node pairing or VPS service change was made. Existing default-disabled gateway and provider/Ollama support remain unchanged. The foreground worker CLI itself has not been validated against a permanent node credential file.
