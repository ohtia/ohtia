---
type: Analysis
title: Native foundation qualification report
description: Observed native desktop feasibility, source compatibility, packaging consequences and evidence limits for the required foundation platforms.
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
sources:
  - id: qualification-contract
    resource: ./desktop-foundation-contract.md
    title: Native target, toolchain and resource contract
  - id: qualification-procedure
    resource: ./native-qualification.md
    title: Repeatable native qualification procedure
  - id: qualification-delivery
    resource: ./adr/adr-0038-desktop-delivery-mechanisms.md
    title: Delivery mechanism selection and later guarantees
  - id: qualification-security
    resource: ./adr/adr-0000-security-verification-frameworks.md
    title: Security applicability and evidence ownership
---

# Native foundation qualification report

## Purpose and acceptance scope

Native execution established foundation-mechanism feasibility for thirteen required OS/CPU/distribution/session cells, with twenty-nine case assessments per cell: 377 assessments and fifty-two complete canonical/supporting scenario records. Each source cohort was replayed through its original unchanged evidence checker with zero reported failures. These are non-shipping qualification probes, not the final Ohtia application or final signed distribution.[^qualification-contract] The repeatable procedure defines the admission and evidence checks.[^qualification-procedure]

The required targets are Linux x86-64 and ARM64, Windows x86-64 and Apple Silicon. Linux requires Ubuntu 24.04, Ubuntu 26.04, Fedora 44 and Debian 13 on each CPU; Ubuntu 24.04 additionally has separate Wayland and X11 cells. Apple Silicon requires macOS 26 and 27. Apple Intel and Windows ARM64 are optional and have no native result in this evaluation. macOS 15 remains an admitted candidate without a required or observed qualification run. Optional absence does not block this required scope; it never becomes a passing native result. A later artifact that includes an optional target needs that target's complete native evidence.

The [qualification playbook](native-qualification.md) owns preparation, admission, commands and evidence requirements. This analysis records observations, interpretation, transfer limits and engineering consequences. The [target manifest](../config/desktop/targets.json), [toolchain](../config/desktop/toolchain.json) and [numeric policy](../config/desktop/resource-policy.json) remain the canonical machine-readable contracts.

## Observed native coverage

| Platform       | Profile      | Session      | Cases | Source tree |
| :------------- | :----------- | :----------- | :---- | :---------- |
| Apple Silicon  | macos-26     | windowserver | 29/29 | `3ca0761`   |
| Apple Silicon  | macos-27     | windowserver | 29/29 | `3ca0761`   |
| Linux ARM64    | debian-13    | wayland      | 29/29 | `22b8321`   |
| Linux ARM64    | fedora-44    | wayland      | 29/29 | `cf6ab37`   |
| Linux ARM64    | ubuntu-24.04 | wayland      | 29/29 | `cf6ab37`   |
| Linux ARM64    | ubuntu-24.04 | x11          | 29/29 | `cf6ab37`   |
| Linux ARM64    | ubuntu-26.04 | wayland      | 29/29 | `22b8321`   |
| Linux x86-64   | debian-13    | wayland      | 29/29 | `b108d05`   |
| Linux x86-64   | fedora-44    | wayland      | 29/29 | `3fca5e2`   |
| Linux x86-64   | ubuntu-24.04 | wayland      | 29/29 | `3fca5e2`   |
| Linux x86-64   | ubuntu-24.04 | x11          | 29/29 | `3fca5e2`   |
| Linux x86-64   | ubuntu-26.04 | wayland      | 29/29 | `58943a4`   |
| Windows x86-64 | windows-11   | desktop      | 29/29 | `cf6ab37`   |

Windows execution observed Windows 11 Pro 26H2 build 26300.9711 on NTFS. The macOS facilities observed 26.7.2 build 25G332 on an M2 with 16 GiB RAM and 27.2 build 26B123 on an M1 with 8 GiB RAM, both on APFS with WindowServer. These are exact observed facilities, not proof of every supported patch, an untested minimum OS release, or all hardware in the same processor family.

