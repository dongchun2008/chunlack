# Startup diagnostic and post-repair full validation

Source revision: `edbd9f72958c3fe47a9e12f04c82b3b0155f0d96`.
Status: local full regression passed; production and native vendor delivery
are not accepted by these results.

This supplements, rather than replaces, the failed-run evidence in
`2026-10-14-agent-resource-deadline-checkpoint.md`.

## Authorized diagnostic command correction

The first diagnostic command failed before tests started because the quoted
Windows preload path in NODE_OPTIONS lost its backslashes during parsing.
After explicit user approval, only the command's preload path was normalized
to forward slashes. No product code, assertions, startup budgets or resource
limits were changed in this follow-up.

The ignored diagnostic preload runs only in the two known synthetic runtime
child shapes. It records module names/load durations and readiness markers,
not request bodies, tokens, credentials or application contents. Each owned
trace is bounded to 2 MiB. Instrumentation can affect timing; this is a
diagnostic sample, not an uninstrumented performance benchmark.

Diagnostic results: 2/2 passed, exit 0, no skips/cancellations, 38866.683 ms.
The workspace runtime's existing spawn-to-ready measurement was 3985 ms
against its unchanged 20000 ms startup limit.

Evidence directory:
`.superpowers/sdd/2026-10-14-startup-diagnostic/run-20261014-233004/`.

| Artifact | SHA-256 |
| --- | --- |
| tests.tap | a3448d397bf5a785bf436d360d061f967008ae0946ea0f9bcf9eb16f72b5239f |
| startup-19480.jsonl | 7faef1c1e3513af925efdcb01c15ca45b9b504a5aa6c76bc93d15cf7962dcee7 |
| startup-24728.jsonl | 9cb28619a786da017e83dbc9cc10cc40aa3c7588eec9c43304a2dfb9a7fb5191 |
| startup-25920.jsonl | 5aaeebb1266bb085cc1203edd23f974264c8a2276815b82b51b1aa97865f978a |
| startup-26832.jsonl | 5965242f62417380183a9cd7e1009ef01a29bb064b79f1d5569b30eba5cce43e |

All four runtime traces reached their expected readiness markers. Public
runtime readiness was 3711.951 and 3888.903 ms from preload initialization;
workspace readiness was 3700.544 ms and legacy readiness 5063.409 ms from
preload initialization. These are not the same measurement boundary as the
workspace test's spawn-to-ready figure.

Large synchronous import durations included Cheerio, Undici and ESLint.
Module durations are inclusive and nested; they must not be summed as
independent contributions. No unfinished module load was recorded. These
successful samples do not establish why earlier full runs missed readiness.
The workspace child was terminated by the original test cleanup, which waits
for its process exit; lack of a Node exit-handler trace is not itself proof
of a retained process.

## Fresh full run without diagnostic preload

The subsequent full run explicitly rejected an inherited NODE_OPTIONS or
CHUNLACK_STARTUP_TRACE_DIR setting. It used the unchanged Node test flags,
configured Python and verified existing portable Caddy 2.11.7 binary. No
product or test source changed during the run.

```powershell
node --test --test-reporter=tap --test-concurrency=1 --test-timeout=90000 tests/*.test.cjs
```

- Total: 775.
- Passed: 775.
- Failed, skipped, cancelled and todo: 0 each.
- Exit code: 0.
- Duration: 602867.295 ms.
- Report: `.superpowers/sdd/2026-10-13-release-preparation/agent-resource-deadline-final-20261014-233217.tap`.
- SHA-256: `9dfa9d1ad98af17030ca4c7ccd5ed1460ddc97fbdcb66611911a9d33dae2f52c`.

This is a complete local run after the single-clock task deadline repair,
including the two new advancing-clock regressions. It is not a sum of
separate partial runs. Earlier 772/773 and 771/773 failures remain recorded;
the intermittent startup-timeout root cause is still unconfirmed.

## Remaining delivery gates

No VPS, production LACK, Tailscale Relay, Pocket ID configuration, live
credential, public listener or DNS change was performed in this follow-up.
The prior native Linux evidence applies to its recorded revisions only.

Next gates remain current-revision constrained native validation, production
assembly of Agent authority with explicit trusted grant selection, dedicated
Pocket ID API/client enrollment, precise HTTPS discovery exposure and genuine
Muse Laozhen/dots Xuanji task-to-computer-to-evidence round trips. Standard
metadata, mock tokens and a passing local suite do not prove those integrations
or complete platform delivery.
