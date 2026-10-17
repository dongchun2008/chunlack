# Native Linux MCP lifecycle checkpoint

Date: 2026-10-16.

## Result and scope

`tests/agent-mcp-lifecycle.test.cjs` passed on the VPS under the approved
isolation limits: **11 tests, 11 passes, zero failures, cancellations, skips,
or todo**, Node exit code 0. TAP duration: 10701.575473 ms.

This is selected native lifecycle verification, not the full Linux suite,
public HTTPS ingress acceptance, vendor enrollment, real model execution, or
the completion of the ChunLACK delivery goal. The local full-suite checkpoint
remains separately recorded in `2026-10-16-full-regression-checkpoint.md`.

## Immutable snapshot provenance

The new local-only runner packaged 142 explicitly scoped source/helper and
dependency files, recorded each SHA-256, and verified the archive and extracted
file hashes before starting the native test. It did not claim a clean Git
revision for the uncommitted working tree.

The older revision-pinned runner was not modified or executed. No historical
test result was attributed to the current snapshot.

- Owned unit: `chunlack-mcp-lifecycle-050e9440011a.service`.
- Owned remote directory: `/var/tmp/chunlack-mcp-lifecycle-050e9440011a`.
- Snapshot SHA-256: `713ede82c9089b1d1882378e2676a53738cec90f34dadb339a8724cc875b1c41`.
- Local report SHA-256: `b233c57f3e651c1f19b4f25ec2767995419dce185677bfe8222fe16d5638787b`.

Ignored local evidence under
`.superpowers/sdd/2026-10-14-agent-grant-routing/`:

- `native-mcp-lifecycle-20261016.py`.
- `chunlack-mcp-lifecycle-050e9440011a-source.tar`.
- `chunlack-mcp-lifecycle-050e9440011a-handle.json`.
- `chunlack-mcp-lifecycle-050e9440011a-report.json`.

Native dependency files were copied into the owned test snapshot, version and
hash checked, and mounted read-only. Production dependency permissions and
contents were not changed. No dependency installation was performed.

## Verified limits

| Property | Observed value |
| --- | --- |
| User / group | nobody / nogroup |
| MemoryMax | 201326592 bytes (192 MiB) |
| MemoryHigh | 167772160 bytes (160 MiB) |
| MemorySwapMax | 0 |
| CPUQuotaPerSecUSec | 100 ms (10%) |
| TasksMax | 32 |
| RuntimeMaxUSec | 1 min 30 s |
| PrivateNetwork / PrivateTmp | yes / yes |
| ProtectHome / ProtectSystem | yes / strict |
| NoNewPrivileges | yes |
| MemoryPeak | 62210048 bytes (about 59.3 MiB) |

Source was read-only; only the owned results/scratch directory was writable.
Tests used fixture authorization and isolated loopback networking, not public
model APIs or vendor computers. The script reported `limitsVerified: true`,
`protectedUnchanged: true`, and no errors.

## Protected service comparison

These values matched before and after the test:

| Existing service | MainPID | NRestarts | State |
| --- | ---: | ---: | --- |
| chunlack.service | 594652 | 0 | active |
| tailscaled.service | 859 | 0 | active |
| chunlack-public.service | 646156 | 0 | active |
| chunlack-https.service | 646181 | 0 | active |

The old loopback health endpoint and certificate-verified public HTTPS health
endpoint both returned HTTP 200 before and after. Relay UDP 40000 remained
listening. This is bounded coexistence evidence, not a measurement of end-user
Relay throughput or a continuous availability guarantee.

After the runner stopped its own unit, a separate read-only query confirmed:
`MainPID=0`, `LoadState=not-found`, `ActiveState=inactive`, `SubState=dead`.
The transient test unit was stopped and collected. Its bounded evidence
directory was retained; no existing directory was removed.

## Remaining work

Formatting cleanup and GitHub synchronization remain pending the previously
presented confirmation. Public Agent metadata/GET ingress routing, broader
native coverage, actual Muse/dots execution and other delivery gates remain
open. This run did not publish or restart production, change credentials,
model providers, DNS, firewall rules, or Tailscale Relay settings.