The Linux extension facilities were native KVM guests with eight Neoverse-N1 ARM64 or AMD EPYC 9555P x86-64 vCPUs and 32 GiB RAM. Ubuntu and Debian used ext4; Fedora used Btrfs and enforcing SELinux. Official GNOME packages supplied native Wayland sessions with virtual software displays. The Fedora ARM facility was provisioned from a provider Cloud image using signed official Workstation packages and acquired Workstation identity, GNOME, Btrfs and enforcing SELinux before qualification. Its authenticated Workstation ISO was inspected but was not the boot/install source. A provisioned provider image, virtual display or native CPU guest does not establish Desktop ISO boot, physical GPU, monitor or hardware-driver coverage.

## Original source identities and compatibility

The native records retain six original frozen source trees:

- `3fca5e281245fdad4f2436c252eed41652dcd707`: original Linux x86-64 cells; 291 inputs. Input-map SHA-256: `5ee8c1837f9ebfb9c993a1f8ed19c3e2d08b581abe12f972368c1d5f02aa81bf`.
- `cf6ab37ce7337fcdb6d685889414d4057b18b12c`: Windows x86-64, Ubuntu 24.04 ARM64 and Fedora 44 ARM64; 291 inputs. Input-map SHA-256: `c29f7512aea5c3266bcc34650104040091614e47d5158fe8612221dbaa7459e1`.
- `3ca076146188f115fe53f55af8d22afc0cf029dc`: Apple Silicon macOS 26 and 27; 291 inputs. Input-map SHA-256: `d74e15b05c96334a31b6aaf8e5f93bfdf0399597bb7583eca0fd4beec68db641`.
- `22b83213ab7bf8c045439476ba139d8192e41d97`: Ubuntu 26.04 ARM64 and Debian 13 ARM64; 292 inputs. Input-map SHA-256: `1daaa8eb2f31af4081a7e06731eb4dfeab8f9fbd417c5fcf8237a656fd949d5c`.
- `58943a4457661d17f06083cfe7c1d4fddd6df8d7`: Ubuntu 26.04 x86-64; 292 inputs. Input-map SHA-256: `0a5fb87782f470f838fc0a36b654728992dcb0f5acef86483f1a8ad6523a11b0`.
- `b108d05e6335a98364c0e4bdf01152c6dc429053`: Debian 13 x86-64; 292 inputs. Input-map SHA-256: `dabf04c2a55bb0b121317d98613e4dcc9950009193688de25c1747dc740c7191`.

These are native candidate Git tree identities, including uncommitted qualification inputs, rather than fabricated release commits. Every record remains bound to its actual complete input map, runtime inventory, admission, host evidence and execution receipts. The original-source replay validates each cohort separately. Mixed snapshots are not relabeled or passed through a current-source checker by disabling its input seals.

The compatibility assessment compared the final qualification implementation with each source family. Seventeen locked-authority and probe-payload files are byte-identical across all cohorts; their file/hash-map projection digest is `a3a366228805839c23dd904617e33cd1c3be70f9c3d5b2ce1c165fcd54975407`. This includes the shared locks, toolchain, numeric policy, workspace entry and actual probe payload. Every native execution/admission/seal function in the probe module has the same AST; only profile enumeration and report aggregation changed to express the required scope.

The intervening changes have identified effects. The first source delta changes tests only. The supervisor correction handles Darwin's zombie-only process-group EPERM case and is exercised by both macOS cohorts; the Windows Job Object path is unchanged and non-Darwin permission failures still raise. Linux distribution additions bind package scripts to the declared native profile. Removing the new read-only distribution predicate and false Debian-only branches leaves the original Ubuntu/Fedora installation-effect bodies byte-identical. The added read-only predicates accept the recorded Ubuntu/Fedora identities; the changed Ubuntu 26.04/Debian package-policy effects have independent ARM64 and x86-64 native records. These comparisons support this specific source handover; they do not claim that old packages were rebuilt or rerun.

The matrix and optional-platform changes alter completion policy, not the runtime payload or native evidence. Consumers must requalify affected paths when they change locked artifacts, executed payloads, installation effects or facility guarantees. Passing unit tests or a projection digest cannot replace evidence for a changed native behavior.

