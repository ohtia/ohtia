---
type: Analysis
title: Native foundation qualification report
description: Observed native desktop feasibility, source compatibility, packaging consequences and evidence limits for the required foundation platforms.
generated:
  by: claude-code/claude-opus-5-5
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

Native execution established foundation-mechanism feasibility for fifteen required OS/CPU/distribution/session/desktop cells, with twenty-nine case assessments per cell: 435 assessments and sixty complete canonical/supporting scenario records. The nine GNOME, Windows and macOS cells were replayed through their original unchanged evidence checkers with zero reported failures; the six KDE Plasma cells form a separate cohort whose records passed the report of their own source with zero reported failures. These are non-shipping qualification probes, not the final Ohtia application or final signed distribution.[^qualification-contract] The repeatable procedure defines the admission and evidence checks.[^qualification-procedure]

The required targets are Linux x86-64 and ARM64, Windows x86-64 and Apple Silicon. Linux requires Ubuntu 26.04, Fedora 44 and Debian 13 on each CPU, each on GNOME and on KDE Plasma 6, both on Wayland ([ADR-0046](adr/adr-0046-required-kde-plasma-desktop-and-native-cell-identifiers.md)). Apple Silicon requires macOS 26 and 27. Apple Intel and Windows ARM64 are optional and have no native result in this evaluation. macOS 15 remains an admitted candidate without a required or observed qualification run. Optional absence does not block this required scope; it never becomes a passing native result. A later artifact that includes an optional target needs that target's complete native evidence. [ADR-0042](adr/adr-0042-wayland-only-linux-support.md) retired the Ubuntu 24.04 and X11 cells; their evidence remains in Git history and in the closed [native qualification issue](https://github.com/ohtia/ohtia/issues/32).

The [qualification playbook](native-qualification.md) owns preparation, admission, commands and evidence requirements. This analysis records observations, interpretation, transfer limits and engineering consequences. The [target manifest](../config/desktop/targets.json), [toolchain](../config/desktop/toolchain.json) and [numeric policy](../config/desktop/resource-policy.json) remain the canonical machine-readable contracts.

## Observed native coverage

| Platform       | Profile      | Session      | Desktop | Cases | Source tree |
| :------------- | :----------- | :----------- | :------ | :---- | :---------- |
| Apple Silicon  | macos-26     | windowserver | none    | 29/29 | `3ca0761`   |
| Apple Silicon  | macos-27     | windowserver | none    | 29/29 | `3ca0761`   |
| Linux ARM64    | debian-13    | wayland      | gnome   | 29/29 | `22b8321`   |
| Linux ARM64    | debian-13    | wayland      | kde     | 29/29 | `f949094`   |
| Linux ARM64    | fedora-44    | wayland      | gnome   | 29/29 | `cf6ab37`   |
| Linux ARM64    | fedora-44    | wayland      | kde     | 29/29 | `f949094`   |
| Linux ARM64    | ubuntu-26.04 | wayland      | gnome   | 29/29 | `22b8321`   |
| Linux ARM64    | ubuntu-26.04 | wayland      | kde     | 29/29 | `f949094`   |
| Linux x86-64   | debian-13    | wayland      | gnome   | 29/29 | `b108d05`   |
| Linux x86-64   | debian-13    | wayland      | kde     | 29/29 | `f949094`   |
| Linux x86-64   | fedora-44    | wayland      | gnome   | 29/29 | `3fca5e2`   |
| Linux x86-64   | fedora-44    | wayland      | kde     | 29/29 | `f949094`   |
| Linux x86-64   | ubuntu-26.04 | wayland      | gnome   | 29/29 | `58943a4`   |
| Linux x86-64   | ubuntu-26.04 | wayland      | kde     | 29/29 | `f949094`   |
| Windows x86-64 | windows-11   | desktop      | none    | 29/29 | `cf6ab37`   |

Windows execution observed Windows 11 Pro 26H2 build 26300.9711 on NTFS. The macOS facilities observed 26.7.2 build 25G332 on an M2 with 16 GiB RAM and 27.2 build 26B123 on an M1 with 8 GiB RAM, both on APFS with WindowServer. These are exact observed facilities, not proof of every supported patch, an untested minimum OS release, or all hardware in the same processor family.

