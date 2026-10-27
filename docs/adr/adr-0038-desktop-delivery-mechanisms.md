---
type: DecisionRecord
title: ADR-0038 — Native desktop packages with authenticated update admission
description: Select provisional six-target packages, native signing and updater admission while preserving immutable candidate bytes and recovery boundaries.
generated:
  by: codex/gpt-6.1-sol
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
  - id: crypto
    resource: https://nodejs.org/api/crypto.html#cryptoverifyalgorithm-data-key-signature
    title: Node signature verification
---

# ADR-0038 — Native desktop packages with authenticated update admission

## Context

The [foundation contract](../desktop-foundation-contract.md) defines the required native OS/CPU cells and optional extensions, usable unsigned contributor packages and separately qualified signed distribution. [ADR-0021](adr-0021-versioned-desktop-artifacts.md) and [release policy](../release-policy.md) prohibit rebuilding during promotion, version reuse, automatic schema downgrade and publication inferred from CI. Installer convenience cannot remove Linux ARM64 or turn a provider signing facility into an assumed capability.

Consider electron-builder with electron-updater, Electron Forge with the built-in updater, and platform-specific MSIX/package-manager/store distribution. The builder pair supports NSIS, DEB, RPM and macOS delivery under one tool family; built-in Electron updating does not provide the required Linux path. Forge remains a valid alternative but would need additional Linux update and unified immutable-asset integration. MSIX, Flatpak/Snap and app stores add authority, package-policy and sandbox assumptions across only subsets of the matrix. They are not initial distribution mechanisms. A manually downloaded replacement is useful recovery, but does not qualify an authenticated updater.[^builder]

## Decision

### Packages and tools

Use electron-builder `26.18.*` for packaging and electron-updater `6.8.*` for updater transport/staging, with exact candidate patches and integrity in the [toolchain manifest](../../config/desktop/toolchain.json). This is a provisional mechanism selection with rejection tests, not evidence that the selected tools already satisfy Ohtia's admission rules. Their mutable latest tags and newer documentation are not configuration authority. 002 locks transitive helpers before any build; 013 verifies exact updater behavior rather than borrowing defaults from a different major.

Select separate DEB packages for the Ubuntu and Debian profiles and RPM packages for the Fedora profiles explicitly assigned to each CPU in the [target manifest](../../config/desktop/targets.json), a per-user offline NSIS installer for each Windows architecture, and separate DMG plus ZIP artifacts for each macOS architecture. Unsigned quality packages use these same formats and development identities under isolated profiles. NSIS web installers, Windows per-machine elevation and cross-architecture installer bundles are excluded. Linux package installation uses explicit native administrator authorization; the running application and its research service remain unprivileged. macOS ZIP is an update payload, not a substitute for native DMG installation testing. Do not select universal macOS output unless both slices receive independent qualification.[^builder]

Select DEB for the declared Ubuntu floor because a fixed, root-owned executable path permits a narrowly scoped installed AppArmor user-namespace allowance while preserving Chromium sandboxing. Portable AppImage is rejected initially: arbitrary user-writable paths, FUSE/extraction and stock Ubuntu's user-namespace restrictions add unresolved sandbox provisioning. The installer must explain and authorize its system-package/profile changes, bind the allowance to the trusted installation executable rather than a wildcard writable path, and verify load/removal/upgrade behavior. Never disable AppArmor globally, use no-sandbox flags, run the product as root or treat the allowance as general parser confinement. 018 tests minimal native feasibility for Ubuntu/DEB and Fedora/RPM on both Linux CPUs; 013 owns final signed package/profile installation and recovery.[^ubuntu-sandbox]

The declared Debian profiles on both CPUs use the same fixed root-owned DEB installation identity, with Debian-specific native namespace admission. Require enabled AppArmor and unprivileged user namespaces, and reject a vendor namespace restriction that has not been qualified. Refuse an existing Ohtia Ubuntu-specific namespace allowance rather than replacing, unloading or silently adopting it. The Debian package hooks do not install that allowance or change global sysctls. Actual Chromium sandbox and native Wayland sessions still require independent 018 observations on each CPU.