The following record identities bind each observed cell to its complete case pack and original runtime inventory. The case summaries additionally bind their source inputs and actual scenario execution receipt.

- **darwin-arm64 / macos-26 / windowserver**: case-manifest SHA-256 `0ad4e495d81fce23ea0d0f31d0980260548feeeddb71d09ae6002a424a403b86`; runtime-inventory digest `c60371181cb1936201573bc944972707ba8968de15ddabed9ac00c98dd87a36c`.
- **darwin-arm64 / macos-27 / windowserver**: case-manifest SHA-256 `6cace4767a8f2eca0d6462d2512b3283dc5b6c6b06c4f9090e9b3fb9c5c750c0`; runtime-inventory digest `c60371181cb1936201573bc944972707ba8968de15ddabed9ac00c98dd87a36c`.
- **linux-arm64 / debian-13 / wayland**: case-manifest SHA-256 `bf85f7b3e81e1e698e2732b50bb0ac3d175489b658bed63123a11bc9c6e398bf`; runtime-inventory digest `ba962925c973aecafa91adf510e2e7c8fd808d37d4eeeb8c8291f6db6c752087`.
- **linux-arm64 / fedora-44 / wayland**: case-manifest SHA-256 `64170fe029342589e8e1ede395d7236edc172d318fe760567fa9aa07cc3e4cd6`; runtime-inventory digest `ba962925c973aecafa91adf510e2e7c8fd808d37d4eeeb8c8291f6db6c752087`.
- **linux-arm64 / ubuntu-24.04 / wayland**: case-manifest SHA-256 `7dea92335515fc431111970a2bc19589976286eebd8b647522915093fc871704`; runtime-inventory digest `8a07580185471d29f7580b6a75b605c491cab2ee5e9e0724baa2f2c05ff262ce`.
- **linux-arm64 / ubuntu-24.04 / x11**: case-manifest SHA-256 `c6e59917f37e21ae3f94bfcb736ff6c386e37fd04657dad2d4d23df7d87b1c91`; runtime-inventory digest `ba962925c973aecafa91adf510e2e7c8fd808d37d4eeeb8c8291f6db6c752087`.
- **linux-arm64 / ubuntu-26.04 / wayland**: case-manifest SHA-256 `b9327603d57fa808fbd9f1d167ed35bc1a89e9ad0fdf9226060eb8af5c82fe8c`; runtime-inventory digest `ba962925c973aecafa91adf510e2e7c8fd808d37d4eeeb8c8291f6db6c752087`.
- **linux-x64 / debian-13 / wayland**: case-manifest SHA-256 `1cc1bc53a04c3e24502363ea2750f0bc54c7cb6777eb08fc1be745d3ace4e24a`; runtime-inventory digest `e9ca59d5fd50dac2bc40469661d337676fa5ea6fdd7116e9bb681e2f8db214a5`.
- **linux-x64 / fedora-44 / wayland**: case-manifest SHA-256 `af1fe5a751e01daa4f4df25e57c574654a3fa2d32b98adaaf1dfabbd093b3172`; runtime-inventory digest `e9ca59d5fd50dac2bc40469661d337676fa5ea6fdd7116e9bb681e2f8db214a5`.
- **linux-x64 / ubuntu-24.04 / wayland**: case-manifest SHA-256 `4433a9f8f9011cf2734a620462f8548302c797db34e4d889001113f0f277af91`; runtime-inventory digest `4301bd3e8d9955fbd2a72d5e71192c4217761053709fdcd54bdd0e3af4070550`.
- **linux-x64 / ubuntu-24.04 / x11**: case-manifest SHA-256 `23824f1511bb81548d0ec741d0b3b8080f91d4cb94d4bc9930a54178363cd565`; runtime-inventory digest `4301bd3e8d9955fbd2a72d5e71192c4217761053709fdcd54bdd0e3af4070550`.
- **linux-x64 / ubuntu-26.04 / wayland**: case-manifest SHA-256 `df8e0d282753f1eccaea53e760d497511c06eb856c8a9d49c9e4c502fe610297`; runtime-inventory digest `e9ca59d5fd50dac2bc40469661d337676fa5ea6fdd7116e9bb681e2f8db214a5`.
- **win32-x64 / windows-11 / desktop**: case-manifest SHA-256 `36dc2c7a5141842111943b74ac4d89f2dee4282a5c1233f19f86e27c82ad81d6`; runtime-inventory digest `2e62615eb170d78dfaafc438c99356c84f5ab51733cbba83dd80377bb36a2450`.

