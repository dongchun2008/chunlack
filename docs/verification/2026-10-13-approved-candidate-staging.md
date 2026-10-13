# Approved isolated candidate staging, 2026-10-13

Current status: the approved metadata repair, isolated owner-data migration,
completed preparation-unit cleanup and replacement activation-state gate passed.
Installation prepared the dedicated users/directories, then stopped at an
overly broad dependency-symlink check. New services are not installed or started.
The public candidate is not active, and real Pocket ID login is not accepted.
Earlier interruption details below are retained as historical evidence.

## Activation-state repair and dependency-link finding

The operator approved correcting the activation condition. The installer now
verifies the recorded successful terminal/release evidence, the offline migration
manifest and operational configuration hashes, actual runtime schema checks, the
exact owner/workspace and scoped counts of 13 messages and one Agent. It requires
the released units to be inactive with zero main/control PIDs instead of still
being exited. These checks and the unchanged full resource preflight passed.
No initialization or password generation was repeated.

Installation then created only the two approved system users, the empty dedicated
configuration directory, and the empty dedicated HTTPS state directory. The new
users have nologin shells. The original service users and directories were not
changed. It stopped before recursive code/data ownership changes, credential
upload, Caddyfile installation, service-unit installation or service startup.

The stop was caused by the installer's unconditional link prohibition over both
code dependencies and data. A bounded read-only inventory found ten links, all
under the candidate node_modules/.bin and resolving to files within the same
candidate node_modules: acorn, eslint, js-yaml, mime, node-which, prebuild-install,
rc, rimraf, semver and uuid. No link was found in the isolated data root; neither
root itself resolves through a link. This finding does not justify allowing
arbitrary code/data symlinks or relaxing source/migration path checks.

The proposed narrow correction is to verify each npm entry against its exact
declared package bin target and confined destination, preserve legitimate
executable entry permissions, and continue from these specifically owned partial
installation artifacts after rechecking their identities, permissions and empty
state. Unknown, broken, escaping or data-directory links remain denied. This
additional correction awaits approval. Existing runtime.env and service units
must not be overwritten, nor system users silently recreated or adopted.

Observed partial state: chunlack-public UID/GID 996/987 and chunlack-https 995/986;
/etc/chunlack-public is 0750 root:chunlack-https, /var/lib/chunlack-https is 0700
chunlack-https:chunlack-https. Candidate code/data roots remain 0700 root:root.
runtime.env and Caddyfile are absent. Postflight old LACK health was 200; LACK
and Tailscale PID/restart counters remained unchanged. No public activation or
real OIDC login has occurred. Local bounded link evidence is retained in the
ignored release-preparation directory.

## Completed-unit cleanup follow-up

Following the operator's instruction to continue, the two known transient units
were checked through systemd D-Bus. Both ExecStop and ExecStopPost explicitly
returned zero-length arrays; absent systemctl output was not accepted as proof.
Exact unit identities, transient fragment paths, zero main/control PIDs and
successful exit status were checked, preserved locally and rechecked immediately
before releasing only those two units. Existing LACK/Relay PID, restart and health
output matched before and after. Both owned units subsequently became inactive,
dead and not-found; their logs and local evidence were retained.

The unchanged full public preflight then passed. Installation nevertheless stopped
before its first mutation: activate-approved-services.py still requires the
data-initialization unit to be exited with status zero, although the preceding
approved cleanup necessarily releases that transient unit. The stale state gate
must instead consume the saved terminal proof and verify the prepared data and
release evidence; it must not rerun initialization, recreate an owner, weaken
the resource preflight or fabricate a successful live unit state.

This additional orchestration correction awaits operator approval. Postflight
confirmed both new service users, public unit files and /etc/chunlack-public
remain absent; 443 is unoccupied. Old LACK still returned health 200 with the
same PID/restart count, and the Relay PID/restart count was unchanged.

## Approved repair and migration follow-up

The operator authorized correcting the upload and continuing. The existing
isolated identity database was opened through the bounded source-copy reader;
exactly one user and one workspace were found, with the approved names and a
valid active owner membership. Only those nonsecret identifiers were recovered.
The already-created, empty metadata file was opened without following links,
its inode/device and empty size checked, set to 0600, written and fsynced. Its
saved JSON and permissions were then verified. No owner or password was recreated.

