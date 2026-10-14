# Agent access verifier: approved repairs and remaining test gate

Date: 2026-10-14. Baseline: `2f73247`.

Follow-up: the RSA test-validity gate below was subsequently corrected with user
approval. See [the fresh verification record](2026-10-14-agent-access-rsa-verification.md)
for the 49-test focused and 649-test full results. The rest of this document
preserves the earlier checkpoint and its then-unresolved gate as history.

Status: the two approved implementation defects are corrected locally. The
verifier remains unmounted. This is a progress checkpoint, not production or
external-Agent acceptance. The earlier checkpoint is retained as history.

## Approved implementation changes

- Require a primitive string `sub` before UUID validation. A correctly signed
  array containing a UUID cannot become mutable identity evidence.
- Reserve a 30-second JWKS fetch-attempt cooldown before network access. This
  includes HTTP and malformed-response failures, in addition to JOSE's existing
  successful-refresh cooldown, cache lifetime and shared in-flight request.

No runtime mount, authorization grant, principal conversion, Pocket ID setting,
credential, VPS service, Tailscale Relay or production deployment was changed.

## Test evidence

New tests were run before the implementation patch: 14 total, 9 passed and 5
failed. The failures reproduced the non-string subject and repeated failed
JWKS fetches, including cold failure, malformed refresh and expired cache.

After the patch:

| Run | Tests | Passed | Failed | Cancelled | Skipped | Exit |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Existing verifier plus new boundaries | 47 | 47 | 0 | 0 | 0 | 0 |
| Complete local `tests/*.test.cjs` | 647 | 647 | 0 | 0 | 0 | 0 |

The full run took 293619.4773 ms, used Node 24.19.0, serial test-file execution
and a 90000 ms per-file bound. Real local Caddy HTTPS tests were enabled with
the previously verified Caddy 2.11.7 executable, whose SHA-256 was checked
before execution. There were no skipped tests. No Linux or real Pocket ID
access-token verification was performed by this repair stage.

New cases include cooldown recovery, concurrent request sharing, key rotation,
cache expiry during issuer outage, body-read timeout, cancellation settlement,
global rate reset, verifier-local proof ownership and prohibited token headers.

## Independent review and unresolved gate

A fresh read-only reviewer found no correctness or security finding in the two
implementation changes. It identified a test-validity defect in the two new
RSA modulus-boundary cases: replacing the public modulus without changing the
signing private key makes the signature invalid independently of the intended
size restriction. Their green result does not prove the RSA size boundary.

Permission to repair these tests using matching key pairs and independently
verified signatures, then rerun focused and complete regression, was requested.
That follow-up is not yet performed in this checkpoint. No production rollout
or final verifier acceptance is justified by the current all-green count.

## Limits relevant to later integration

- A valid cached issuer key can remain usable within the five-minute cache
  window. This is not immediate issuer-side token or account revocation.
- The 120-attempt per-minute budget is verifier-global and malformed attempts
  consume it. Public ingress needs a separately reviewed availability policy.
- Opaque proof is identity evidence only. Current workspace membership,
  local node grants and revocation must be checked by the later authority bridge.
- This stage does not demonstrate native Muse or dots task execution.

## Local evidence hashes

Private TAP artifacts remain ignored; they contain only local test output.

| Artifact | SHA-256 |
| --- | --- |
| `identity/agent-access.cjs` | `721cead58a792fdda499bad7319b841b3f711f33a260a63090ded60f12561872` |
| `tests/agent-access-boundaries.test.cjs` | `5e2ee3c2d0354e5264d314d8b86699501aa49036ca9ffec8eb2facd2f12bb884` |
| `agent-access-repair-focused-20261014.tap` | `6362641853f669000b68c8cefd7df9a57b320cf6c232728c3949fb5402cd3b53` |
| `agent-access-repair-full-20261014.tap` | `d189e5fe749c39f1e47f63220b1d8174e3afca804a24232ca7ed42cc670d8700` |

TAP directory: `.superpowers/sdd/2026-10-13-release-preparation/`.
