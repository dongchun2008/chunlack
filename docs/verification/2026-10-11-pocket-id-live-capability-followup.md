# Pocket ID public capability refresh and HTTPS test preparation

Source revision checked: `c77ad328e2326c947118cfa4a3d2c10f750d43b2`.
Worktree was clean. This follow-up changes documentation only, not product code
or the three unresolved login blockers in the repair checkpoint.

## Fresh read-only Pocket ID evidence

At `2026-10-11T15:35:07.693Z`, bounded Node HTTPS GET requests returned:

- Discovery HTTP 200 at
  https://pockid.chunclaw.top/.well-known/openid-configuration .
- Exact issuer `https://pockid.chunclaw.top`.
- Authorization `/authorize`, token `/api/oidc/token`, userinfo `/api/oidc/userinfo`.
- Authorization-code response, S256 PKCE, RS256 ID-token signing and
  `client_secret_basic` authentication are advertised. The server also advertises
  plain/post/none alternatives; ChunLACK does not enable those as fallbacks.
- Scopes: openid, profile, email, groups, offline_access.
- Authorization-response issuer parameter support is true.
- No registration or revocation endpoint is advertised;
  `client_id_metadata_document_supported` is false. Missing metadata is not proof
  that every possible private/admin feature is unsupported.
- JWKS HTTP 200 at https://pockid.chunclaw.top/.well-known/jwks.json ; one key
  advertises RSA, RS256, signature use. No private key or bearer token was read.

Both requests used ordinary TLS verification, rejected redirects, had ten-second
timeouts and a 64 KiB response limit. JWKS was accepted only on the exact issuer
origin. No login, token POST, client registration or credentials were involved.
The web reading tool itself could not access discovery; the direct HTTPS checks
succeeded, so that tool error is not evidence of a service outage.

This closes the previous uncertainty about currently advertised RS256 support,
not installed Pocket ID version, dedicated-client configuration, subject binding,
real browser authentication, token issuance or native Agent authorization.

## Previously skipped HTTPS tests

The current Windows shell has no Caddy executable on PATH and no
`CADDY_TEST_BIN`. The existing test files skip their real ingress cases when that
variable is absent. Their fixtures use synthetic certificates and loopback high
ports, not the production domains/443 or the OS trust store.

Official release:
https://github.com/caddyserver/caddy/releases/tag/v2.11.7 .
GitHub release API advertised these SHA-256 digests:

| Asset | SHA-256 |
| --- | --- |
| caddy_2.11.7_checksums.txt | 5d27b76b95f496638d79208c55250317b8755fd9e90005f7466aa32956944a90 |
| caddy_2.11.7_windows_amd64.zip | 0a1edc0b799512051c57071ce0e798d3f2cf67dc98171366f1d2b326072e3b06 |

Both downloaded files matched those API digests. They remain in the ignored,
owned `caddy-windows-2.11.7` subdirectory of
`.superpowers/sdd/2026-10-11-real-1cat-provider/`.

The preparation command then stopped: it incorrectly compared the release
manifest's SHA-512 entry against the API's SHA-256 digest. The manifest entry is:

```text
c308154504e53755958ffc62d8a2657ab17eefd6dd25c45dbb2c3d93d29519971f77ca652f7d0f2bcb7f980b9ba3822478865e29969d0272d7613550a43152b1
```

The executable was not extracted or run, no Caddy service was installed, and no
HTTPS supplement was run. This is a local command error, not demonstrated binary
tampering or a product failure. Permission was requested to correct the checksum
procedure and run the unchanged isolated tests. Do not count the seven cases as
passed, or silently remove a verification step to proceed.

## Remaining gates

The additional OIDC repair request remains unanswered at this checkpoint.
Production LACK, Pocket ID applications, private credentials and Tailscale Relay
were untouched. The last full run remains 532 total / 525 pass / 0 fail / 7 skip;
no new full-suite or production acceptance claim is made.