## Runtime, isolation and security findings

The probes observed Electron 45.0.0, embedded Node 24.22.0, module ABI 150, the selected better-sqlite3 binding and SQLite 3.53.4 with its expected source identity and compilation options. The actual utility connection used file-backed databases, exercised constraints, transaction/migration rollback, competing writers, backup and reopen, and verified file and parent-directory publication primitives. Metadata or an in-memory database did not supply the native result.

Every execution used an admitted independent native account or VM with separate configuration, research and scratch roots and synthetic/public fixtures. Positive admissions and negative alias, overlapping-root, foreign-home, unverified-isolation and changed-sentinel declarations were retained. Complete synthetic stable locator/store/recovery contexts were compared before and after the applicable controls. This demonstrates preservation of the identified fixtures; it does not claim inspection of a researcher's private profile.

The actual default journey, distinct hostile IPC journey, deliberate utility failure and pinned Playwright control retained their respective outcomes. Observed enforcing boundaries reject spoofed contents/frames, invalid/oversized requests, unexpected navigation/resources, privileged renderer imports and prohibited CSP connections. Wrong CPU, incompatible or absent addon, changed runtime ABI expectations, altered native bytes and SQLite source mismatch controls refuse unsafe loading. Expected-ABI metadata mutations are identified separately from actual incompatible native addon/runtime execution.

Independent process observation established the real display backend and OS sandbox rather than trusting JavaScript declarations alone. Linux uses native scheduler fork/exec/exit events, calibrated TASKSTATS per-thread exit records, procfs sandbox/namespace state and native compositor peers. Windows uses native process/job/token observations; macOS uses retained native process/accounting and WindowServer evidence with the applicable targeted supplements. Captured ownership, exit and loss checks are part of each record. Instrumented controls do not replace the uninstrumented default resource anchor.

The native evidence extends the existing ADR-0000 applicability inventory and the same versioned ASVS requirement IDs and three foundation control groups. This is partial non-shipping isolation/runtime/filesystem evidence; it is not product-wide ASVS conformity, screen-reader usability, human linguistic review or a substitute for later product-boundary tests.[^qualification-security]

## Resource and setup measurements

The default native journeys passed the applicable numeric resource checks under their recorded facilities. Representative independently reconciled Linux anchors are:

| Observed profile    | Lifetime process upper | RSS upper, bytes | CPU, ms   |
| :------------------ | :--------------------- | :--------------- | :-------- |
| Ubuntu 26.04 ARM64  | 16                     | 1,022,668,800    | 2,391.150 |
| Ubuntu 26.04 x86-64 | 16                     | 958,394,368      | 612.922   |
| Debian 13 x86-64    | 10                     | 818,331,648      | 435.979   |
| Fedora 44 ARM64     | 16                     | 886,263,808      | 2,409.624 |

Lifetime process counts and sums of per-process RSS highwater values are conservative upper bounds, not simultaneous samples. Per-thread CPU is accumulated without double-counting process aggregates. Cloud guests and virtual software graphics do not establish universal reference-hardware or physical graphics results.

Cold checkouts retained their locks and separated download observations or conservative clone/setup bounds from active command measurements. For example, Ubuntu 26.04 x86-64 recorded a 57.604-second cold workspace interval, Debian 13 x86-64 55.431 seconds and Fedora 44 ARM64 170.550 seconds. Clone/setup network upper bounds include local processing and may overlap the command interval; they are not an exclusive allocation of human work and network waiting. Some facilities had native prerequisites already installed. Throughput/latency were not independently measured on the remote Linux facilities.