The Linux extension facilities were native KVM guests with eight Neoverse-N1 ARM64 or AMD EPYC 9555P x86-64 vCPUs and 32 GiB RAM. Ubuntu and Debian used ext4; Fedora used Btrfs and enforcing SELinux. Official GNOME packages supplied native Wayland sessions with virtual software displays. The Fedora ARM facility was provisioned from a provider Cloud image using signed official Workstation packages and acquired Workstation identity, GNOME, Btrfs and enforcing SELinux before qualification. Its authenticated Workstation ISO was inspected but was not the boot/install source. A provisioned provider image, virtual display or native CPU guest does not establish Desktop ISO boot, physical GPU, monitor or hardware-driver coverage.

The KDE Plasma facilities were native KVM guests provisioned from official cloud images: the x86-64 guests ran one at a time on a local host with an Intel Core Ultra 7 155H, eight vCPUs and 24 GiB RAM, and the ARM64 guests on Scaleway with eight Neoverse-N1 vCPUs and 15 GiB RAM. Each installed its distribution's official KDE set without recommended or weak dependencies: `kubuntu-desktop` with Plasma 6.6.6, `task-kde-desktop` with Plasma 6.3.6, and `fedora-release-identity-kde-desktop` with the `kde-desktop` group and Plasma 6.8.2, which reported the Fedora KDE Plasma Desktop Edition. Ubuntu ran kernel 7.0.0-38 on both CPUs, Debian 6.12.113, and Fedora 6.19.10 on x86-64 and 7.1.10 on ARM64; Ubuntu and Debian used ext4 and Fedora Btrfs with enforcing SELinux. Every session was a private headless KWin virtual output with `plasmashell`, started by the shared Plasma launcher; no display-manager process ran. The provider's Fedora ARM64 Cloud image registers `qemu-user-static` binfmt handlers through `podman`; the probe processes ran the native aarch64 runtime, and an x86-64 executable reached the emulator, which stopped for lack of an x86-64 loader. The same facility limits apply: virtual software graphics do not establish physical GPU or monitor coverage.

## Original source identities and compatibility

The native records retain seven original frozen source trees:

- `3fca5e281245fdad4f2436c252eed41652dcd707`: Fedora 44 x86-64; 291 inputs. Input-map SHA-256: `5ee8c1837f9ebfb9c993a1f8ed19c3e2d08b581abe12f972368c1d5f02aa81bf`.
- `cf6ab37ce7337fcdb6d685889414d4057b18b12c`: Windows x86-64 and Fedora 44 ARM64; 291 inputs. Input-map SHA-256: `c29f7512aea5c3266bcc34650104040091614e47d5158fe8612221dbaa7459e1`.
- `3ca076146188f115fe53f55af8d22afc0cf029dc`: Apple Silicon macOS 26 and 27; 291 inputs. Input-map SHA-256: `d74e15b05c96334a31b6aaf8e5f93bfdf0399597bb7583eca0fd4beec68db641`.
- `22b83213ab7bf8c045439476ba139d8192e41d97`: Ubuntu 26.04 ARM64 and Debian 13 ARM64; 292 inputs. Input-map SHA-256: `1daaa8eb2f31af4081a7e06731eb4dfeab8f9fbd417c5fcf8237a656fd949d5c`.
- `58943a4457661d17f06083cfe7c1d4fddd6df8d7`: Ubuntu 26.04 x86-64; 292 inputs. Input-map SHA-256: `0a5fb87782f470f838fc0a36b654728992dcb0f5acef86483f1a8ad6523a11b0`.
- `b108d05e6335a98364c0e4bdf01152c6dc429053`: Debian 13 x86-64; 292 inputs. Input-map SHA-256: `dabf04c2a55bb0b121317d98613e4dcc9950009193688de25c1747dc740c7191`.
- `692e941938d8e2af52987cef9784597729c4040c`, commit `f94909432dfcc6b59de96eaffdd35059d8c809ad`: the six KDE Plasma cells; 768 inputs. Input-map SHA-256: `cc52a4cc80d71adecbef4a7622901f07b350b421eddd8bbc22e1a0a4a3cbc642`.

