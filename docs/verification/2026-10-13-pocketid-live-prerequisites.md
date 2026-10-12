# Pocket ID live prerequisites, 2026-10-13

Status: prerequisites partly verified; real login and production delivery are
not accepted. Initial observations did not change configuration. Subsequent
explicitly approved client-access and failed-state changes are recorded below.
No production application, credential or Relay setting was changed.

## Replacement credential boundary

The user reported revoking the exposed old secret and saving its replacement.
A state-only local check confirmed valid JSON, a nonempty clientSecret without
outer whitespace, matching dedicated client ID, issuer and redirect URI, and
an inheritance-disabled file ACL with Allow entries limited to the current
Windows user and SYSTEM. No credential value was emitted.

Revocation is user-confirmed, not independently authenticated evidence. The
requiresSecretReplacement flag remains true and was not edited. The check did
not authenticate the replacement against Pocket ID or create a local session.

## Real issuer discovery

At 2026-10-12T22:56:40.981Z, the current identity/oidc.cjs adapter was invoked
with the dedicated client ID, configured issuer and web origin. A clearly
non-credential placeholder was used for the secret parameter because discovery
does not authenticate a client. No real secret was read by this probe.

The adapter completed its real HTTPS discovery and metadata validation,
including the existing RS256, client_secret_basic and PKCE S256 requirements.
It constructed an authorization URL with the expected issuer origin, exact
https://lack.chunclaw.top/auth/oidc/callback redirect and openid/profile/email
scopes. The probe did not navigate to that URL, exchange a code, bind a human
identity or create a login session. It closed its owned adapter afterwards.

Only sanitized booleans and scope names were saved below the ignored directory
.superpowers/sdd/2026-10-13-pocketid-preflight. State, nonce, verifier and the
constructed authorization URL were not printed or persisted.

## Client UI observation

The authenticated Pocket ID UI displayed version 2.14.0 and client ChunLACK.
Read-only controls showed confidential-client mode, PKCE enabled and skip
consent disabled. The Allowed User Groups tab showed no checked group and a
Remove Restrictions control. The only listed group was the existing Tailscale
group with two members; it was not selected or modified.

