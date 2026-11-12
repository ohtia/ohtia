---
type: DecisionRecord
title: ADR-0038 — Native desktop packages with independently gated platform distribution
description: "Select native package profiles, shared display-session qualification and package authenticity with independently gated platform distribution."
generated:
  by: claude-code/claude-fable-5-2
verified:
  by: human:AdrianMastronardi
sources:
  - id: builder
    resource: https://www.electron.build/v26/docs/features/auto-update/
    title: electron-builder stable update documentation
  - id: rpm-updater
    resource: https://github.com/electron-userland/electron-builder/blob/electron-updater%406.8.11/packages/electron-updater/src/RpmUpdater.ts
    title: Selected updater RPM installation behavior
  - id: rpm-version
    resource: https://rpm.org/docs/6.0.x/man/rpm-version.7
    title: RPM native version and prerelease ordering
  - id: deb-version
    resource: https://www.debian.org/doc/debian-policy/ch-controlfields.html#version
    title: Debian package version ordering
  - id: rpm-target
    resource: https://www.electron.build/v26/docs/api/electron-builder.interface.configuration/
    title: Stable builder RPM target
  - id: ubuntu-sandbox
    resource: https://documentation.ubuntu.com/release-notes/24.04/#unprivileged-user-namespace-restrictions
    title: Ubuntu user-namespace admission and per-application profiles
  - id: deb-scripts
    resource: https://github.com/electron-userland/electron-builder/tree/electron-builder%4026.18.0/packages/app-builder-lib/templates/linux
    title: Published builder privileged Linux installation templates
  - id: deb-updater
    resource: https://github.com/electron-userland/electron-builder/blob/electron-updater%406.8.11/packages/electron-updater/src/DebUpdater.ts
    title: Selected updater DEB installation behavior
  - id: mac
    resource: https://www.electron.build/v26/docs/notarization/
    title: electron-builder notarization
  - id: windows
    resource: https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool
    title: Microsoft SignTool
---

# ADR-0038 — Native desktop packages with independently gated platform distribution

## Context

The [foundation contract](../desktop-foundation-contract.md) defines the required native OS/CPU cells and optional extensions, usable unsigned contributor packages and separately qualified signed distribution. [ADR-0021](adr-0021-versioned-desktop-artifacts.md) and [release policy](../release-policy.md) prohibit rebuilding during promotion, version reuse, automatic schema downgrade and publication inferred from CI. Installer convenience cannot remove Linux ARM64 or turn a provider signing facility into an assumed capability.

Consider electron-builder with electron-updater, Electron Forge with the built-in updater, and platform-specific MSIX/package-manager/store distribution. The builder pair supports NSIS, DEB, RPM and macOS delivery under one tool family; built-in Electron updating does not provide the required Linux path. Forge remains a valid alternative but would need additional Linux update and unified immutable-asset integration. MSIX, Flatpak/Snap and app stores add authority, package-policy and sandbox assumptions across only subsets of the matrix. They are not initial distribution mechanisms. A manually downloaded replacement is useful recovery, but does not qualify an authenticated updater.[^builder]

## Decision

### Qualification phases

