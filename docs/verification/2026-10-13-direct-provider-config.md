# Direct provider configuration and remaining Agent creation gate

Date: 2026-10-13. Status: candidate configured; real workspace generation pending.

## Current observations

- The approved Pocket ID scope compatibility fix is deployed. A fresh browser login reached the ChunLACK workspace as chunlack-owner, with the owner role and CONNECTED. The acceptance is recorded in `2026-10-13-approved-candidate-staging.md`.
- Read-only inspection found one migrated Agent, Moderator, still assigned to Ollama's `nomic-embed-text:latest`. Its visible prompt is `Embedding only - not for chat.` (punctuation normalized here). It was not renamed, deleted or converted into a chat Agent.
- From the VPS, the direct private inference endpoint returned HTTP 200 for its model list and included `qwen38-27b-nvfp4`. The observed discovery took 2448 ms. This did not involve Open WebUI or its credentials, and does not independently identify the physical GPU or serving engine.
- Before the configuration change, the VPS had 998 MiB available memory and no used swap. The protected old LACK and tailscaled PIDs remained 594652 and 859; the existing Relay UDP 40000 listeners remained present. This is not a Relay forwarding or sustained-load acceptance result.

## Scoped configuration change

The operator configuration now contains provider `onecat-direct` (display name `1Cat Direct`), using the existing provider-neutral OpenAI-compatible adapter. Only the existing ChunLACK workspace was granted `qwen38-27b-nvfp4`. Its private endpoint stays in private server configuration, not in the browser metadata or this document.

- Default provider/model: `onecat-direct` / `qwen38-27b-nvfp4`.
- Provider request timeout: 30000 ms; maximum generated tokens per response: 512.
- No provider fallback models; no cloud fallback or new API key was configured.
- Musing and Triangulation multi-candidate generation are disabled for this initial low-resource profile. Their implementations and Ollama support remain intact.
- Existing Ollama workspace grants, credentials, code and migrated Agent data were preserved.

The private configuration was backed up before replacement, with an exclusive backup directory and retained original owner/mode. Only the new candidate application and HTTPS services were stopped and started. The wrapper required normal writer-lock removal and used atomic configuration replacement; it did not delete a runtime lock. It retained a failure rollback path.

Configuration SHA-256 before: `a983857935d8b4838073bf30b8461cfebe8253424bfa653c79d36186a587a9df`.

Configuration SHA-256 after: `9e171ad148f0b659c5985a0b9583f0301aac0e912e6421b47299457647a572f7`.

Private backup and stage report remain under `/opt/chunlack-public/preparation/direct-model-b62fcd2ec3/`. They are not committed. Restore requires a controlled stop of only the candidate, confirmation of normal lock release, restoration of the private backup's owner/mode, restart, certificate-verified HTTPS and protected-service checks. Do not overwrite a running service's configuration or forcibly remove its lock.

## Post-change evidence

- Application health became HTTP 200 after 2360 ms; certificate-verified HTTPS became HTTP 200 after 1086 ms.
- Anonymous `/auth/me` remained HTTP 401; old LACK health remained HTTP 200; the protected service baseline was identical.
- New application PID 636769 and HTTPS PID 636792 were active, each with NRestarts=0. Their sampled MemoryCurrent values were 54677504 and 12664832 bytes, respectively; these are point observations, not load maxima.
- Reloading the real public browser preserved the authenticated owner/workspace session.
- Sending `/list onecat-direct` through the authenticated webpage and real WebSocket produced `Available ONECAT-DIRECT models: qwen38-27b-nvfp4` in that workspace. The browser screenshot is kept in ignored evidence storage.

## Newly observed blocker

Clicking Add Agent showed `无法添加 Agent，请检查模型服务配置。` instead of completing creation. Source inspection found that `handleSpawn()` still uses a sequence of native `prompt()` dialogs, picks the first configured provider rather than the server-declared default, and the button's catch handler collapses any exception to the generic model-configuration message. The exact thrown browser exception was not captured; therefore a native-dialog problem remains a supported hypothesis, not a proven exclusive root cause. The successful workspace model-list query distinguishes this failure from a blanket absence of model access.

No chat Agent was created through a database bypass. Product code was not changed in this increment. Permission was requested for an in-page creation form with explicit provider/model selection, cancellation, bounded loading, duplicate-submit protection, and workspace-switch invalidation, preserving backend authorization. The repair still needs a failed-first regression, passing related/full tests, isolated verification, and controlled candidate deployment.

The System model-list message also displayed `Invalid Date` in the live broadcast. This is a separate presentation defect to reproduce; it is not evidence that the model-list request failed and was not silently fixed here.

## Remaining acceptance

Real chat generation through the delivered webpage, multi-Agent complete rounds, sustained multi-user coexistence, reboot/recovery behavior, Relay forwarding comparison and Muse/dots native-computer task evidence remain separate gates. Configured routing, a model list, one successful login and earlier isolated model tests do not prove those gates or full delivery.
