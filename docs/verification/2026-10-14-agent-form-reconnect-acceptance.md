# Agent form reconnect repair and isolated verification - 2026-10-14

Status: the authorized reconnect and isolation-runner repairs passed the
verification below. No production deployment was performed. Overall delivery
and native external-Agent acceptance remain incomplete.

This supersedes the unresolved reconnect and namespace/dependency test gates
in `2026-10-13-agent-form-checkpoint.md`, without rewriting its historical
failure evidence.

## Repairs

- Split workspace/identity-generation matching from socket matching in the
  embedded create-Agent controller. Reopening an unacknowledged submission
  after a same-workspace reconnect preserves the pending state and focuses
  Cancel instead of enabling another submission.
- Retain existing workspace/identity reset and model authorization behavior.
  A reconnect without a pending request can load a new form. A matching-looking
  frame arriving on a replacement connection does not clear the old lock.
- Add regressions for cancel/retry after reconnect, an unsent reconnect, and
  clearing private drafts/locks after identity or workspace changes. The
  previously failing reconnect regression is retained and now passes.
- Explicitly bind only the owned Linux results directory through PrivateTmp,
  preserve startup/cleanup diagnostics, and require an exact TAP count plus
  successful exit and unchanged protected services before reporting success.
- The first rerun exposed unreadable production parser dependencies for
  `nobody`. After separate user approval, package private test copies of
  espree 9.6.1, acorn 8.18.0, acorn-jsx 5.3.2 and eslint-visitor-keys 3.4.3 from
  the tested local installation. Verify every uploaded source/dependency file
  by SHA-256. Mount the test source and dependencies read-only; do not modify
  production dependencies, file permissions or the test identity.

The operational runner remains in the ignored local preparation directory;
it is not part of the application or an unattended deployment entry point.

## Results

| Verification | Result | Scope |
| --- | --- | --- |
| Local focused UI regressions | 18/18, exit 0 | Real embedded functions with synthetic DOM/transport |
| Local full suite | 569/569, exit 0; 0 skipped/cancelled/todo | All `tests/*.test.cjs`, serial execution, real portable Caddy enabled |
| Linux isolated UI regressions | 18/18, exit 0; 0 skipped/cancelled/todo | Selected UI tests only, not the full native suite |
| Independent read-only review | No new reproducible finding | Reconnect patch and identity/workspace boundaries |
| Local actual-browser check | Passed the interactions below | Disposable identities, loopback fixture and mock model only |

The full suite took 590.789 seconds. Linux TAP duration was 5.403 seconds;
reported peak memory was 43,012,096 bytes (about 41.0 MiB).

Linux limits remained: MemoryMax 192 MiB, MemoryHigh 160 MiB, zero swap,
CPUQuota 10%, TasksMax 32, RuntimeMaxSec 90, stop timeout 5 seconds,
PrivateTmp, PrivateNetwork, ProtectSystem=strict, ProtectHome and
NoNewPrivileges. Tests ran as `nobody:nogroup`.

Before/after checks found unchanged PID, restart count and active state for
old LACK, candidate LACK, candidate HTTPS and Tailscale Relay. The old health
endpoint remained available and Relay UDP listeners remained present.
This does not establish sustained Relay forwarding quality or load capacity.

## Actual-browser evidence

The existing fixture reached readiness without another timeout adjustment.
Using its disposable owner account in a real browser:

1. Opened the in-page Add Agent form, without native prompt dialogs.
2. Observed the authorized `local-test` provider and `fixture-model` selection.
3. Entered a draft, cancelled, reopened, and observed an empty name field.
4. Created `Browser Acceptance Agent` in `general`.
5. Observed server confirmation and `Agents: 1` in the interface.
6. Reloaded and observed the persisted Agent and connected workspace.

The temporary tab was closed. Subsequent process checks found neither its
fixture parent nor Node children using its unique temporary directory running.

The screenshot and runtime explicitly identify this as a local fixture with
mocked model and transport adjustments. It is not production HTTPS, Pocket ID
login, or real-provider acceptance. Real-browser fault injection at the exact
creation/acknowledgement disconnect boundary remains unperformed; that race
was exercised by the controller regressions, not by this browser check.

## Evidence retained locally

Under `.superpowers/sdd/2026-10-13-release-preparation/`:

- `agent-form-reconnect-full-suite-20261014.tap`
- `agent-form-linux-1791930613593297400.json` (dependency-permission failure)
- `agent-form-linux-1791931269641103400.json` (passing isolated rerun)
- `agent-form-browser-20261014.png`
- `agent-created-browser-20261014.png`
- `agent-form-isolation.py` (approved operational runner)

Working-tree/artifact SHA-256 values recorded after verification:

| File | SHA-256 |
| --- | --- |
| lack.py | F541E0792D8E42D6424AE21C14ADDC969788740042B04440D096BE241389A726 |
| tests/agent-create-ui.test.cjs | C16D710A112AB390F84AEAB6C855093E1F174D8B87B5E93C53F4A0E774F296E7 |
| agent-form-isolation.py | 1A13124FD18A1E599CF2B7CD49190A1DFDA20F84DF042DA49DEC1913EBF95FE5 |
| agent-form-reconnect-full-suite-20261014.tap | 0F85AA681C5B8195E71D6EE9B4B83B19AC806343F03E6F20B27E31753D507681 |

## Remaining release boundary

No application, credentials, DNS, production permissions or Relay configuration
were changed on the VPS. The new form has not yet been deployed there. A
controlled candidate update and real direct-provider UI exercise remain next
steps. Muse/dots native execution, external OAuth and broader multi-Agent
delivery gates remain separate. Do not describe this report as full product
delivery or infer server-side, cross-refresh idempotency from the browser lock.
