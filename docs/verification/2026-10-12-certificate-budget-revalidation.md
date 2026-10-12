# Certificate fixture budget revalidation

Status: approved certificate-budget change passed; candidate-wide Windows
acceptance remains incomplete. No production release was performed.

## Exact change

Only tests/public-ingress.test.cjs changed in this increment. With
CHUNLACK_TEST_LOW_CPU=1, temporary RSA certificate generation has a 20000 ms
deadline and each real TLS test has a 40000 ms total deadline. Normal mode
retains 5000 ms and 20000 ms respectively. RSA-2048, certificate verification,
routing, header, SNI, HTTP/2 and WSS assertions are unchanged. A finally block
reports elapsed time and budget without printing certificate/key material.

The ignored native runner includes this test overlay in its hashed inputs;
its scope label now correctly names 136 tests. It does not relax isolation or
resource limits. Input source is base c78c23c plus the explicit candidate
overlays, not the unmodified Git revision or the production release.

## Results

| Run | Total | Pass | Fail | Cancelled | Skipped | Exit |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Linux isolated, all 16 selected groups | 136 | 136 | 0 | 0 | 0 | 0 |
| Windows complete suite | 552 | 551 | 1 | 0 | 0 | 1 |
| Windows unchanged diagnostic subset | 5 | 5 | 0 | 0 | 0 | 0 |

Linux batch native-candidate-b53d9fc78bc4 is accepted for its stated scope.
It is 136 selected native tests, not a full 552-test Linux suite. Temporary
certificate generation took 2997 ms and 3301 ms; all four public-ingress tests
passed. This establishes this run's result, not a maximum certificate-generation
time or indefinite stability. The previous two five-second timeouts remain
recorded in the earlier report.

The Windows complete suite took 603341.4973 ms. Both certificate generations
used the unchanged normal-mode 5000 ms budget, taking 964 ms and 843 ms. Smoke
subsequently exited zero with real HTTP/WebSocket, two mock model backends,
SQLite restart persistence, private binding and configuration preservation.
It is not live provider/vendor-Agent acceptance.

The sole Windows full-suite failure was:

`actual embedded process enforces human identity, viewer denial and workspace separation without global config writes`

The failure occurred at workspace-runtime.test.cjs:63: the child had printed
the JSPACE stub message but had not printed its readiness marker within the
existing 100 iterations of 50 ms. The case failed before its business
assertions. A later local CPU sample reported 100%; causation is not proven.

Without editing that test, one diagnostic run of workspace-runtime plus
public-ingress passed all five cases in 18568.6715 ms. The workspace case took
9787.3381 ms including setup and assertions, not just child startup. This
diagnostic pass does not erase the failed complete run or establish its cause.
No automatic retry-until-green loop was used. A separate request proposes
measured, bounded startup waiting for this one fixture; it is not implemented
in this checkpoint.

## Production protection and remaining gates

Native CPUQuota=10%, MemoryMax=192 MiB, MemoryHigh=160 MiB, zero swap, private
network, PrivateTmp and non-root execution remain unchanged. The runner's
per-group and final baselines matched: existing LACK and Tailscale active with
unchanged main PIDs, LACK health 200, Relay UDP 40000 present, no host TCP 443
listener. This does not measure functional Relay forwarding quality.

Only the approved certificate fixture and this report are synchronized at
this checkpoint. Other dependency/runtime candidates remain local pending
candidate-wide acceptance. There was no production cutover, production
certificate issuance, existing service restart, DNS/firewall/credential change,
or resource expansion. Pocket ID replacement credentials, real login, formal
production ownership, provider/vendor execution and final delivery remain open.

## Evidence

Local ignored root: .superpowers/sdd/2026-10-12-dependency-hardening.

| Artifact | SHA-256 |
| --- | --- |
| full-suite-certificate-fixed.tap | 1179c4cc9e953f7349c36d665834155e1db7631324ccc76971f686571155ebf0 |
| smoke-certificate-fixed.log | f11986f4ca6071992a388765ca44f0a4d23d1332a8d0f6a1603c5cd04cec79cb |
| workspace-and-ingress-diagnostic.tap | ed1d459809a7591b8fd19c6fb5e79192520087a4fe28fb499e5e3168c239f642 |
| native-candidate-b53d9fc78bc4/inputs.json | 300bf753b9efba27af14904317dadf1b618eb0ab05289caf03312b2d654cf028 |
| native-candidate-b53d9fc78bc4/result.json | d1a1bb9f62d7e32a2e855eb9c67f374d3f4575d4c0b6e2dd65647fc5bf1730da |
| native public-ingress TAP | dcbca5489917dcb6455b187f3c824049547ed9c12fed397b59e9d5d9f6cd8a03 |