The existing frozen snapshot was verified and used to reconstruct a private
source copy. The reviewed migration produced a separate candidate data root and
passed its offline verification: 13 messages and one Agent were converted. The
original snapshot verification result was unchanged. The candidate configuration
was then recorded separately for the approved origins and ports; real inference
remains disabled and no Pocket ID subject has been bound. migrationReady is true
only for this verified offline conversion; restoreReady remains false.

The owned data-initialization unit exited successfully under 192 MiB, 50% CPU,
no swap and a 240-second limit. Its MemoryPeak was unavailable, not zero. Before
public activation, the full preflight correctly blocked on two retained
active/exited preparation units lacking live process resource evidence:

- chunlack-public-data-init-20261013.service
- chunlack-public-dependencies-20261013.service

Both have MainPID=0, ControlPID=0, Result=success, ExecMainStatus=0 and Transient=yes.
A proposed evidence-preserving stop of only these completed, owned units did not
execute: the new controller indexed ExecStop, but systemctl omitted that empty
property. It raised KeyError before the first stop. The proposed narrow repair is
to request complete property output, require explicit empty ExecStop/ExecStopPost
and the other ownership/terminal checks, retain the evidence, and only then stop
these two completed units and repeat the unchanged full preflight. This repair
awaits approval; no gate is bypassed and no product preflight is weakened.

Postflight: old LACK health 200, PID 594652 / NRestarts 0; Tailscale PID 859 /
NRestarts 0 with UDP 40000 listeners. TCP 443 remains free. No public service unit
or /etc/chunlack-public/runtime.env has been installed, and no HTTPS activation,
certificate request, external identity binding or production data cutover occurred.

## Authorization and boundaries

The operator approved both the independent HTTPS candidate and initialization
of ChunLACK / chunlack-owner. Only the new candidate may use TCP 443, with the
existing application 448 MiB / 50% CPU and HTTPS 128 MiB / 10% CPU contracts.
This does not authorize stopping old LACK, changing Tailscale Relay, replacing
existing credentials, or switching production data to a copied snapshot.

## Completed evidence

- A fresh full public preflight passed before staging. The new target paths and
  ports 13721, 13722, 13723 and 443 were unused.
- The fixed source revision adce51ce5ed822e20c5b9962f4cfba8c8da31253 and its
  previously materialized runtime were uploaded into /opt/chunlack-public.
  No files under the existing LACK release were changed.
- Independent locked dependencies were installed with npm ci --omit=dev
  --ignore-scripts --no-audit --no-fund. The owned install unit exited with
  status 0 under 192 MiB, 10% CPU, no swap and a 240-second runtime limit.
  Measured peak memory was 168034304 bytes; measured swap peak was zero.
- better-sqlite3 12.11.1 matches the lock and the existing Linux native module.
  A separate copy of that native binary was used, not a writable shared module.
  Both copies have SHA-256
  45cb92a176fb758533db6d9a343acdfc73e4de27ac4c20a0cb2a6fb5be3e84f2.
  The candidate opened an in-memory SQLite database and executed SELECT 1.
- Candidate simple-git is 4.0.2 and openid-client is 6.8.8. The private Caddy
  binary matched the prior verified hash; candidate configuration validation
  exited 0. Validation did not start HTTPS or request a certificate.
- A new random recovery password was saved to the operator-approved private
  local JSON, outside Git. Inheritance was disabled and access restricted to
  the current Windows user and SYSTEM before writing its content. No secret
  value was printed or sent as a process argument.
- The actual accounts.cjs bootstrap completed successfully for chunlack-owner
  and workspace ChunLACK, using protected stdin and an isolated identity source.
  The returned success and local identifiers were parsed and checked. The
  identity source is 110592 bytes with mode 0600. No external identity was bound.

## Exact interruption and pending repair

The new orchestration command then incorrectly referenced SFTPFile.name while
setting permissions on a newly opened owner-result.json. Paramiko does not
provide that attribute. The command failed before writing the nonsecret local
identity identifiers, uploading the data initializer or starting migration.

The resulting metadata file is empty and mode 0644, inside a root-owned 0700
preparation directory. It contains no credential. The initialized identity
database and private recovery file must be retained; do not bootstrap a second
owner or overwrite the password to recover from this orchestration error.