Keep the complete required desktop target inventory. The [foundation delivery contract](../epics/EPIC-001-desktop-foundation/epic.md#spec-001-028-linux-first-delivery-and-platform-capability-admission) assigns common Actions-operated build/sign/verify interfaces, real Linux signing and all required Linux installation/update cells to story 013, currently six under [ADR-0042](adr-0042-wayland-only-linux-support.md); candidate/publication mechanisms to 015/016; and all-platform common native/runtime/contributor acceptance plus Linux delivery integration to 017. Retain native macOS/Windows builds, packaged smoke and verified retained-artifact GitHub provenance immediately; these attestations do not require platform publisher certificates and do not replace them.

Real macOS Developer ID/notarization, final DMG/ZIP and signed user-route qualification belong to [story 019](../epics/EPIC-001-desktop-foundation/STORY-001-019-qualify-signed-macos-distribution.md). Real Windows Authenticode/publisher/timestamp and signed user-route qualification belong to [story 020](../epics/EPIC-001-desktop-foundation/STORY-001-020-qualify-signed-windows-distribution.md). Both consume the completed common foundation independently; neither blocks 013/015/016/017 or interface development against delivered common outputs. Native foundation, storage, privacy, assistive and contributor requirements on those platforms remain in scope now.

The shared candidate manifest records every required platform's build/provenance, native-runtime and distribution-qualification evidence and eligibility. Only qualified signed platforms may enter distribution; absent/unknown/revoked evidence fails closed. Deferred platforms stay required and distribution ineligible, not optional or silently omitted. Linux-only controlled infrastructure rehearsal does not authorize a public Linux-only product or an unsigned preview. Full-platform publication requires real platform facilities and all required final native results. An unsigned macOS or Windows package is a testing-only asset of the unpublished release under [ADR-0050](adr-0050-signed-linux-repositories-and-update-notices.md); publication removes it, so a public release holds only signed packages. A newly enabled signer changes final bytes and requires a new candidate/version, never replacement of an earlier sealed internal package.

### Packages and tools

Use electron-builder `26.18.*` for packaging, with exact candidate patches and integrity in the [toolchain manifest](../../config/desktop/toolchain.json). The manifest also pins electron-updater `6.8.*`; the application does not use it to download, stage or install updates, following [ADR-0050](adr-0050-signed-linux-repositories-and-update-notices.md). This is a provisional mechanism selection with rejection tests, not evidence that the selected tools already satisfy Ohtia's admission rules. Their mutable latest tags and newer documentation are not configuration authority. 002 locks transitive helpers before any build.

Select separate DEB packages for the Ubuntu and Debian profiles and RPM packages for the Fedora profiles explicitly assigned to each CPU in the [target manifest](../../config/desktop/targets.json), a per-user offline NSIS installer for each Windows architecture, and separate DMG plus ZIP artifacts for each macOS architecture. Unsigned quality packages use the applicable same formats and development identities under isolated profiles; [ADR-0020](adr-0020-github-policy-and-trusted-ci.md#recurring-hosted-quality-matrix) selects their recurring hosted CI scope independently of final distribution qualification. NSIS web installers, Windows per-machine elevation and cross-architecture installer bundles are excluded. Linux package installation uses explicit native administrator authorization; the running application and its research service remain unprivileged. macOS ZIP is not a substitute for native DMG installation testing. Do not select universal macOS output unless both slices receive independent qualification.[^builder]

X11 and Wayland are native qualification environments, not separate Linux distribution packages. For each selected CPU and distribution package profile, build and seal one final package and exercise those same bytes in every display session assigned to it, following [ADR-0021](adr-0021-versioned-desktop-artifacts.md). In particular, Ubuntu 24.04 X11 and Wayland on one CPU share a DEB; Ubuntu and Debian keep their distinct installation-policy profiles. Reuse across other declared OS versions requires explicit assignment and complete native evidence for each version; format or filename equality does not establish compatibility. Keep the target manifest's session requirements: every Linux profile requires its GNOME and KDE Plasma Wayland cells, and this grouping does not add X11 support or remove any required cell. [ADR-0042](adr-0042-wayland-only-linux-support.md) retires Ubuntu 24.04 and X11; the rule that session cells of one OS/profile/CPU share one sealed package remains. [ADR-0046](adr-0046-required-kde-plasma-desktop-and-native-cell-identifiers.md) makes GNOME and KDE Plasma the two desktop cells of every Linux profile, and both consume that profile's one sealed package.

Select DEB for the declared Ubuntu floor because a fixed, root-owned executable path permits a narrowly scoped installed AppArmor user-namespace allowance while preserving Chromium sandboxing. Portable AppImage is rejected initially: arbitrary user-writable paths, FUSE/extraction and stock Ubuntu's user-namespace restrictions add unresolved sandbox provisioning. The installer must explain and authorize its system-package/profile changes, bind the allowance to the trusted installation executable rather than a wildcard writable path, and verify load/removal/upgrade behavior. Never disable AppArmor globally, use no-sandbox flags, run the product as root or treat the allowance as general parser confinement. 018 tests minimal native feasibility for Ubuntu/DEB and Fedora/RPM on both Linux CPUs; 013 owns final signed package/profile installation and recovery.[^ubuntu-sandbox]

The declared Debian profiles on both CPUs use the same fixed root-owned DEB installation identity, with Debian-specific native namespace admission. Require enabled AppArmor and unprivileged user namespaces, and reject a vendor namespace restriction that has not been qualified. Refuse an existing Ohtia Ubuntu-specific namespace allowance rather than replacing, unloading or silently adopting it. The Debian package hooks do not install that allowance or change global sysctls. Actual Chromium sandbox and native Wayland sessions still require independent 018 observations on each CPU.

The integrity-checked published app-builder-lib package supplies default DEB scripts that can set `chrome-sandbox` to mode 4755, skip a rejected AppArmor profile, ignore unload/mode errors and force symlink fallbacks. The same FPM target also supplies these scripts to RPM builds; Fedora must not inherit their AppArmor assumptions or SUID fallback. Prohibit those stock install/remove scripts and their implicit setuid fallback. 012/013 package only reviewed Ohtia-owned maintainer scripts/profile bytes: no setuid-root helper, wildcard/user-writable executable allowance, arbitrary metadata-selected commands, silent profile skip or ignored security-state failure. Validate fixed root-owned destination paths and dependencies before changing system state; require successful profile load and observed sandbox admission before activation. Reconcile profile unload/removal and prior installation recovery on uninstall, upgrade and interruption, preserving explicit failed/uncertain outcomes. The repository source entry and public key that each package registers under [ADR-0050](adr-0050-signed-linux-repositories-and-update-notices.md) are packaged files at fixed root-owned paths under the same review, and removing the package removes them. Desktop integration conveniences cannot hide failed security invariants. 018 probes this feasibility and 013 qualifies the final privileged transitions; no script is implemented or certified here.[^deb-scripts]

Story 020 must demonstrate native x64 NSIS installation, publisher identity and locked-file/restart behavior; optional ARM64 requires its own independent native qualification if included. Story 019 must demonstrate native macOS signing of nested helpers and addons, hardened runtime with minimal entitlements, notarization, stapling and Gatekeeper acceptance. Disabling renderer sandboxing or widening entitlements to make a probe pass rejects the proposed path.[^mac]

For Linux, the operating system's package manager installs and updates Ohtia from the signed apt and dnf repositories of [ADR-0050](adr-0050-signed-linux-repositories-and-update-notices.md). The application starts no package installation and contains no DEB or RPM installation adapter. The inspected stock `DebUpdater` can invoke unauthenticated/downgrade/held-package overrides and global dependency-repair fallbacks. The stock `RpmUpdater` can disable GPG checks, allow unsigned packages or bypass dependencies/replace files. Prohibit both installation paths, including `--nogpgcheck`, `--allow-unsigned-rpm`, `--nodeps` and forced file replacement. Installation from a downloaded package file and every later update keep the package manager's signature verification, dependency admission and locks under explicit native administrator authorization. A missing dependency or denied authorization leaves the current installation usable, without changing unrelated packages or policy. The system can replace the package while Ohtia runs; schema admission happens at the next start under [ADR-0010](adr-0010-pre-migration-recovery.md). Stock dpkg/dnf/rpm success alone does not establish data safety.[^deb-updater][^rpm-updater]

Fedora RPM packaging uses the selected builder's declared RPM target and a frozen rpmbuild/FPM helper toolchain from 002/012. Its native names are `x86_64` and `aarch64`. Preserve Fedora's targeted SELinux enforcing policy and correct labels on fixed root-owned installation paths; do not switch to permissive mode, disable policy globally or auto-generate broad allow rules. Custom install/remove/upgrade scripts receive the same explicit review, path/permission checks and failure handling as DEB scripts. Fedora Atomic variants and other RPM distributions are outside this initial qualification profile.[^rpm-target]

### Authenticity and updates

Windows distribution uses Authenticode with a maintainer-provisioned certificate or qualified remote signing facility and timestamped signatures. Verify chain, intended publisher and signed bytes on the final native package; 020 selects and qualifies the actual Windows facility before that guarantee is enabled. macOS uses Apple Developer ID Application signing, hardened runtime, notarization and stapling. Verify on clean native systems, including offline stapling behavior. Ad-hoc signing may enable isolated contributor tests; it establishes no distribution identity. Signing never promises warning-free installation or SmartScreen reputation.[^windows][^mac]

RPM distribution additionally requires a native package signature from a qualified maintainer-controlled OpenPGP identity, with explicit expected-key verification rather than treating an unsigned/NOKEY warning as success. Complete RPM signing before recording final digests. [ADR-0050](adr-0050-signed-linux-repositories-and-update-notices.md) selects that identity, its custody in the protected `release-signing` GitHub environment and the signed apt and dnf repository indexes; the DEB carries no embedded signature because the signed apt index authenticates it. 018 may use an independent ephemeral qualification key and trust database for feasibility; it does not establish the official release identity or authorize changes to stable trust roots. 013 qualifies actual RPM signature, installation and recovery on Fedora 44 for both CPUs.

The application verifies no update metadata. [ADR-0050](adr-0050-signed-linux-repositories-and-update-notices.md) limits it to checking for a newer version and announcing it, so there is no signed update catalog and no distribution key pinned in the application. The authenticity of an installed or updated package comes from the operating system's verification of the signed apt index or the RPM signature on Linux and from the platform publisher signature on Windows and macOS. SHA-256 and HTTPS alone do not authenticate a Linux release. No private key ships in the application or its packages. Real macOS/Windows signing capabilities are added only after 019/020 qualify them.

First installation uses a package file downloaded from GitHub Releases. That package registers its repository and public key, and later updates arrive through the operating system, following [ADR-0050](adr-0050-signed-linux-repositories-and-update-notices.md); there is no separately authenticated graphical bootstrap route, and the release's digest file and GitHub build attestation identify the published bytes. The user cannot be required to install a developer runtime or use a terminal. An exposed signing subkey is revoked and replaced with the offline primary key, which keeps the identity that installed systems trust.

There is one public channel, stable; the `test` repository zone serves qualification only and a preview channel is deferred, following [ADR-0050](adr-0050-signed-linux-repositories-and-update-notices.md). Development and qualification builds do not check for updates. Use SemVer precedence with prerelease identifiers, never build metadata as an ordering signal; the application announces only a final version greater than the running one. Preserve permanent reservations for rejected/internal candidates.

The application only checks and notifies on Linux, Windows and macOS, following [ADR-0050](adr-0050-signed-linux-repositories-and-update-notices.md). A startup check, behind a setting that is enabled by default and changed in Settings, asks GitHub for the latest published release, and a quiet title-bar button opens a dialog that explains how to update on the current system. The application never downloads, stages or installs an update. Review the bounded main-process network contract, endpoint/operator disclosure, accessible/localized action and error paths before implementation. Preserve the no-default-usage-analytics and research-content privacy contracts. A system-installed update cannot bypass schema preflight at the next launch. No automatic mutation replay, database downgrade or assertion that executable rollback restores research data is permitted. [ADR-0010](adr-0010-pre-migration-recovery.md) owns checkpoint recovery.

For both Linux formats, derive the native package version from the application SemVer. The supported prerelease form is `dev.<run>.<attempt>`; package tooling must not accept an unqualified alternative automatically. Provisionally map the SemVer core to the native version, replacing the prerelease separator with `~`, with native release/revision `1` and no nonzero epoch. Build metadata is not an ordering input. The tilde mapping follows the native version systems rather than passing an invalid RPM dash through unchanged.[^rpm-version][^deb-version] Verify native comparison with the selected Debian/RPM tools, including dev numeric ordering and prerelease → final, before publishing to a repository; a failed mapping requires reviewed correction before package delivery. 012 may use the declared provisional mapping for isolated unsigned quality artifacts before that qualification. Native version comparisons never bypass schema admission or authorize a database downgrade.

### Promotion, licenses and qualification

Finish all package construction, signing, timestamping, notarization and stapling transformations before recording final digests. A DMG and its ZIP have distinct immutable identities. Record those digests in the release's digest file; publication only copies the verified final package set and publishes the signed Linux repository indexes generated from it, following [ADR-0050](adr-0050-signed-linux-repositories-and-update-notices.md). A rebuild, re-sign, changed embedded version or replacement file requires a new candidate/version. Differential payloads are excluded.

Retain upstream license/notices for Electron/Chromium, npm packages, native addons, SQLite, fonts and installer/updater helpers, with an actual final-artifact inventory. The builder/updater packages' MIT labels do not establish the licenses of every bundled helper. Audit DEB/RPM packaging scripts/tools, NSIS and transitive signing/notarization helpers for license, attribution and applicable source-offer obligations; retain required source/material with supported artifacts. Reject a target whose obligations cannot be met rather than omitting its notices. No license-compliance result is claimed from package metadata.

018 tests minimal controlled install/update feasibility for both Ubuntu/DEB and Fedora/RPM, native dependencies, sandbox and filesystem primitives in independent native profiles/VMs using synthetic data and controlled endpoints. It needs no final signing credentials. Linux qualification under [ADR-0050](adr-0050-signed-linux-repositories-and-update-notices.md) installs the signed package and receives the next version through the repository with research data intact: the complete scenario on the GNOME cell of each package and a short scenario on its KDE cell with the same package bytes. 019/020 test the corresponding final publisher-signed macOS/Windows user routes, supported baselines, incompatible schema, wrong target/signature, interruption and safe refusal/recovery. A mechanism that cannot pass requires a reviewed contract/consumer correction; these empirical checks cannot become a return dependency for D1a. The preparation and publication workflows of [ADR-0050](adr-0050-signed-linux-repositories-and-update-notices.md) separately qualify version reservation, exact-byte publication and partial activation/retry.

### Retention and retirement

The [numeric policy](../../config/desktop/resource-policy.json) sets disposable CI artifact retention and minimum retirement notice. 012 explicitly configures that bounded retention for quality artifacts and their run evidence; expiry cannot delete the only copy of a supported release. Candidate packages, full input manifests, verification records, notes and necessary license/source material are retained in separate controlled release storage. Internal failed candidates retain their permanent version reservation and failure identity even when disposable packages expire.

Support the current stable minor line and its immediately preceding stable minor line until the reviewed retirement process completes. Retain every published patch needed as a compatible upgrade/recovery baseline, including a skipped-release path; a newer release's existence does not retire an older schema. Before a platform enters public distribution, its owner (013 for Linux, 019 for macOS, 020 for Windows) qualifies fresh installation, reinstall, wrong/newer-schema refusal and same-candidate continuation; subsequent releases qualify upgrades from each retained supported baseline. Preserve any promised recovery baseline after supersession.

A maintainer identifies the retiring versions/OS floor/schema baselines, publishes the minimum notice, verifies a supported forward path on every affected target and confirms recovery/retention obligations before removing update eligibility. If migration or retained research still needs a baseline, extend retention. Retirement never reuses versions, overwrites bytes or silently deletes recovery material. Preserve version/source/digest identity, notes, retirement/withdrawal reason, security advisories and verification provenance indefinitely; archived packages and required source remain available for the declared recovery obligations. A withdrawal disables recommendation/admission promptly while preserving identity and a safe next action, rather than waiting for the retirement notice. Data erasure and local checkpoint retention remain governed by ADR-0010, independently of release-artifact retention.

## Consequences

The selected family reduces separate packaging integrations and keeps ordinary contributor builds independent of signing credentials. Linux repository trust, signing-subkey custody and schema preflight after a system-installed update remain implementation and qualification responsibilities under [ADR-0050](adr-0050-signed-linux-repositories-and-update-notices.md). Tool support or successful signature verification alone cannot establish data safety or public readiness. Reconsider the mechanism if any required native cell, license obligation, authority control or recovery path fails; preserve the matrix and immutable-artifact contract during correction.

[^builder]: The stable tool documentation describes supported update formats and the additional macOS ZIP requirement.

[^mac]: Upstream documents Apple signing/notarization/stapling integration; actual credentials, entitlement scope and native acceptance need their own evidence.

[^windows]: Microsoft documents SignTool signing and verification; an invocation alone is not a verified native result.

[^ubuntu-sandbox]: Ubuntu documents application-specific user-namespace admission; the actual installed path/profile and active Electron sandbox require native evidence.

[^deb-updater]: The pinned updater source and inspected published package reveal installation fallbacks that Ohtia must not enable; the application invokes neither path.

[^deb-scripts]: Inspection of the pinned published package templates confirms privileged and best-effort defaults that the Ohtia contract excludes; native evidence must inspect the final replacement script bytes and resulting state.

[^rpm-updater]: The pinned RPM updater implementation reveals signature/dependency bypasses that Ohtia must not invoke.

[^rpm-target]: The selected stable builder exposes an RPM target; actual native helper availability, resulting package and update behavior require their assigned qualification.

[^rpm-version]: RPM documents EVR, allowed version characters and tilde prerelease comparison; actual selected-tool comparison still needs qualification.

[^deb-version]: Debian defines upstream version/revision ordering, including tilde treatment; package-format metadata does not establish a successful upgrade.