The official [app connection guide](https://pocket-id.org/docs/setup/connect-an-app)
states that restricted clients require allowed users/groups. An authenticated
Pocket ID administration session is therefore not evidence that this client
will admit the operator. Recommended next action, requiring explicit access
approval: create a dedicated ChunLACK group with only the intended initial
human owner, then allow that group for this client. Do not repurpose the
Tailscale group, allow every user, or grant ChunLACK workspace ownership from
group membership. Application ownership still requires an explicit verified
(issuer, sub) binding.

The private configuration's redirect value was checked. The initial label
lookup did not resolve the custom callback control. A subsequent read-only
General-tab DOM snapshot directly showed one configured callback:
https://lack.chunclaw.top/auth/oidc/callback, with no wildcard or additional
callback. It also showed the launch URL https://lack.chunclaw.top. No field was
edited or saved. This confirms the displayed client configuration, not HTTPS
reachability or a completed authorization-code exchange.

## Unsuccessful VPS observation, not a server-health result

A pinned-host SSH attempt sent the existing read-only preflight collector to
Node through standard input. The wrapper reached report parsing but obtained
no valid JSON and returned JSONDecodeError. It did not upload a file, start a
service, change a listener or modify production data.

A local minimal reproduction showed require.main === module is false in this
stdin execution mode. The collector's CLI body uses precisely that guard, so
the invocation does not execute the collector entry. This is a check-wrapper
defect, not evidence of an unhealthy VPS. No usable current VPS baseline was
obtained; earlier healthy-service and empty-443 observations remain historical.
The defect was reported rather than silently corrected. The user subsequently
approved the minimal invocation correction and read-only recheck, completed
below. Product code did not need to change.

## Approved invocation correction and current VPS evidence

The wrapper now explicitly invokes the collector's existing exported
parseOptions, collectBaseline and assessBaseline functions when require.main
is not module. It keeps the collector and all its fail-closed gates unchanged.
The source and invocation hashes are retained in the local evidence record.
No remote file was uploaded or written, and SSH host-key pinning remained
mandatory before authentication.

At 2026-10-13 07:04:26 Asia/Shanghai, the collector returned valid JSON and
exit 2, BLOCKED_OR_REVIEW_REQUIRED. Successful report collection is not a
passing deployment preflight. The report showed:

- Two CPU cores, load1m 0, available memory 1091376 KiB, swap use zero.
- CPU/memory/IO pressure avg10 0.54/0.18/1.81 and no kernel OOM entries in
  the preceding hour. The cumulative historical OOM counter was 62, not zero.
- Existing chunlack.service and tailscaled.service active, PIDs 594652 and
  859, respectively, both with zero recorded restarts.
- No TCP 443 listener; the expected UDP 40000 listener present.
- Both public hostnames resolved on the VPS to the expected IPv4 address,
  with no IPv6 address returned. This is not ACME/TLS acceptance.
- Ten existing failed units were the only reported preflight gates.

A follow-up bounded metadata query at 07:10:49 Asia/Shanghai identified all
ten as transient units with failed state, MainPID 0, ControlPID 0 and
NRestarts 0. Their descriptions/working directories refer to prior isolated
ChunLACK tests under /var/tmp; fragment paths are systemd transient-unit
paths. Eight recorded exit status 1, two recorded status 226. Current memory
and task counters were unset, not measurements of zero resource use. The
follow-up GET /health returned 200 with curl exit zero.

| Failed transient unit | Recorded exit status |
| --- | --- |
| chunlack-actual-migration-7fd316ba.service | 1 |
| chunlack-candidate-47165309d229-2.service | 1 |
| chunlack-candidate-6666cbcbdf11-10.service | 1 |
| chunlack-candidate-ac0b95885333-13.service | 1 |
| chunlack-candidate-ac0b95885333-2.service | 1 |
| chunlack-candidate-fbb525d7f2eb-1.service | 1 |
| chunlack-dependency-fa02c62b7cc1.service | 226 |
| chunlack-oidc-1b4ad68c-1.service | 1 |
| chunlack-oidc-a61f09d2-1.service | 226 |
| chunlack-runtime-679fe4a2-1.service | 1 |

No reset-failed, service stop/restart, firewall/DNS change, credential change,
production switch, or permission change was performed. Metadata distinguishes
these exited test units from the active production services; it does not
erase their failed test history, prove every original failure resolved, or
measure actual Relay forwarding quality. Any scoped failed-state reset needs
approval and a fresh ownership/inactive-state check before action; never use
an unqualified global reset-failed or weaken the collector to hide failures.

Evidence below .superpowers/sdd/2026-10-13-pocketid-preflight:

| Artifact | SHA-256 |
| --- | --- |
| vps-readonly-preflight-fixed-1791846266567145800.json | f27b1728cb433d09d77dabebc58c82bf8de3f042b0b5314ada78fd351db9059c |
| failed-unit-classification-1791846649658716600.json | 01d9c87876d63fc666f6b0a9e8c226d3ea234e58af8e33df4eaa49553c6fe24a |

The intended Pocket ID username was explicitly selected by the user. At this
point access changes were still unapproved; selecting an account alone was not
treated as permission. The user then separately approved both actions below.

## Approved failed-state cleanup and access configuration

Before cleanup, each of the exact ten listed units was rechecked for matching
identity, failed state, zero main/control PIDs, transient status, the expected
systemd transient fragment path and an isolated /var/tmp/chunlack- working
directory. Both production services had to be active/running with real PIDs,
LACK health 200 and the expected Relay UDP listener. Pre-action evidence was
flushed to a local record before executing the approved command.

One systemctl reset-failed invocation named only those ten units. It returned
zero; their failed states cleared. No test files, original reports or journal
entries were deleted, and no service was started, stopped or restarted. The
production baseline matched before and after: LACK PID 594652, tailscaled PID
859, both zero restarts, health 200 and Relay listener present. The unchanged
collector then returned exit 0, BASELINE_CLEAR_NOT_DEPLOY_AUTHORIZATION and an
empty gate list. This establishes only the sampled baseline, not production
permission, a new test pass, or actual Relay forwarding quality.

Evidence: approved-failed-state-reset-1791846872492165000.jsonl, SHA-256
8f53c60b5ff0e988f520cdaf56b5b0832fb1b2e26698a00e55c19b7a440a29b8,
under the same ignored evidence directory. Historical failed-run evidence above
remains part of the record, not replaced by this cleared systemd state.

In Pocket ID, the approved dedicated group chunlack-users was created. Only
the explicitly selected existing human account was added; the other account
remained unchecked. Only ChunLACK was selected in the group's allowed clients;
Tailscale was not selected. A full page reload confirmed the one-member group.
Fresh navigation to the dedicated ChunLACK client's Allowed User Groups tab
confirmed chunlack-users checked, user count 1, and the existing Tailscale group
unchecked, still showing its original two users. Restricted access remained
enabled; no All Users grant, secret change or additional client was created.

A non-secret screenshot of that client-side result was retained locally as
pocketid-access-1791847023501.jpg in the ignored evidence directory. No personal
account details or credential values are included in this Git report. Granting
Pocket ID client access did not create a ChunLACK owner, bind an external
identity or prove the complete browser login flow.

## Remaining sequence

1. Retain the historical failed-run evidence and the new successful baseline
   report. Refresh production conditions before any separately approved release.
2. The selected human's narrowly scoped Pocket ID client access and saved
   callback are confirmed. Next verify the real authentication exchange, not
   merely these settings or the presence of a secret file.
3. Prepare the isolated real-login trial and explicit identity binding. A
   production HTTPS callback and production cutover still need their own
   applicable release gates and maintenance authorization. Do not disable
   certificate checks or broaden redirect URLs to work around these gates.
4. Verify actual browser/code exchange, workspace boundaries and logout before
   updating login acceptance. Retain the distinct real-provider, Muse Laozhen,
   dots Xuanji, backup/rollback and Relay traffic acceptance gates.

The completed Windows 552-case run and separate Linux 136-case and one-case
runs remain evidence of their documented scopes; they were not rerun here and
do not substitute for the real identity or vendor-Agent checks above.