The proposed narrow correction is to use the explicit, fixed remote pathname,
set the empty owned metadata file to 0600, and reconstruct only the approved
owner/workspace identifiers from the isolated identity database after checking
their exact names and owner membership. Permission to make this correction
is requested before continuing.

## Postflight and remaining gates

The old LACK remained active with PID 594652 and NRestarts 0; its health endpoint
returned 200. Tailscale remained active with PID 859, NRestarts 0 and UDP 40000
listeners. These are sampled coexistence checks, not functional Relay traffic
acceptance. TCP 443 remained unoccupied. No new public service units, public
data root or public configuration directory had been created.

Still pending: reviewed isolated data conversion, new service startup and
resource/coexistence checks, valid public TLS, verified Pocket ID subject binding
and browser login/logout, real provider and Muse/dots execution acceptance.
This preparation is not a production cutover or a complete delivery.

Local ignored evidence is under
.superpowers/sdd/2026-10-13-release-preparation/, including the fresh activation
preflight, native dependency/Caddy result and activation-stopped postflight.
Private credentials and runtime data are excluded from this record and Git.

## Independent read-only identity prerequisite

While the upload-command correction awaits approval, the authenticated Pocket
ID administration UI was used to inspect the explicitly selected dongchun
account. Its enabled state and the username on its individual detail page were
confirmed, and that page's user identifier was retained only in local ignored
evidence. No form was submitted, permission changed, secret read or identity
binding written. An administration-page user ID is not yet a verified OIDC
token subject; actual issuer/sub validation and authenticated browser acceptance
remain required before reporting the owner login as usable.

## 2026-10-13 update: candidate active; owner binding completed; acceptance open

This entry supersedes earlier pending activation/link-check notes in this document. It does not declare delivery or a production-data cutover.

- The confined npm-bin exception was applied only to the ten declared package binaries, matching the pinned dependency lock and canonical in-tree targets. Other code links and all data links remain rejected.
- Independent `chunlack-public.service` and `chunlack-https.service` started successfully. App listeners remain on 127.0.0.1 ports 13721/13722/13723; Caddy listens on TCP 443. No port 80, UDP 443, existing DNS, or firewall rules were changed in this step.
- Initial external checks verified both hostnames with normal certificate/hostname verification and TLS 1.3. Human health returned 200, anonymous identity and channels returned 401, and the agents origin root returned 404. These are point-in-time results, not continuous availability evidence.
- The public login page was rendered in the browser, and its SSO link reached the dedicated Pocket ID ChunLACK interaction page.
- Only the two new candidate services were gracefully stopped for identity maintenance. The runtime lock disappeared normally; it was not removed manually. A private SQLite backup was created before binding, using the application account.
- The administratively verified Pocket ID user `dongchun` was explicitly linked by issuer and immutable user ID to the already approved local `chunlack-owner`. The store API confirmed the mapping, and the new services restarted successfully. No email-based, automatic group-based, or arbitrary-user owner grant was added.
- Pocket ID documents `sub` as the immutable user ID: https://pocket-id.org/docs/guides/scopes-and-claims . Administrative mapping is not proof of a successful signed-token exchange; real login remains pending the user's passkey interaction.
- At the latest service observation, the app used 59,936,768 bytes and HTTPS used 13,225,984 bytes. Limits remain app 448 MiB / 50% of one CPU and HTTPS 128 MiB / 10%. Both had zero automatic restarts. These measurements are not a sustained-load acceptance test.
- Protected old LACK remained active at PID 594652 with health 200; Tailscale remained at PID 859 with its existing UDP 40000 listeners. Both restart counters remained zero. This is coexistence sampling, not Relay end-to-end forwarding verification.

### New unresolved acceptance finding

After the candidate restart, the VPS-local hostname/SNI-correct HTTPS check returned 200, but new connections from this Windows host failed during TLS with `SSLEOFError`. A separate browser health navigation reported `ERR_BLOCKED_BY_CLIENT`. The local resolver returned 28.0.36.204 for the human hostname; this observation alone does not establish the root cause. No local proxy, VPN, DNS, certificate-trust or security settings were modified. No TLS validation was disabled.

The attempted eight-case anonymous-boundary batch stopped at its first connection failure; it is NOT an 8/8 pass. Distinguish this current failure from the earlier successful public TLS and browser observations.

