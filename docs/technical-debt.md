---
type: Reference
title: Technical debt
description: Deliberate technical compromises, their evidence, compensating controls and verifiable removal conditions.
generated:
  by: claude-code/claude-opus-5-5
verified:
  by: human:AdrianMastronardi
sources:
  - id: arm-nested-virtualization
    resource: https://github.com/orgs/community/discussions/160591
    title: GitHub hosted nested virtualization and ARM fleet migration
  - id: chromium-input-panel
    resource: https://github.com/chromium/chromium/blob/156.0.8078.48/ui/ozone/platform/wayland/host/wayland_input_method_context.cc
    title: Chromium Wayland input-method activation and virtual-keyboard requests
  - id: chromium-text-input-v3
    resource: https://github.com/chromium/chromium/blob/156.0.8078.48/ui/ozone/platform/wayland/host/zwp_text_input_v3.cc
    title: Chromium text-input-v3 enable and commit requests
  - id: chromium-main-input-panel
    resource: https://github.com/chromium/chromium/blob/94bcdb6eb0a10926ffe25e896f4a0d9ececc4306/ui/ozone/platform/wayland/host/wayland_input_method_context.cc
    title: Chromium development-branch virtual-keyboard requests
  - id: mutter-text-input
    resource: https://gitlab.gnome.org/GNOME/mutter/-/blob/50.1/src/wayland/meta-wayland-text-input.c
    title: Mutter text-input-v3 focus and input-panel state
  - id: mutter-text-input-version
    resource: https://gitlab.gnome.org/GNOME/mutter/-/blob/50.2/src/wayland/meta-wayland-versions.h
    title: Mutter advertised text-input-v3 protocol version
  - id: shell-keyboard
    resource: https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/50.1/js/ui/keyboard.js
    title: GNOME Shell on-screen keyboard opening rules
  - id: gtk-osk
    resource: https://gitlab.gnome.org/GNOME/gtk/-/blob/4.22.1/gtk/gtkimcontextwayland.c
    title: GTK Wayland on-screen keyboard activation
  - id: text-input-3-2
    resource: https://gitlab.freedesktop.org/wayland/wayland-protocols/-/merge_requests/282
    title: Wayland text-input protocol update to version 3.2
  - id: chromium-text-input-v3-2
    resource: https://issues.chromium.org/issues/510839988
    title: "Ozone-wayland: support text_input_v3 protocol version 2"
  - id: chromium-osk-report
    resource: https://issues.chromium.org/issues/40832770
    title: Clicking on an input does not trigger virtual on-screen keyboard
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

Recurring quality CI runs Fedora 44 and Debian 13 in native ARM64 VMs with their own kernels and the profiles established by [native foundation qualification](native-foundation-report.md). Each runs on GNOME and on KDE Plasma Wayland; Fedora uses Btrfs and enforcing SELinux, and Debian uses ext4. Each cell produces identifiable packages and complete packaged runtime, storage, diagnostics and shutdown evidence.

### Current compromise

The [quality matrix](../config/quality/build-targets.json) includes x64 Fedora and Debian VMs on the standard Ubuntu 26.04 runner and omits their four ARM64 VM counterparts: Fedora and Debian, each on GNOME and KDE Plasma. The [VM policy](../config/quality/virtual-machines.json) explicitly retains ARM64 as pending. Ubuntu ARM64 jobs do not establish Fedora or Debian ARM64 compatibility. This is a recurring CI coverage limit, not removal of either distribution/CPU from the supported target contract.

### Acceptance evidence

