# Bounded native application + TLS verification, 2026-10-11

## Accepted scope

**Three unchanged packaged HTTPS/WSS component tests passed on the VPS.**
The generated application, Caddy, fixture setup and Node test processes ran
inside one isolated systemd unit with the approved 192 MiB hard memory limit
and CPU 10% quota. This is a fixture TLS/application acceptance, not acceptance
of the production domains or a sustained real-model workload.

Product source is `95c70de51de569cd04f3c1bf60d6b2b944eac530`. The frozen
315-entry source tree and archive were verified, then copied to the new owned
run `927d401c`. The fixture writes within that copy's private .superpowers
directory; it did not write into the frozen source tree. Product and existing
test files were not modified.

## Native result and actual limits

- Native tests: 3 passed; 0 failed, cancelled or skipped.
- Local controller control-flow injection: 6/6 passed.
- Local TLS TAP parser fixtures: 9/9 passed, including eight rejected cases.
- Unit elapsed time: 47.600 seconds.
- Aggregate cgroup memory peak: 115,224,576 bytes (109.887 MiB).
- Swap peak: 0; unit CPU accounting: 4,437,483,000 ns.
- Test process and host controller exited 0; controller errors were empty.

Captured systemd values:

```text
CPUQuotaPerSecUSec=100ms
MemoryHigh=167772160
MemoryMax=201326592
MemorySwapMax=0
TasksMax=32
RuntimeMaxUSec=4min
OOMPolicy=stop
```

The Node heap cap was 64 MiB. Caddy used GOMAXPROCS=1 and a 32 MiB Go soft
memory target; the whole unit's hard limit remained 192 MiB. No cap was
automatically expanded. Download/setup outside the unit and host-side
SSH/Python monitoring are not included in workload cgroup figures.
No memory.events sampling or Relay forwarding benchmark is claimed here.

## What the three tests actually checked

1. Real generated login/workspace pages and their referenced identity scripts
   were accessible through certificate-verified HTTPS; unapproved scripts,
   internal source files and wrong surface/method paths were rejected.
2. Actual login issued the secure scoped session cookie. Origin/CSRF checks,
   current workspace membership, cross-workspace denial and logout/session
   invalidation were verified through ingress.
3. Actual WSS joined the scoped workspace and broadcast a test
   message with authenticated identity rather than its forged sender field.
   Cross-workspace WSS access was denied; unauthenticated node/MCP endpoints
   and the tested cross-surface/admin paths remained restricted.

The third case checked unauthenticated REST/MCP boundary responses, not a
successful Muse/dots task. The fixture disabled model providers, background
inference and events. Real backend requests were zero. This does not prove
streaming inference, paid provider usage or native Agent plan-and-act.

## TLS tooling provenance

No usable Caddy binary was found in PATH or the targeted standard/candidate
locations. OpenSSL and Python 3 were present; the fixture's PYTHON variable was
set to python3, without a system Python alias or global installation.

The [official Caddy v2.11.7 release](https://github.com/caddyserver/caddy/releases/tag/v2.11.7)
Linux amd64 asset was fetched into the owned private test directory. Its
18,113,754-byte archive was compared with the GitHub release asset's SHA-256
digest before extracting only its regular `caddy` member. No global binary
or HTTPS service was installed; no separate publisher-signature verification
is claimed. Archive SHA-256:

`727b91701a392de6ebc5027509f548bf39979e5216340d0faed8fa5e69c84f8b`

Binary SHA-256:

`678ade3bfc088749c81a681adc603333ee0bb023b6a6cfe3c0f58bef8ff854e9`

The fixture generated its own short-lived certificate for fixture.invalid
hosts and explicitly trusted that certificate while retaining hostname/TLS
verification. It did not request an ACME certificate, change DNS or bind
public 443. Test certificate/key data stayed inside disposable fixture paths
and was cleaned up; only top-level JSON records were transferred for evidence.

## Independent cleanup and co-host proof

Independent postflight at **2026-10-11 18:57:33 Asia/Shanghai** confirmed:

- Test unit not-found/inactive with MainPID 0.
- The owned packaged-ingress fixture directory had no remaining fixtures.
- Original LACK PID 594652 and Tailscale PID 859 were unchanged, both
  active/running with zero recorded restarts.
- Original unit-file hashes were unchanged.
- LACK health returned 200 and Relay UDP 40000 listener remained present.
- TCP 443 was still unbound.

These are continuity checks, not Relay traffic/latency/loss measurements.
The original LACK and Tailscale services were not stopped, restarted or
reconfigured. The separate approved publication window remains unconsumed.

## Canonical reports

The private host/native reports were transferred over pinned SSH. Downloaded
hashes matched the independently reported server values. The tracked
[independent postflight JSON](fixtures/2026-10-11-combined-tls-postflight-927d401c.json)
is byte-identical to that transferred original:

`b289475a5ec890e8d758781c5d824d275bfd9c5b469e7eb9af1fa3c6a50ef668`

Host report SHA-256:

`1a086a335408793b8411fc03a80d17447d36b13a21595106fc9b9e04d431d9e5`

Native trial report SHA-256:

`7ddeada44880efce3daa9c5b5c983ab8d1db48700eb92a5ed37c87e73ceefeca`

[Executed controller](fixtures/2026-10-11-combined-tls-controller-927d401c.py.txt),
retained for audit only:

`f7d7ccf83556f90fb5f552d400e58e471241126b12db65bdcb6dc3ac21bd89bb`

Its run identity is already consumed; it is not an in-place rerun command.

## Remaining full-delivery gates

Real VPS-to-1Cat reachability/generation, native Muse/dots computer execution,
formal owner/old-data attribution, production domain TLS/login and sustained
combined real-model use remain unaccepted. The generic model-node bridge is
not implemented merely by these ingress tests. Production resource settings
must not be inferred from a 47.6-second synthetic fixture run.

The full goal remains incomplete. Do not reuse Open WebUI credentials,
reconfigure Relay, open a public model API, or count fixture accounts as the
formal ChunLACK/chunlack-owner account.
