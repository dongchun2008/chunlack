# Agent access RSA test correction: local verification

Date: 2026-10-14. Baseline: `34ec580`.

Status: the approved RSA test-fixture correction and complete local regression
are finished. This resolves the test-validity finding in the previous repair
checkpoint. The Agent access verifier remains unmounted; this is not production,
real Pocket ID token, or native external-Agent acceptance.

## Correction and evidence quality

The old negative cases replaced the public modulus while retaining an unrelated
signing private key. They could pass because of invalid signatures rather than
the intended size policy.

The corrected cases generate matching key pairs at 2047, 2048, 4096 and 4098
bits. Each case independently verifies its signature with Node crypto and
asserts the actual exported modulus bit count. The two allowed endpoints must
be accepted, and the two out-of-range samples must be rejected.

The upper negative control also passes ordinary JOSE JWT verification against
its own local JWKS before it is submitted to ChunLACK's restricted verifier.
This establishes that the 4098-bit sample is a valid signed JWT, not merely a
malformed key, wrong signature or invalid-claims rejection.

A prior in-memory diagnostic found that this runtime generated an actual
4096-bit modulus when asked for 4097 bits. Therefore the test uses a verified
4098-bit sample and never assumes that the requested size is the actual size.

## Fresh results

| Run | Tests | Passed | Failed | Cancelled | Skipped | Exit |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Verifier and boundary tests | 49 | 49 | 0 | 0 | 0 | 0 |
| Complete local `tests/*.test.cjs` | 649 | 649 | 0 | 0 | 0 | 0 |

Focused duration: 6209.336 ms. Full duration: 295453.1659 ms.

The full suite used Node 24.19.0, `--test-concurrency=1`,
`--test-timeout=90000`, and the TAP reporter. Actual local Caddy HTTPS tests were
enabled. Caddy 2.11.7's SHA-256 was checked against the previously verified
`5f93a9bd555f3aac9d33af2756ba14b3519d8cca4ffd55256bdaeab444c9db2a`.

The dedicated Agent verifier command was:

```powershell
node --test --test-reporter=tap --test-concurrency=1 --test-timeout=90000 tests/agent-access.test.cjs tests/agent-access-boundaries.test.cjs
```

No tests were skipped. Git whitespace validation also passed.

## Independent review and coverage limits

A fresh read-only reviewer reported no findings in the correction and confirmed
that the unrelated-signature false-positive risk was removed. The review was
static; the execution results above were obtained by the parent test runner.

The 2047-bit case establishes overall rejection, but does not isolate the
application's minimum-size check from JOSE's own 2048-bit minimum. The upper
negative case tests 4098, not exactly 4097, and encounters the encoded-modulus
length restriction before the explicit bit-count guard. These are stated
coverage limits, not claims that every internal branch has been mutation-tested.

## Unchanged scope and next gate

Only the test fixture and verification documentation changed in this stage.
The product verifier's hash is unchanged from the previous approved repair.
There were no production deployments, VPS operations, credential changes,
Pocket ID client changes or Tailscale Relay operations. This stage did not run
Linux-native verification or use real provider access tokens.

The next unmounted implementation gate is an explicit authority bridge between
verified issuer/user/client identity and locally granted workspace/node access,
including current membership and revocation checks. Opaque verifier evidence
alone must never become an HTTP node principal. Real Pocket ID configuration,
native Muse/dots execution and end-to-end delivery remain separate unfinished
gates; local green tests do not substitute for them.

## Evidence hashes

| Artifact | SHA-256 |
| --- | --- |
| Unchanged `identity/agent-access.cjs` | `721cead58a792fdda499bad7319b841b3f711f33a260a63090ded60f12561872` |
| `tests/agent-access-boundaries.test.cjs` | `69fb71744d39f29b35bee12693ee4436fdfaad1e4926274f2f68a34ac0346ac8` |
| `agent-access-rsa-focused-20261014.tap` | `ebda3bd078929e44eff771cca16ca3c38d909fb31230457ccc682e721b7abe4e` |
| `agent-access-rsa-full-20261014.tap` | `b94ef7135eacb40f5fc801e43d5e075c45ae1ce4202da8f1bc6399ed7c25826f` |

Private TAP files remain ignored under
`.superpowers/sdd/2026-10-13-release-preparation/`.
