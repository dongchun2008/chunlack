# Pocket ID live prerequisites, 2026-10-13

Status: prerequisites partly verified; real login and production delivery are
not accepted. No production, credential, client permission, or Relay setting
was changed by these checks.

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

The private configuration's redirect value was checked. The general-page
custom callback control did not yield a value through the attempted label
lookup, so this probe does not newly attest the saved server-side callback.

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
The defect was reported rather than silently corrected. A minimal explicit
entry invocation and bounded recheck await approval; product code need not
change.

## Remaining sequence

1. Approve and correct only the read-only preflight invocation; obtain current
   service, resource, listener and DNS evidence without modifying services.
2. Approve narrowly scoped Pocket ID client access, verify the saved callback,
   and identify the intended human owner without exposing credentials.
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
