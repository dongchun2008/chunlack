# Prepare source integration without merging or publishing

Fixed evidence snapshot: main `27866b15f32ffbeac157eac6a0363dcdea7e71a6`, development `1ea71ce48d0a44abc6c79407eb4ed8d05ce49d6c`, common ancestor `08d1d1dd944581a38a5b1be00b299f41ff947537`. Later audit-record commits will move main, so these are immutable audit inputs rather than current-head assertions.

The complete Git-object comparison found 268 development-only and 505 main-only commits, with 533 and 466 changed paths respectively when rename detection is disabled. A private, unreferenced `git merge-tree` simulation preserves all 464 main-only path changes and all 66 desired product-source bytes. It has two unresolved documentation conflicts: `PROJECT_CONTEXT.md` and `docs/MUSE_DOTS_INTEGRATION.zh-CN.md`. No source branch, index, primary checkout, pull request, workflow or production service was changed by the audit. No tracked workflow file exists in the three inspected trees; external repository automation was not inspected.

The next local step is a private three-way resolution preview:

1. Capture and compare base/main/development text for both files, including conflict regions and historical dates. Separately preserve the existing dirty local versions; do not overwrite or silently discard them.
2. Preserve newer evidence and main-only records. Keep historical claims dated and distinguish completed single-task evidence from unverified sustained/native/production capabilities. Respect the current identities: 老镇 historical/unavailable, 苏婳 independently unverified, 玄玑's normal conversation must not be used as an automatic fallback destination.
3. Produce resolved copies and a content-preservation/difference report in a new private directory. Recheck that all 66 product files remain exact and that the entire main-only evidence set is unchanged. An unresolved or unreviewed proposal is not an integration commit.
4. Before any actual branch integration, refresh the relevant Git heads and reassess intervening changes. Require the remaining application/native gates for the exact final source/package. Do not force-push, remove main-only records, apply a conflict tree, or silently substitute the old frozen manual manifest for the updated guides.

This plan authorizes no VPS, Linux unit, real model or external Agent operation. The already-issued one-shot native isolation request remains pending; old allowance use and unknown watch cleanup remain recorded. Actual main integration, production maintenance and live acceptance are separate key gates. See the [fixed-commit audit](../../verification/2026-11-23-source-branch-integration-audit.json).