### Remaining delivery gates

- Complete the user's Pocket ID passkey interaction and prove the actual callback, owner/workspace session, logout and access isolation.
- Resolve or localize the Windows-to-public-ingress failure and repeat public boundary checks without weakening TLS or client protections.
- Enable and verify boot persistence only as part of an accepted operational configuration; current start success does not prove reboot recovery.
- Connect and accept the direct 1Cat provider separately; no Open WebUI integration or credential reuse is implied.
- Complete real Muse and dots cloud-Agent task execution and evidence return; mock/worker tests do not establish vendor-Agent acceptance.
- Preserve the old deployment, private identity backup, and Relay throughout. Do not claim full delivery yet.

All private credentials, UUID mapping records, recovery files and raw evidence remain outside tracked source. This update changes documentation only, not product code.

## 2026-10-13 update: direct inference path recovered without network changes

- Fresh VPS route inspection showed the historical LAN endpoint was routed over the default Ethernet gateway, not the tailnet; its bounded model-list request failed. The earlier LAN success from Windows must not be treated as current VPS reachability.
- A read-only inventory identified the existing online Linux inference peer. Using that peer's existing Tailscale IPv4 address and port 8080, the VPS retrieved `/v1/models` successfully in 1106 ms.
- One bounded direct `/v1/chat/completions` request returned HTTP 200 in 242 ms, with returned model `qwen38-27b-nvfp4` and nonempty output. Maximum requested output was 32 tokens. These are individual request observations, not capacity measurements.
- This used the direct OpenAI-compatible endpoint: no Open WebUI, credentials, new tunnel, route changes, Tailscale changes, or Relay reconfiguration. The backend engine and physical GPU topology remain unverified.
- The protected LACK and Tailscale PIDs remained 594652 and 859, both active with zero automatic restarts after the probe.
- Private endpoint and raw report are retained in the ignored release-preparation evidence directory as `direct-tailnet-model-*.json`; no endpoint credentials were read or committed.
- The new candidate's model configuration has NOT been switched. The pending real Pocket ID interaction was left intact rather than invalidated by another application restart. Actual provider integration, workspace authorization and Agent execution remain distinct next gates.

The direct-model gate now has a current usable private path. This does not resolve the separate Windows/public-TLS failure or establish completed Pocket ID login, external vendor-Agent execution, boot recovery, or overall delivery.

## 2026-10-13 update: current-source isolated real-provider workflow passed

A fresh disposable packaged-runtime fixture was run from the current worktree using existing Caddy 2.11.7, synthetic human accounts and two synthetic workspaces. The fixture materialized the current application, used actual HTTPS and WSS with its explicitly trusted test certificate and hostname verification, and called the direct inference backend through a loopback-only bounded test guard. No real owner credential, Open WebUI credential, public service, production data, or Relay configuration was used or changed.

Observed terminal exit was 0. The final report recorded exactly four attempted and four successful completions, zero failed or budget-rejected requests, and zero active calls. Each completion was capped at 32 output tokens and a 15-second upstream timeout. The actual provider was `direct-1cat-pilot`, model `qwen38-27b-nvfp4`; four runtime route records had `fallback=false`, `attempt=0`, and durations of 1024, 759, 952 and 762 ms.

The owner accessed the workspace provider view, while the unrelated workspace owner received 404 both before and after restart. The first Agent response included observed real-backend output. After restarting the disposable runtime, its exact message ID and content remained in channel history, and the persisted Agent produced a different second response using two further successful model calls. Both tested local execution scopes settled with no active branches. The fixture and its own sockets/process were closed before the successful terminal result.

The private operator harness and report are under `.superpowers/sdd/2026-10-13-release-preparation/current-provider-acceptance.cjs` and `current-provider-acceptance-*.json`. This is current-source isolated integration evidence, not public deployment acceptance, sustained throughput evidence, interrupted-task recovery, real Pocket ID login, or Muse/dots cloud-computer execution. The publicly running candidate configuration remains unchanged while the user's Pocket ID interaction is pending.

## 2026-10-13 update: Pocket ID scope compatibility fixed locally; publication rolled back

