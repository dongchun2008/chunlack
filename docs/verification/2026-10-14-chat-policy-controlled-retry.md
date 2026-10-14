# Controlled chat-policy retry and real browser acceptance

Date: 2026-10-14. Scope: deployment wrapper dependency handling and the already-tested candidate backend. Outcome: controlled update succeeded; one real browser chat round passed.

## Authorization and repair

The user explicitly approved correcting service dependency handling, adding tests and retrying the controlled update. A fresh read-only preflight confirmed the restored application and HTTPS were active, health was 200, and HTTPS still required the application service.

The wrapper now separates the unchanged protected services (old LACK and Relay) from the two intentionally managed services (candidate application and HTTPS). Both update and rollback use this order:

1. Start the application and check its loopback HTTP health.
2. Start the existing HTTPS service only after application readiness.
3. Check HTTPS health with certificate verification enabled.

All start commands and readiness probes in each startup attempt share one 20-second deadline. Rollback receives its own bounded startup attempt. Postflight still checks protected-service identity/state, Relay listeners, health, fixed file hashes, resource limits and restart counts. The existing systemd dependency was not weakened or changed.

## Tests executed this round

- Four existing no-network deadline tests passed again.
- Five new transaction tests execute the wrapper's actual update/exception flow against simulated systemd and network boundaries, with real temporary incoming/backup files. They cover successful update, application health timeout, HTTPS health timeout, HTTPS start failure and application start-command timeout followed by recovery.
- Before the repair, all five transaction tests failed because HTTPS was not restored; after repair, all five passed.
- One additional readiness-unavailable check passed. It tests bounded readiness failure, not a complete permanently failing rollback transaction.
- Total this round: 10 tests passed, zero failures. These simulations do not substitute for the live postflight below.

Product source was not changed in this round. The earlier 600/600 full-suite and 31/31 Linux results remain historical evidence for the exact guarded source, not newly rerun results.

## Live controlled update

Attempt: `chat-policy-8bd52e9b8f`.

- Guarded source SHA-256: `ea5db9cdb429f71f04d822ae01235be7d0eb044d3a3f9e5ff1088893de587e22`.
- Old server SHA-256: `61941931e83f4835708cf5224746bbd235c5b7c14ba178b86c7c96293c85d7a7`.
- Active updated server SHA-256: `7fec811f31053a8307e0c4b23f2990fbc6fda8b05aa02f662c3902cf3de3f059`.
- An exclusive private backup was saved before atomic replacement. Original owner/group/mode were preserved.
- Application plus HTTPS startup/readiness completed in 3.732 seconds.
- Controller exited 0 and reported `updated=true`, `rolledBack=false`, `phase=complete`, with no errors.
- Old LACK PID 594652 and Relay PID 859 remained unchanged, active, with restart count 0. Relay UDP listeners matched before/after. This is not a traffic-quality benchmark.
- Candidate PID changed from 645635 to 646156; HTTPS PID changed from 645897 to 646181, as expected. Both were active with restart count 0.
- Candidate limits remained 448 MiB / 50% CPU; HTTPS limits remained 128 MiB / 10% CPU.
- Old and public-hostname HTTPS health returned 200. Runtime configuration, credential-file and frontend hashes were unchanged. No service unit, ingress configuration or writer lock was edited.

## Real browser check

At 13:39 Asia/Shanghai, the existing authenticated `chunlack-owner` session reloaded the public ChunLACK page and reconnected. The existing `1Cat` acceptance Agent received one explicit mention requesting only `CHUNLACK_SINGLE_OK_20261014_B8F`, without tools, delegation, reflection or follow-up.

The browser displayed exactly that reply. An additional 30-second observation wait produced no new message, and a subsequent reload showed the request and the same single reply persisted. The page was connected. This verifies the observed single-round UI behavior through the configured direct model; it does not independently count every backend request or establish indefinite absence of delayed callbacks.

The unchanged historical failed acceptance messages remain visible above the new successful round; they were not deleted or reclassified as successful.

## Private evidence and reproducibility

Private artifacts remain under `.superpowers/sdd/2026-10-13-release-preparation/` and are intentionally not committed. The report and browser screenshot are under the attempt subdirectory. Wrapper and test files are operational artifacts for this exact guarded deployment, not generic scripts to rerun against a changed service baseline.

| Artifact | SHA-256 |
| --- | --- |
| `deploy-chat-policy.py` | `cc4f3e482bd2a753f87fd9829a38050602b71d292887db0ce1819b8617a4c7ea` |
| `test-chat-policy-services.py` | `19bc552e6ca2ddf8b7c0542bc14b44b66f8acb816090910cae576ddae36f9a8d` |
| `test-chat-policy-deadline.py` | `2afecdcf031b5fe50b7a0e631fb906f9eb75ce5b62fe7d9117b0269863b4c559` |
| `chat-policy-8bd52e9b8f/report.json` | `db9c8a7b6405ef7580669b47db8a0054a4630ea37291bfc3b8623b440c9a63e3` |

## Remaining delivery gates

This closes the dependency-restoration retry and the bounded single-reply browser check. Native Muse/dots cloud-computer execution, Agent OAuth, multi-user isolation in real use, five-Agent whole-round sustained load, full application recovery and Relay traffic-quality evidence remain separate outstanding gates. Overall platform delivery is not claimed.