These are native candidate Git tree identities, including uncommitted qualification inputs, rather than fabricated release commits. Every record remains bound to its actual complete input map, runtime inventory, admission, host evidence and execution receipts. The original-source replay validates each cohort separately. Mixed snapshots are not relabeled or passed through a current-source checker by disabling its input seals.

The compatibility assessment compared the final qualification implementation with each source family. Seventeen locked-authority and probe-payload files are byte-identical across all cohorts; their file/hash-map projection digest is `a3a366228805839c23dd904617e33cd1c3be70f9c3d5b2ce1c165fcd54975407`. This includes the shared locks, toolchain, numeric policy, workspace entry and actual probe payload. Every native execution/admission/seal function in the probe module has the same AST; only profile enumeration and report aggregation changed to express the required scope.

The intervening changes have identified effects. The first source delta changes tests only. The supervisor correction handles Darwin's zombie-only process-group EPERM case and is exercised by both macOS cohorts; the Windows Job Object path is unchanged and non-Darwin permission failures still raise. Linux distribution additions bind package scripts to the declared native profile. Removing the new read-only distribution predicate and false Debian-only branches leaves the original Ubuntu/Fedora installation-effect bodies byte-identical. The added read-only predicates accept the recorded Ubuntu/Fedora identities; the changed Ubuntu 26.04/Debian package-policy effects have independent ARM64 and x86-64 native records. These comparisons support this specific source handover; they do not claim that old packages were rebuilt or rerun.

The matrix and optional-platform changes alter completion policy, not the runtime payload or native evidence. Consumers must requalify affected paths when they change locked artifacts, executed payloads, installation effects or facility guarantees. Passing unit tests or a projection digest cannot replace evidence for a changed native behavior.

The following record identities bind each observed cell to its complete case pack and original runtime inventory. The case summaries additionally bind their source inputs and actual scenario execution receipt.

