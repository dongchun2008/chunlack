# Pinned OIDC candidate package - 2026-10-12

Status: local isolated candidate prepared, not deployed or started.

## Source and construction

- Pinned source: `753308194bfb9136e34555008d68c4736f76292e`.
- The checkout matched this commit and had no local changes before packaging.
- Exported that exact commit using `git archive`, then ran its existing
  `scripts/materialize.py` against the exported source, not a changing checkout.
- Materialization used the embedded default configuration. No production config,
  database, private credential file, installed dependency tree or backup was copied.
- No global installation, runtime startup, VPS connection, service restart,
  Pocket ID operation, DNS/firewall modification or publication occurred.

Ignored local artifact root:
`.superpowers/sdd/2026-10-12-oidc-release-candidate/rc-7533081/`.

| Artifact | SHA-256 |
| --- | --- |
| `chunlack-7533081-runtime.tar.gz` | `b1d428186c7d69cfb54adc3deed7ba19a3f3d0826d2b6e526fcb14c00cb736e2` |
| `runtime-inventory.json` | `a1b760a874d67daefb5d0ecc49da2db32adbc2240008e433188afbc091ef9ed3` |

The runtime contains 53 files totaling 837191 bytes; the compressed archive is
218783 bytes. These figures exclude installed dependencies, private configuration,
data and runtime memory, so they are not a VPS sizing or memory-use measurement.

## Integrity verification

- Recorded each relative runtime file path, byte count and SHA-256 in the inventory.
- Rejected private/runtime-state directory names in the generated payload.
- Checked archive entry paths before extracting to a fresh owned verification
  directory. No absolute or parent-traversal archive paths were accepted.
- Verified all 53 extracted files against the original inventory, including exact
  count, size and hash. Result: PASS.

The inventory explicitly records that dependencies are not installed, production
configuration is not included, and the artifact itself authorizes no deployment.
The unmounted OAuth core may exist as source in the runtime; packaging does not
mount its endpoints or accept its unresolved integration/security gates.

## Relationship to tests and next gates

The code commit has the local 541/541 full regression and smoke evidence recorded
in `2026-10-12-oidc-boundary-repair-validation.md`. This packaging step adds byte
integrity evidence, not another behavioral test run or native Linux acceptance.

Do not run this default-config package against production data. Next stages need
an explicitly scoped isolated native retest, private candidate configuration,
confirmed account/data ownership, compatible identity schema and rollback policy,
then the authorized HTTPS/publication path. Preserve the existing production
LACK and Tailscale Relay throughout.

Dedicated Pocket ID client availability was requested from the user. Client ID
and a private Client Secret file path are still needed if it already exists; if
absent, creating a dedicated application is a separate external operation. Do not
reuse or modify Tailscale's OIDC client. The intended callback remains
`https://lack.chunclaw.top/auth/oidc/callback`; this record does not establish that
its DNS, TLS, route or real browser login has been accepted.

Muse LaoZhen and dots XuanJi native task execution and evidence return remain
unverified. A generated package and human OIDC support do not fulfill those gates.
