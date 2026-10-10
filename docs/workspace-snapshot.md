# Offline workspace snapshot preparation

This is an intermediate migration capability, not a production deployment or a
completed migration. `scripts/workspace-snapshot.cjs` exports
`prepareWorkspaceSnapshot({ sourceRoot, snapshotRoot })` and
`verifyWorkspaceSnapshot(snapshotRoot)`. Paths must be absolute. The snapshot
parent must exist, and the snapshot root must not exist. Linked paths, overlapping
source/destination roots and existing destination contents are rejected.

## Preserved data

- The exact original `config/lack.config.json` is archived under `archive/config/`.
- A working copy under `candidate/config/` retains model/provider/Agent settings,
  including Ollama, but always sets `multiUser.migrationReady` to `false`.
- Inventoried `memory`, `research`, `uploads`, `artifacts` and `attachments` files
  retain their exact bytes, including original source URLs and missing-evidence flags.
- `db/lack.db` and present allowlisted `identity.db`, `agent-gateway.db` and
  `mcp-events.db` use SQLite's online backup API. Committed WAL rows are included;
  main database files are not copied as a substitute for online backup.
- Every copied artifact has a byte count and SHA-256; each database has native
  integrity/foreign-key checks and independently recounted table rows.

## Boundaries

Only the inventoried directories and database allowlist are included. Unknown
source-root files are not automatically collected, and unknown table/ownership
issues remain in the migration plan. This is not a full machine backup. The
inventory is bounded to 4096 files, 64 MiB per file and 512 MiB total. Larger
datasets require an explicit reviewed expansion, not a silently incomplete copy.

SQLite files are individually consistent. Checks before and after preparation
detect observed source changes, but cannot prove application-wide quiescence or
transactional consistency across databases and JSON files. Accordingly, the
result always reports `applicationConsistency: not_proven`, `restoreReady: false`
and `migrationReady: false`. No live producer is stopped or restarted.

The manifest and state marker support artifact integrity checks, not signatures
or protection against an attacker able to rewrite the entire snapshot. Final
workspace ownership bootstrap, schema conversion, audit preservation, an actual
isolated restore/start test and production cutover approval are still required.

## Privacy and failure handling

Snapshots contain private configuration and potentially credentials. They must
remain outside version control, web roots and shared folders. Linux creation uses
0700 directories and 0600 files; Windows ACL isolation is explicitly unverified
and must be established before using production data. No credentials are printed
by the API result.

An exclusively owned root starts with a `building` marker. It becomes `prepared`
only after copying, database checks and source-change checks; verification checks
the manifest hash, artifact hashes, native database counts, required files,
unlisted payloads and the disabled activation flag. A failed attempt remains
non-activatable and does not replace another snapshot or delete source data.
Retries must use a fresh root. No snapshot is automatically restored or published.

## Local verification scope

`tests/workspace-snapshot.test.cjs` exercises actual local SQLite/WAL backups,
unchanged source bytes and a usable source writer, original-source/attachment
preservation, invalid database handling, mutation detection, manifest path escape,
unexpected files and table-count mismatch. These tests do not prove VPS restore,
Linux service/cgroup behavior, browser HTTPS acceptance, real model inference,
or actual Muse/dots account execution. Those remain separate delivery gates.
