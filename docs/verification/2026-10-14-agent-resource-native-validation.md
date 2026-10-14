# Current-revision constrained Linux Agent validation

Source revision: `03f46e1232fadd2f7c4094fd0c86921603b01a81`.
Status: selected native Linux validation passed; not full platform delivery.

## Scope and results

The existing ignored isolation runner was extended with a resource/clock group
and pinned to the exact source revision. Its sandbox, timeout, resource,
dependency-copy and production-baseline checks were unchanged. An initial
local patch context mismatch made no file change; the runner was read and the
patch applied against its actual assertion before execution.

| Group | Native tests | Duration (ms) | Unit memory peak (bytes) |
| --- | ---: | ---: | ---: |
| Protected-resource discovery and advancing task clock | 12/12 | 8801.275714 | 62136320 |
| Event binding, ciphertext integrity and migration | 24/24 | 12602.05262 | 44052480 |
| Event runtime, real loopback MCP and workspace events | 28/28 | 23802.87745 | 66654208 |

All three groups had exit code 0, no failed/skipped/cancelled/todo cases,
verified source hashes, verified copied dependency hashes and no controller
errors. The combined result is 64 selected native tests, NOT a full native
775-test run. The highest measured unit peak was about 63.6 MiB.

## Enforced isolation

- CPU quota 10%, reported as CPUQuotaPerSecUSec=100ms.
- MemoryMax=201326592 bytes; MemoryHigh=167772160 bytes; MemorySwapMax=0.
- TasksMax=32; per-unit RuntimeMaxSec=90; bounded controller observation.
- User nobody/group nogroup; NoNewPrivileges=yes; private networking and tmp;
  ProtectSystem=strict and ProtectHome=yes.
- Explicit read-only source mapping and only the owned results/scratch paths
  writable. No host/public test listener was opened.
- Existing native better-sqlite3 12.11.1, bindings 1.5.0 and file-uri-to-path
  1.0.0 were copied into the isolated owned tree and verified. No production
  dependency file or permission was changed; no global software was installed.
- Only the explicitly named owned test units were stopped. Evidence directories
  remain for inspection; no production data was removed.

## Production coexistence evidence

Each group captured matching before/after baselines:

| Service | Main PID | Restart count | State |
| --- | ---: | ---: | --- |
| chunlack.service | 594652 | 0 | active |
| tailscaled.service | 859 | 0 | active |
| chunlack-public.service | 646156 | 0 | active |
| chunlack-https.service | 646181 | 0 | active |

Original LACK health remained `ok`; the public HTTPS health check with normal
certificate verification returned 200. The existing UDP 40000 Relay listener
records matched. This checks service/listener coexistence, not Relay forwarding
throughput, latency or packet loss. No service configuration, credential, DNS,
firewall, production deployment or Pocket ID application was changed.

## Evidence

Local evidence directory:
`.superpowers/sdd/2026-10-13-release-preparation/`.

| Report | SHA-256 |
| --- | --- |
| chunlack-agent-events-resource-73ad82581f-report.json | 85c70fb5b7ce8e655561dc8945d84e99064a2408ee4f02be3e88a1a35467663f |
| chunlack-agent-events-storage-1a92b8d076-report.json | 5b9e0c22ea3f5ac0db09219840dd614e6c73a547af974c871e4286993ff59141 |
| chunlack-agent-events-runtime-9a5c697201-report.json | 8b8c203acc09f8916f46c36f9c6247073bd74323d8173934de1587c3a01f5667 |

The corresponding unit names are the report prefixes with `.service` instead
of `-report.json`. Runtime properties in each report were captured before the
successful stop operation; `active/exited` there is not a running test process.

## Remaining gates

Local 775/775 acceptance is separately recorded in
`2026-10-14-startup-diagnostic-and-full-validation.md`; earlier intermittent
Windows readiness failures remain unexplained, not erased by native results.

Public runtime Agent authority assembly and trusted grant selection, dedicated
Pocket ID API/client enrollment, exact HTTPS discovery routes, restore/revoke
behavior and genuine Muse Laozhen/dots Xuanji computer execution remain open.
A read-only browser inspection found the accessible Muse page at sign-in;
no account was selected and no consent or connector was created. The absence
of a dots tab in that browser inventory is not an account-capability finding.
These checks do not constitute native vendor-Agent acceptance or authorize a
production update.
