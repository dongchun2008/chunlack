# Native runtime cold-start retest (2026-10-12)

## Scope and outcome

The user authorized the test-only low-CPU adjustment and isolated retest.
Source archive: `36ec636aca3ddcbad548bd9564f0c2fa5cc42c86`.
Product behavior and production timeout settings were not changed.

`tests/public-runtime.test.cjs`: **17 passed, 0 failed, 0 cancelled, 0 skipped**
in 104101.59582 ms on native Linux. The previous two cold-start timeout
failures are superseded by this actual complete runtime-group retest,
not by the earlier import-timing diagnostic.

The explicit `CHUNLACK_TEST_LOW_CPU=1` test flag changes only two cold-start
child waits from 5000 to 12000 ms. Their enclosing test deadlines become
30000 and 40000 ms. Without that exact flag, the original 5000 ms child
waits and 15000/20000 ms enclosing deadlines remain unchanged. No business
assertions were removed or bypassed.

A local run of the same group with the flag also passed 17/17 before the
native run. It is not evidence of the server's CPU-quota behavior; the
native result below supplies that evidence.

## Isolation and co-host protection

- Dedicated root: `/var/tmp/chunlack-runtime-36ec636-dafd52e7`.
- Owned transient unit: `chunlack-runtime-dafd52e7-1.service`.
- User: `nobody`; private network, private temporary directory and devices.
- CPU quota: 10%; memory high: 160 MiB; hard memory limit: 192 MiB.
- Swap: 0; task limit: 32; unit runtime ceiling: 240 seconds.
- Recorded systemd memory peak: 155213824 bytes (about 148 MiB).
- Only existing production dependencies were mapped read-only; separate
  pure-JavaScript OIDC dependencies were copied into the owned test root.
- Production data/configuration were not mounted for the tests. Test
  writes were confined to owned scratch and fixture directories.
- No global software installation, production deployment, public port
  activation or production dependency update occurred.

The baseline and postflight records match byte-for-byte: LACK and
Tailscale service state/PIDs/unit hashes, LACK health, Relay listener,
443 listener state, and the Node binary/version were unchanged.
The test unit was stopped after its terminal successful result; the
recorded active owned unit is null.

## Evidence

Local evidence directory (ignored, not shipped):
`.superpowers/sdd/2026-10-12-oidc-native/native-runtime-lowcpu-36ec636-dafd52e7/`.

| File | SHA-256 |
| --- | --- |
| inputs.json | `170fb24542b2bad7f4e9ce6cad04e47e3628c414c5c6e4b78458be888e699896` |
| result.json | `cb80c7e073e6c1cea2c731ba2481f1ae0f721cb3192a4340141daae9700f4c31` |
| public-runtime.tap | `c5ae9e6128a20aeb47e1d040dc8baaa5e0197a5d2ce335b01190fe85a87818c4` |
| baseline.json / postflight.json | `2a9eba13dcf362333002ffb3b9a8c2e80983c8430c36994e1e66baae96c9581e` |

## Remaining delivery gates

This closes the runtime cold-start retest only. Dependency security
upgrades are a separate work item and are not included in this source
archive or native result. Pocket ID client creation and real login,
Agent authorization, Muse/dots native execution and production release
acceptance remain incomplete. Existing storage/OIDC/HTTPS evidence keeps
its original scope and source revision.
