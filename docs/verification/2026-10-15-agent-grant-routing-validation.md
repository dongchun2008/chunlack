# Explicit grant routing and HTTPS fixture cleanup: full local validation

Date: 2026-10-15 (Asia/Shanghai). Source baseline: `59146ca` plus the documented
grant-routing changes and the separately approved test-only cleanup correction.

## Authorized correction

Only `tests/public-ingress.test.cjs` changed in this repair. Its owning cleanup
hook now closes test connections, stops/awaits the owned Caddy child, and only
then removes the exclusive fixture directory. Each resource cleanup is bounded
at seven seconds. Failures do not prevent attempting remaining resource cleanup;
any failure prevents directory removal and is reported explicitly. Before recursive
removal the resolved absolute target must be a non-link `lack-ingress-` directory
directly under the resolved system temporary directory.

The original Caddy shutdown signals, certificate verification, TLS/HTTP2/WSS,
raw-path/host/header checks and product timeouts are unchanged. No product code
was changed to address this fixture failure.

Three new regressions first failed at the missing cleanup coordinator, then
passed: ordered completion, connection-close failure still attempting child
shutdown while preserving files, and bounded uncooperative cleanup preserving
files. Real Caddy focused validation passed **7/7**, zero failures/skips/cancels,
in 5898.6477 ms (`cleanup-green.tap`).

## Fresh full result

Node v24.19.0; serial test execution; verified portable Caddy 2.11.7. The Caddy
SHA-256 remained `5f93a9bd555f3aac9d33af2756ba14b3519d8cca4ffd55256bdaeab444c9db2a`.

```text
node --test --test-reporter=tap --test-concurrency=1 --test-timeout=90000 tests/*.test.cjs
tests 793
pass 793
fail 0
cancelled 0
skipped 0
todo 0
exit 0
duration_ms 807501.5338
```

Report: `.superpowers/sdd/2026-10-14-agent-grant-routing/full-cleanup-fixed-20261015.tap`.
SHA-256: `ce5c09d305efff0b764adf6e87c74a6ec3fbffc31b0390bdd0b755d9228c4b3e`.

This run includes the new explicit routing/discovery tests and all previously
failing HTTPS and OIDC writer-lock tests. No manual child termination was needed
in this successful run. The previous **787/790** failed run and the separate
unchanged OIDC **2/2** rerun remain recorded in
`2026-10-15-agent-grant-routing-checkpoint.md`; they are not erased or relabeled.
This success does not identify the cause of the earlier intermittent OIDC
subprocess timeouts.

## Acceptance boundary

This is a full local regression result, not production or native vendor
acceptance. The approved connection routing is still an opt-in component;
public runtime authority lifecycle, owner-only administration and exact ingress
assembly remain pending. The actual Muse Laozhen/dots Xuanji computer execution,
real OAuth enrollment and constrained native regression for this source remain
separate gates. See `docs/AGENT_CONNECTION_ROUTING.md` and the approved plan.

No production service, VPS, Pocket ID application, credential, public listener,
model provider route or Tailscale Relay was changed by this local repair/test run.
