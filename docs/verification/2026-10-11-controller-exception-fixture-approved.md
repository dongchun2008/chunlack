# Controller exception fixture: approved correction and verification

Date: 2026-10-11. The operator explicitly approved filling the missing fixture
field and rerunning exception checks. No VPS operation was performed.

## Correction and actual test

The temporary fake owner previously omitted `commit`, while the actual
controller includes that field in its host report. Both fake owner sources now
carry the same explicit fixture-only `commit`. The owner-mismatch case still
changes the nonce, so it tests ownership failure rather than an incomplete
fixture schema. The production controller was not changed for this correction.

Reproducible local fixture: `tests/manual/actual-runtime-controller-exceptions.py`.
It parses the archived executed r1 controller and runs its actual launch-to-exit
control-flow tail with fake filesystem, unit, clock and baseline collaborators.
It does not execute systemd commands or access any private credential files.

Command from repository root:

```powershell
python tests/manual/actual-runtime-controller-exceptions.py docs/verification/fixtures/2026-10-11-actual-runtime-controller-r1.py.txt
```

Observed exit 0, six passed, zero failed:

1. Normal completion: no errors and success exit.
2. Launch observation exception: owned unit stopped, failure report and exit 1.
3. Poll exception: owned unit stopped, failure report and exit 1.
4. Malformed native JSON: owned unit stopped, failure report and exit 1.
5. Host-report write exception: cleanup already completed, emitted error and
   exit 1 rather than success; no fake host file was written.
6. Changed owner: fails closed without stopping or writing into the changed
   ownership context.

All five ownership-valid cases independently assert the exact action order:
`stop_owned`, then `write_host_report`. Each fake systemctl action is restricted
to the one fixture unit; other actions fail the fixture.

## Evidence limits and previous failure

The earlier `KeyError: commit` failure remains documented in
`2026-10-11-actual-runtime-business-approved.md`. It was not a native VPS failure.
This explicit, approved rerun supersedes its pending local fixture checks.

This verifies controller control flow with injected collaborator failures. It
does not prove actual OS/cgroup OOM, timeout signals, disk exhaustion, corrupted
filesystem recovery, transient-unit ownership enforcement by systemd, or Relay
throughput/latency. The fake baseline is constant, not a real-service health
measurement. Native normal-path business and stopped-unit evidence remain the
separate previous VPS result, not a new test run.

No production code/configuration, service, resource limit, credential, real user,
public listener or external Agent connection changed. Public HTTPS, real model
routing, live ownership/cutover and true Muse/dots execution still require their
own accepted evidence; the whole delivery goal is not complete.
