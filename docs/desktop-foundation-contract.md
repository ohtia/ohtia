---
type: Specification
title: Desktop foundation contract
description: Native target and distribution qualification inputs, pinned candidate metadata, numeric resource policy and evidence ownership for the desktop foundation.
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
sources:
  - id: ubuntu-26-profile
    resource: https://documentation.ubuntu.com/release-notes/26.04/summary-for-lts-users/
    title: Ubuntu 26.04 desktop and libc changes
  - id: debian-13-profile
    resource: https://www.debian.org/News/2025/20250809
    title: Debian 13 release and native desktop families
  - id: debian-13-libc
    resource: https://packages.debian.org/trixie/libc6
    title: Debian 13 libc package
  - id: electron-platforms
    resource: https://github.com/electron/electron/blob/v45.0.0/README.md#platform-support
    title: Electron platform support
  - id: electron-display
    resource: https://github.com/electron/electron/blob/v45.0.0/docs/breaking-changes.md
    title: Selected Electron display backend and preload compatibility changes
  - id: electron-native-init
    resource: https://github.com/electron/electron/blob/v45.0.0/shell/app/electron_main_delegate.cc
    title: Electron native Ozone startup
  - id: electron-js-init
    resource: https://github.com/electron/electron/blob/v45.0.0/shell/browser/electron_browser_main_parts.cc
    title: Electron JavaScript initialization
  - id: electron-assets
    resource: https://github.com/electron/electron/releases/tag/v45.0.0
    title: Electron release assets and checksums
  - id: node-platforms
    resource: https://github.com/nodejs/node/blob/v26.12.1/BUILDING.md#platform-list
    title: Node native platform requirements
  - id: node-assets
    resource: https://nodejs.org/dist/v26.12.1/SHASUMS256.txt
    title: Node release checksums
  - id: binding
    resource: https://github.com/WiseLibs/better-sqlite3/blob/v13.0.3/binding.gyp
    title: Native binding build and Node-API requirements
  - id: binding-engine
    resource: https://github.com/WiseLibs/better-sqlite3/blob/v13.0.3/docs/compilation.md
    title: Bundled SQLite configuration
  - id: windows-lifecycle
    resource: https://learn.microsoft.com/en-us/windows/release-health/windows11-release-information
    title: Windows release servicing information
  - id: apple-lifecycle
    resource: https://support.apple.com/en-us/100100
    title: Apple security releases
  - id: ubuntu-lifecycle
    resource: https://documentation.ubuntu.com/release-notes/24.04/
    title: Ubuntu LTS release notes and support
  - id: github-runner
    resource: https://github.blog/changelog/2026-09-17-ubuntu-26-generally-available-and-latest-migration/
    title: GitHub Ubuntu runner migration
  - id: fedora-download
    resource: https://fedoraproject.org/workstation/download/
    title: Fedora Workstation native images and verification
  - id: fedora-libc
    resource: https://packages.fedoraproject.org/pkgs/glibc/glibc/fedora-44.html
    title: Fedora 44 libc package baseline
  - id: fedora-workstation
    resource: https://fedoraproject.org/wiki/Workstation/Technical_Specification
    title: Fedora Workstation SELinux policy
  - id: fedora-btrfs
    resource: https://fedoraproject.org/wiki/Changes/BtrfsByDefault
    title: Fedora desktop Btrfs adoption
  - id: fedora-wayland
    resource: https://fedoraproject.org/wiki/Changes/WaylandOnlyGNOME
    title: Fedora GNOME session change
  - id: runner-facilities
    resource: https://github.com/actions/runner-images#available-images
    title: Published native hosted runner facilities
  - id: ci-python
    resource: https://github.com/actions/python-versions/releases/tag/3.14.8-36806082737
    title: CI interpreter native release artifacts
  - id: python-managed
    resource: https://github.com/astral-sh/uv/blob/0.13.5/crates/uv-python-managed/download-metadata.json
    title: Pinned uv managed Python distribution metadata
  - id: registry
    resource: https://registry.npmjs.org/
    title: Primary npm package metadata
  - id: pypi
    resource: https://docs.pypi.org/api/json/
    title: Primary Python package metadata and file digests
---

# Desktop foundation contract

## Authority and consumers

