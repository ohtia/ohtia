---
type: DecisionRecord
title: ADR-0056 — The two most recent Fedora releases
description: Support the two most recent Fedora releases as exact Linux profiles, each with its own RPM and native cells, adding each new release and retiring the oldest.
generated:
  by: claude-code/claude-opus-5-5
verified:
  by: human:AdrianMastronardi
sources:
  - id: fedora-lifecycle
    resource: https://docs.fedoraproject.org/en-US/releases/lifecycle/
    title: Fedora release life cycle
  - id: fedora-45-libc
    resource: https://packages.fedoraproject.org/pkgs/glibc/glibc/fedora-45.html
    title: Fedora 45 libc package baseline
---

# ADR-0056 — The two most recent Fedora releases

## Context

[ADR-0042](adr-0042-wayland-only-linux-support.md) and [ADR-0046](adr-0046-required-kde-plasma-desktop-and-native-cell-identifiers.md) left one Fedora profile, Fedora 44, on each Linux CPU, and the [desktop foundation contract](../desktop-foundation-contract.md) did not admit another release. Fedora publishes a release about every six months and supports release N until four weeks after release N+2, so two releases are supported at most times.[^fedora-lifecycle] Fedora 45 is released, and the RPM of Ohtia 0.1.0 refuses to install on it. The profile name was also written into the code of the quality, qualification and packaging tooling.

## Decision

Linux supports the two most recent Fedora releases, today Fedora 44 and Fedora 45, on x86-64 and ARM64. Each release is an exact distribution profile in the [target manifest](../../config/desktop/targets.json):

- its own glibc minimum, 2.43 for Fedora 44 and 2.44 for Fedora 45;[^fedora-45-libc]
- its own RPM package, whose install check accepts only that release;
- its own native GNOME and KDE Plasma 6 Wayland cells, Btrfs and enforcing SELinux;
- its own native qualification image.

When Fedora publishes a new release, a change adds its profile. The oldest profile then stays only while the minimum retirement notice of [ADR-0038](adr-0038-desktop-delivery-mechanisms.md#retention-and-retirement) runs, and a second change retires it, following that procedure against Fedora's actual end of support. The contract check requires two Fedora profiles with consecutive releases on each Linux CPU, or three during a retirement notice, and the same releases on both CPUs.

Code never names a Fedora release. Scripts and tooling read the Fedora profiles from the target manifest. The few files that run alone on a guest read the release from the admitted profile id, `fedora-<release>`.

## Consequences

The required scope has four distribution profiles per Linux CPU: sixteen Linux cells and nineteen required native records across all platforms. The recurring hosted matrix gains a Fedora 45 GNOME and KDE pair of native x64 KVM guests, fourteen cells in all, and the ARM64 qualification on Scaleway needs a Fedora 45 image. Each release ships one more RPM per CPU once the release platform declaration lists it.

Adding a release costs one configuration change, a native qualification image, CI time for two more cells and the native evidence for each new cell. A gap between releases, a fourth Fedora profile, different releases on the two CPUs or a newer release with an older glibc fails the contract check.

[^fedora-lifecycle]: Fedora's release life cycle states that release N is supported until four weeks after the release of N+2.

[^fedora-45-libc]: The Fedora 45 package page lists glibc 2.44; it does not establish Ohtia native loading.
