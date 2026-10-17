# Agent resource ingress: implementation and local acceptance

Date: 2026-10-16. Status: local implementation and regression passed; no
production activation or real Muse/dots enrollment.

## Implemented scope

- `deploy/public/Caddyfile.template` forwards GET and HEAD for exactly
  `/.well-known/oauth-protected-resource` and
  `/.well-known/oauth-protected-resource/mcp` to the MCP backend.
- Exact GET `/mcp` now reaches the authenticated backend, which declines its
  optional SSE stream with 405 and `Allow: POST`. POST `/mcp` remains supported.
- Original-URI equality prevents case, query, encoding, trailing-path, and
  prefix variants from becoming new proxy routes. Existing request boundaries
  and identity-header scrubbing remain in place.
- Human administration is not exposed on the Agent host. No extra service,
  listener, public port, proxy daemon, or model dependency was added.
- `tests/public-ingress.test.cjs` covers actual certificate-verified Caddy TLS
  against the packaged MCP runtime, in addition to the existing upstream-route
  counter tests, HTTP/2, and WSS checks.
- `tests/helpers/public-agent-fixture.cjs` retains its default behavior and
  adds a test-only disabled-Agent-OAuth option and access to fixture ports,
  configuration, and a synthetic human session cookie.

The exact-URI boundary deliberately avoids relying on the case-insensitive
`path` matcher. See the [Caddy matcher documentation](https://caddyserver.com/docs/caddyfile/matchers#path).
No arbitrary `.well-known` prefix is forwarded.

## Verified behavior

Local real TLS tests covered public metadata GET/HEAD and its declared resource
and issuer, authentication-challenge metadata retrieval, signed fixture JWTs,
initialize, empty HTTP 202 initialized notifications, ping, tools discovery,
authorized GET returning 405, invalid protocol headers, duplicate
Authorization, foreign Origin, valid human-cookie rejection as Agent
authorization, grant revocation, and disabled-OAuth metadata returning 404.

Route-counter tests confirmed denied methods, queries, path variants, foreign
hosts, and Agent-host human administration did not reach an upstream. Existing
TLS verification, HTTP/2, WSS, and trusted-header checks were retained.

These are real local HTTP/TLS/runtime integrations with synthetic identity
fixtures, not actual Pocket ID Agent clients or vendor cloud computers.

## Test results

Node v24.19.0, serial tests, existing timeouts and safety assertions, verified
portable Caddy 2.11.7, and Python 3.13.

| Run | Tests | Pass | Fail | Cancelled | Skipped | Exit | Duration |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Focused ingress/authority/resource | 35 | 35 | 0 | 0 | 0 | 0 | 74529.0862 ms |
| Existing packaged/cancellation scenarios | 13 | 13 | 0 | 0 | 0 | 0 | 59440.1305 ms |
| Full suite | 837 | 837 | 0 | 0 | 0 | 0 | 919870.0843 ms |

Full command:

```powershell
node --test --test-reporter=tap --test-concurrency=1 --test-timeout=90000 tests/*.test.cjs
```

The existing `tests/smoke.cjs` body also passed, exit 0. It ran with a temporary
in-process guard requiring recursive deletion to target the smoke invocation's
own freshly created, non-linked temporary directory. Its business assertions
were unchanged. Evidence markers were the existing HTTP/WebSocket/persistence
PASS message and `SMOKE_OWNED_CLEANUP_GUARD=PASS`.

The packaged five-Agent test completed four rounds with 20 main generation
requests across two workspaces. It used synthetic model servers and registered
synthetic nodes; it is not proof of five vendor-owned computers executing
concurrently or sustained production capacity.

A fresh process query found no Caddy process matching the local ingress fixture
paths. Scoped `git diff --check` passed for the three changed files. No commit,
push, or production publication occurred.

## Evidence hashes

Logs are under `.superpowers/sdd/2026-10-14-agent-grant-routing/`.

| File | SHA-256 |
| --- | --- |
| `agent-resource-ingress-focused-2026-10-16.tap` | `d09efb0d17d534f0f2d097f68e12482a5fe6527a5f4ee401fff88557602e5594` |
| `agent-resource-ingress-packaged-2026-10-16.tap` | `97c86e6b8f7432dd05c63964b7e328996253082733b29a17e759df811bba4e85` |
| `agent-resource-ingress-full-2026-10-16.tap` | `4d5bf0ab73ef0028dd41ab607a6313f27ad78525eaa8390347c6d49bfdd1c8de` |
| `agent-resource-ingress-smoke-2026-10-16.log` | `5359b28afdc2dad9c957037b30515ab522230c6a3508da05551b3ea7e211ce89` |

## Read-only native dependency preparation

The 11 locally required direct-package installation versions matched the VPS:
`@node-oauth/oauth2-server 5.3.0`, `axios 1.20.0`, `better-sqlite3 12.11.1`,
`cheerio 1.2.0`, `eslint 8.57.1`, `express 4.22.2`, `openid-client 6.8.8`,
`simple-git 4.0.2`, `uuid 11.1.1`, `ws 8.21.3`, and `jose 6.2.12`.

The lockfiles were not byte-identical. Read-only semantic comparison established
that all 257 non-root locked package entries matched; the only difference was
the root entry's direct `jose` declaration, present locally and absent in the
server lockfile. The server already had the same installed `jose` version.
No server lockfile or installed package was changed. Matching lock entries do
not by themselves prove every installed file's integrity; the forthcoming
isolated copy still needs its own file-hash evidence.

The server's existing Caddy reported v2.11.7 and matched the pinned Linux SHA-256:
`678ade3bfc088749c81a681adc603333ee0bb023b6a6cfe3c0f58bef8ff854e9`.
These checks did not start a new server, install software, or change production.

## Remaining gates

- Run the new HTTPS ingress cases in bounded Linux isolation, with a fresh
  source manifest and independently checked dependency copies. The earlier
  11-case native lifecycle result does not cover this new template change.
- Complete the pending five-space formatting cleanup confirmation and scoped
  GitHub synchronization; those three older fixture callers were not changed.
- Perform separately controlled candidate publication and rollback validation.
- Complete actual Agent-client configuration, Muse/dots task execution,
  evidence return, and the remaining real-provider and delivery requirements.

Earlier failed full runs remain preserved. No historical intermittent timeout
is declared root-caused merely because this full run passed.
