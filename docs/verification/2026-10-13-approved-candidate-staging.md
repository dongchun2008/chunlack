# Approved isolated candidate staging, 2026-10-13

Status: preparation partially completed; stopped at a metadata upload error.
The public candidate is not active, and real Pocket ID login is not accepted.

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
