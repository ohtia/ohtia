---
type: DecisionRecord
title: ADR-0042 — Wayland-only Linux desktop support
description: Retire Ubuntu 24.04 and X11 from the required Linux desktop contract, leaving three distribution profiles per CPU on native GNOME Wayland.
generated:
  by: claude-code/claude-opus-5-5
verified:
  by: human:AdrianMastronardi
sources:
  - id: gnome-50
    resource: https://linuxiac.com/gnome-50-ends-the-x11-era-after-decades/
    title: GNOME 50 removes its X11 session
  - id: plasma-68
    resource: https://www.phoronix.com/news/KDE-Plasma-68-Wayland-Exclusive
    title: KDE Plasma 6.8 becomes Wayland exclusive
  - id: fedora-wayland
    resource: https://fedoraproject.org/wiki/Changes/WaylandOnlyGNOME
    title: Fedora removes the GNOME X11 packages
  - id: debian-13
    resource: https://lwn.net/Articles/1033740/
    title: Debian 13 desktop session availability
---

# ADR-0042 — Wayland-only Linux desktop support

## Context

The [target manifest](../../config/desktop/targets.json) required four distribution profiles per Linux CPU. Ubuntu 24.04 was the only one with a native X11 session, so the contract had ten Linux cells instead of a regular matrix. The [recurring matrix](../../config/quality/build-targets.json) also ran Ubuntu 26.04 X11 cells under Xvfb, a simulated display, although the contract declared Ubuntu 26.04 as Wayland only. Those cells corresponded to no supported session.

Upstream desktops are leaving X11. GNOME 50 and Plasma 6.8 removed their X11 sessions, and Fedora removed the GNOME X11 packages.[^gnome-50][^plasma-68][^fedora-wayland] Debian 13 still offers X11 sessions for GNOME and KDE.[^debian-13] The repository has no published release, so no installed user depends on the retired profile.

The alternatives were to keep Ubuntu 24.04 as a required profile, to keep X11 cells on Ubuntu 26.04 only, and to refuse to start in an X11 session. Keeping Ubuntu 24.04 adds native evidence for one older profile on every signed-installation scenario. Keeping simulated X11 cells produces evidence for a session no supported distribution profile declares. Refusing X11 adds application behavior that protects nothing, because the application source has no X11-specific path.

## Decision

Ubuntu 24.04 stops being a supported Linux profile on both CPUs. X11 stops being a qualified session on every Linux profile. Linux support is Wayland only, with Ubuntu 26.04, Fedora 44 and Debian 13 on x86-64 and ARM64, each on native GNOME Wayland. That is six required Linux cells and nine required native records across all platforms.

This replaces the Ubuntu 24.04 and X11 parts of the recurring matrix in [ADR-0020](adr-0020-github-policy-and-trusted-ci.md#recurring-hosted-quality-matrix) and of the package grouping example in [ADR-0038](adr-0038-desktop-delivery-mechanisms.md#packages-and-tools). The recurring matrix has eight cells and ten package results on six runner labels. The rule that several session cells of one OS, profile and CPU consume one sealed package remains in force.

The [target manifest](../../config/desktop/targets.json) declares the glibc minimum per distribution profile: 2.43 for Ubuntu 26.04 and Fedora 44, and 2.41 for Debian 13. Each profile is verified natively on its own cells. Delivery admission refuses an Ubuntu-profile package in a Debian 13 cell. The manual ARM facility has no hosted Debian runner, so it constructs its unsigned Debian-profile DEB on a hosted Ubuntu ARM runner from the pinned prebuilt runtime and addon. Its execution on Debian 13 is what establishes that profile.

Ohtia does not refuse to start in an X11 session. Such a session is unqualified and carries no support guarantee. The [Linux E2E image](../linux-e2e.md) keeps its pinned Playwright base and its Xvfb display, because it is a sandboxed test environment and promises nothing about the Linux product floor.

## Consequences

Researchers on institutional machines that remain on Ubuntu 24.04 must upgrade to Ubuntu 26.04 before installing Ohtia. An X11-only regression in a future Electron version will no longer be caught by the package matrix. The X11 libraries Electron loads stay in the Linux runtime prerequisites, because the executable needs them in any session.

Evidence for the retired cells stays in Git history and in the closed [native qualification issue](https://github.com/ohtia/ohtia/issues/32). The evidence for the retained cells remains valid and is not repeated. The [native foundation report](../native-foundation-report.md) describes the retained cells.

Restoring a retired profile or session requires a new decision and complete native evidence for each restored cell.

[^gnome-50]: GNOME 50 ends its X11 session.

[^plasma-68]: Plasma 6.8 ships Wayland only.

[^fedora-wayland]: Fedora documents the removal of the GNOME X11 packages.

[^debian-13]: Debian 13 still offers X11 sessions for GNOME and KDE.
