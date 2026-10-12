# Candidate regression checkpoint after workspace startup repair

Status: current Windows full regression and the stated Linux scopes passed.
This checkpoint permits synchronizing the tested development candidate; it
does not declare production delivery or authorize a production cutover.

## Latest approved repair

Only the workspace-runtime test fixture changed in this increment. The
startup wait uses a monotonic 20000 ms deadline instead of approximately
100 sleeps of 50 ms. It also stops waiting if the owned child exits by signal.
The complete test deadline is 60000 ms. A bounded diagnostic reports elapsed
startup time and readiness, without printing credentials or private content.
All existing human-identity, viewer, workspace-isolation, model-authorization,
node-capacity, session-revocation and unchanged-global-config assertions remain.
Product startup behavior and VPS resource limits did not change.

## Fresh acceptance evidence

- Windows complete suite: 552 tests, 552 pass, zero failures, cancellations,
  skips or TODOs; exit zero; duration 472350.991 ms. The real Caddy fixture was
  enabled. Workspace child startup took 2164 ms in this run.
- Standalone smoke: exit zero; real HTTP/WebSocket, two mock model backends in
  one channel, SQLite restart persistence, private bind and configuration
  preservation. Mock generation is not a real provider acceptance result.
- Linux supplemental workspace-runtime test: 1/1 passed, exit zero, duration
  26005.56599 ms. Actual child startup took 7545 ms, exceeding the old roughly
  five-second wait but remaining within the new bound. Batch identifier:
  native-candidate-a8222c859616.
- The immediately preceding Linux candidate batch b53d9fc78bc4 passed all 136
  selected cases across 16 groups, including real TLS, dependency security,
  OIDC/session, browser, lifecycle, migration and snapshot/restore regressions.
  Its source predates only the supplemental workspace test change above.
  These are separate runs, not a claim that all 552 tests ran on Linux.

Native execution retained non-root identity, private networking, PrivateTmp,
read-only source/dependency mappings, CPUQuota 10%, MemoryHigh 160 MiB,
MemoryMax 192 MiB, no swap and the existing bounded unit lifetime. The
supplemental runner's initial/final baselines matched: original LACK and
Tailscale service states and PIDs, LACK health 200, Relay UDP 40000 listeners
present and no host TCP 443 listener. Actual Relay forwarding quality was not
measured. No production service restart or configuration change occurred.

## Development candidate included in this checkpoint

Previously local, approved candidate changes can now be synchronized on the
existing cloud-agent-pilot-foundation branch:

- Named simpleGit factory import and pinned simple-git 4.0.2, proxy-addr 2.0.8,
  and brace-expansion 1.x override 1.1.21 with the matching lockfile.
- Seven dependency/security regressions, including real Git workflow and
  rejection of dangerous inherited/configuration execution paths. Tests isolate
  their Git environment; real user Git configuration is not rewritten.
- Browser startup/early-STOP fixture accounting, low-CPU login-only budget,
  and bounded cleanup tests for owned public-runtime child processes.
- Private snapshot-copy permission fixture, retaining rejection of permissive
  POSIX directories and existing archive-preservation assertions.
- The workspace test startup deadline and timing evidence described above.

The certificate-budget test change was already synchronized at 33a12b7.
Production dependency directories, real model configuration, Ollama support,
Provider-neutral routing and product permission policy remain unchanged by
this test-budget increment. Synchronizing a candidate is not deploying it.

## Failed history remains evidence

The preceding Windows run was 551/552, with workspace startup failure before
business assertions. Its unchanged five-test diagnostic rerun passed. This
new complete run follows the explicit authorized fixture repair; it does not
erase the failure or prove that host CPU load was its sole cause. Earlier
certificate, namespace and reporter failures remain in their original records.

## Evidence hashes

Local ignored root: .superpowers/sdd/2026-10-12-dependency-hardening.

| Artifact | SHA-256 |
| --- | --- |
| full-suite-workspace-startup-fixed.tap | 73ee9ae5d9982d9018600643b78f9c8bfc881695bee9b28d210fe54dcc5630e9 |
| smoke-workspace-startup-fixed.log | f11986f4ca6071992a388765ca44f0a4d23d1332a8d0f6a1603c5cd04cec79cb |
| native-candidate-a8222c859616/inputs.json | d9c90b81913e856c753425b062ddbc782c993edf97e67ba3fc431f652fcd21e4 |
| native-candidate-a8222c859616/result.json | 0168a03d66fd23687cc95493d062e8fb4fa3ae9b7cd14a949beb3b6dceb77918 |
| native workspace-runtime TAP | 37f468a17be61167df46c29a739c388c6d293978c050d98804302b6ba785915b |

The input manifest records the base revision and immutable candidate overlays.
Raw runtime files, keys, backups, databases and test certificates are not
included in Git synchronization.

## Still not delivered

Pocket ID replacement credentials and real human login remain pending. Formal
production ownership, controlled public HTTPS publication, actual Muse Laozhen
and dots Xuanji own-computer execution with matching evidence, final direct
provider acceptance and sustained functional co-host checks remain distinct
gates. Earlier backup and isolated restoration evidence is preserved; it is not
permission to switch production or to reuse a consumed maintenance window.
