# Candidate chat-policy update and recovery

Date: 2026-10-14. Outcome: update not accepted; old candidate code and HTTPS service restored.

## Approved work and tests

The user approved tightening the readiness deadline and continuing a controlled candidate update. Product source SHA-256 remained:
`ea5db9cdb429f71f04d822ae01235be7d0eb044d3a3f9e5ff1088893de587e22`

No product changes followed the existing 600/600 full-suite and 31/31 Linux results. Four no-network tests extracted the actual remote readiness functions from the deployment wrapper. Three reproduced the deadline failure before correction; all four passed after correction. They cover successful readiness, the final curl retry's remaining budget, a late status response and the final status probe's remaining budget. They do not test systemd dependency behavior.

## Attempt

Attempt ID: `chat-policy-17299969e7`.

- Preflight found old LACK, Relay, candidate application and HTTPS active; old and candidate health returned 200.
- The existing server file matched its expected hash, and an exclusive private backup was created before replacement.
- New materialized server SHA-256: `7fec811f31053a8307e0c4b23f2990fbc6fda8b05aa02f662c3902cf3de3f059`.
- HTTPS readiness did not succeed within the shared deadline. The wrapper restored the old server file and started the application, but its rollback HTTPS check also failed.
- The wrapper's report therefore records `updated=false` and `rolledBack=false`; that report is preserved unchanged and does not include the subsequent recovery below.

## Diagnosis and recovery

Read-only inspection found the application running with internal HTTP health 200, two `PUBLIC_RUNTIME_READY` log markers from the starts, and a writer lock owned by the live application process. The old server SHA-256 had been restored:
`61941931e83f4835708cf5224746bbd235c5b7c14ba178b86c7c96293c85d7a7`

The HTTPS service was inactive. Its existing `Requires` dependency includes the candidate application service. Stopping the application also stopped HTTPS; the new wrapper had incorrectly assumed the HTTPS process would stay running and omitted restoring it. This is a deployment-wrapper omission, not evidence that the product patch failed to start.

Recovery was limited to starting the existing HTTPS service after checking the restored old code and internal application health. The public-hostname HTTPS health check then returned 200 with certificate verification enabled. All four services were active.

- Old LACK PID remained 594652, restart count 0.
- Relay PID remained 859, restart count 0.
- Restored candidate application PID was 645635, restart count 0.
- Restored HTTPS PID was 645897, restart count 0.
- No service unit, ingress configuration, credential, writer lock or protected-service configuration was edited. The lock was not removed manually.

Private evidence is kept under `.superpowers/sdd/2026-10-13-release-preparation/chat-policy-17299969e7/`; the original report and backup are not published to GitHub. This document records the separately confirmed recovery after the wrapper report.

## Required before retry

The user has been asked to approve correcting the wrapper's dependency handling: make the candidate application ready before restoring HTTPS, handle the same order on rollback, and test successful update, timeout and rollback paths. Keep the existing unit dependency, TLS configuration, resource limits and credential separation intact. Do not require the HTTPS PID to remain unchanged across an application stop that legitimately stops it.

No second update attempt or real-model browser acceptance was performed in this round. Successful product tests and successful restoration do not constitute a successful release or overall platform delivery.