The integrity-checked published app-builder-lib package supplies default DEB scripts that can set `chrome-sandbox` to mode 4755, skip a rejected AppArmor profile, ignore unload/mode errors and force symlink fallbacks. The same FPM target also supplies these scripts to RPM builds; Fedora must not inherit their AppArmor assumptions or SUID fallback. Prohibit those stock install/remove scripts and their implicit setuid fallback. 012/013 package only reviewed Ohtia-owned maintainer scripts/profile bytes: no setuid-root helper, wildcard/user-writable executable allowance, arbitrary metadata-selected commands, silent profile skip or ignored security-state failure. Validate fixed root-owned destination paths and dependencies before changing system state; require successful profile load and observed sandbox admission before activation. Reconcile profile unload/removal and prior installation recovery on uninstall, upgrade and interruption, preserving explicit failed/uncertain outcomes. Desktop integration conveniences cannot hide failed security invariants. 018 probes this feasibility and 013 qualifies the final privileged transitions; no script is implemented or certified here.[^deb-scripts]

Windows qualification must demonstrate native ARM64/x64 NSIS installation, publisher identity and locked-file/restart behavior. macOS qualification must demonstrate native signing of nested helpers and addons, hardened runtime with minimal entitlements, notarization, stapling and Gatekeeper acceptance. Disabling renderer sandboxing or widening entitlements to make a probe pass rejects the proposed path.[^mac]

For Linux, use the updater only for authenticated transport/staging and separate reviewed native package-install adapters for the authorized DEB and RPM. The inspected stock `DebUpdater` can invoke unauthenticated/downgrade/held-package overrides and global dependency-repair fallbacks. The stock `RpmUpdater` can disable GPG checks, allow unsigned packages or bypass dependencies/replace files. Prohibit both installation paths, including `--nogpgcheck`, `--allow-unsigned-rpm`, `--nodeps` and forced file replacement; use a Fedora native adapter that preserves signature verification, dependency admission and package-manager locks. Admit only the exact verified Ohtia package, run schema/quiescence preflight first, preserve package-manager locks and obtain explicit native administrator authorization. Preflight required dependencies; a missing dependency or denied authorization leaves the current installation usable and reports the remediation, without changing unrelated packages or policy. 013 qualifies interrupted package/profile transitions and previous-compatible-executable recovery; stock dpkg/dnf/rpm success alone does not establish atomic activation or data safety.[^deb-updater][^rpm-updater]

Fedora RPM packaging uses the selected builder's declared RPM target and a frozen rpmbuild/FPM helper toolchain from 002/012. Its native names are `x86_64` and `aarch64`. Preserve Fedora's targeted SELinux enforcing policy and correct labels on fixed root-owned installation paths; do not switch to permissive mode, disable policy globally or auto-generate broad allow rules. Custom install/remove/upgrade scripts receive the same explicit review, path/permission checks and failure handling as DEB scripts. Fedora Atomic variants and other RPM distributions are outside this initial qualification profile.[^rpm-target]

### Authenticity and update admission

Windows distribution uses Authenticode with a maintainer-provisioned certificate or qualified remote signing facility and timestamped signatures. Verify chain, intended publisher and signed bytes on the final native package; 013 selects and qualifies the actual facility before the guarantee is enabled. macOS uses Apple Developer ID Application signing, hardened runtime, notarization and stapling. Verify on clean native systems, including offline stapling behavior. Ad-hoc signing may enable isolated contributor tests; it establishes no distribution identity. Signing never promises warning-free installation or SmartScreen reputation.[^windows][^mac]

RPM distribution additionally requires a native package signature from a qualified maintainer-controlled OpenPGP identity, with explicit expected-key verification rather than treating an unsigned/NOKEY warning as success. Complete RPM signing before recording final digests. 018 may use an independent ephemeral qualification key and trust database for feasibility; it does not establish the official release identity or authorize changes to stable trust roots. 013 qualifies actual RPM signature, installation and recovery on Fedora 44 for both CPUs.