This is D1a for [STORY-001-001](epics/EPIC-001-desktop-foundation/STORY-001-001-qualify-the-desktop-target-and-delivery-contracts.md). It supplies the target contract, exact candidate metadata and one numeric resource policy to the workspace, application-port, runtime, storage and delivery owners. The adopting [ADRs](adr/index.md) retain software version-line ownership. [ADR-0038](adr/adr-0038-desktop-delivery-mechanisms.md) owns provisional package/update mechanisms; [release policy](release-policy.md) retains publication authority. These contracts require content review before consumer integration; a metadata check is neither human approval nor native qualification.

[Targets](../config/desktop/targets.json), [toolchain](../config/desktop/toolchain.json) and [resource policy](../config/desktop/resource-policy.json) are the machine-readable inputs. The numeric policy is canonical for the foundation's new byte, count, time and process budgets. Existing locator and log-retention limits retain their architecture/ADR owners; the policy includes checked projections of those constants. Producers and consumers read the same record; copied policy tables or consumer-selected replacement values are prohibited. A reviewed change updates this contract, affected conformance fixtures and all affected consumers together.

D1a admission requires reviewed content and passing host-independent checks on the actual consumer base. It does not depend on a returning result from workspace 002, portable IPC 003 or native feasibility 018. A failed 018 probe requires a reviewed correction to the affected contract and consumers before that native capability is delivered; it cannot silently remove a target. This preserves PRIN-004–007 and PRIN-016: identified inputs, honest uncertainty and coverage, and no manufactured completion.

The [native foundation report](native-foundation-report.md) records the observed source revisions, facilities, measurements and limitations. It does not grant final signed-delivery or release authority.

## Native target contract

The manifest retains six OS/CPU identities. Required qualification covers `linux-x64`, `linux-arm64`, `win32-x64` and `darwin-arm64`; `win32-arm64` and `darwin-x64` are optional and do not block the required foundation. Optional means unqualified until its own complete native evidence passes, rather than accepting emulation or a missing result. `x64`, `amd64` and `x86_64` denote x86-64; `arm64` and `aarch64` denote ARM64. Exclude 32-bit x86/ARM, emulation, Rosetta and cross-build-only substitutes for native acceptance. Separate macOS packages are selected; including an optional slice in a future universal package requires its independent native verification.

- **Linux, both architectures:** require Ubuntu 24.04 LTS with DEB, glibc at least 2.39, kernel at least 6.8 and local ext4; require Fedora Workstation 44 with RPM, its maintained native kernel, glibc at least 2.43 and local Btrfs. Ubuntu 24.04 qualifies native Wayland and X11 sessions; Fedora qualifies native GNOME Wayland with SELinux enforcing. Both CPUs additionally require Ubuntu 26.04 LTS with DEB, glibc at least 2.43, ext4, its maintained vendor kernel and native GNOME Wayland, with independent evidence for each CPU. Both CPUs also require Debian 13 with DEB, glibc at least 2.41, ext4, its maintained vendor kernel and native GNOME Wayland; each CPU requires independent native evidence. Ubuntu 26.04's GNOME session is Wayland-only; XWayland does not establish a native X11 session. Other Debian desktop/session combinations require their own qualification. Run every profile as an ordinary account. Musl/Alpine and Fedora Atomic/rpm-ostree remain outside this selection. The common Linux GNU binaries are candidates; library metadata does not prove native compatibility.[^electron-platforms][^node-platforms][^fedora-libc][^fedora-workstation][^fedora-btrfs][^fedora-wayland][^ubuntu-26-profile][^debian-13-profile][^debian-13-libc]
- **Windows, both architectures:** Windows 11 25H2, build 26200, or a later vendor-supported Windows 11 release, on local NTFS, in a native graphical session. Contributor tools and the installed executable must match the host CPU. WSL and a Linux container are supplemental contributor environments; they do not qualify Windows. Windows 10 is outside this selected product floor even though upstream binaries may load there.[^electron-platforms][^node-platforms]
- **macOS, both architectures:** macOS 15 Sequoia as the floor, with the explicitly enumerated vendor-supported families in the target manifest, on local APFS, in a WindowServer session. Intel requires an actual Intel host and Apple Silicon an actual ARM64 host. The contributor floor also satisfies developer Node's higher minimum, rather than using Electron's lower floor as proof for the entire toolchain.[^electron-platforms][^node-platforms]

