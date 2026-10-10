# Isolated workspace restore trial

This is the offline restore-rehearsal portion of the approved multi-user delivery plan. It does not migrate legacy ownership, bootstrap accounts, publish a runtime, or change a production service.

`scripts/workspace-restore-trial.cjs` exports:

```javascript
const { prepareWorkspaceRestoreTrial, verifyWorkspaceRestoreTrial } = require('./scripts/workspace-restore-trial.cjs');
const report = prepareWorkspaceRestoreTrial({ snapshotRoot, restoreRoot });
verifyWorkspaceRestoreTrial(restoreRoot);
```

Both paths must be absolute and disjoint. The snapshot must already pass `verifyWorkspaceSnapshot`. The restore destination must not exist, and its parent must exist. Symlink/junction path components are rejected. No existing files are overwritten or deleted. Use a private operator-owned parent outside Git and web-served directories.

The destination contains `restore-trial-state.json` and a self-contained `payload` holding the original archive, non-activatable candidate, and snapshot verification metadata. Bounded exclusive copies check hashes while writing, then independently verify the restored files, SQLite integrity, foreign keys, and table counts. The source snapshot is reverified before a successful marker is published. A failure retains a `failed` trial for operator investigation, not an accepted recovery point.

The report contains identifiers and counts, not config credentials or source payloads. The actual restored files can contain credentials and private documents: never publish or commit this directory. POSIX output directories/files use 0700/0600; Windows ACL protection remains explicitly unverified and needs operator acceptance before real private data use.

Success proves an independent copy of the selected snapshot can be read after the original snapshot is no longer at its former path. It does not prove application-wide consistency, a full-machine backup, ownership migration, live runtime startup, or production rollback. `migrationReady` and `restoreReady` remain false. Original source links, acquired excerpts, missing-evidence flags, model configuration, unclassified database tables, task evidence, and attachments are preserved rather than invented or relabeled as verified.

No service, network, DNS, firewall, port, real model, Open WebUI, or Muse/dots operation is performed by this tool. Real cutover and recovery require the remaining migration, identity, Linux service, browser, real-model, external-Agent, and co-host health acceptance gates.
