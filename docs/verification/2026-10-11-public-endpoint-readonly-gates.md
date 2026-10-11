# Public endpoint read-only gates

Date: 2026-10-11. Inspected product revision: `5778cf6ae8d6b9ec17f689f4316fc9c1e12cdb40`. The worktree was clean at the beginning of this check.

## Fresh observations

The Windows system resolver returned `28.0.36.204` for `lack.chunclaw.top` and `28.0.36.239` for `agents.chunclaw.top`. Bounded HTTPS HEAD requests to each hostname failed with `ECONNRESET`. No response content, login, credential or private account data was requested.

An independent public DNS-over-HTTPS query to `https://dns.google/resolve`, with query type A, returned these results:

| Host | HTTP status | DNS status | A records |
| --- | --- | --- | --- |
| lack.chunclaw.top | 200 | 0 | 47.108.217.178 |
| agents.chunclaw.top | 200 | 0 | 47.108.217.178 |

The public resolver results match the selected VPS. No DNS records were added or changed. These observations do not prove all recursive resolvers have converged, zone ownership, certificate validity, a VPS listener on 443, public login readiness or vendor connector access.

The difference between Windows system resolution and the public resolver may involve local interception or other resolver configuration; the cause was not inspected or established. The HTTPS reset therefore cannot be attributed to ChunLACK, the VPS, or its firewall from these checks alone. No local proxy, resolver, network or security setting was modified.

## Delivery blocker audit

The requested maintenance-window permission has remained unanswered through successive goal turns. It is not an active process that can be polled or retried. No service-stop, recovery timer, production restart or version switch was performed.

The real original-data backup failed its strict source-stability gate while production remained active. The template-index fix is tested and committed but not deployed. Excluding the changing file, accepting changed source identities, or treating an isolated fixture as the original backup would not satisfy the requested consistent-recovery gate.

Real Muse and dots acceptance also needs the relevant account-side connection and execution permissions. Local protocol tests and generic workers do not establish execution by Muse 老镇 or dots 玄玑. No vendor subscription, pairing, private-network enrollment or credential change was made in this check.

The remaining critical-path steps cannot be completed by repeatedly rerunning already-passing isolated tests. Resume production work after an explicit response to the bounded maintenance-window request, and conduct each real vendor account connection within its specifically approved scope. Do not mark the full goal complete on the evidence recorded here.
