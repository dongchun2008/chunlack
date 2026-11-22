# Setup boot-marker compatibility implementation plan

> Execute with the existing executing-plans and TDD workflow. Only key external/native execution decisions need user confirmation under the user's established preference.

**Goal:** Produce a local compatibility profile that supplies systemd's boot marker within the private management namespace.

**Architecture:** Derive from the pinned40b042 profile in a new private candidate. Add only a bounded read-only empty tmpfs at /run/systemd/system. Preserve every other proposal property, strict checked/wire encoding, and all old/frozen/deployed bytes.

**Tech stack:** Existing Python pure profile, AST/literal comparison, standard unittest. No dependency or service installation.

**Spec:** The private setup-boot-marker-compatibility-20261122-a1 DESIGN.md, grounded in the [fixed query result](../../verification/2026-11-22-setup-command-stderr-readonly-result.json) and [official sd_booted notes](https://www.freedesktop.org/software/systemd/man/latest/sd_booted.html).

## Constraints and review focus

- Only TemporaryFileSystem may differ; no new host binds, capabilities, environment, retry, model route or unit actions.
- Original private /run mount remains exact; the additional marker must be read-only/noexec/nosuid/nodev with4KiB/16-inode bound and0555 mode.
- Resource, identity, NNP, control sockets and source flags must remain exact; altered proposals and malformed bindings must still fail.
- Existing codec must encode the new two-mount property correctly; no native bus call in local verification.
- This is a layout/policy candidate, not proof of the actual Linux mount or systemctl fix. No external review result is implied.

## Tasks

1. Reproduce the missing marker with the pinned profile request (RED).
2. Derive the single property change and verify literal/AST boundaries (GREEN).
3. Test exact unchanged policy, caps/budgets, tamper rejection, codec and source stability; record local-only results.
4. Integrate profile/hash references into a fresh inactive carrier in a subsequent local step; preserve current failures and old candidates.
5. Only after local integration, request a fresh bounded native window; no execution is authorized by this plan.

## Local progress and newly identified dependency

2026-11-22: profile9/9 and carrier6/6 local tests passed. The setup profile plus its literal hash references now reach an inactive15-file/13-input/170-member packet. The original full driver and same-connection capture bytes remain exact; local prospective admission and actual unapproved-child rejection passed. These results do not prove a Linux mount or a successful systemctl call.

Static downstream inspection also found a separate root control namespace with private /run and a runtime systemctl inspection. It likewise lacks the marker. Before requesting another full-chain native window, locally extend the same bounded marker policy to that management-only profile and close its source/hash references, or produce evidence that its execution context already provides the marker. Business UID996/GID987 profiles remain untouched. The current setup-only package is therefore **not yet a full-chain execution candidate**.

The initial carrier derivation incorrectly assumed that receiver changes rewrite a driver PINS dictionary. Inspection showed that this driver uses a fixed helper subset and checks receiver/runtime bytes through binding/packet hashes. The final adapter now requires the unhooked driver to remain exactly unchanged. Both the failed assumption and corrected GREEN results are retained; no checks were relaxed.