Windows setup timing carries the maintainer-accepted measurement imprecision retained in its original report. That exception does not waive architecture, isolation, native loading, sandbox, recovery or unchanged-input checks. These measurements calibrate the provisional setup envelope under stated conditions. Full unfamiliar-contributor setup, operator coordination, representative editing and universal duration guarantees remain the integrated contributor trial's responsibility.

## Filesystem and interruption findings

The native filesystem cases cover file locking, denied writes, bounded volume exhaustion and explicit retry, temporary-write interruption, unconfirmed rename and confirmed publication. Bounded fixture volumes avoided filling a system disk. VM/host restart observations are distinct from process interruption and retain their actual administrative sequences.

Ubuntu 26.04 ARM64 required recovery through the provider Rescue environment after SSH failed following its test reset. The original volume was inspected read-only with noload, and witnesses were verified and backed up before narrow cloud-uplink network configuration repair. Additional observed normal boots, Rescue and the final Local boot are preserved; this is not immediate single-boot readback. The final original-OS check passed all three states and source/runtime/stable/installation/catalog/security postchecks. The observed network-manager conflict is documented without claiming exclusive proof of the original SSH failure's cause.

Fedora 44 ARM64 retained an empty non-fsynced auxiliary preflight file after the reset. Its v2 readback used separately durable original package/trust and reinstall evidence; it never promoted that auxiliary file into a confirmed record. The three Btrfs publication states and previous-compatible copies passed.

Ubuntu 26.04 x86-64 and Debian 13 x86-64 each performed one authorized abrupt guest reset after full verified laptop backup. Both returned through pinned-key SSH, changed boot identity and passed all three ext4 states and protected postchecks. The SSH sessions issuing those resets expired under their local transport watchdogs; the markers, changed boot and subsequent readback independently establish execution. No second reset was inferred from or triggered by the timeout.

All guest-reset results keep cloud hypervisor/storage caches powered. They do not prove physical device power-loss durability. Readiness and backup synchronization may commit otherwise unconfirmed metadata; an unconfirmed rename remains uncertain between the explicitly accepted intact generations.

## Consequences for package profiles

### Shared package and verification inputs

Build profiles must bind OS/distribution/CPU, exact runtime/addon/engine identities, locks and helper bytes, native package version, file ownership/modes and the distribution's security policy. Installed app execution stays under an ordinary account, separate from fixture administration. Inspect final archive contents and actual installed bytes; input modes or a successful builder receipt do not prove final package safety. Keep probe packages and fixtures excluded from shipped application artifacts.

The evidence supplies a starting dependency inventory and concrete failure cases for package creation and CI. It does not supply a product implementation to copy from the probe. The real runtime/storage components are built against their own contracts, and real final packages must rerun their native smoke, installation, update, recovery and security checks.[^qualification-delivery]

### Ubuntu and Debian DEB

Ubuntu requires an inspected, exact-installed-executable AppArmor user-namespace allowance while the global restriction remains active. Install/remove hooks must enforce the selected profile bytes, root ownership, non-writable payload and strict kernel load/unload outcomes. A non-SUID Chromium helper is not permission to fall back to privileged sandbox execution.

Debian 13 uses its actual enabled AppArmor and native unprivileged-user-namespace support. Its package hooks refuse an unexpected Ubuntu allowance and leave global policy unchanged. Bind this choice into generated scripts from the admitted distribution; do not inherit an untrusted selector from the invoking environment. Ubuntu and Debian packages need their own native results even when they use common GNU runtime bytes.

Provider desktop preparation can introduce a global NetworkManager renderer conflicting with an existing cloud uplink owner. Record actual per-interface ownership and preserve vendor addresses/routes/SSH policy when provisioning the facility. This is test-facility configuration, not an application installer responsibility.

### Fedora RPM

Require the native Workstation environment, GNOME Wayland, Btrfs and enforcing SELinux. Verify native payload labels and policy after installation. RPM signature verification must use the actual platform's supported keyring route and an explicit expected trust root; an empty verification database must not silently inherit trust. The native fixture used isolated synthetic signing identities and preserved system vendor keys, establishing verification mechanics without certifying an official publisher identity.

RPM removal may leave empty implicit parent directories that the package never owned. Verify removal of owned files and preserve unknown/user data rather than treating every leftover directory as failed removal or deleting it automatically.

