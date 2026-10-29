---
type: Reference
title: Technical debt
description: Deliberate technical compromises, their evidence, compensating controls and verifiable removal conditions.
sources:
  - id: arm-nested-virtualization
    resource: https://github.com/orgs/community/discussions/160591
    title: GitHub hosted nested virtualization and ARM fleet migration
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
---

# Technical debt

## Admission and removal

This register records a deliberate technical compromise in code, infrastructure, tests or operating practice. An entry identifies the desired property, the accepted difference, concrete evidence, a technical risk and a verifiable exit. Product backlog items and unexamined implementation ideas do not belong here. Unknown measurements remain unknown rather than becoming estimates presented as observations.

Each entry has a stable `TD-NNN` identifier, an owning issue, affected paths, compensating controls, an exit condition and a review trigger. Keep acceptance and changes in Git and the owning issue, following the repository's provenance rules. Remove a resolved entry after its exit evidence is verified; Git preserves its history. Do not retain resolved entries as an alternative progress log.

## Entry fields

- **Desired technical state:** the property that replaces the compromise.
- **Current compromise:** the deliberate difference in the actual implementation or inventory.
- **Acceptance evidence:** supporting observations and the owning decision; distinguish unavailable measurements.
- **Affected scope:** the concrete code, configuration, tests or operating boundary.
- **Technical risk or cost:** the failure or maintenance burden the compromise permits.
- **Compensating controls:** what limits the risk while the compromise remains.
- **Claim boundary:** the guarantee that cannot be asserted until this debt is resolved.
- **Exit condition:** reproducible evidence required before removing the entry.
- **Review trigger:** a change that requires reassessment even if the exit is not yet satisfied.
- **Owning issue:** the issue responsible for the compromise and assignment of its resolution.

## TD-001 — Fedora and Debian ARM64 guests in recurring CI

### Desired technical state

Recurring quality CI runs Fedora 44 and Debian 13 in native ARM64 VMs with their own kernels and the profiles established by [native foundation qualification](native-foundation-report.md). Fedora uses GNOME/Wayland, Btrfs and enforcing SELinux; Debian uses GNOME/Wayland and ext4. Each cell produces identifiable packages and complete packaged runtime, storage, diagnostics and shutdown evidence.

### Current compromise

The [quality matrix](../config/quality/build-targets.json) includes x64 Fedora and Debian VMs on the standard Ubuntu 26.04 runner and omits their ARM64 VM counterparts. The [VM policy](../config/quality/virtual-machines.json) explicitly retains ARM64 as pending. Ubuntu ARM64 jobs do not establish Fedora or Debian ARM64 compatibility. This is a recurring CI coverage limit, not removal of either distribution/CPU from the supported target contract.

### Acceptance evidence

The maintainer explicitly deferred the ARM64 VM extension in the work for [#26](https://github.com/ohtia/ohtia/issues/26). GitHub's infrastructure discussion reports that ARM nested virtualization depends on the Cobalt200 fleet migration and is not reliable across the mixed fleet.[^arm-nested-virtualization] Selecting a newer Ubuntu image cannot itself establish hardware virtualization support. No successful ARM guest boot or performance measurement on GitHub-hosted runners is claimed here.

[Issue #32](https://github.com/ohtia/ohtia/issues/32) retains earlier successful native Fedora and Debian ARM64 qualification on its identified facilities. Those records preserve their original sources and artifacts; they do not qualify later CI packages or establish hosted KVM availability.

### Affected scope

The hosted runner and guest inventories in [the quality matrix](../config/quality/build-targets.json) and [VM policy](../config/quality/virtual-machines.json), [VM launcher](../scripts/quality_vm.py), [CI workflow](../.github/workflows/ci.yml), complete-result accounting and the [trusted PR check inventory](../config/github/ci-verification.json).

### Technical risk or cost

A distribution-specific native dependency, package script, filesystem or kernel-policy regression on ARM64 can escape recurring CI even when Ubuntu ARM64 and the x64 guest jobs pass. An emulated guest or userspace container could conceal this gap if reported as native qualification.

### Compensating controls

- Keep Ubuntu 24.04 and 26.04 native ARM64 jobs on X11 and GNOME/Wayland.
- Require x64 Fedora and Debian guest jobs to use actual KVM; fail on missing acceleration rather than falling back to TCG.
- Preserve the full distribution target contract and the original #32 evidence.
- Report the omitted ARM guest cells explicitly; require applicable native final-artifact qualification before a distribution guarantee.

### Claim boundary

Passing Ubuntu ARM64 jobs, passing Fedora/Debian x64 guests or the historical #32 qualification do not establish recurring Fedora/Debian ARM64 CI coverage or qualify changed final ARM64 artifacts. Until the exit condition is met, these two ARM64 guest cells must remain explicitly unverified in the recurring CI inventory.

### Exit condition

Verify reliable nested KVM on the selected standard GitHub-hosted ARM64 runner and boot both pinned native ARM64 guest images with actual acceleration observed. Run the selected distro-native kernels, GNOME/Wayland, filesystems and enforcing security policy. Verify actual ARM64 host, guest, executable and addon identities and all required packaged success/failure suites. Add both cells to the mandatory workflow and trusted inventories, demonstrate that missing or failed cells fail the aggregate, and retain real PR and integrated-source run evidence. An announcement, `/dev/kvm` pathname alone, cross-build or emulation is insufficient.

### Review trigger

GitHub announces supported ARM nested virtualization or completes the relevant fleet migration; the hosted ARM hardware changes; guest images, native dependencies or package mechanisms change; or a release needs new Fedora/Debian ARM64 compatibility evidence. The issue crossing a trigger must take explicit responsibility for resolving or reassessing this entry.

### Owning issue

[STORY-001-012, #26](https://github.com/ohtia/ohtia/issues/26) owns this accepted CI scope and its handoff. Implementation of the ARM extension requires an issue before code changes, following the contribution rules.

[^arm-nested-virtualization]: GitHub's response describes the hardware-dependent transition and requires a completed rollout before treating the capability as supported and reliable.