- **darwin-arm64 / macos-26 / windowserver**: case-manifest SHA-256 `0ad4e495d81fce23ea0d0f31d0980260548feeeddb71d09ae6002a424a403b86`; runtime-inventory digest `c60371181cb1936201573bc944972707ba8968de15ddabed9ac00c98dd87a36c`.
- **darwin-arm64 / macos-27 / windowserver**: case-manifest SHA-256 `6cace4767a8f2eca0d6462d2512b3283dc5b6c6b06c4f9090e9b3fb9c5c750c0`; runtime-inventory digest `c60371181cb1936201573bc944972707ba8968de15ddabed9ac00c98dd87a36c`.
- **linux-arm64 / debian-13 / wayland**: case-manifest SHA-256 `bf85f7b3e81e1e698e2732b50bb0ac3d175489b658bed63123a11bc9c6e398bf`; runtime-inventory digest `ba962925c973aecafa91adf510e2e7c8fd808d37d4eeeb8c8291f6db6c752087`.
- **linux-arm64 / fedora-44 / wayland**: case-manifest SHA-256 `64170fe029342589e8e1ede395d7236edc172d318fe760567fa9aa07cc3e4cd6`; runtime-inventory digest `ba962925c973aecafa91adf510e2e7c8fd808d37d4eeeb8c8291f6db6c752087`.
- **linux-arm64 / ubuntu-26.04 / wayland**: case-manifest SHA-256 `b9327603d57fa808fbd9f1d167ed35bc1a89e9ad0fdf9226060eb8af5c82fe8c`; runtime-inventory digest `ba962925c973aecafa91adf510e2e7c8fd808d37d4eeeb8c8291f6db6c752087`.
- **linux-x64 / debian-13 / wayland**: case-manifest SHA-256 `1cc1bc53a04c3e24502363ea2750f0bc54c7cb6777eb08fc1be745d3ace4e24a`; runtime-inventory digest `e9ca59d5fd50dac2bc40469661d337676fa5ea6fdd7116e9bb681e2f8db214a5`.
- **linux-x64 / fedora-44 / wayland**: case-manifest SHA-256 `af1fe5a751e01daa4f4df25e57c574654a3fa2d32b98adaaf1dfabbd093b3172`; runtime-inventory digest `e9ca59d5fd50dac2bc40469661d337676fa5ea6fdd7116e9bb681e2f8db214a5`.
- **linux-x64 / ubuntu-26.04 / wayland**: case-manifest SHA-256 `df8e0d282753f1eccaea53e760d497511c06eb856c8a9d49c9e4c502fe610297`; runtime-inventory digest `e9ca59d5fd50dac2bc40469661d337676fa5ea6fdd7116e9bb681e2f8db214a5`.
- **win32-x64 / windows-11 / desktop**: case-manifest SHA-256 `36dc2c7a5141842111943b74ac4d89f2dee4282a5c1233f19f86e27c82ad81d6`; runtime-inventory digest `2e62615eb170d78dfaafc438c99356c84f5ab51733cbba83dd80377bb36a2450`.
- **linux-arm64 / debian-13 / wayland / kde**: case-manifest SHA-256 `da8e9ae0dbfc39a3e010ad2ec86166a0d5c51512e436bba6d8a9745a3d08297e`; runtime-inventory digest `64500704730ba8855f26e6a4d34b4c807087007445b2c7b62e6934b8a4ac889e`.
- **linux-arm64 / fedora-44 / wayland / kde**: case-manifest SHA-256 `20ff2f92cf9c3e8e40bd69e421324872c83adbb87442842389d3e6ff39794cb6`; runtime-inventory digest `ba962925c973aecafa91adf510e2e7c8fd808d37d4eeeb8c8291f6db6c752087`.
- **linux-arm64 / ubuntu-26.04 / wayland / kde**: case-manifest SHA-256 `b47fd34b6c70ba0171111d2a9ed0a5d77cb44ab9bf1b5a5a2d4107dab3604b04`; runtime-inventory digest `64500704730ba8855f26e6a4d34b4c807087007445b2c7b62e6934b8a4ac889e`.
- **linux-x64 / debian-13 / wayland / kde**: case-manifest SHA-256 `844ecdf6348f851ce4779fd377bae19e65faa39727d584a946c623185561eba9`; runtime-inventory digest `4301bd3e8d9955fbd2a72d5e71192c4217761053709fdcd54bdd0e3af4070550`.
- **linux-x64 / fedora-44 / wayland / kde**: case-manifest SHA-256 `4b7b9579be401c2a7966fc002b5c6b2363ccdf0082a1cc4862b416895e69ad10`; runtime-inventory digest `e9ca59d5fd50dac2bc40469661d337676fa5ea6fdd7116e9bb681e2f8db214a5`.
- **linux-x64 / ubuntu-26.04 / wayland / kde**: case-manifest SHA-256 `40658762849eb232961f1efc85b7efff5507bcd0ee1df137138fdec104943a24`; runtime-inventory digest `4301bd3e8d9955fbd2a72d5e71192c4217761053709fdcd54bdd0e3af4070550`.

## Runtime, isolation and security findings

The probes observed Electron 45.0.0, embedded Node 24.22.0, module ABI 150, the selected better-sqlite3 binding and SQLite 3.53.4 with its expected source identity and compilation options. The actual utility connection used file-backed databases, exercised constraints, transaction/migration rollback, competing writers, backup and reopen, and verified file and parent-directory publication primitives. Metadata or an in-memory database did not supply the native result.

Every execution used an admitted independent native account or VM with separate configuration, research and scratch roots and synthetic/public fixtures. Positive admissions and negative alias, overlapping-root, foreign-home, unverified-isolation and changed-sentinel declarations were retained. Complete synthetic stable locator/store/recovery contexts were compared before and after the applicable controls. This demonstrates preservation of the identified fixtures; it does not claim inspection of a researcher's private profile.

The actual default journey, distinct hostile IPC journey, deliberate utility failure and pinned Playwright control retained their respective outcomes. Observed enforcing boundaries reject spoofed contents/frames, invalid/oversized requests, unexpected navigation/resources, privileged renderer imports and prohibited CSP connections. Wrong CPU, incompatible or absent addon, changed runtime ABI expectations, altered native bytes and SQLite source mismatch controls refuse unsafe loading. Expected-ABI metadata mutations are identified separately from actual incompatible native addon/runtime execution.