### Windows NSIS

Use an architecture-specific native package, real Windows desktop/NTFS and the supported native shell. Preserve per-user installation/HKCU scope and test file locks, restart, interrupted activation, explicit previous-compatible recovery and final activation. Native Job Object/process evidence is needed for bounded cleanup. Actual electron-updater transport was tested against a private loopback feed; that does not establish public-feed authentication or final publisher-signature acceptance.

### Apple Silicon DMG and ZIP

Keep independent native macOS 26 and 27 records for the selected ARM64 executable and addon. Verify mounted/read-only delivery, file/framework-link identity, installation/activation and recovery without weakening SIP or Gatekeeper. Retain the actual observation permissions and any targeted accounting supplements. Ad-hoc/synthetic signing and mechanism feasibility do not establish final Developer ID signing, notarization, stapling or official update trust. An optional Intel slice needs its own native qualification before inclusion.

## Evidence retention and replay

The repository retains this consolidated analysis, reusable contracts/procedures and deterministic checks. Large original packages, runtimes, traces, individual platform case packs and operational records remain in separate maintainer-controlled evidence archives. Each archive has a file/hash manifest and local verification receipt. Source credentials, private research and access screenshots are excluded from public repository content.

The following identities locate the retained final profile or evidence archives. These hashes identify the exact retained byte sets; a profile archive and a raw-input archive have different coverage and are kept together. Ubuntu 24.04 ARM64 and macOS 26 use verified directory manifests rather than pretending their directory trees are one archive blob.

- **fedora-44-arm64-cf6ab37-profile-final-v1**: SHA-256 `e28b548acaff6d23f6d03c94de54afc0bbf6a71593c3308de29a5c57a5b36ac6`.
- **ubuntu-26.04-arm64-22b8321-profile-final-v1**: SHA-256 `fe1d2873a18fd175b88ecfc87bc10f3ce6003ea48f50efac89604f37f9ef2a07`.
- **debian-13-arm64-22b8321-profile-final-v1**: SHA-256 `a74ba49b8fb8ce4c7124f9277dbbfd6187c831f59de8ca35e922212b9a9eaf14`.
- **ubuntu-26.04-x64-58943a4-profile-final-v1**: SHA-256 `709cf0dd6520ca318b382261ba9e05552babb46882d5b7d7e4cd6d5d1c44226b`.
- **debian-13-x64-b108d05-profile-final-v1**: SHA-256 `fc432cd8037a17e38efe79968327eae1868207da44c937cb0ad080bd1f9da663`.
- **macos-27-arm64-26B123-profile-final-v1**: SHA-256 `146b0e44ae6490b5e44106b58b89fbb4a470700dc9c67d323747cf5ec2f57a12`.
- **linux-x64-3fca5e2-native-v1**: SHA-256 `c439fe2207564ff17afa80709a5be40af6af1324614928a6bb63e375baf566c1`.
- **windows-11-x64-cf6ab37-native-v1**: SHA-256 `adb7ab12e17181ce9b7377f0721fda2c710b0921ccde6c10f8c834ff20877fcf`.
- **ubuntu-24.04-arm64-cf6ab37-v1**: file-manifest SHA-256 `19a89a52c1a036d60fa36975c433347be9413abc52b05a5c88ddf233b1a94b3f`.
- **macos-26-arm64-25G332-v1**: file-manifest SHA-256 `16b8fef5ba64a6038fae89f3b43d3baae7534811dfdce2382187ac826123bf9d`.

Each final portable profile includes its original-source reconstruction, case references and an offline verifier. The cohort replay also reconstructs the original source and invokes the unchanged evidence checker. Replay validates retained evidence; it does not execute Electron or manufacture another native result. The source-compatibility assessment separately binds the observed cells to the reviewed qualification changes while retaining each original input digest.

This evaluation grants no product release, signing credentials, deployment or publication authority. Future package creation, final signed installation/authenticated update and integrated unfamiliar-contributor trials retain their own acceptance and actual-artifact obligations. An optional or untested platform cannot inherit another CPU's result.