The Windows floor excludes 24H2 Home/Pro after its vendor update window. The macOS floor uses the oldest family in Apple's current security-release set, rather than inferring maintained support from Electron's lower binary minimum. Ubuntu's selected LTS has a published standard maintenance window.[^windows-lifecycle][^apple-lifecycle][^ubuntu-lifecycle]

Intel admits macOS 15 and 26; Apple Silicon admits 15, 26 and 27. Apple's current macOS 27 eligibility lists Apple Silicon, so that release is not an Intel target. Do not promise a future Intel OS release or invent a vendor retirement date. Apple Intel remains optional. Apple Silicon qualification requires macOS 26 and 27; macOS 15 remains an admitted baseline candidate without a mandatory qualification run. `required_os_majors` selects the required native family evidence independently of the admitted family inventory. A tested later release does not prove an untested floor.[^apple-lifecycle]

Each Linux CPU cell requires both DEB and RPM results; neither format is optional. The target manifest assigns four distribution profiles to each Linux CPU. The required scope expands to thirteen OS/CPU/distribution/backend records: ten Linux cells, Windows x86-64, and Apple Silicon on macOS 26 and 27. Other admitted records are optional. Use native package architecture names `amd64`/`arm64` for DEB and `x86_64`/`aarch64` for RPM. Both signed/unsigned artifact inventories enumerate each declared package format and distinct distribution-policy variant separately. A DEB result cannot stand in for RPM, and an Ubuntu container cannot establish Fedora's native kernel, SELinux, GNOME or Btrfs behavior.