Independent process observation established the real display backend and OS sandbox rather than trusting JavaScript declarations alone. Linux uses native scheduler fork/exec/exit events, calibrated TASKSTATS per-thread exit records, procfs sandbox/namespace state and native compositor peers. Windows uses native process/job/token observations; macOS uses retained native process/accounting and WindowServer evidence with the applicable targeted supplements. Captured ownership, exit and loss checks are part of each record. Instrumented controls do not replace the uninstrumented default resource anchor.

On KDE Plasma the same observations identified `kwin_wayland` as the Wayland peer of the browser process, automatic Ozone Wayland selection in its children, renderers under seccomp filters with no-new-privileges, no effective capabilities and separate user, PID and network namespaces, and the browser process's own environment naming `XDG_CURRENT_DESKTOP=KDE`; the probe launcher admitted each run only with `KDE_SESSION_VERSION=6`. Two launcher defects were found and corrected before the KDE records: the desktop portal had started before the activation environment named the KDE session and served every interface through its GTK fallback, and bus-activated services such as `plasma_waitforname` outlived each session. Without an AppArmor namespace restriction, Debian 13 and Fedora 44 run an unallowed copy sandboxed, so their `sandbox-denied` refusal was observed with unprivileged user namespaces disabled for one run; Chromium aborted rather than run without its sandbox on all six cells. The prepared runtime's inventory records file modes produced under the preparing account's umask: identical bytes prepared under `0002` on Ubuntu and Debian and under `0022` on Fedora have different runtime-inventory digests per CPU.

The native evidence extends the existing ADR-0000 applicability inventory and the same versioned ASVS requirement IDs and three foundation control groups. This is partial non-shipping isolation/runtime/filesystem evidence; it is not product-wide ASVS conformity, screen-reader usability, human linguistic review or a substitute for later product-boundary tests.[^qualification-security]

## Resource and setup measurements

The default native journeys passed the applicable numeric resource checks under their recorded facilities. Representative independently reconciled Linux anchors are:

| Observed profile          | Lifetime process upper | RSS upper, bytes | CPU, ms   |
| :------------------------ | :--------------------- | :--------------- | :-------- |
| Ubuntu 26.04 ARM64 GNOME  | 16                     | 1,022,668,800    | 2,391.150 |
| Ubuntu 26.04 x86-64 GNOME | 16                     | 958,394,368      | 612.922   |
| Debian 13 x86-64 GNOME    | 10                     | 818,331,648      | 435.979   |
| Fedora 44 ARM64 GNOME     | 16                     | 886,263,808      | 2,409.624 |
| Ubuntu 26.04 x86-64 KDE   | 10                     | 901,296,128      | 3,487.943 |
| Ubuntu 26.04 ARM64 KDE    | 10                     | 938,008,576      | 1,673.245 |
| Debian 13 x86-64 KDE      | 10                     | 805,699,584      | 3,263.527 |
| Debian 13 ARM64 KDE       | 10                     | 797,003,776      | 1,635.389 |
| Fedora 44 x86-64 KDE      | 10                     | 880,037,888      | 670.365   |
| Fedora 44 ARM64 KDE       | 10                     | 805,974,016      | 1,469.989 |

Lifetime process counts and sums of per-process RSS highwater values are conservative upper bounds, not simultaneous samples. Per-thread CPU is accumulated without double-counting process aggregates. Cloud guests and virtual software graphics do not establish universal reference-hardware or physical graphics results.

Cold checkouts retained their locks and separated download observations or conservative clone/setup bounds from active command measurements. For example, Ubuntu 26.04 x86-64 recorded a 57.604-second cold workspace interval, Debian 13 x86-64 55.431 seconds and Fedora 44 ARM64 170.550 seconds. Clone/setup network upper bounds include local processing and may overlap the command interval; they are not an exclusive allocation of human work and network waiting. Some facilities had native prerequisites already installed. Throughput/latency were not independently measured on the remote Linux facilities.

