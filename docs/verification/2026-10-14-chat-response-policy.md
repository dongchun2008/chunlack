# Chat response policy and workflow lifecycle verification

Date: 2026-10-14

## Approved scope

- Ordinary chat does not automatically append reflection or schedule proactive follow-up.
- Explicit Agent mentions select only the named, authorized Agents. Unaddressed channel collaboration and explicitly started workflows remain supported.
- Resolve the longest complete display name within the current workspace before checking channel eligibility. Unknown, unavailable or ambiguous names fail closed without channel fan-out.
- Normalize only the exact known legacy base prompt when generating an ordinary reply. Preserve custom suffixes and do not rewrite stored Agent data or custom prompts resembling only part of the base prompt.
- Bind delayed proactive follow-up to a workflow generation. Stop/restart invalidates prior callbacks and discards results returned after invalidation.
- Initialize the generation state Map once per runtime, preserving both legacy single-user behavior and multi-workspace isolation.

Product file: `lack.py`.
Regression file: `tests/chat-response-policy.test.cjs`.

## Evidence recorded so far

- Initial policy regression: 20/20 passed. The earlier full suite passed 589/589, but subsequent independent review found uncovered boundaries. That earlier pass is not acceptance of the final patch.
- Boundary regressions reproduced six failures before correction; the corrected version passed 28/28 locally and in Linux isolation.
- Independent review then found a legacy-mode regression: repeated `workspaceMap()` construction returned a new Map on every access. Three additional regressions reproduced this failure before the approved correction.
- The final focused suite passed 31/31, zero failed, cancelled, skipped or todo, exit 0; duration 7479.7758 ms.
- Tests now extract the actual embedded `workspaceMap()` implementation and generation-state initializer, rather than replacing the former with a fixed-Map stub. The fixtures use synthetic model replies; these are not real-provider acceptance tests.
- Final Linux isolation passed 31/31, zero failed, cancelled, skipped or todo, exit 0; duration 9401.349776 ms. The run retained 192 MiB memory / 10% CPU / zero swap / private-network restrictions. Peak memory was 58,417,152 bytes. Protected service state was unchanged.
- Final independent static review reported no additional findings in the approved product changes. The reviewer did not run tests or access the VPS.
- Final full suite passed 600/600, zero failed, cancelled, skipped or todo, exit 0; duration 719328.6755 ms. HTTPS fixtures used the existing pinned Caddy binary rather than skipping those tests.

Final focused-test source SHA-256:
`ea5db9cdb429f71f04d822ae01235be7d0eb044d3a3f9e5ff1088893de587e22`

Private local evidence, intentionally excluded from Git:

- `.superpowers/sdd/2026-10-13-release-preparation/chat-policy-linux-1791935467999901300.json`
- `.superpowers/sdd/2026-10-13-release-preparation/chat-response-final-full-suite-20261014.tap`

The intermediate `chat-response-boundaries-full-suite-20261014.tap` run was stopped once its version was superseded by the approved legacy-mode correction. Its incomplete result is not a full-suite pass.

## Candidate update and bounded real acceptance

The first update exposed a dependency-restoration omission and was restored to the old code and HTTPS health; see [the historical recovery record](2026-10-14-chat-policy-update-recovery.md).

After explicit approval, the wrapper was corrected to establish application readiness before restoring HTTPS, using the same sequence for rollback. Ten wrapper checks passed. The controlled retry succeeded in 3.732 seconds with the tested backend active, HTTPS health 200, and protected-service state, fixed file hashes and resource limits unchanged.

One real browser request through the existing direct 1Cat acceptance Agent produced exactly `CHUNLACK_SINGLE_OK_20261014_B8F`. An additional 30-second wait showed no extra reply; refreshing retained the same request and reply. This is bounded single-round evidence, not an unlimited-duration or backend-call-count assertion.

No credentials, old LACK service or Tailscale Relay configuration were changed. Full details and evidence hashes: [controlled retry and browser acceptance](2026-10-14-chat-policy-controlled-retry.md).

## Delivery boundary

These results do not constitute acceptance of native Muse or dots cloud-computer execution, Agent OAuth integration, multi-user end-to-end collaboration or the overall platform delivery. Those gates require separate evidence. Ollama and provider-neutral routing remain in place.