Fedora 44 is an exact distribution profile. Its libc minimum applies within that profile and does not automatically admit Fedora 45 or another release. A successor or retirement of 44 follows the reviewed OS-floor procedure in [ADR-0038](adr/adr-0038-desktop-delivery-mechanisms.md#retention-and-retirement) against the vendor's actual maintenance announcements. If the vendor moves installation media to an official archive, review the new source URL while preserving the selected image bytes/checksum identity; unavailable media cannot trigger an unreviewed successor fallback.

The stated minimum and latest admitted vendor-supported release each need native observations before a claimed OS range is qualified. Retiring an OS floor follows the release-retirement procedure; a vendor support change cannot silently narrow a released matrix. Native VMs are acceptable only when their CPU architecture matches the executable and the required graphical, filesystem and sandbox behavior is available. Record physical versus virtual hardware, acceleration and host/guest identities.

Use at least four logical CPUs, 8 GiB RAM, an SSD and 20 GiB free space for contributor and initial resource measurements. x86-64 hardware must satisfy the chosen Chromium binary's instruction requirements; ARM64 must run the selected native binaries. Record actual CPU model/features rather than treating these capacity assumptions as an instruction-set guarantee. The foundation resource journey uses one window, an empty synthetic store and one appearance replacement; multiple windows remain subject to the global caps. These are qualification assumptions, not benchmark results or minimum requirements for future large corpora.

002's development entry point and 004's isolated runtime/test launcher preserve the native session's `XDG_SESSION_TYPE` and leave the Ozone platform switch unset, using the target manifest's empty `runtime_arguments` list. 012 preserves the same selection in packaged launchers/desktop entries. Do not pass the unsupported literal `--ozone-platform=auto` or force X11 in a Wayland qualification. Native Ozone selection occurs before the main JavaScript environment is created; a late `app.commandLine.appendSwitch` call is not the selected control.[^electron-native-init][^electron-js-init] 004's product runtime tests validate the observed backend using the native observation procedure supplied by 018. The selected Electron release automatically chooses native Wayland in a Wayland session, and the removed `ELECTRON_OZONE_PLATFORM_HINT` is not a configuration route. 018 uses the same selection and records actual Ozone protocol, compositor/session and window behavior for each declared backend; an environment variable or requested flag alone is not proof of the active backend. Both Ubuntu 24.04 backends must qualify on each CPU. Fedora and Ubuntu 26.04 on each CPU and the Debian 13 on each CPU profile require native GNOME Wayland. An unqualified fallback cannot silently replace a failed native path; changing the admitted backend requires reviewed contract/fixture updates.[^electron-display]

Linux native prerequisites include GTK 3, NSS/NSPR, ALSA, GBM/DRM, ATK/AT-SPI, X11/XCB/XRandR, CUPS and their font/display dependencies, plus a private D-Bus/session/display for automated tests. The Ubuntu DEB installations provision a reviewed executable-path-specific AppArmor user-namespace allowance through the native package installer, as defined in ADR-0038. Debian 13 on each CPU instead requires its native unprivileged-user-namespace support and enabled AppArmor, and refuses an unexpected Ubuntu-specific Ohtia allowance. Its installer neither changes global namespace policy nor installs or removes that Ubuntu allowance. Fedora RPM preserves targeted SELinux enforcing mode and verifies native labels and sandbox behavior rather than installing the Ubuntu AppArmor profile. No no-sandbox flags, root product launch, permissive SELinux or blanket policy disablement is allowed. The inspected Windows x64 addon imports only KERNEL32.dll; this does not identify every dependency of the complete packaged runtime or the ARM64 import set. macOS needs the native system frameworks and a signed helper configuration compatible with its hardened runtime. 018 inspects actual ELF/Mach-O/PE imports and load requirements on both CPUs; 008 later freezes the measured Linux package set in its input-addressed image. A list of proposed libraries is not proof that a native dependency resolves.

Only nonsynchronized, account-owned local volumes qualify for the live store, bootstrap locator, recovery files and scratch. Reject network/UNC/SMB/NFS paths, redirected cloud folders, concurrently synchronized roots, removable FAT/exFAT and ambiguous aliases. Resolve native case/Unicode aliases, symlinks and Windows reparse points before checking overlap and ownership; do not rely on path-prefix strings. Denied access or uncertain filesystem identity prevents admission. The [bootstrap contract](architecture.md#application-preferences-and-bootstrap) still forbids overlap in either direction with fixed settings and forbids redirecting Electron's configuration path.

018 qualifies ext4 on each declared Ubuntu and Debian profile and Btrfs on Fedora, including same-directory atomic replacement, file synchronization and parent-directory durability or the platform's demonstrated equivalent, locking, crash interruption and disk-full behavior on each selected filesystem. A directory chooser or SQLite success in memory proves none of these. 004 and 005 enforce those qualified procedures for locator and database recovery, respectively. Existing stores remain untouched on failed admission.

## Contributor and CI environments

The repository quality workflow explicitly selects `ubuntu-26.04`, rather than tracking the moving `ubuntu-latest` alias. GitHub's announced default migration does not retire the explicitly available `ubuntu-24.04` label; Ohtia deliberately moves its quality runner to `ubuntu-26.04`. The explicit selection makes the environment change reviewable and keeps tool versions independently pinned.[^github-runner]

The hosted quality runner is separate from the Linux product floor. The existing workflow runs repository hooks/history/policy tests; it does not yet package or qualify Electron. Later native build owners must compile native artifacts against the selected product ABI floor in their reviewed environment and verify the product on Ubuntu 24.04 and Fedora 44. A successful run on a newer hosted runner cannot establish the older runtime/libc, filesystem or sandbox contract. 008 owns the separately pinned, input-addressed Linux E2E image; 012 owns actual six-cell hosted build/result provenance. A runner label alone is not an immutable toolchain or native qualification result.

The target manifest names candidate facilities from GitHub's published native catalog: `ubuntu-24.04` and `ubuntu-24.04-arm` for the Linux floor; `windows-11-arm` for ARM64 Windows; `macos-15-intel`/`macos-26-intel` for Intel macOS; and `macos-15`/`macos-26` plus preview `xcode-27` for Apple Silicon. The catalog has no matching Windows 11 x64 desktop label; `windows-2025` is a server image and does not qualify that client cell. Use maintainer-provisioned native Windows 11 x64 systems/VMs, and independent matching OS-floor VMs when a hosted image has already advanced. Preview facilities remain conditional. Catalog availability is not reserved capacity, authorized access, a graphical/assistive session or a passing native result; 018 qualifies actual facilities/isolation and 017 supplies human newcomer/assistive journeys.[^runner-facilities]

Fedora 44 requires an additional maintainer-provisioned native desktop/VM on each Linux CPU. The target profiles identify official x86-64/ARM64 installation-image URLs and published checksums, not a verified boot or signature result. 018 authenticates the vendor checksum and checks ISO bytes before provisioning, then tests SELinux enforcing, native Wayland and Btrfs. The Ubuntu hosted candidates and the separate 008 image remain useful for their declared scope and do not replace Fedora native evidence.[^fedora-download]

Windows contributor acceptance uses the native PowerShell patch/portable ZIP from the toolchain manifest and the invocation/policy in each Windows target record. The primary archive route is per-user and isolated, with no Microsoft Update registration or routine administrator step; source/hash/patch verification precedes extraction and execution. Its version line belongs to [ADR-0004](adr/adr-0004-javascript-development-toolchain.md); no consumer chooses another primary shell. The selected CI Python patch has a conventional native Ubuntu 26.04 x64 archive in actions/python-versions, with its published digest recorded in the manifest. This resolves tool availability metadata, not the future hosted workflow result.[^ci-python]

## Tool and artifact selection

Exact patches, primary URLs, package integrity, computed or published SHA-256 values and observed native headers are recorded only in [the toolchain manifest](../config/desktop/toolchain.json). Patches stay within the adopting ADR lines. Select the highest published stable patch inspected within each adopted line, except CPython, which deliberately matches the actual CI interpreter pin. Prettier and Ruff match the repository hook pins. Do not update an adopted line by following a mutable registry tag.

The manifest distinguishes downloaded bytes with verified npm integrity, downloaded bytes with a locally computed hash, header inspection, and published checksum metadata without a binary download. A computed hash freezes observed bytes; it does not authenticate an upstream signer. Workspace 002 produces full transitive locks and pins bootstrap/runtime downloads; this candidate manifest is not a substitute lockfile or permission for installation-time latest resolution. Preserve optional native dependencies for all six architectures even when the initial install uses one host.

- **Compiler and lint:** typescript-eslint's declared compiler range includes the selected TypeScript patch and its ESLint peers include the selected lint major. Developer Node satisfies the published engines of Electron's installer, pnpm, Vite, Vitest, ESLint, typed lint, Playwright, Kysely and the binding. Workspace 002 must still run compiler/lint/build together; peer metadata alone does not prove their integrated behavior.[^registry]
- **Renderer and tests:** React and React DOM use matching patches and satisfy React DOM's peer declaration. Vitest's Vite peer includes the selected bundler. Playwright and its installed browser/core packages must resolve to matching patches under the lock. Its Electron automation remains experimental; 018 verifies actual launch/control against the chosen Electron runtime. Browser-only tests cannot qualify desktop IPC.[^registry]
- **Native frontend tools:** Vite brings platform-dependent Rolldown and Lightning CSS packages. Workspace 002 must lock every required OS/CPU optional artifact and fail on absence or architecture mismatch. The Python tooling manifest identifies published wheels for all six targets; publication is narrower evidence than successful installation or execution.[^registry][^pypi]
- **Preload compatibility:** the selected Electron release removes Node module shims and `Buffer` from sandboxed preloads. 002/003/004 use supported Web APIs such as `TextEncoder`/`Uint8Array` for the narrow bridge instead of assuming those globals or requiring Node built-ins there. Actual bundled-preload conformance belongs to runtime qualification.[^electron-display]
- **Two Node identities:** the manifest records developer Node independently from Electron's embedded Node, Chromium, V8 and module ABI. Expected native identities preserve complete vendor build tags, including V8's Electron suffix; compare the exact `process.versions` values rather than a shortened release-index version. Electron's aggregate release-index file list omits ARM64 entries; its actual release assets and checksum file enumerate all six selected binaries. Use the concrete asset inventory, never that incomplete summary, for matrix admission.[^electron-assets][^node-assets]
- **SQLite and binding:** the integrity-checked npm tarball includes six matching ELF/PE/Mach-O native headers and additional musl artifacts outside the selected Linux contract. The GitHub release's empty attachment list does not mean the npm package lacks native binaries. Build metadata requests Node-API 10, C++20 and the standard bundled SQLite engine; Node-API compatibility is an assumption to test in Electron's utility process, not an ABI-specific rebuild claim. The inspected Linux addons reference glibc and libstdc++ symbol versions within the selected Ubuntu floor; the observed maxima are retained in the manifest and still need native resolution. The default entry point accepts trusted `nativeBinding`; a consumer-selected path or a system SQLite fallback is forbidden.[^binding][^binding-engine]
- **Fallback compilation:** when an inspected prebuild cannot qualify, build only from the pinned upstream binding source with its bundled engine. Linux needs a compatible C++20 compiler, make and headers; Windows needs native MSVC C++/Windows SDK tooling; macOS needs compatible Xcode command-line tools/SDK. 002 pins the actual build tools if needed and 018 records their native versions/digests. A fallback that changes engine line or source distribution requires correction of the adopting decision, not an undocumented custom amalgamation.
- **Python:** maintenance scripts remain independent of the installed product. The selected conventional GIL interpreter matches current CI; existing standalone scripts retain their documented compatibility minimum. The manifest also pins the conventional six-target python-build-standalone archives named by the selected uv release, including build identities and published digests; all six download URLs were checked for availability without running the archives. 002 must consume those exact distributions without moving metadata resolution, and 018 verifies their actual interpreter identity. The official CPython source digest identifies upstream source, not a claim that one source archive installs on all six hosts.[^python-managed]

Reject unqualified newer TypeScript, pnpm, Vite or test lines despite newer published tags, mismatched React pairs, free-threaded Python, Node's built-in SQLite, OS SQLite and a custom amalgamation. They either leave adopted decisions, change the runtime/storage boundary or introduce an unnecessary variant. Electron alternatives and Python product-runtime alternatives remain justified in their adopting ADRs. No correction to an existing software line is needed on the inspected metadata; 018 can reject a selection empirically.

Before admission, 018 records host/executable/addon architectures, full packaged digests, `process.versions` including Node-API/module ABI, the loaded addon path/digest, `sqlite_version()`, `sqlite_source_id()` and sorted compilation options from the actual utility-process connection. Compare the source identity and required options against the frozen binding sources; foreign keys are explicitly enabled and read back. Exercise file-backed constraints, backup, migration transactions and wrong-addon/engine refusal. Host tools, headers, package peers and metadata cannot replace these observations.

## Resource policy and failure semantics

Each numeric entry declares its exact `value`, unit, permitted positive integer range, owning story suffix, measurement scope, controlled failure and rationale. Every permitted policy range is the singleton `[value, value]`: these are fixed reviewed constants, not runtime knobs or suggested minima. Changing a constant requires changing its singleton range, rationale and affected fixtures together through review; no value inside an earlier broad interval is implicitly authorized. Runtime occupancy and measured CPU can be zero. The exact current `value` governs admission and fixtures. Reject missing, boolean, fractional, nonfinite, negative, zero or out-of-range policy values; do not coerce or clamp them. Existing execution-limit preferences remain governed by ADR-0011, including its positive-integer values and atomic defaults, rather than acquiring an unrelated fixed concurrency maximum here.

Measure the complete compact JSON envelope as UTF-8 bytes, including keys and JSON escaping. JSONL adds exactly one LF. Count encoded bytes rather than UTF-16 code units or Unicode code points. A transport may add a bounded framing header, but it cannot exclude envelope bytes to accept a larger payload. Reject unsupported non-JSON values, cycles, inherited/prototype fields, duplicate keys in serialized input and unknown schema keys. Check the fixed encoded-byte cap before parsing serialized input; bound traversal while checking already-materialized Electron values. Initial status/appearance payload limits apply in addition to envelope, string, container, total-node and depth limits. Root depth is one, and each JSON value counts as a node.

003 implements the actual wire schemas, decoders and shared boundary corpus. Test empty/maximum/over-limit payloads, escaped strings, multibyte text, nested/wide inputs, invalid replies and count/byte saturation. No truncation or payload echo is allowed on failure. Main validates live sender frame/origin and generation before dispatch; the service rechecks operation authority, expected revision and idempotency. An oversize or invalid service result is a controlled unavailable/error result, never forwarded as trusted data.

Request deadlines include queue time. Count all unsettled work through main/service, including cancellation and unknown outcomes, against both per-window and global pending caps. Reject excess work before acceptance. Subscription queues obey both item and byte caps; overflow invalidates the stream, reports a controlled sequence gap and requires a fresh snapshot/subscription rather than dropping events while claiming completeness. Dispose subscriptions on window/service generation changes. Initial operations perform one bounded snapshot/read/replacement, never arbitrary work batches, task creation or paid inference.

A timeout or cancellation before dispatch can safely reject work; after dispatch, a missing mutation receipt is uncertain. Reconcile the same operation ID and expected revision through durable receipts before retrying. There is no automatic mutation replay, no initial-operation scheduler retry and no assumption that cancellation rolls back a commit. A single automatic service restart requires proven local cessation and cannot replay requests; further restarts require an explicit retry action. Schema checks and checkpoint operations preserve [ADR-0007](adr/adr-0007-sqlite-repositories-and-migrations.md) and [ADR-0010](adr/adr-0010-pre-migration-recovery.md); they are not forced into the short ordinary preference-request deadline.

Startup timing ends at a responsive controlled bootstrap/status surface, not at a user answering a native picker or a completed migration. The service handshake has its own nested deadline. Shutdown timing begins after the human save/discard/work decision, stops admission and composes graceful drain plus verified termination budgets. If the budget expires without local cessation evidence, retain uncertainty/recovery and do not report clean shutdown, free quarantined capacity or silently abandon descendants. ADR-0011 owns long-work exit choices and remote uncertainty.

Process-tree measurements include broker, utility, all renderers, GPU/network/crash helpers and descendants. Sample process count and aggregate resident working sets throughout the fixed initial journey, record peak aggregate RSS and accumulate user/system CPU across cores and exited children. Record sampling interval, process creation/exit accounting and any visibility gap. Incomplete accounting fails qualification; a single root-process memory reading is insufficient. RSS summation may count shared pages more than once; use that conservative definition consistently. 018 enforces these qualification budgets in independent native profiles/VMs; 004 enforces process admission and lifecycle caps. Exceeding resource budgets produces controlled failure and correction, never a hidden no-sandbox flag.

Diagnostic failure returns a content-free degraded state and cannot block research saving. Queue saturation or denied disk access cannot spill raw stderr, messages or exception text elsewhere. The byte/count projections in the policy preserve [ADR-0013](adr/adr-0013-private-content-free-structured-logging.md), whose privacy and rotation rules remain canonical.

## Contributor setup acceptance

Use the resource policy's separate active-work and cold-download budgets as initial acceptance hypotheses. Reference conditions are the hardware above, a fresh native profile, a clean checkout, empty pnpm/uv/browser caches, at least 100 Mbit/s sustained permitted downloads, latency at most 100 ms to package sources, unrestricted access to the pinned primary endpoints and no signing/provider credentials. Record cache state and actual network throughput; a proxy, throttled link or machine outside these assumptions needs its own measured record.

Active work includes prerequisite installation/operator interaction, frozen dependency resolution, builds, first launch, representative edit, shared checks and local unsigned package creation. Cold-download timing records network wait separately, including tool/browser/runtime payloads, without subtracting compilation or human debugging. Record elapsed wall time, active/operator time and download time; overlapping transfers are not summed twice into total elapsed time. Pause for externally blocked authorization only with an explicit recorded interval. A failed attempt still counts as a failed journey and retains intervention details.

The [native foundation report](native-foundation-report.md) supplies empirical calibration under identified hardware, cache, network and operator assumptions. Frozen command windows and conservative download bounds do not establish a human newcomer duration; STORY-001-017 owns that integrated trial. Preserve accepted measurement limitations with each qualified profile rather than inferring a universal setup promise.

## Host-independent verification

Run from the task checkout:

```bash
python3 scripts/desktop_contract.py
python3 -m unittest discover -s scripts/tests -v
pre-commit run --files config/desktop/targets.json config/desktop/toolchain.json config/desktop/resource-policy.json config/desktop/security-applicability.json scripts/desktop_contract.py scripts/tests/test_desktop_contract.py docs/desktop-foundation-contract.md docs/foundation-security.md docs/adr/adr-0038-desktop-delivery-mechanisms.md docs/adr/adr-0004-javascript-development-toolchain.md docs/index.md docs/adr/index.md
pre-commit run --all-files
pre-commit run --hook-stage manual gitleaks-history --all-files
git diff --check
```

The metadata command checks target completeness, exact patches against their adopting ADRs, six-cell artifact identities, policy completeness/ranges, cross-budget consistency and synchronization with the actual literal CI/hook pins. Ambiguous or expression-based pins require an explicit checker/contract update rather than a guessed match. Regression tests deliberately remove targets, change runtime identities and break bounds. These checks do not fetch mutable latest metadata, install packages, launch Electron, implement the future port or claim native compatibility. 002 carries these inputs into locks and commands; 003 verifies that its decoders consume the approved policy identity rather than selecting another limit set.

[Foundation security applicability](foundation-security.md) supplies the versioned baseline and enforcing-boundary evidence obligations. 018 supplies isolated native feasibility; 013 supplies final signed install/update evidence; 017 reconciles the full matrix, actual assistive/linguistic journeys and final-artifact coverage. Their evidence is not a return dependency for this contract.

[^electron-platforms]: Upstream declares native OS/CPU support; the narrower Ohtia OS/filesystem/display floor is a local selection requiring native qualification.

[^electron-assets]: Actual release attachments and their checksum list contain the selected six binaries, independently of the aggregate release index.

[^node-platforms]: Developer Node's native support and compiler requirements differ from Electron's embedded runtime.

[^node-assets]: Published checksums identify selected developer-runtime downloads without asserting their execution.

[^binding]: The pinned upstream build requests Node-API and native compiler features; the integrity-checked npm tarball supplies the selected prebuilds.

[^binding-engine]: The pinned upstream compilation document identifies the bundled engine and its compile-time options.

[^registry]: Each exact npm package record and integrity-checked tarball is identified in the manifest; engine and peer declarations are compatibility inputs rather than integration results.

[^pypi]: The manifest retains the selected six-target wheel names, Python requirements, yanked flags and published file digests from the primary JSON API.

[^windows-lifecycle]: Microsoft lists servicing windows by Windows release and edition; binary availability alone does not establish maintained support.

[^apple-lifecycle]: Apple's actual security release list informs the selected macOS floor; it does not promise future support duration.

[^ubuntu-lifecycle]: Canonical publishes the selected LTS standard-maintenance period.

[^python-managed]: The selected uv release maps conventional interpreter identities to build-specific archives and digests for all six cells.

[^github-runner]: GitHub publishes versioned runner labels and a staged default-alias migration; the explicit Ohtia quality-runner selection is separate from desktop support.

[^runner-facilities]: The published runner catalog identifies potential native facilities; repository access, exact desktop OS and isolation remain facts to verify.

[^ci-python]: The specific release publishes a conventional interpreter archive for the selected hosted runner OS and CPU.

[^fedora-download]: Fedora publishes Workstation images and checksums for both architectures; installation and checksum-signature verification remain native-provisioning obligations.

[^fedora-libc]: The versioned Fedora package page identifies the distribution libc baseline; it does not establish Ohtia native loading.

[^fedora-workstation]: The Workstation specification identifies targeted SELinux enforcing mode; the separate Fedora change records support filesystem/session choices.

[^electron-display]: The pinned runtime documents native Wayland auto-selection, removal of the older hint and sandboxed-preload changes; actual Ohtia execution still needs native evidence.

[^fedora-btrfs]: Fedora's desktop change record documents Btrfs adoption; local Btrfs is Ohtia's selected Fedora qualification filesystem.

[^fedora-wayland]: Fedora's GNOME change record documents the Wayland session direction; native GNOME Wayland is Ohtia's selected Fedora qualification session.

[^electron-native-init]: The pinned native delegate selects Linux Ozone during native pre-sandbox startup.

[^electron-js-init]: The pinned browser main-parts implementation creates the JavaScript environment later, so launcher argv is the effective early configuration boundary.

[^ubuntu-26-profile]: Ubuntu documents its GNOME Wayland-only session and libc family; actual runtime and sandbox observations remain required on each selected CPU.

[^debian-13-profile]: Debian identifies its maintained release and desktop families; choosing GNOME Wayland here does not qualify its other sessions.

[^debian-13-libc]: Debian publishes the selected libc family; native artifact loading remains empirical evidence from 018.