The KDE cold checkouts kept both locks unchanged and passed setup, doctor, check and package:local from empty checkout-local caches. Setup took 41.2 seconds on Ubuntu 26.04 x86-64, 11.7 seconds on Ubuntu 26.04 ARM64, 20.7 seconds on Debian 13 x86-64, 11.7 seconds on Debian 13 ARM64, 19.4 seconds on Fedora 44 x86-64, 16.0 seconds on Fedora 44 ARM64, with download wall-time upper bounds from 6.0 to 17.6 seconds. The Linux contributor route ran on the three x86-64 KDE distributions and on Ubuntu 26.04 ARM64 KDE from an independent account: prerequisites, setup, doctor, profile admission, the exact-path Ubuntu allowance, the private Plasma `session` with `doctor`, `desktop:test`, `storage:test` and `diagnostics:test`, a representative edit observed by the native acceptance harness, check, package, hooks on a branch and the unit tests passed with the stable fixture unchanged. On the x86-64 distributions, at `f949094`, `session smoke` could not pass with a runtime prepared by `desktop:prepare`: its startup suite launched that runtime in installed mode, which main admits only for a packaged executable, and the prepared executable keeps Electron's development name. The contributor smoke now runs only the development startup cases on that runtime; on Ubuntu 26.04 ARM64 KDE, at `d826551`, the complete route passed, including `session smoke`. Outside the private session, `doctor` reports only the absent display session.

Windows setup timing carries the maintainer-accepted measurement imprecision retained in its original report. That exception does not waive architecture, isolation, native loading, sandbox, recovery or unchanged-input checks. These measurements calibrate the provisional setup envelope under stated conditions. Full unfamiliar-contributor setup, operator coordination, representative editing and universal duration guarantees remain the integrated contributor trial's responsibility.

## Filesystem and interruption findings

The native filesystem cases cover file locking, denied writes, bounded volume exhaustion and explicit retry, temporary-write interruption, unconfirmed rename and confirmed publication. Bounded fixture volumes avoided filling a system disk. VM/host restart observations are distinct from process interruption and retain their actual administrative sequences.

Ubuntu 26.04 ARM64 required recovery through the provider Rescue environment after SSH failed following its test reset. The original volume was inspected read-only with noload, and witnesses were verified and backed up before narrow cloud-uplink network configuration repair. Additional observed normal boots, Rescue and the final Local boot are preserved; this is not immediate single-boot readback. The final original-OS check passed all three states and source/runtime/stable/installation/catalog/security postchecks. The observed network-manager conflict is documented without claiming exclusive proof of the original SSH failure's cause.

Fedora 44 ARM64 retained an empty non-fsynced auxiliary preflight file after the reset. Its v2 readback used separately durable original package/trust and reinstall evidence; it never promoted that auxiliary file into a confirmed record. The three Btrfs publication states and previous-compatible copies passed.

Ubuntu 26.04 x86-64 and Debian 13 x86-64 each performed one authorized abrupt guest reset after full verified laptop backup. Both returned through pinned-key SSH, changed boot identity and passed all three ext4 states and protected postchecks. The SSH sessions issuing those resets expired under their local transport watchdogs; the markers, changed boot and subsequent readback independently establish execution. No second reset was inferred from or triggered by the timeout.

Each KDE cell performed one abrupt guest reset after leaving three states on its bounded volume: a staged and fsynced write before the rename, a rename without the directory synchronization and a confirmed publication. The ARM64 guests were reset from inside with `sysrq` and the x86-64 guests through the hypervisor's reset; all returned, changed boot identity and read back the old bytes, the new bytes and the new bytes respectively. On Debian ARM64 the reset also emptied the operator's own unsynchronized records and a just-copied tool, which were recovered from the persistent journal and the operator output; on Debian x86-64 it emptied the installation records written in the preceding minute, which were repeated. Later preparation synchronizes the operator's home filesystem, not the bounded volume, before the reset. On a full volume the probe failed without changing the confirmed bytes, but did not exit after failing to write its own result; the bounded supervisor stopped it, and the explicit retry passed.

All guest-reset results keep cloud hypervisor/storage caches powered. They do not prove physical device power-loss durability. Readiness and backup synchronization may commit otherwise unconfirmed metadata; an unconfirmed rename remains uncertain between the explicitly accepted intact generations.

