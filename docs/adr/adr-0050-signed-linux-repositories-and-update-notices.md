---
type: DecisionRecord
title: ADR-0050 — Signed Linux repositories, protected GitHub signing and update notices
description: Distribute Linux through signed apt and dnf repositories, sign in a protected GitHub environment and limit the application to notifying about newer versions.
generated:
  by: claude-code/claude-fable-5-2
verified:
  by: human:AdrianMastronardi
sources:
  - id: r2-pricing
    resource: https://developers.cloudflare.com/r2/pricing/
    title: Cloudflare R2 — Pricing
  - id: pages-limits
    resource: https://developers.cloudflare.com/pages/platform/limits/
    title: Cloudflare Pages — Limits
---

# ADR-0050 — Signed Linux repositories, protected GitHub signing and update notices

## Context

[ADR-0038](adr-0038-desktop-delivery-mechanisms.md) selected an application that downloads and installs its own updates on every platform, authenticated by a signed update catalog, with reviewed native installation adapters on Linux. [ADR-0041](adr-0041-independent-linux-signing-service.md) placed the Linux signing keys in an independently administered service. The story that owned both integrated 27 pull requests without completing one acceptance criterion; most of that work built the signing service, which was never deployed and never signed with a real key, while the update route visible to the researcher did not start.

The project has one maintainer. Whoever controls the maintainer's GitHub account can already integrate code into protected `main`, and that code ends inside any signed package. A signing service administered by the same person therefore added operating cost without adding an independent control.

Three signing placements were considered. The ADR-0041 service keeps keys outside GitHub but needs deployment, provider qualification and continuous maintenance. Manual signing on the maintainer's machine needs no infrastructure but is not operated by GitHub Actions and repeats by hand at every release. A protected GitHub environment keeps signing inside the reviewed workflow with an approval for every use.

Two Linux update routes were considered. The in-application route needs privileged package installation started by the application, recovery from an interrupted installation and an independently authenticated first installation. Package repositories let the operating system download, verify and install updates with its own signature checks, which is the established practice for desktop software on Ubuntu, Debian and Fedora.

## Decision

### Signing

Sign Linux packages and repository indexes in GitHub Actions, in a protected environment named `release-signing` that admits only the `main` branch and requires the maintainer's approval for every run. This replaces the signing service of ADR-0041.

Use one signing identity, the existing OpenPGP key held by the maintainer. Keep the primary certification key and its revocation certificate offline. Store only a signing subkey, valid for one year and renewed annually, with its passphrase as secrets of that environment. The primary key revokes and replaces an exposed subkey without changing the identity that installed systems trust. Commit the public key and record its primary fingerprint; the signing job refuses a subkey that does not belong to it.

Separate building from signing. The build job runs without secrets. The signing job receives the built package, checks its digest, signs and verifies; it installs no project dependency and runs no project code. Pull-request jobs never receive the environment.

Sign each RPM with an embedded OpenPGP signature and compute final digests after signing. Do not embed a signature in the DEB: apt authenticates packages through the signed repository index.

### Linux repositories

Distribute Linux through three signed package repositories: apt repositories for Ubuntu and for Debian, whose packages differ, and a dnf repository for Fedora. Each package registers its repository and the public key on installation, so the first installation from a downloaded package file enables later updates through the operating system. The in-application DEB and RPM installation adapters of ADR-0038 are not built.

Host the repositories on Cloudflare R2 behind `packages.ohtia.com`, with the zone first in the path: `stable` for the public repositories and `test` for qualification. R2 charges no egress and offers 10 GB-month of standard storage without charge;[^r2-pricing] Cloudflare Pages limits a file to 25 MiB and cannot hold packages of about 130 MiB.[^pages-limits] The address belongs to the maintainer's domain, so the storage provider can change without changing what installed systems reference. The `test` zone is publicly reachable but unlinked; protecting it with credentials is deferred.

GitHub Releases holds the packages for manual download, the release notes and the latest published version. There is one public channel, stable; a preview channel is deferred. The `prepare-release.yml` and `publish-release.yml` workflows cover Linux, macOS and Windows with one independent job per platform, and attach unsigned macOS and Windows packages as testing-only assets until [their signing stories](../epics/EPIC-001-desktop-foundation/index.md) pass. Publication removes every unsigned asset, so a public release holds only signed packages. A separate manual `withdraw-release.yml` workflow stops offering a published version: it republishes the signed `stable` indexes without it and marks its GitHub Release as a prerelease, keeping the version's tags and assets.

### Application

The application only checks and notifies on Linux, Windows and macOS. On startup, behind a setting that is enabled by default and changed in Settings, the trusted main process asks GitHub for the latest published version. It sends no research content or identifier. When a newer version exists, a quiet button appears in the title bar and opens a dialog that explains how to update on the current system. The application never downloads or installs an update. This replaces the user-invoked-only checking of ADR-0038.

Remove the Ed25519 signed update catalog. Its purpose was to authenticate what the application downloaded and installed; with a notify-only application nothing consumes it. A forged notice can at most send the researcher to the system software centre or the official download page, where the operating system's signature checks or the platform's publisher signature still apply. The catalog returns only with a later decision that makes the application install updates.

### Scope of earlier decisions

ADR-0041 is deprecated. ADR-0038 keeps its package formats, maintainer-script rules, sandbox rules and the macOS and Windows assignments. [ADR-0049](adr-0049-main-source-selection-for-packages.md) keeps main-only source selection by commit. [ADR-0021](adr-0021-versioned-desktop-artifacts.md) keeps immutable versions and publication without rebuilding.

## Consequences

Signing needs no service to deploy or maintain, and the remaining release work is workflows, repository indexes and a small notice in the application. Updates reach Linux users with their system updates, authenticated by the system.

The signing subkey is exposed to GitHub and to a compromise of the maintainer's account or of the signing job. The environment approval, the `main`-only rule, a signing job without project code, the yearly subkey expiry and offline revocation bound that exposure; they do not provide hardware isolation. Protect the account with a hardware second factor.

The application no longer controls when a Linux update is installed. A package can be replaced while Ohtia runs, and a schema migration happens at the next start under the existing pre-migration checkpoint of [ADR-0010](adr-0010-pre-migration-recovery.md). The repositories add a hosted surface, a write credential and a signed index to regenerate at every publication. Windows and macOS users update by downloading from the official page until [their distribution stories](../epics/EPIC-001-desktop-foundation/index.md) decide otherwise.
