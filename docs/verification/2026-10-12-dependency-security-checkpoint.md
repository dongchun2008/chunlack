# Dependency security upgrade checkpoint (2026-10-12)

## Status: local candidate only, not accepted

The runtime-only retest in `2026-10-12-runtime-low-cpu-retest.md` passed on
its recorded source/dependencies. It does NOT validate this subsequent
dependency upgrade. No upgraded dependency was installed on the VPS.

The local package manifest, lockfile and node_modules now contain these
scoped changes; they remain uncommitted pending compatibility repairs:

| Package | Before | Candidate |
| --- | --- | --- |
| simple-git | 3.36.0 | 4.0.2 |
| @simple-git/argv-parser | 1.1.1 | 2.0.1 |
| @simple-git/args-pathspec | 1.0.3 | 1.0.4 |
| proxy-addr | 2.0.7 | 2.0.8 |
| brace-expansion | 1.1.18 | 1.1.21 |

No other locked package version changed. brace-expansion stays on its
existing major version. The local npm 12.2.0 tool was downloaded from
the npm registry and checked against its SHA-512 registry integrity;
it was not installed globally. Installation scripts were disabled.

## Evidence and limitations

- npm's hidden installation lock reported new versions while actual
  package metadata still reported old versions. The stale hidden lock
  was preserved under the ignored evidence directory, then npm scanned
  the actual installed tree and replaced the five packages.
- Installed-version/lock matching and benign proxy/brace compatibility:
  2 selected tests passed after actual replacement.
- Bulk npm advisory query over all 239 unique locked package names
  returned no advisories at query time. This is not an exploitability
  assessment or a guarantee against unknown vulnerabilities.
- Existing regression suite: **525 passed / 16 failed / 541 total**,
  no skips or cancellations, 224208.9291 ms.
- The newly added seven-case dependency test file was explicitly excluded
  from that existing-suite run because its Git fixture needs repair.
  The 541 count must not be presented as the complete enlarged suite.
- One screenshot SDK case failed with `fetch failed` during the full run
  and passed on a separate one-case rerun. Root cause is not established;
  a successful full rerun remains required.

## Confirmed compatibility defect and pending repairs

The installed simple-git 4.0.2 module has type `object`, its `simpleGit`
property has type `function`, and it has no default factory export.
The existing `const simpleGit = require('simple-git')` call site therefore
throws `TypeError: simpleGit is not a function` during packaged startup.
This accounts for explicit startup failures in the regression output.
Do not release the candidate or claim the remaining failures resolved.

The new Git test fixture also sets `GIT_CONFIG_GLOBAL`, which the library's
default safety checks reject. An inherited `GIT_PAGER` initially obscured
that fixture error. Neither rejection should be worked around by enabling
unsafe options. Proposed repair: named factory imports; temporary HOME/XDG
configuration isolation; remove inherited editor, pager and Git configuration
override variables only in the test subprocess environment.

User confirmation for those repairs was requested. They have NOT been
applied at this checkpoint. After approval, run the complete enlarged suite,
smoke test and bounded native Linux validation with the upgraded packages.
Pocket ID login, native Agent acceptance and production release remain
separate incomplete gates.

## Evidence locations and upstream references

Ignored directory: `.superpowers/sdd/2026-10-12-dependency-hardening/`.
Relevant files: `npm-provenance.json`, `lock-version-delta.json`,
`hidden-lock-before-reify.json`, `reify.log`, `advisories-after.json`,
`existing-suite-after-reify.tap`.

`runtime-after-upgrade.tap` was recorded BEFORE actual installation-cache
repair, despite its filename; it used the old dependencies and MUST NOT be
used as acceptance evidence for the candidate.

- https://github.com/steveukx/git-js/releases/tag/simple-git%404.0.2
- https://github.com/advisories/GHSA-x6jw-m9v5-85vh
- https://github.com/advisories/GHSA-v5rq-49vh-5v5c
- https://github.com/advisories/GHSA-jqcg-44mw-7w3h
- https://github.com/advisories/GHSA-q2hr-2g5m-vwhr
