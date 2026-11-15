# Native copy preflight implementation plan

> Execute with superpowers:executing-plans in the existing private workspace. Routine local choices proceed autonomously under the standing goal; remote execution requires its own unconsumed scope.

**Goal:** Establish actual Linux identity/resource/network/read-only DATA checks before the fixed copier and serial boot controller can be joined into a native entry.

**Architecture:** An effect-free Python module reads only fixed proc/cgroup paths and fixed production DATA mount metadata. It validates exact per-tag unit membership, UID996/GID987, NNP, zero effective/permitted/inheritable/ambient capabilities, bounded capability ceiling, existing resource limits and read-only mounts. Existing copy helpers and full proof validator remain unchanged. The preflight does not read databases, issue proofs, launch processes or grant execution.

**Stack:** Existing Python standard library, existing checkout, no installation.

**Spec:** `.superpowers/sdd/native-copy-preflight-20261115-a1/DESIGN.md` (private).

## Tasks

- [x] Write failing tests for exact identity, capabilities, cgroup, budgets, mount precedence, mount escapes, writable nested mounts, namespace and malformed inputs.
- [x] Implement pure parsers and bounded native reader, then actual collection with an absolute shared deadline.
- [x] Exercise Linux collection using explicit local test doubles plus Windows rejection; never count doubles as native evidence.
- [x] Independently review, fix confirmed issues with regression evidence, run affected tests and bind source hashes.
- [ ] Synchronize sanitized results and this plan with exact readback.

## Invariants and completion boundary

One unit: `/chunlack-owned-rehearsal.slice/chunlack-owned-rehearsal-<12 hex>-prepare.service`. Memory<=192MiB, CPU<=20%, tasks<=32, swap0, CPUWeight<=10, Nice>=10. UID/GID four fields exact996/987, NNP1, CapEff/Prm/Inh/Amb zero; bounding mask is a subset of the existing0xeb ceiling. Read-only DATA is fixed `/var/lib/chunlack-public/db`; longest covering mount must be VFS read-only, no writable nested mounts, and statvfs must confirm ST_RDONLY. Network must contain only lo in a namespace distinct from a root-acquired host namespace descriptor. The launch layer must independently authenticate that descriptor's origin; this module cannot do so using fstat alone and explicitly reports the outstanding validation. No business PID1 namespace open or added capability. Reads are bounded and checked against the shared monotonic deadline, with a Linux deadline alarm around blocking probes and a required future outer kill/reap limit for uninterruptible I/O.

Local simulation does not prove these controls exist on VPS. Actual copier provenance, historical source binding, dependency files, whole-lifetime kernel confinement, child identity checks and original full proof validation remain subsequent native-entry integration requirements. No SSH, unit, production operation, credential access or real model call occurs in this plan.