## Consequences for package profiles

### Shared package and verification inputs

Build profiles must bind OS/distribution/CPU, exact runtime/addon/engine identities, locks and helper bytes, native package version, file ownership/modes and the distribution's security policy. Installed app execution stays under an ordinary account, separate from fixture administration. Inspect final archive contents and actual installed bytes; input modes or a successful builder receipt do not prove final package safety. Keep probe packages and fixtures excluded from shipped application artifacts.

The evidence supplies a starting dependency inventory and concrete failure cases for package creation and CI. It does not supply a product implementation to copy from the probe. The real runtime/storage components are built against their own contracts, and real final packages must rerun their native smoke, installation, update, recovery and security checks.[^qualification-delivery]

### Ubuntu and Debian DEB

Ubuntu requires an inspected, exact-installed-executable AppArmor user-namespace allowance while the global restriction remains active. Install/remove hooks must enforce the selected profile bytes, root ownership, non-writable payload and strict kernel load/unload outcomes. A non-SUID Chromium helper is not permission to fall back to privileged sandbox execution.

Debian 13 uses its actual enabled AppArmor and native unprivileged-user-namespace support. Its package hooks refuse an unexpected Ubuntu allowance and leave global policy unchanged. Bind this choice into generated scripts from the admitted distribution; do not inherit an untrusted selector from the invoking environment. Ubuntu and Debian packages need their own native results even when they use common GNU runtime bytes.

The DEB lists `/opt` among its directories. Where the image left `/opt` without an owning package, as on the Ubuntu 26.04 and Debian 13 cloud images, purging the package removed `/opt`, and a repository test that requires `/opt` was then skipped, which the quality gate counts as a failure. Package profiles must not remove directories they do not own, and the facility was repaired by recreating `/opt`.

Provider desktop preparation can introduce a global NetworkManager renderer conflicting with an existing cloud uplink owner. Record actual per-interface ownership and preserve vendor addresses/routes/SSH policy when provisioning the facility. This is test-facility configuration, not an application installer responsibility.

### Fedora RPM

Require the cell's native Fedora identity, Workstation for GNOME and the KDE Plasma Desktop Edition for KDE Plasma, on Wayland with Btrfs and enforcing SELinux. Verify native payload labels and policy after installation. RPM signature verification must use the actual platform's supported keyring route and an explicit expected trust root; an empty verification database must not silently inherit trust. The native fixture used isolated synthetic signing identities and preserved system vendor keys, establishing verification mechanics without certifying an official publisher identity.

RPM removal may leave empty implicit parent directories that the package never owned. A transaction killed during installation left two temporary `name;txid` files that the package did not own; the recovering reinstall verified clean and removal left those files, which were deleted manually on both Fedora KDE cells. Verify removal of owned files and preserve unknown/user data rather than treating every leftover directory as failed removal or deleting it automatically.

### Windows NSIS

Use an architecture-specific native package, real Windows desktop/NTFS and the supported native shell. Preserve per-user installation/HKCU scope and test file locks, restart, interrupted activation, explicit previous-compatible recovery and final activation. Native Job Object/process evidence is needed for bounded cleanup. Actual electron-updater transport was tested against a private loopback feed; that does not establish public-feed authentication or final publisher-signature acceptance.

### Apple Silicon DMG and ZIP

Keep independent native macOS 26 and 27 records for the selected ARM64 executable and addon. Verify mounted/read-only delivery, file/framework-link identity, installation/activation and recovery without weakening SIP or Gatekeeper. Retain the actual observation permissions and any targeted accounting supplements. Ad-hoc/synthetic signing and mechanism feasibility do not establish final Developer ID signing, notarization, stapling or official update trust. An optional Intel slice needs its own native qualification before inclusion.

## Evidence retention and replay

The repository retains this consolidated analysis, reusable contracts/procedures and deterministic checks. Large original packages, runtimes, traces, individual platform case packs and operational records remain in separate maintainer-controlled evidence archives. Each archive has a file/hash manifest and local verification receipt. Source credentials, private research and access screenshots are excluded from public repository content.

