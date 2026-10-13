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
