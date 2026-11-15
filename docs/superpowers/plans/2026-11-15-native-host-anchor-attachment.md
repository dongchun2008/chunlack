# Native host anchor attachment plan

> Execute inline with superpowers:executing-plans in a new private local candidate. Remote access/units/publication remain separately scoped; routine local choices proceed under the standing goal.

**Goal:** Attach the fixed native preflight to a root-origin-bound, read-only host namespace handle without giving the business worker access to PID1 or additional capabilities.

**Architecture:** Trusted host launch preparation collects only host namespace identity and boot ID, returning a metadata object without writing files. The launcher must store it as a new root-owned0440/GID987 context and mount it and `/proc/1/ns/net` read-only at exact private paths. A new business-side attachment validates root ownership, exact bytes/hash/tag/boot/freshness and namespace identity/type before calling the frozen preflight. Linux nsfs `net:[inode]` mount roots are checked for this exact read-only anchor, then normalized only in memory for the original DATA mount validator. No original file is edited.

**Tech stack:** Existing Python standard library and byte-pinned preflight; no installations or new native launcher.

**Spec:** `.superpowers/sdd/native-host-anchor-20261115-a1/DESIGN.md` (private).

## Tasks

- [x] Write failing context, namespace-mount, read-only and attachment tests.
- [x] Implement bounded, effect-free imports and root-only metadata collection with explicit descriptor ownership.
- [x] Implement context validation and preflight attachment; preserve shared deadline, cleanup and all DATA checks.
- [x] Run affected local regressions, independent review and source binding; fix confirmed issues with RED/GREEN evidence.
- [ ] Synchronize only sanitized results and this plan with exact readback.

## Requirements

Context fixed at `/run/chunlack-copy/launch-context.json`, host anchor `/run/chunlack-copy/host-netns`; root-owned, non-link context0440/GID987 and both paths on read-only mounts. Context binds tag, boot ID, namespace dev/inode, monotonic collection time, source `/proc/1/ns/net` and no execution/publication authority. Maximum context4096 bytes, freshness30 seconds; shared preflight deadline<=10s. All original UID/GID/capability/resource/loopback/DATA-mount checks remain. Borrowed host namespace descriptor always closed by its owner after use; any closure failure rejects success and retains the primary error.

No SSH, native unit, real database read, model, external Agent or production change. Actual launcher creation/mounting, outer owned-worker termination/reap, copier provenance, actual source/dependency binding and full compatibility validation remain pending.

## Primary source

Linux nsfs emits dynamic namespace names and mount paths and creates read-only regular namespace inodes: [v5.15 nsfs.c](https://github.com/torvalds/linux/blob/v5.15/fs/nsfs.c). This source inspection supports the parser adaptation, not a claim about the current VPS kernel or actual unit behavior.
