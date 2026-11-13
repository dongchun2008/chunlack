# Preparation capacity gate (local only)

The inactive detail-trace candidate is locally integrated, but its reservation checks do not establish current disk or inode availability. This gate must precede any further candidate-writing preparation. Existing post-preparation DATA/backup capacity and database compatibility gates remain required.

Use the existing pinned read-only directory-FD API to inspect only `/var/tmp`, `/var/lib`, `/opt/chunlack-public` and their ancestors. Never traverse application data or read file bodies. Take two metadata/statvfs observations, reject identity/mode/allocation-unit drift, and use the lesser free-space/inode values. Group destinations by device so one filesystem is charged for all relevant writes.

Use explicit preparation-only allowances derived from existing file/entry ceilings, allocation rounding and a 512 MiB remaining-space margin per device. These are conservative admission estimates, not a disk reservation or a guarantee against concurrent writers, quotas or arbitrary filesystem metadata costs. Insufficient or unknown information rejects preparation.

- [x] Write failing policy, read-only capture, drift, budget and cleanup tests.
- [x] Implement pure evaluation and the pinned metadata adapter; preserve original source files.
- [x] Run the new local cases with explicit terminal evidence and independent review.
- [x] Prepare sanitized evidence and this plan for synchronization; native execution remains unapproved.

Evidence: [local 24-case capacity/envelope record](../../verification/2026-11-13-preparation-capacity-gate-local.json). The final inactive packet remains separate from the preserved first packet and all failed local reports. Each observation shares an FD for fstat/statvfs, while the second pass reopens descriptors. No real VPS capacity, native deadline or production readiness is inferred. The existing bounded transport still needs binding before a new single read-only observation is proposed; an observation alone cannot authorize preparation.

No SSH, native system bus, new Linux unit, publication, credentials, grants, Agent/model calls, existing service changes or Relay operations are part of this phase.
