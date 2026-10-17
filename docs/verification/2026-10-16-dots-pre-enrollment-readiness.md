# Dots pre-enrollment readiness, 2026-10-16

Status: read-only production inspection and unsaved browser preparation.
Muse (Laozhen) login is unavailable according to the user; defer that vendor
without treating it as a blocker for dots preparation.

## Current observations

- The running public service obtains its data root from its process environment.
  The configuration path is `/var/lib/chunlack-public/config/lack.config.json`.
  The inspected environment file did not contain LACK_DATA_ROOT; no credentials
  or complete environment contents were printed.
- Multi-user mode is enabled. Agent OAuth and public events are disabled.
  No Agent issuer, resource, browser-client binding, or allowed client is
  configured in the inspected Agent OAuth section.
- All four protected services were active/running with NRestarts=0:
  old LACK PID 594652, public LACK PID 646156, HTTPS PID 646181,
  Tailscale PID 859. These match the previous recorded baseline.
- MemAvailable was 998544 kB; total memory was 1651808 kB. Swap total and
  free were both 2097148 kB. This is an instantaneous observation, not a
  sustained-load or five-Agent capacity result.
- Local identity/agent-access.cjs rejects an enabled configuration with an
  empty clientIds array. Therefore merely enabling Agent OAuth with empty
  enrollment settings is not a safe deployment procedure.

## Browser preparation

The authenticated ChatGPT custom MCP form supports a custom OAuth client.
The unsaved form contains the public Agent endpoint, Pocket ID authorization
and token endpoints, issuer, resource, and OIDC discovery URL. After adding
the discovery URL and retrying, the callback field still reports that it
could not load the callback URL.

This does not establish why callback loading fails, nor prove that publishing
resource metadata will fix it. Do not invent a callback URI or reuse the
human-login client. No client secret was entered, no risk acknowledgment was
checked, no connector was created, and no new access was granted.

## Proposed next boundary, not implemented or deployed

Evaluate a discovery-only pre-enrollment state: publish only public OAuth
resource metadata while rejecting all Agent business access until actual
client registration and explicit local grants exist. Preserve the existing
fail-closed verifier rather than inserting a dummy client identifier or
allowing arbitrary clients. Its configuration, protocol behavior, and tests
require a bounded design decision before implementation.

If approved, first implement and test locally and in the previously bounded
isolated environment. A production update remains a separate controlled
release with backup, rollback, and protected-service checks. Client creation,
vendor consent, event delivery, real cloud-computer execution, and result
receipt remain separate acceptance gates.

No VPS files, services, credentials, firewall, or Tailscale settings were
changed in this increment. No new product tests were run. This report does
not claim delivery or GitHub synchronization.