Every platform additionally requires a detached Ed25519 signature over the exact UTF-8 update-catalog bytes, verified with a pinned distribution public key through the standard runtime crypto implementation. SHA-256 and HTTPS alone do not authenticate a Linux release. The catalog binds candidate/source identity, permanent application version, channel eligibility, native OS/CPU/package identity, byte length, final package digest, schema source/target admission and release-note identity. No private key ships in the application. 013 owns the concrete catalog schema, serialized representation and cryptographic fixtures, extending the single numeric policy through review before updater implementation; 015/016 bind it to independent signing/publication authority. This decision selects the authority boundary, not a speculative executable format.[^crypto]

The verifier rejects unknown/revoked keys, invalid signatures, unsupported catalog versions, mismatched lengths/digests, unsafe destinations, wrong architectures, expired catalog validity, a replayed catalog sequence and a lower version than the locally retained accepted sequence/version. First installation verifies the same authenticated catalog against the pinned trust root. Freshness and clock uncertainty fail closed with an explicit manual recovery route. Key rotation requires a transition authenticated by the existing trusted key, including overlap and revocation tests; loss/compromise requires separately authenticated maintainer recovery. 013 must qualify provisioning, rotation, revocation, offline first use, clock failure and reinstall/replay behavior before claiming this mechanism complete. It may propose a reviewed established update-metadata framework if the provisional catalog cannot satisfy those tests.

Only a trusted broker can configure updater sources, after catalog admission. Development packages never read public feeds. Preview is explicit opt-in; external metadata can make an already final-version candidate eligible for a new channel without altering its bytes or bootstrap identity. Use SemVer precedence with prerelease identifiers, never build metadata as an ordering signal; stable must not select a preview merely because it is newer. Preserve permanent reservations for rejected/internal candidates. Test preview → stable, stable → preview opt-in, same-version idempotent continuation, revoked releases and downgrade refusal.

Disable automatic download/install defaults until the verified admission path and user-visible update action exist. The platform updater must receive only catalog-authorized exact bytes and cannot bypass schema preflight on quit or next launch. Complete downloads into bounded temporary staging, verify before activation and keep the previous executable available until verified replacement. Kill network, fill disk, corrupt staging, revoke signatures and interrupt each install/activation stage; retain the prior confirmed executable or a controlled recoverable failure. No automatic mutation replay, database downgrade or assertion that executable rollback restores research data is permitted. [ADR-0010](adr-0010-pre-migration-recovery.md) owns checkpoint recovery.

For both Linux formats, bind the application SemVer and native package identity in the catalog. The initial supported prerelease vocabulary is `dev.<run>.<attempt>` and `beta.<sequence>`; package tooling must not accept an unqualified alternative automatically. Provisionally map the SemVer core to the native version, replacing the prerelease separator with `~`, with native release/revision `1` and no nonzero epoch. Build metadata is not an ordering input. The tilde mapping follows the native version systems rather than passing an invalid RPM dash through unchanged.[^rpm-version][^deb-version] 013 verifies native comparison with the selected Debian/RPM tools, including dev/beta numeric ordering and prerelease → final, before enabling updates; a failed mapping requires reviewed correction before package delivery. 012 may use the declared provisional mapping for isolated unsigned quality artifacts before final updater qualification; 013 is not a return prerequisite for those quality builds. Native version comparisons never bypass catalog channel/schema admission or authorize downgrade.

### Promotion, licenses and qualification

Finish all package construction, signing, timestamping, notarization, stapling and update-payload transformations before recording final digests. A DMG and its update ZIP have distinct immutable identities. Prepare updater metadata from those digests; publication only copies the verified final package set and approved metadata. A rebuild, re-sign, changed embedded version or replacement file requires a new candidate/version. Differential payloads are excluded initially to keep exact-byte admission and interruption evidence assessable.

Retain upstream license/notices for Electron/Chromium, npm packages, native addons, SQLite, fonts and installer/updater helpers, with an actual final-artifact inventory. The builder/updater packages' MIT labels do not establish the licenses of every bundled helper. Audit DEB/RPM packaging scripts/tools, NSIS and transitive signing/notarization helpers for license, attribution and applicable source-offer obligations; retain required source/material with supported artifacts. Reject a target whose obligations cannot be met rather than omitting its notices. No license-compliance result is claimed from package metadata.

