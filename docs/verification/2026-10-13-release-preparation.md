# Fixed-revision candidate preparation, 2026-10-13

Status: local preparation only. No candidate process started, dependency
installation, remote upload, certificate request or production activation was
performed in this increment. A clear preflight is not deployment permission.

## Generated artifacts

Source revision: adce51ce5ed822e20c5b9962f4cfba8c8da31253. The worktree was
clean when selected. A Git archive of that exact revision was extracted into
an exclusive ignored staging directory; its materialize.py generated the
runtime without executing the legacy installer. The archived ingress renderer
generated a fresh Caddyfile using the existing approved hostname example.

Local staging root:
.superpowers/sdd/2026-10-13-release-preparation/adce51c-d9ca2e967c.

- Runtime inventory: 53 files, 837330 bytes, with individual SHA-256 hashes.
- No node_modules was installed or copied; platform-specific dependencies
  remain a separate installation and acceptance gate.
- The generated configuration is a template, not a reviewed production data
  configuration. No migrationReady flag or identity binding was fabricated.
- No private credential file was an input to materialization or rendering.
- Caddy configuration was rendered, not validated against a production binary,
  activated or used to request a certificate in this step.

| Artifact | SHA-256 |
| --- | --- |
| source.tar | 83c4b6b86344d8fc468250a117e3624e90f15a16d5f2fa825fbaaebc7908fa0c |
| Caddyfile.candidate | bd809ebcec0b336fd78f5f65607718322f15d4f13b28e696c3f4041e3b69ecb4 |
| manifest.json | a305fc0531ae3528abdffc446e5425c701724092218ee935a7d265832263e6a7 |
| caa-observation.json | 2e1bca799d1b5828d32deca7ab5e5467d9755733f9163ce4b61e41dc0b2af9d2 |

At 2026-10-13 07:21:13 Asia/Shanghai, Google DNS-over-HTTPS returned DNS status
0 and no CAA answers for lack.chunclaw.top, agents.chunclaw.top and chunclaw.top.
These three observations do not prove DNS ownership, all ancestor policy,
certificate issuance or client reachability. No DNS records were changed.

## Identity initialization gate

The existing accounts.cjs bootstrap command requires a protected JSON password
on stdin and an explicit login/workspace. It refuses interactive plaintext
entry, does not infer an owner from Pocket ID groups, and outputs only local
user/workspace identifiers. The approved names remain chunlack-owner and
ChunLACK. The chosen Pocket ID account and client-access group do not by
themselves create this local owner or prove the authenticated issuer/sub pair.

Before binding or activating a real owner, authorize private initialization
and its destination. Do not print an initial password or reset token, put it
on a command line, silently reuse the VPS password, or treat an account name
as a verified OIDC subject. Prefer a newly generated recovery credential in a
new user/SYSTEM-only local file and a private candidate environment; no
existing credential is to be replaced. Actual verified identity binding and
browser login remain separate acceptance steps.

## Proposed next authorization scope, not yet executed

1. Stage the fixed candidate, platform dependencies and verified private
   Node/Caddy binaries in separate directories, with dedicated service users.
   Do not overwrite /opt/chunlack/current or the existing LACK data/config.
2. Prepare a reviewed isolated data copy and the explicitly approved human
   owner. Retain the original source backup, quarantine and migration evidence;
   never set readiness over unreviewed legacy data or transfer stale copied
   data into production by implication.
3. Permit only the existing budget contracts: application MemoryMax 448 MiB,
   CPUQuota 50%; HTTPS MemoryMax 128 MiB, CPUQuota 10%, with at least 192 MiB
   headroom. A fresh baseline and free loopback ports 13721/13722/13723 are
   required before startup. Do not increase quotas to make a failing trial pass.
4. If authorized, start independent candidate services and request valid TLS
   for only lack.chunclaw.top and agents.chunclaw.top using TCP 443. Do not open
   port 80, UDP 443 or public application ports; do not rewrite unrelated DNS,
   firewall rulesets, proxies or the existing Tailscale configuration.
5. Run the real browser authorization-code flow, validate issuer/sub before
   binding it to the approved owner, and verify session/workspace isolation
   and logout. Native Muse/dots and final real-model acceptance remain later
   gates, not implied by Pocket ID login.
6. Stop only the newly owned candidate services if their safety gates fail.
   Preserve diagnostics, backups and incomplete-shutdown locks for review;
   do not restart the old LACK or Relay or force an unclean data-root takeover.

This proposed candidate-access scope does not authorize a production data
cutover, a new stop of the existing LACK, or reuse of an already consumed
maintenance window. A final migration requires a separately approved fresh
consistent backup and rollback plan. Existing services remain the working
baseline until that decision.
