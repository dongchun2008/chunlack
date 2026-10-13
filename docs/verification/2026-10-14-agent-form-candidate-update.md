# Candidate Agent form update and real-model acceptance

Date: 2026-10-14 (Asia/Shanghai)

Status: static candidate update completed; direct inference passed; browser
connectivity passed, but strict single-response acceptance did not pass.
This is not full system or native Muse/dots delivery acceptance.

## Scope and preceding evidence

The deployed form comes from commit `b2823fd` on
`cloud-agent-pilot-foundation`. The preceding record is
[Agent form reconnect acceptance](2026-10-14-agent-form-reconnect-acceptance.md).
That record describes the state before this candidate update.

Recorded tests before deployment:

- Local focused tests: 18/18 passed.
- Local full suite: 569/569 passed, with no failures, skips, cancellations or todos.
- Linux isolated focused tests: 18/18 passed, exit 0, systemd result success.
- Linux isolation retained nobody:nogroup, readonly source/dependency copies,
  private networking, PrivateTmp, 192 MiB memory, 10% CPU and a 90-second limit.
- Isolated parser dependency copies were hash-verified. Production dependency
  permissions were not changed. Recorded memory peak was 43,012,096 bytes.
- Local browser fixture covered opening, cancelling, creating and reloading an
  Agent. That fixture was not a real-provider test.

These results apply to their recorded revisions and scopes, not to every
production workflow or external Agent integration.

## Static-only candidate update

Only `/opt/chunlack-public/current/public/index.html` was replaced atomically.
Its ownership and mode were preserved, and the previous file was backed up to
`/opt/chunlack-public/preparation/agent-form-a7bc83a021/before-index.html`.

SHA-256 values:

| Artifact | SHA-256 |
| --- | --- |
| Previous HTML | `91e2244a3ee50a36adc276db97a0d81d7f4bf824fc94b3e2ac5784e8659b95fe` |
| Updated HTML, also verified through HTTPS | `ddff0157c8b4244937b241c66eecb24b88fa2c8403e0a4b432ce07e4effce806` |
| Existing backend, matched against the tested materialized package | `61941931e83f4835708cf5224746bbd235c5b7c14ba178b86c7c96293c85d7a7` |

The deployment report recorded `updated: true`, `rolledBack: false`, no errors
and unchanged protected-service observations. Before/after service PIDs:

| Service | PID | Restart count |
| --- | --- | --- |
| Old LACK | 594652 | 0 |
| Tailscale Relay daemon | 859 | 0 |
| Candidate LACK | 636769 | 0 |
| Candidate HTTPS | 636792 | 0 |

Old and candidate health endpoints returned HTTP 200. Relay UDP listener
observations were unchanged. No service was restarted; no credentials, DNS,
firewall, Relay configuration or production timeout was changed.
These bounded checks do not establish sustained Relay forwarding quality.

An already-open browser initially retained the old page. Reloading obtained the
new form; this did not require another deployment or a backend patch.

## Real-provider and browser results

The configured direct `onecat-direct` provider was tested without Open WebUI.
The private endpoint and any credentials are intentionally omitted here.

- Model: `qwen38-27b-nvfp4`.
- Direct request returned HTTP 200 in 2.363 seconds with finish reason `stop`.
- Content exactly matched `CHUNLACK_DIRECT_OK_20261014`.
- Reported usage: 41 prompt tokens, 16 completion tokens, 57 total.
- Pocket ID login completed through the user's own passkey interaction.
- Browser displayed owner `chunlack-owner` in workspace `ChunLACK`, connected.
- The deployed form created one acceptance Agent using `onecat-direct` and the
  model above, restricted to `general`; the existing Moderator was preserved.
- Browser displayed two Agents and creation confirmation. No create request was
  resent after a locator timeout.

One browser message requested exactly `CHUNLACK_UI_OK_20261014`, with no tools,
delegation or commands. The Agent returned that marker, but also appended
unrequested reflection content and produced a second message.

Therefore:

- Browser-to-real-provider reply connectivity: demonstrated.
- Exact output / one visible reply: failed.
- Absence of tool, command or delegation side effects: not independently proven
  by the visible reply and must not be inferred from model-generated claims.
- No repeated model request or second Agent creation was used to hide this gap.

The inspected `agentRespondBody` calls `generateReflection` and appends its
output even when musing and triangulation are disabled. This accounts for an
unconditional extra-generation path; the second visible message's trigger is
not yet established. No backend change was made for this newly observed issue.
Model-generated follow-up suggestions were not treated as user instructions.

## Local evidence

Evidence remains in the ignored `.superpowers/sdd/2026-10-13-release-preparation/`
directory, not in Git:

- `agent-form-reconnect-full-suite-20261014.tap`
- `agent-form-linux-1791931269641103400.json`
- `agent-form-a7bc83a021/report.json`
- `direct-onecat-20261014-1791932705061689100.json`
- `live-agent-created-20261014.png`
- `live-onecat-ui-reflection-20261014.png`

## Next gate

Agree on bounded normal-chat semantics before changing response behavior:
one reply by default, with reflection and follow-up work explicitly selected
rather than unconditionally invoked. Diagnose the second-message trigger and
add targeted regression coverage without weakening workspace permissions or
removing Ollama/provider-neutral routing. Any candidate backend update requires
the applicable approved tests and rollback guardrails.

Native Muse/dots execution and evidence return, external Agent authorization,
multi-user/workspace and sustained collaboration acceptance, source-preserving
research, and recovery gates remain separate unfinished delivery work.
