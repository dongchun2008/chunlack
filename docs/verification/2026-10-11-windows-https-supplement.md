# Authorized Windows HTTPS supplement

Source revision: `f4bd5a953ee34588b5f5542f5791c1c02d868177` (product changes
remain those of `c77ad328e2326c947118cfa4a3d2c10f750d43b2`). The working tree
was clean before execution. The user specifically approved correcting portable
Caddy verification and rerunning the seven previously skipped HTTPS cases.
This did not authorize or implement the three remaining OIDC repairs.

## Corrected verification

Only the already downloaded official Caddy v2.11.7 archive and checksum manifest
were used. Linked input paths and an existing executable were rejected before
extraction. Both API SHA-256 digests were checked, then exactly one 128-hex-digit
SHA-512 entry for `caddy_2.11.7_windows_amd64.zip` was selected from the manifest
and compared to the archive's SHA-512. The algorithms were not interchanged.

| Item | Digest |
| --- | --- |
| Manifest SHA-256 | 5d27b76b95f496638d79208c55250317b8755fd9e90005f7466aa32956944a90 |
| ZIP SHA-256 | 0a1edc0b799512051c57071ce0e798d3f2cf67dc98171366f1d2b326072e3b06 |
| ZIP SHA-512 | c308154504e53755958ffc62d8a2657ab17eefd6dd25c45dbb2c3d93d29519971f77ca652f7d0f2bcb7f980b9ba3822478865e29969d0272d7613550a43152b1 |
| Extracted executable SHA-256 | 5f93a9bd555f3aac9d33af2756ba14b3519d8cca4ffd55256bdaeab444c9db2a |

Only the exact `caddy.exe` ZIP member was extracted, with an explicit size bound
and no overwrite. Its reported version was `v2.11.7`. This was a portable test
tool, not a global installation or Windows service. The source release remains
https://github.com/caddyserver/caddy/releases/tag/v2.11.7 .

## Execution and result

Environment variables were set only for the owned command process:
`CADDY_TEST_BIN` pointed to the verified executable in ignored test storage;
`PYTHON` pointed to `C:\Python\Python313\python.exe`.

```text
node --test --test-concurrency=1 --test-timeout=90000 tests/public-ingress.test.cjs tests/packaged-public-ingress.test.cjs tests/packaged-node-lifecycle.test.cjs tests/packaged-agent-rounds.test.cjs
```

Result: **11 tests, 11 pass, 0 fail, 0 skip, 0 cancel**, exit **0**,
**47348.7477 ms**. No product code, test assertions or deadlines were changed.
Four tests had already run previously; the other seven now have fresh Windows
acceptance instead of skips:

1. Packaged HTTPS/WSS four distinct five-Agent discussion rounds, three human
   sessions, two workspaces and five registered synthetic nodes.
2. Scoped HTTPS node-task lifecycle, cancellation evidence and persisted lease
   recovery with three humans and five paired synthetic nodes.
3. Materialized login/workspace script delivery through verified HTTPS.
4. Session, Origin/CSRF and current workspace authorization across ingress.
5. Scoped WSS and separation of human versus node REST/MCP administration routes.
6. Real Caddy TLS routing, raw-path boundaries and trusted-proxy headers.
7. Verified HTTP/2 and WSS forwarding with the browser host boundary preserved.

The first scenario reported four completed rounds, zero failed rounds/privacy
failures, 20 main generation requests and 40 total generation requests against
synthetic backends. It explicitly reported `nodesExecutedTasks: 0`: registration
in that discussion scenario is not native node execution. The separate lifecycle
scenario tests synthetic node execution protocol, not Muse/dots computer use.

The discussion scenario's 120.6015625 MiB peak RSS measures its test process only,
not the combined application/Caddy budget, VPS capacity or sustained production
resource use. It does not establish a new production limit.

## Evidence, cleanup and boundaries

Ignored log:
`.superpowers/sdd/2026-10-11-real-1cat-provider/oidc-checkpoint-windows-ingress.log`

SHA-256: `902e9f9606d305df13ba28d7b0fc11ab9ba5fb0967b746bc115fee3fa01d0585`.

After the test process exited, an exact executable-path process query found
**zero** remaining owned Caddy processes. The portable executable/downloads are
retained in ignored test storage for reproducibility; none is committed.

Fixtures used loopback high ports and synthetic, explicitly trusted test
certificates. No OS trust-store installation, public certificate issuance,
production-domain configuration, VPS access, service install/restart, credential
change or Tailscale Relay operation occurred.

The earlier full run remains **532 total / 525 pass / 0 fail / 7 skip** as an
immutable historical result. This separate **11/11** supplement covers those
seven skips; it is not presented as a new single full-suite run. Source stayed
unchanged throughout both runs apart from intervening documentation.

The three OIDC review blockers still require the separately requested approval
and repairs. Real Pocket ID login, native Muse LaoZhen/dots XuanJi round trips,
dependency hardening and production publication remain unaccepted. The overall
platform is not yet delivered.