A real Pocket ID callback included a single `scope` query parameter. The OIDC callback's explicit query allowlist did not include it, so the application returned `unauthorized` before attempting the token exchange. A synthetic signed-identity reproducer established the failure: the control callback passed, the otherwise identical scope-bearing callback failed, and duplicate scope was rejected. No real authorization code, cookie or credential was used in that reproducer.

The minimal product change adds `scope` to the accepted callback parameter names. Its value is not consumed as identity, membership or permission data. Duplicate parameters, unknown parameters, browser binding, state/issuer checks, PKCE, nonce, signature, audience, expiry and explicit local identity bindings remain enforced.

Tests now cover normal scope, scope text containing owner/admin without deriving authority, duplicate scope, unknown role parameters, unbound identities and the actual HTTP callback/session path with scope. Fresh results:

- Reproducer and related OIDC regression files: 29/29 pass, zero failure/skip/cancel, exit 0.
- Full Windows suite with existing real Caddy fixture support: 555/555 pass, zero failure/skip/cancel, exit 0; 421917.576 ms.
- Smoke: exit 0; real HTTP/WebSocket, two mock model backends, SQLite restart persistence, private bind and configuration preservation.
- VPS Linux synthetic regression: 3/3 pass, zero failure/skip/cancel, exit 0, Node duration 4896.917665 ms. The transient test was launched with 192 MiB maximum memory, no swap, 10% CPU, 90 seconds maximum runtime, private network and read-only system protection. This was not a live Pocket ID exchange.

The first Linux wrapper failed before any remote file creation because it attempted `open_sftp` on a Paramiko Transport. The user approved correcting only that call; the subsequent isolated run above passed.

### Publication attempt and rollback

The user approved updating only the new candidate service. The operator verified the existing module hash and permissions, saved an exclusive private backup, stopped only the two new candidate units, replaced only `identity/oidc.cjs`, and attempted startup/health verification. A post-update check failed. The wrapper automatically stopped only those candidate units, restored the original module, and restarted them. It did not retain which exact verification stage failed; therefore a root cause for the publication failure is NOT established.

Fresh post-rollback observations: the original module SHA-256 is `1a9fa148d54711fd2f701984b275ec952c27131086ad7659ad6117f147debae3`; the candidate app and HTTPS service are active with zero automatic restarts; hostname/SNI-correct locally verified HTTPS health is 200 and anonymous `/auth/me` is 401. Protected old LACK and Tailscale remain active at PIDs 594652 and 859 with zero automatic restarts. No credentials or Pocket ID client configuration changed.

The operator's immediate HTTPS check after `systemctl start` lacks an explicit readiness wait, which is a possible timing issue, not a confirmed cause. A bounded readiness wait plus sanitized per-stage diagnostics and one controlled retry have been submitted for user approval. Existing TLS validation, assertions, backup and rollback must remain intact.

**The scope fix is tested and synchronized source code, not a successfully deployed fix yet.** Do not ask the user to reuse old callback URLs or report real Pocket ID login as passed. A fresh login attempt is required after successful publication.

## Controlled scope-patch retry: successful

The approved retry changed only the already-tested `identity/oidc.cjs` module in the new public candidate. Its SHA-256 is `ae459a09646237683d38e3218899b392580395a7729f3ec99282f837f5663f57`. The previous module remains in an exclusive private backup for rollback.

The wrapper now records sanitized failure stages and waits at most 20 seconds for certificate-verified HTTPS readiness. In this run, HTTPS probes at 12, 271, 531 and 790 ms returned curl exit 7; the probe at 1108 ms returned exit 0 / HTTP 200. This confirms that an immediate check would have been premature in this run; it does not retrospectively prove the exact failure stage of the earlier attempt.

The candidate application and HTTPS services are active with zero automatic restarts. Anonymous `/auth/me` remains HTTP 401. The old LACK health endpoint remains HTTP 200, and the protected old LACK / Tailscale service baseline is unchanged. No credentials, Pocket ID client configuration, Relay configuration or product security assertions were changed. Process-state checks do not constitute an end-to-end Relay forwarding test.

The preceding Windows full suite passed 555/555 with no failures, skips or cancellations; the smoke test passed. The resource-limited Linux scope regression passed 3/3. This retry changed the deployment wrapper only, not the tested product patch. Real Pocket ID login still requires a fresh browser attempt; neither this update nor the health checks constitute full delivery acceptance.