The maintainer explicitly deferred the ARM64 VM extension in the work for [#26](https://github.com/ohtia/ohtia/issues/26). GitHub's infrastructure discussion reports that ARM nested virtualization depends on the Cobalt200 fleet migration and is not reliable across the mixed fleet.[^arm-nested-virtualization] Selecting a newer Ubuntu image cannot itself establish hardware virtualization support. No successful ARM guest boot or performance measurement on GitHub-hosted runners is claimed here.

[Issue #32](https://github.com/ohtia/ohtia/issues/32) retains earlier successful native Fedora and Debian ARM64 qualification on its identified facilities. Those records preserve their original sources and artifacts; they do not qualify later CI packages or establish hosted KVM availability.

### Affected scope

The hosted runner and guest inventories in [the quality matrix](../config/quality/build-targets.json) and [VM policy](../config/quality/virtual-machines.json), [VM launcher](../scripts/quality_vm.py), [CI workflow](../.github/workflows/ci.yml), complete-result accounting and the [trusted PR check inventory](../config/github/ci-verification.json).

### Technical risk or cost

A distribution-specific native dependency, package script, filesystem or kernel-policy regression on ARM64 can escape recurring CI even when Ubuntu ARM64 and the x64 guest jobs pass. An emulated guest or userspace container could conceal this gap if reported as native qualification.

### Compensating controls

- Keep the Ubuntu 26.04 native ARM64 jobs on GNOME and KDE Plasma Wayland.
- Require x64 Fedora and Debian guest jobs to use actual KVM; fail on missing acceleration rather than falling back to TCG.
- Preserve the full distribution target contract and the original #32 evidence.
- Report the omitted ARM guest cells explicitly; require applicable native final-artifact qualification before a distribution guarantee.

### Claim boundary

Passing Ubuntu ARM64 jobs, passing Fedora/Debian x64 guests or the historical #32 qualification do not establish recurring Fedora/Debian ARM64 CI coverage or qualify changed final ARM64 artifacts. Until the exit condition is met, these four ARM64 guest cells must remain explicitly unverified in the recurring CI inventory; approved ephemeral Scaleway guests run their packaged cases for qualification and each candidate.

### Exit condition

Verify reliable nested KVM on the selected standard GitHub-hosted ARM64 runner and boot both pinned native ARM64 guest images with actual acceleration observed. Run the selected distro-native kernels, GNOME and KDE Plasma on Wayland, filesystems and enforcing security policy. Verify actual ARM64 host, guest, executable and addon identities and all required packaged success/failure suites. Add all four cells to the mandatory workflow and trusted inventories, demonstrate that missing or failed cells fail the aggregate, and retain real PR and integrated-source run evidence. An announcement, `/dev/kvm` pathname alone, cross-build or emulation is insufficient.

### Review trigger

GitHub announces supported ARM nested virtualization or completes the relevant fleet migration; the hosted ARM hardware changes; guest images, native dependencies or package mechanisms change; or a release needs new Fedora/Debian ARM64 compatibility evidence. The issue crossing a trigger must take explicit responsibility for resolving or reassessing this entry.

### Owning issue

[STORY-001-012, #26](https://github.com/ohtia/ohtia/issues/26) owns this accepted CI scope and its handoff. Implementation of the ARM extension requires an issue before code changes, following the contribution rules.

[^arm-nested-virtualization]: GitHub's response describes the hardware-dependent transition and requires a completed rollout before treating the capability as supported and reliable.

## TD-002 — GNOME software keyboard from Chromium text fields

### Desired technical state

On every supported GNOME Wayland profile, touching an Ohtia text field such as the command palette input opens GNOME's software keyboard through the ordinary installed launch. Its keys enter text into the field, and a deliberate software Return activates the intended command, distinct from composition confirmation. Physical keyboard input, real IME composition, screen-reader handling and native shortcuts keep their existing contracts.

### Current compromise

Ohtia uses the unmodified Electron runtime selected by [ADR-0003](adr/adr-0003-electron-desktop-boundaries.md) and pinned in the [toolchain manifest](../config/desktop/toolchain.json), without additional launch switches. Its Chromium connects text fields to GNOME's input method but never asks GNOME to show the software keyboard. Ohtia therefore cannot open GNOME's software keyboard from a touched text field. This is a runtime limitation accepted while no upstream correction exists, not a change to the product's input or accessibility requirements.

### Acceptance evidence

[Issue #188](https://github.com/ohtia/ohtia/issues/188) reproduces the absence with the installed package on Ubuntu 26.04.1 GNOME Wayland with Mutter 50.1, a native touchscreen and Screen Keyboard enabled. An independent GTK entry in the same session opened the software keyboard, received a word from its keys and recorded one activation.

The pinned Chromium enables text-input-v3 by default and sends one enable request when a text field gains focus. Its virtual-keyboard request does nothing for text-input-v3.[^chromium-input-panel][^chromium-text-input-v3] Mutter 50.1 treats the first enable as input-method focus and sets the input panel on only when an already focused client enables again.[^mutter-text-input] GNOME Shell opens its keyboard for application windows from that panel state rather than from focus alone.[^shell-keyboard] GTK sends the additional enable when its entry is activated, which explains the successful reference journey.[^gtk-osk] The Chromium development branch inspected at the cited commit still leaves the text-input-v3 request empty.[^chromium-main-input-panel]

Text-input protocol 3.2 adds explicit show and hide requests,[^text-input-3-2] and Mutter advertises that version from 50.2.[^mutter-text-input-version] Chromium tracks its adoption in an assigned issue with no linked code change.[^chromium-text-input-v3-2] An older report of the same symptom remains open.[^chromium-osk-report] Whether a distribution's Mutter 50.1 package includes the newer protocol version has not been inspected.

Ohtia cannot send the missing request itself. Blurring and refocusing the field produces a disable followed by a new first enable, which Mutter treats as new focus. Forcing X11 is excluded by [ADR-0042](adr/adr-0042-wayland-only-linux-support.md) and [ADR-0044](adr/adr-0044-linux-graphics-compatibility.md). A patched Chromium would replace the upstream Electron artifact selected by ADR-0003.

### Affected scope

The limitation affects every renderer text field on GNOME Wayland, including the command palette input of [command discovery](command-discovery.md). It affects the virtual-keyboard conditions of command discovery and [workspace layout](workspace-layout.md#acceptance-scenarios), and the software-keyboard portion of [issue #52](https://github.com/ohtia/ohtia/issues/52) under [SPEC-002-015](epics/EPIC-002-basic-interface/epic.md#spec-002-015-packaged-native-and-assistive-verification). Its resolution depends on the Electron version line in ADR-0003 and the toolchain manifest.

### Technical risk or cost

A person who relies on a touchscreen without a physical keyboard cannot open the software keyboard by touching an Ohtia text field on GNOME. A launch switch, input-handling change or forced backend added to work around the limitation could break real IME composition, physical shortcuts or the sandbox controls verified by earlier issues.

### Compensating controls

- Keep physical keyboard input, real Hangul composition, screen-reader handling and native shortcuts under their existing contracts and native evidence.
- Add no launch switch, forced Ozone backend or input-handling workaround for this limitation without a reviewed decision and native verification.
- Report the GNOME software-keyboard journey as unmet in native qualification; do not substitute injected text, a simulated input capability or a manually opened keyboard as a pass.

### Claim boundary

Ohtia does not claim that touching a text field opens GNOME's software keyboard on any supported GNOME profile, or that its virtual-keyboard conditions are qualified there. The applicable software-keyboard criterion of SPEC-002-015 remains unmet on GNOME until the exit condition is satisfied. No result is claimed for KDE Plasma's software keyboard, which has not been tested.

### Exit condition

An Electron release under ADR-0003 includes a Chromium that requests the input panel for text-input-v3: with the explicit show request where the compositor advertises protocol version 2, and with an additional enable where a supported GNOME profile only advertises version 1. Alternatively, every supported GNOME profile advertises version 2 and Chromium uses it. On a newly frozen candidate, an ordinary installed launch on each supported GNOME profile opens the software keyboard from the touched palette input, receives a word from its actual keys and activates the intended command with a deliberate software Return, while physical Latin input, real Hangul, screen-reader handling and native shortcuts retain their contracts.

### Review trigger

An Electron update under ADR-0003; a change in the Chromium issue or code for text-input-v3 panel requests; a supported distribution shipping a Mutter that changes its advertised text-input-v3 version; or a proposal to patch Electron, add launch switches or change text-input handling. The issue crossing a trigger must take explicit responsibility for resolving or reassessing this entry.

### Owning issue

[Issue #188](https://github.com/ohtia/ohtia/issues/188) owns the analysis of this limitation and its acceptance. Implementing the exit requires an issue before code changes, following the contribution rules.

[^chromium-input-panel]: Chromium activates text-input-v3 on focus and leaves its virtual-keyboard display request without a text-input-v3 action.

[^chromium-text-input-v3]: Chromium's text-input-v3 wrapper sends enable and commit only on activation.

[^chromium-main-input-panel]: The development branch retains the same virtual-keyboard display request for text-input-v3.

[^mutter-text-input]: Mutter focuses the input method on the first committed enable and turns the input panel on for a later enable while focused.

[^mutter-text-input-version]: Mutter 50.2 advertises text-input-v3 protocol version 2.

[^shell-keyboard]: GNOME Shell opens its keyboard for application windows when the input panel state turns on.

[^gtk-osk]: GTK sends an additional enable to activate the on-screen keyboard from its Wayland input-method context.

[^text-input-3-2]: The protocol update adds requests to show and hide the input panel.

[^chromium-text-input-v3-2]: The Chromium issue tracks protocol version 2 support, including showing and hiding the virtual keyboard.

[^chromium-osk-report]: The report describes the on-screen keyboard not opening for Chromium's own or HTML inputs.

## TD-003 — Conversation archive and deletion

### Desired technical state

The researcher can archive a project-scoped conversation, which hides it from the project history and allows its restoration, and can delete it. Deletion defines and verifies how it treats the conversation's active work, the records that cite its messages, copies held by the provider runtime and the managed pre-migration recovery copies that [ADR-0010](adr/adr-0010-pre-migration-recovery.md#retention-erasure-and-disclosure) requires purging before destructive erasure is claimed.

### Current compromise

[EPIC-003](epics/EPIC-003-research-agents/epic.md) delivers project-scoped conversations that can be created, listed in the project history and renamed. It offers no archive or delete action, so conversation records and their messages remain in the application database. This is a deliberate simplification of the first conversation delivery, not a change to the retention requirements of the [data model](data-model.md#referential-and-lifecycle-invariants) or the [workspace layout](workspace-layout.md#presentation-integration).

### Acceptance evidence

The maintainer postponed archive and delete on 2026-11-08 while preparing EPIC-003, to simplify its first conversation delivery. The handling of active work, dependent records, provider-held copies and recovery copies was not decided; no measurement or implementation evidence is claimed.

### Affected scope

The conversation records, port operations and history surface specified by EPIC-003, and the archive/delete subcases of workspace scenario V14 in [workspace layout](workspace-layout.md#acceptance-scenarios).

### Technical risk or cost

A researcher cannot hide or remove a conversation that contains mistaken, private or restricted material, and project histories only grow. A later delete added without the missing rules could stop work silently, leave findings that cite removed messages without disclosure or report an erasure that recovery copies or provider history contradict.

### Compensating controls

- Offer no archive or delete control, disabled placeholder or menu command until the exit condition is met.
- Keep conversation content out of operational diagnostics under [ADR-0013](adr/adr-0013-private-content-free-structured-logging.md).
- Keep provider-held thread history separate from Ohtia records; Ohtia never claims to control or erase it.

### Claim boundary

Ohtia does not claim that a conversation can be hidden, removed or erased. The archive and delete subcases of V14 are not verified while this entry remains.

### Exit condition

An issue specifies and delivers archive with restoration and delete, with explicit rules for active work, records that cite deleted messages, provider-held copies and recovery-copy purging. Its file-backed storage tests and the archive/delete subcases of V14 pass on the packaged application, and the entry is removed.

### Review trigger

A request to remove private or mistaken conversation content; a conversation retention, export or erasure feature; a change to ADR-0010 recovery copies; or a change to how memory entries or syntheses cite conversation messages. The issue crossing a trigger must take explicit responsibility for resolving or reassessing this entry.

### Owning issue

[EPIC-003, #202](https://github.com/ohtia/ohtia/issues/202) owns this accepted simplification. Implementing the exit requires an issue before code changes, following the contribution rules.