018 tests minimal controlled install/update feasibility for both Ubuntu/DEB and Fedora/RPM, native dependencies, sandbox and filesystem primitives in independent native profiles/VMs using synthetic data and controlled endpoints. It needs no final signing credentials. 013 tests final signed/notarized installation and authenticated updates on every native cell, supported baselines, incompatible schema, wrong target/signature, interruption and safe refusal/recovery. A mechanism that cannot pass requires a reviewed contract/consumer correction; these empirical checks cannot become a return dependency for D1a. 015/016 separately qualify independent authority, reservation, exact-byte publication and partial activation/retry.

### Retention and retirement

The [numeric policy](../../config/desktop/resource-policy.json) sets disposable CI artifact retention and minimum retirement notice. 012 explicitly configures that bounded retention for quality artifacts and their run evidence; expiry cannot delete the only copy of a supported release. Candidate packages, full input manifests, verification records, notes and necessary license/source material are retained in separate controlled release storage. Internal failed candidates retain their permanent version reservation and failure identity even when disposable packages expire.

Support the current stable minor line and its immediately preceding stable minor line until the reviewed retirement process completes. Retain every published patch needed as a compatible upgrade/recovery baseline, including a skipped-release path; a newer release's existence does not retire an older schema. Before the first public release, 013 qualifies fresh installation, reinstall, wrong/newer-schema refusal and same-candidate continuation; subsequent releases qualify upgrades from each retained supported baseline. Retain public previews while their declared evaluation period remains open and preserve any promised recovery baseline after supersession.

A maintainer identifies the retiring versions/OS floor/schema baselines, publishes the minimum notice, verifies a supported forward path on every affected target and confirms recovery/retention obligations before removing update eligibility. If migration or retained research still needs a baseline, extend retention. Retirement never reuses versions, overwrites bytes or silently deletes recovery material. Preserve version/source/digest identity, notes, retirement/withdrawal reason, security advisories and verification provenance indefinitely; archived packages and required source remain available for the declared recovery obligations. A withdrawal disables recommendation/admission promptly while preserving identity and a safe next action, rather than waiting for the retirement notice. Data erasure and local checkpoint retention remain governed by ADR-0010, independently of release-artifact retention.

## Consequences

The selected family reduces separate packaging integrations and keeps ordinary contributor builds independent of signing credentials, while adding a mandatory authenticated admission layer across all platforms. Linux trust, native updater interruption, schema preflight and catalog/key lifecycle remain substantial implementation and qualification responsibilities. Tool support or successful signature verification alone cannot establish data safety or public readiness. Reconsider the mechanism if any required native cell, license obligation, authority control or recovery path fails; preserve the matrix and immutable-artifact contract during correction.

[^builder]: The stable tool documentation describes supported update formats and the additional macOS ZIP requirement; Ohtia's admission, interruption and schema controls still require implementation.

[^mac]: Upstream documents Apple signing/notarization/stapling integration; actual credentials, entitlement scope and native acceptance need their own evidence.

[^windows]: Microsoft documents SignTool signing and verification; an invocation alone is not a verified native result.

[^crypto]: Node exposes signature verification with supported key types; Ohtia must qualify the selected runtime, key lifecycle and exact catalog bytes.

[^ubuntu-sandbox]: Ubuntu documents application-specific user-namespace admission; the actual installed path/profile and active Electron sandbox require native evidence.

[^deb-updater]: The pinned updater source and inspected published package reveal installation fallbacks that Ohtia must not enable; a separate admission-preserving native installer is required.

[^deb-scripts]: Inspection of the pinned published package templates confirms privileged and best-effort defaults that the Ohtia contract excludes; native evidence must inspect the final replacement script bytes and resulting state.

[^rpm-updater]: The pinned RPM updater implementation reveals signature/dependency bypasses that the Ohtia installation adapter must not inherit.

[^rpm-target]: The selected stable builder exposes an RPM target; actual native helper availability, resulting package and update behavior require their assigned qualification.

[^rpm-version]: RPM documents EVR, allowed version characters and tilde prerelease comparison; actual selected-tool comparison still needs qualification.

[^deb-version]: Debian defines upstream version/revision ordering, including tilde treatment; package-format metadata does not establish a successful upgrade.
