# VPS deployment preparation

## Scope and access

This deployment runs LACK as a private, single-owner service. The application has
no complete login/authorization system. Port 3721 is published to VPS loopback
only; use an SSH tunnel or an authenticated reverse proxy. Public HTTPS/domain
exposure is a separate deployment step after access controls are configured.

No GPU is required on the LACK VPS. Local models can run on a separate private
model server. CUDA and model-server installations are outside this deployment.

The image runs as uid/gid 1000 with a read-only root, dropped capabilities, no
Docker socket, a dedicated data volume, a bounded temporary directory, resource
limits and rotating logs. Direct shell tools are disabled. File tools are limited
to the workspace and reject traversal/symlinks. Existing STACK, reverse-skill and
code-pipeline execution still require further Tool Gateway work; only trusted
users should operate this instance. No host root/home/config directories are mounted.

Compose options follow the [official service reference](https://docs.docker.com/reference/compose-file/services/).

## Required host information

Provide an SSH alias or hostname/IP, port, username and an existing local key path.
Do not put private keys or provider API keys into chat, source control or logs.
We will inspect OS/architecture, free RAM/disk, Docker/Compose, existing services,
listening ports, firewall and any reverse proxy before changing the VPS.
Choose the provider/model, private model URL if applicable, and optional domain.

## Build and first start

Use Linux with Docker Engine and Compose v2 supporting `up --wait`. Runtime is
Node 24; dependencies are locked by package-lock.json and installed with npm ci.
Building the native SQLite module may need more memory than running LACK. Tune
the default 1 GiB/1 CPU runtime limits to observed host capacity.

From a checkout of the desired commit:

```sh
umask 077
cp deploy/.env.example deploy/.env
cp deploy/lack.config.example.json deploy/lack.config.json
chmod 600 deploy/.env deploy/lack.config.json
```

Edit `.env` on the VPS with the provider key. Configure `llmProvider`,
`defaultModel`, and each agent's provider/model in `lack.config.json`; replace
every `REPLACE_WITH_PROVIDER_MODEL_ID`. The example uses DeepSeek as a placeholder
choice, not an activated account. Set `LACK_IMAGE_TAG` to the source commit ID.

The uid 1000 container must be able to read the seed file: if it is owned by a
different host account, use `sudo chown 1000:1000 deploy/lack.config.json` while
keeping mode 600. The host operator reads `.env`; it is not bind-mounted.

```sh
sh deploy/manage.sh preflight
sh deploy/manage.sh up
sh deploy/manage.sh status
```

`preflight` does not print expanded secrets. `up` builds an image, waits for the
health check and shows service state. It does not install Docker or modify host
firewall rules. Do not run the legacy `python lack.py` installer on the VPS.

On your own computer, forward a local port through the provided SSH entry:

```sh
ssh -N -L 3721:127.0.0.1:3721 YOUR_SSH_ALIAS
```

Open `http://127.0.0.1:3721`. Use a different local port if 3721 is occupied.
Keep the VPS's 3721 closed to public ingress. Container-internal binding is
0.0.0.0; the Docker host publication remains 127.0.0.1.

## Configuration and routing

`llmCloudProviders` accepts cloud endpoints and requires HTTPS plus a key.
`llmProviders` uses the same adapter and also accepts explicit private/local
endpoints, for example:

```json
{
  "id": "local-vllm",
  "local": true,
  "requiresApiKey": false,
  "baseUrl": "http://PRIVATE_MODEL_HOST:8000/v1",
  "models": ["YOUR_LOCAL_MODEL_ID"],
  "timeoutMs": 30000,
  "fallbackModels": []
}
```

Set `apiKeyEnv` if the endpoint needs authentication. `local: true` is an operator
classification, not automatic network verification. Do not label a public cloud
service as local. Loopback inside a container refers to that container, not the
VPS or your GPU machine. `host.docker.internal` maps to the Linux host gateway;
the model service must listen on a reachable private interface, with access
restricted appropriately. Ollama uses `OLLAMA_URL` or `config.ollamaUrl`.

`models` supplies a static fallback list if discovery fails. Generation fallbacks
come from the selected provider's `fallbackModels`; only Ollama uses the legacy
global `fallbackModels`. Unknown providers fail explicitly.

Per-agent generation policies live in a separate map so editing an Agent in the
UI does not overwrite routing policy:

```json
{
  "agentRouting": {
    "private-research": {"localOnly": true},
    "research": {
      "allowCloudFallback": true,
      "fallback": {"provider": "deepseek", "model": "YOUR_CLOUD_MODEL_ID"}
    }
  }
}
```

Cloud primary selection is explicit in the Agent configuration. Cross-provider
cloud fallback additionally requires `allowCloudFallback: true`; `localOnly`
blocks all cloud generation routes for that Agent. These controls do not stop
other cloud agents reading shared channel messages. Use local-only instances or
carefully separated channels for confidential work. Cost budgets, per-provider
concurrency limits, streaming and native Anthropic/Gemini protocols remain planned.

`embeddingProvider` is independent of chat providers: `none` disables vector
calls, the default is `ollama`, and another registered ID explicitly enables that
provider's configured `embeddingModel`. Changing the embedding namespace clears
stored incompatible memory vectors while retaining text. Keep embeddings local
or disabled for private workloads; do not change them casually on a live dataset.

The container initializes `/data/config/lack.config.json` from the seed only on
first start. Afterwards this persistent file and SQLite hold live configuration;
editing the seed alone does not update a running installation. The UI persists
Agent edits. For operator configuration changes, back up first, edit the live
JSON via `docker compose exec`/`docker cp`, and restart. Existing DB-backed Agents
take precedence over most seed Agent fields. New config-only Agents should be
created via the UI once a database exists.

The generator can also be used for local verification without starting services:

```sh
python3 scripts/materialize.py --output .runtime
npm ci
npm test
npm run smoke
```

Use `PYTHON=python3` for Node tests on Linux if `python` is not installed.

## Upgrades and rollback

Before changing code or live configuration:

```sh
sh deploy/manage.sh backup
```

The backup briefly stops the service for a consistent SQLite/filesystem snapshot,
records the exact image ID and deployment settings, then starts the service again.
Archives include sensitive application data and config; the backup directory is
private. No backup is deleted automatically. Check free disk space beforehand.

For an upgrade, select the next reviewed source commit, assign a new image tag in
`.env`, then run `up`. Existing data/config remain in the same volume. Do not use
`docker compose down -v`, prune old images, or overwrite live config during an upgrade.

For a code-only rollback, use the image ID recorded in `backups/<timestamp>/image-id`:

```sh
docker tag IMAGE_ID_FROM_BACKUP chunlack:rollback
# Set LACK_IMAGE_TAG=rollback in deploy/.env, then:
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --no-build --wait
```

If data/schema restoration is needed, restore into a NEW volume first. Retain the
current volume, and point `LACK_DATA_VOLUME` to the restored volume only after the
snapshot has been inspected. Example from the repository root:

```sh
docker volume create chunlack_restore_YYYYMMDD
docker run --rm -i --user 1000:1000 --read-only --cap-drop ALL \
  --security-opt no-new-privileges:true \
  -v chunlack_restore_YYYYMMDD:/data --entrypoint tar chunlack:rollback \
  -C /data -xzf - < deploy/backups/TIMESTAMP/data.tar.gz
# Set LACK_DATA_VOLUME=chunlack_restore_YYYYMMDD and LACK_IMAGE_TAG=rollback
# in deploy/.env, then run Compose up --no-build --wait as above.
```

Use only a trusted archive created by the backup command. We will exercise the
backup/restore process on disposable VPS data before relying on it for production.

## Verification status

Local checks cover generated syntax, provider routing, constrained fallback,
missing keys, model-list fallback, timeout configuration, queue recovery, workspace
paths, HTTP/WebSocket behavior and SQLite restart persistence. Smoke tests use
synthetic model servers and a temporary data directory, never actual provider keys.

Docker build/health, actual Linux permissions, backup/restore, SSH access, real
provider calls and live multi-agent collaboration must be verified on the target
VPS. A successful `/health` response means the app is running, not that every model
endpoint is healthy. The provider list's `configured` flag means configuration is
present, not that authentication, quota or network connectivity has been verified.
