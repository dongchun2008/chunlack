# Publication readiness after native business acceptance

Date: 2026-10-11. This is an evidence and gate record, not a deployment command,
production acceptance certificate, or permission to widen the approved scope.

## Revision and scope

- Source revision checked locally: `aa3db26c0918a0d02dda7b367de409069debfce6`.
- Branch: `cloud-agent-pilot-foundation`; remote: `dongchun2008/chunlack`.
- Last product-source revision: `95c70de51de569cd04f3c1bf60d6b2b944eac530`.
- Later commits contain verification documentation and test fixtures. Previously
  passing suites are historical results, not new runs at this document's revision.
- No production cutover, real owner-account creation, certificate issuance,
  credential change, DNS change, or firewall change was performed in this step.

## Evidence already obtained

| Requirement | Evidence | Limit of that evidence |
| --- | --- | --- |
| Product regression | Earlier focused 38/38 and full Caddy-enabled 497/497; smoke exit 0 | Not a current production or real-provider acceptance run |
| Actual-backup conversion | Native conversion retained 13 legacy messages and one Agent, checked recovery records, and passed repeat apply | Candidate data only; unknown roots stay quarantined |
| Authenticated workspace behavior | Native business trial passed three fixture logins, two workspaces, membership isolation, CSRF/Origin checks, logout, restart persistence, SQLite integrity and foreign keys | Fixture accounts; no formal human owner or production cutover |
| Controller exception handling | Six local injected cases passed at `aa3db26` | Mocked control flow, not actual OOM, disk exhaustion, signals or OS-level fault injection |
| Native trial resource observation | Business trial lasted 45.42 seconds, peaked at 139321344 bytes, used no swap, under 192 MiB / CPU 10% limits | Short trial; not sustained workload capacity evidence |

Supporting records:

- `docs/verification/2026-10-11-actual-backup-workspace-conversion.md`.
- `docs/verification/2026-10-11-actual-runtime-business-approved.md`.
- `docs/verification/2026-10-11-controller-exception-fixture-approved.md`.

## Latest bounded deployment observations

The read-only remote preflight completed with exit 0. These are observations at
check time, not a promise that the same state persists until publication.

- VPS: `47.108.217.178`; CPU count 2; MemTotal 1651808 KiB;
  MemAvailable 1093048 KiB; available disk 32076672 KiB.
- SwapTotal and SwapFree were both 2097148 KiB.
- `chunlack.service`: active/running, PID 594652, NRestarts 0.
- Existing release: `/opt/chunlack/releases/e188eae`.
- Existing loopback health at `127.0.0.1:3721/health`: HTTP 200.
- `tailscaled.service`: active/running, PID 859, NRestarts 0.
- LACK memory.current: 41050112 bytes; Tailscale: 43520000 bytes.
- Existing UDP 40000 listeners were present. This does not measure Relay traffic
  continuity, packet loss, latency, or throughput.
- No TCP 443 listener was observed; this is not proof of public firewall access.
- `chunlack-public.service`, `chunlack-ingress.service`, and caddy/nginx units
  queried by the shell preflight were not found.
- The shell preflight did NOT query the template's exact
  `chunlack-https.service` name. Its current unit state remains a separate gate;
  do not substitute `chunlack-ingress.service` as proof of its absence.
- This bounded preflight does not establish a current full unit inventory,
  PSI/OOM baseline, resource acceptance, or functional Relay acceptance.

Public DNS checks used Google DNS-over-HTTPS, not access to the DNS provider's
account or a direct authoritative-server audit:

- `lack.chunclaw.top` and `agents.chunclaw.top`: A = `47.108.217.178`, TTL 300.
- Both AAAA queries returned no answer records.
- The apex `chunclaw.top` CAA query returned no answer records. Per-host CAA
  was not checked in this run; apex-only results are not sufficient for issuance.
- Certificate-verifying curl probes with requested IP pinning returned HTTP 000:
  exit 35 for lack (TLS handshake failure), exit 28 for agents (timeout).
- Proxy environment and intervening network effects were not independently
  excluded. These errors do not identify a precise network root cause.
- Public HTTPS is NOT accepted. No certificate-verification bypass was used.

## Maintenance authorization and remaining decisions

The human approved a new maintenance/publication window. It remains unconsumed.
Its limits are binding:

- Stop only existing LACK, for at most 120 seconds, to refresh a consistent backup.
- Restore it immediately and abort publication if that deadline is exceeded.
- Verify data ownership, the formal human account, and resource budget first.
- Preserve the old release for rollback.
- Add only TCP 443 as the new public entrance. Do not expose backend ports.
- Do not restart or reconfigure Tailscale Relay, change existing DNS, or replace
  the existing firewall rule collection.

The resource choice is still pending. Current templates specify application
MemoryMax 448 MiB / CPUQuota 50%, and HTTPS MemoryMax 128 MiB / CPUQuota 10%.
Those are configured ceilings, not measured consumption or accepted sustained
capacity. The 192 MiB / CPU 10% short native business trial does not justify
silently applying that budget to long-running production.

Two choices were presented: a low-budget sustained isolated trial before deciding
the publication budget, or explicit approval of the template budget for a
low-load production acceptance. Neither is presumed selected.

## Local candidate packaging failure

The initial archive command failed with exit 128 because the output-path argument
was incorrectly composed in PowerShell. It did not modify the VPS.

The owned preparation directory is
`.superpowers/sdd/2026-10-11-public-release-prep/release-candidate-aa3db26-4b390c12`.
Its owner marker identifies source commit `aa3db26`, nonce `4b390c12`, and
`productionCutover=false`, `liveOwnerCreated=false`. A bounded post-failure check
confirmed both `source-aa3db26.tar` and `package` absent.

Correction approval was requested. No candidate archive, package hash, or
successful packaging result is claimed. Do not overwrite unexpected files or
delete the preparation directory to hide this failure.

## Gates before calling the system usable

1. Resolve the packaging correction and resource choice; build a uniquely owned,
   secret-free fixed-revision candidate and retain its inventory and hashes.
2. Complete the chosen resource-validation path without silently expanding
   limits. Recheck the exact HTTPS unit and port ownership before service setup.
3. Enforce the maintenance deadline and abort/restore path, refresh the consistent
   backup, and verify restore evidence before relying on it for rollback.
4. Establish formal ownership for workspace `ChunLACK` and login
   `chunlack-owner` through the authorized private process. Fixture identities
   must not become live owners or be presented as human-account acceptance.
5. Confirm DNS/CAA, verified certificates, exact origins, private backend binds,
   real public authentication and isolation, and co-host/Relay functional health.
6. Validate the intended direct 1Cat route from the deployed runtime. Earlier
   local API completions do not establish the engine, hardware, or VPS route.
   Do not connect Open WebUI or reuse its credentials as a substitute.
7. Complete real Muse **老镇** and dots **玄玑** task delivery, native Agent/browser
   execution, nonce-matched evidence, persisted results, and bounded cleanup.
   HTTP receipt, a model answer, or our own worker does not satisfy this gate.
8. Deliver verified login/use instructions, node enrollment and revocation,
   provider-neutral configuration, recovery/rollback instructions, and synchronize
   the scoped non-secret changes to GitHub.

Until these gates have authoritative evidence, the full delivery goal remains
active and the platform must not be announced as ready for use.
