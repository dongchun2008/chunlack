# Private systemd deployment

This is the deployment alternative used on the small relay VPS. The original
Docker deployment remains supported and unchanged. No application source changes
are included in this deployment. See `../VPS_DEPLOYMENT_2026-09-14.md` for actual
results, including a failing chat-history restoration check.

## Layout and isolation

| Host path | Purpose |
| --- | --- |
| `/opt/chunlack/releases/56ec5ba` | Source archive, locked dependencies, generated runtime |
| `/opt/chunlack/current` | Symlink to the active release |
| `/opt/chunlack/node` | Private Node runtime, not installed into the system PATH |
| `/opt/chunlack/jail` | systemd filesystem root |
| `/var/lib/chunlack` | Application-only persistent data |
| `/etc/chunlack/provider.env` | Root-owned mode 600 provider environment file |
| `/opt/chunlack/backups` | Private, local backups; not an off-host backup |

The service runs as `chunlack`, without capabilities and with no-new-privileges.
It binds only `127.0.0.1:3721`. The jail exposes read-only runtime/system libraries
and selected DNS/CA files, not the host root, home directories, SSH keys or
Tailscale/Docker sockets. Only `/data` and bounded temporary filesystems are
writable. Network egress is not allowlisted: this is a private single-owner
deployment, not a multi-tenant security boundary or a complete Tool Gateway.

MemoryHigh is 320 MiB, MemoryMax 448 MiB, MemorySwapMax 128 MiB, CPUQuota 50%,
TasksMax 64, and Node old-space 256 MiB. The CPU quota means half of one CPU core,
not half of this two-core machine. These are limits, not resource reservations.
The service journal is rate-limited. `chunlack.logrotate` rotates application
`*.log` files when the existing host logrotate job runs; it is not a hard disk
quota. Workspace, database, journal and backup growth still need monitoring.

## First-install preparation

This is an operator checklist, not an unattended installer. Do not apply it over
an existing deployment. Preserve the active data and take a backup before upgrades.

1. Inspect existing services, ports, free memory, swap and disk. Do not run the
   legacy `python lack.py` installer, upgrade OS packages, alter firewall rules
   or restart unrelated services as part of this procedure.
2. Deliver a reviewed source archive into a new release directory. Verify its
   SHA-256. Install the official Linux x64 Node 24 archive separately under
   `/opt/chunlack`, verifying against the official SHASUMS256 file. Dependencies
   must use the committed package lock and `npm ci --omit=dev`. Run installation
   scripts as a low-privilege account under CPU/memory limits, not as root.
3. Run `npm test` and `PYTHON=python3 npm run smoke` before promoting the release.
4. Materialize using `scripts/materialize.py`. Move its first generated config
   into the dedicated data directory. In the release, link `config`, `logs`,
   `lineage`, `research`, `workspace`, `lack_repos`, `thread_repos`,
   `agent_memories`, `db`, `k8s`, `jspace` and `.github` to their `/data/` paths.
   Precreate these data directories, plus `home` and `git`, owned by `chunlack`.
   A `.git` link to `/data/git` was also prepared in the deployed release.
5. Keep the data root mode 700 and live config mode 600. Make release directories
   searchable and code readable by the `chunlack` group, but never writable:

```sh
# RELEASE must first be resolved and checked to be the intended release directory.
find "$RELEASE" -xdev -type d -exec chown root:chunlack {} + -exec chmod g+rx,go-w {} +
find "$RELEASE" -xdev -type f -exec chown root:chunlack {} + -exec chmod g+r,go-w {} +
```

6. Prepare the jail mount destinations and make `/etc` and `/etc/ssl` searchable
   (755). Its `/bin` and `/sbin` links target `usr/bin` and `usr/sbin`. The unit
   binds `/usr`, `/lib`, `/lib64`, the release as `/app`, Node as `/runtime`, and
   the dedicated data as `/data`. Do not bind the host `/etc` or `/` wholesale.
7. Install `chunlack.service`, reload systemd, start only this service, and wait
   for HTTP health before testing. Enable it after successful startup. Install
   `chunlack.logrotate` separately in `/etc/logrotate.d/chunlack`.

The first attempt used `umask 077` while generating code, then changed ownership
to root without granting group read/search access. That caused EACCES. The
permissions above correct it without running the application as root or making
code writable. The private config must not receive these code permissions.

## Access and operation

```sh
ssh -N -L 13721:127.0.0.1:3721 YOUR_SSH_ALIAS
# Browser: http://127.0.0.1:13721
systemctl status chunlack
curl --fail http://127.0.0.1:3721/health
journalctl -u chunlack --since '10 minutes ago'
```

No public port, reverse proxy, API credentials or real model was configured.
The live config intentionally has zero Agents, embeddings disabled and model
auto-pull disabled. The dormant Ollama default is retained for compatibility;
its startup discovery reports ECONNREFUSED because there is no local Ollama.
This warning does not mean a working model backend exists. Configure approved
providers and Agents separately before real workloads. Codex/OpenClaw connectors
are not part of this deployment.

## Repeatable acceptance

Use a disposable data root, never production data. Clone the service into a
temporary unit, change only the `/data` host binding and remove the provider
environment file. Keep the same jail and security/resource settings. Configure
port 3722, default `mock-1`/`mock-model`, five local providers `mock-1` through
`mock-5` with base URLs `http://127.0.0.1:13870/worker-N/v1`, and five Agents with
IDs `worker-N`, names `WorkerN`, corresponding providers, model `mock-model`,
channel `general` and prompt `Be brief.`. Disable embedding, auto-pull, musing,
triangulation and public memory, as in the deployment seed.

After the fixture passes `/health`, run as the low-privilege account with
`NODE_PATH` pointing at the release's `node_modules`:

```sh
node deploy/systemd/acceptance.cjs exercise
# Restart ONLY the disposable fixture, wait for health, then:
node deploy/systemd/acceptance.cjs persisted
```

The exercise verifies five replies/routes, shared prior context, five connected
clients, 100 health requests, edits, model discovery and path rejection. It does
not prove five simultaneous real model requests or long-running relay capacity.
`persisted` currently fails on missing channel history after restart, while
Agent name/provider restoration succeeds. Do not suppress this assertion.

For backup acceptance, stop the fixture, archive its data, restore into a NEW
directory, compare database/config hashes and SQLite integrity/counts, and start
a temporary unit bound to that restored directory. Stop the test units and remove
only their temporary unit files afterwards. Retain evidence privately. Do not
overwrite live data or assume a successful database backup fixes UI history.

## Backup, rollback and limits

The initial production snapshot is `/opt/chunlack/backups/20260914-initial`.
It was created with only LACK stopped, and includes the data archive, unit,
provider environment and application/Node version record. Build cache is excluded.
The separate synthetic backup is `20260914-acceptance`. Neither is off-host.

For later backups, briefly stop only LACK and use a trap to restart it even if
archiving fails. Preserve mode 700 for backup directories and 600 for secrets.
Restore only trusted archives into new directories. For code rollback, stop LACK,
select a retained, reviewed release via `current`, and start LACK; do not restore
old data over the live data directory. The Node ABI must match native dependencies.
To disable this added service without touching relay: `systemctl disable --now
chunlack`. Keep data, runtime, backups and source until retention is agreed.

Boot enablement is verified without rebooting the VPS. Host reboot behavior,
real providers, sustained heavy relay traffic, complete access control, cost
budgets and global provider concurrency limits remain outside this acceptance.