The following identities locate the retained final profile or evidence archives. These hashes identify the exact retained byte sets; a profile archive and a raw-input archive have different coverage and are kept together. macOS 26 uses a verified directory manifest rather than pretending its directory tree is one archive blob.

- **fedora-44-arm64-cf6ab37-profile-final-v1**: SHA-256 `e28b548acaff6d23f6d03c94de54afc0bbf6a71593c3308de29a5c57a5b36ac6`.
- **ubuntu-26.04-arm64-22b8321-profile-final-v1**: SHA-256 `fe1d2873a18fd175b88ecfc87bc10f3ce6003ea48f50efac89604f37f9ef2a07`.
- **debian-13-arm64-22b8321-profile-final-v1**: SHA-256 `a74ba49b8fb8ce4c7124f9277dbbfd6187c831f59de8ca35e922212b9a9eaf14`.
- **ubuntu-26.04-x64-58943a4-profile-final-v1**: SHA-256 `709cf0dd6520ca318b382261ba9e05552babb46882d5b7d7e4cd6d5d1c44226b`.
- **debian-13-x64-b108d05-profile-final-v1**: SHA-256 `fc432cd8037a17e38efe79968327eae1868207da44c937cb0ad080bd1f9da663`.
- **macos-27-arm64-26B123-profile-final-v1**: SHA-256 `146b0e44ae6490b5e44106b58b89fbb4a470700dc9c67d323747cf5ec2f57a12`.
- **linux-x64-3fca5e2-native-v1**: SHA-256 `c439fe2207564ff17afa80709a5be40af6af1324614928a6bb63e375baf566c1`.
- **windows-11-x64-cf6ab37-native-v1**: SHA-256 `adb7ab12e17181ce9b7377f0721fda2c710b0921ccde6c10f8c834ff20877fcf`.
- **macos-26-arm64-25G332-v1**: file-manifest SHA-256 `16b8fef5ba64a6038fae89f3b43d3baae7534811dfdce2382187ac826123bf9d`.
- **linux-x64-ubuntu-26-04-kde-evidence-final**: SHA-256 `dd7325c498c4b4509751d5a645b4b6c5cd61a57c0775850e12d20b73246c0051`.
- **linux-x64-ubuntu-26-04-kde-contributor**: SHA-256 `e300dfddba5afd099b979ee8180ec2e54fa1342c404285a7dc01d60bee689d33`.
- **linux-arm64-ubuntu-26-04-kde-contributor**: SHA-256 `1c49a54bdc6a27773a683765f3ec7725c3db8a150d06a7f08d133877b998ecc6`.
- **linux-x64-debian-13-kde-evidence-final**: SHA-256 `8669409e25bc662c17149fdeac3680c9acb3e151d507540d721668114963773d`.
- **linux-x64-fedora-44-kde-evidence-final**: SHA-256 `9bd388bda1c7cd1e888034bb587bb28586e564df165d4e91b7fac87902748f09`.
- **linux-arm64-ubuntu-26-04-kde-evidence-final**: SHA-256 `98a2865a9d4b934c8acd224b081b4edfb93ee8d9389e786c685193b5d6dbba8c`.
- **linux-arm64-debian-13-kde-evidence-final**: SHA-256 `ef0aae0eb6b5d5780372af64f89e9bae6d680e9e310cebdccb976138831eecfb`.
- **linux-arm64-fedora-44-kde-evidence-final**: SHA-256 `08f63a05b3d4216f4556d52482c3dd401614418b4dabb003221173d8cba0ddb6`.

Each final portable profile includes its original-source reconstruction, case references and an offline verifier. The cohort replay also reconstructs the original source and invokes the unchanged evidence checker. Replay validates retained evidence; it does not execute Electron or manufacture another native result. The source-compatibility assessment separately binds the observed cells to the reviewed qualification changes while retaining each original input digest.

This evaluation grants no product release, signing credentials, deployment or publication authority. Future package creation, final signed installation/authenticated update and integrated unfamiliar-contributor trials retain their own acceptance and actual-artifact obligations. An optional or untested platform cannot inherit another CPU's result.
