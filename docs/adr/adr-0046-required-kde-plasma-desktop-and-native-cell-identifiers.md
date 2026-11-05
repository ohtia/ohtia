---
type: DecisionRecord
title: ADR-0046 — Required KDE Plasma desktop and native cell identifiers
description: Require KDE Plasma 6 beside GNOME on every Linux profile and CPU, and name every native cell by its target, profile and Linux desktop.
generated:
  by: claude-code/claude-opus-5-5
sources:
  - id: kde-desktop
    resource: "Maintainer-approved EPIC-001 KDE Plasma desktop qualification and native cell identifiers, 2026-11-02 and 2026-11-05"
    title: KDE Plasma as a required Linux desktop with one identifier per native cell
  - id: kubuntu-support
    resource: https://www.theregister.com/a/5288531
    title: Kubuntu 26.04 vendor support period
---

# ADR-0046 — Required KDE Plasma desktop and native cell identifiers

## Context

[ADR-0042](adr-0042-wayland-only-linux-support.md) left three Linux distribution profiles per CPU, each on native GNOME Wayland. GNOME was implicit: a native cell was a target, a profile and a display backend, and the session launchers, the native focus helper and the identity checks were fixed to GNOME and to Fedora Workstation. Every supported distribution also publishes an official KDE Plasma 6 desktop, and Plasma is a common desktop for the researchers Ohtia serves.

Cell identifiers mixed three naming styles. Hosted Ubuntu cells named their display backend, KVM guests and Scaleway guests named where they ran, and Windows and macOS cells named neither the target nor, on Windows, the operating-system version. Delivery admission already used a fourth form, `<target>-<profile>-<backend>`. Wayland is the only Linux backend, so the backend no longer distinguishes cells, and the place where a cell runs is not part of what it qualifies.

The alternatives were to keep KDE outside the contract, to qualify it as an optional desktop that cannot block results, to build separate packages per desktop, and to keep the existing identifiers while adding a desktop suffix. An optional desktop would let a KDE regression pass every required result. Separate packages would multiply the sealed artifacts without a package difference: both desktops run the same executable. Keeping the old identifiers would leave four naming styles and an identifier that names a test environment instead of a cell.

## Decision

KDE Plasma 6 on Wayland is a required Linux desktop with the same standing as GNOME on Ubuntu 26.04, Fedora 44 and Debian 13, on x86-64 and ARM64. Each Linux profile in the [target manifest](../../config/desktop/targets.json) declares both desktops, which gives twelve required Linux cells and fifteen required native records across all platforms. KDE means each distribution's official desktop identity without GNOME: Fedora KDE, Ubuntu with its `kubuntu-desktop` metapackage, and Debian with its KDE task. KDE cells install that official set without recommended or weak dependencies and add the session, portal, accessibility and GTK theme packages that the application uses. Recurring KDE cells are required from the change that first passes them.[^kde-desktop]

KDE adds native cells, not packages. The GNOME and KDE cells of one profile and CPU consume the same sealed package under [ADR-0038](adr-0038-desktop-delivery-mechanisms.md#packages-and-tools), so the shared-package rule applies to real cells rather than synthetic fixtures.

Every native cell on every platform has one identifier, `<target>-<profile>`, followed by `-<desktop>` on Linux. The target is the manifest's Node.js and Electron platform name and CPU, such as `linux-x64` or `win32-arm64`; the profile is the operating-system profile with dots replaced by hyphens. The same identifier is used in recurring CI, KVM guests, Scaleway guests, evidence and delivery admission. A hosted cell keeps the profile it actually runs: the Windows x64 job is `win32-x64-windows-server-2025`, distinct from the Windows 11 admission cell that Windows Server does not qualify. Recurring jobs declare how they run in a `launcher` field instead of an identifier suffix, and the full-suite job is `full-suite (linux-x64-ubuntu-26-04)`, without a desktop because it runs no desktop session. [SPEC-001-031](../epics/EPIC-001-desktop-foundation/epic.md#spec-001-031-kde-plasma-desktop-qualification) owns the cell table, the identity rules, the Plasma session launcher and the required evidence.

## Consequences

The recurring matrix grows from eight to twelve cells and from ten to fourteen package results on the same six hosted runner labels. KDE cells take longer to install than GNOME cells, and the ARM64 Fedora and Debian KDE cells add paid ephemeral guest runs under [TD-001](../technical-debt.md#td-001--fedora-and-debian-arm64-guests-in-recurring-ci). The application's scoped KDE Wayland color fallback in [ADR-0044](adr-0044-linux-graphics-compatibility.md) now applies to qualified cells.

Kubuntu 26.04 has a shorter vendor support period than Ubuntu 26.04, until April 2029; the KDE cell's end of support follows the existing retirement procedure.[^kubuntu-support] Retained evidence from earlier runs keeps the identifiers it was recorded with. Adding another desktop requires a new decision and complete native evidence for each of its cells.

[^kde-desktop]: Approves KDE Plasma 6 as a required Linux desktop with GNOME parity, official distribution identities and one identifier per native cell on every platform.

[^kubuntu-support]: Reports that Kubuntu 26.04 receives vendor support until April 2029.
