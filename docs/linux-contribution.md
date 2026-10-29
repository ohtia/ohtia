---
type: Playbook
title: Native Linux contribution
description: Prepare a declared Linux contributor environment with consented vendor packages, pinned checkout-local tools, read-only diagnosis and isolated native execution.
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
sources:
  - id: ubuntu-packages
    resource: https://packages.ubuntu.com/resolute/libgtk-3-0t64
    title: Ubuntu GTK runtime package
  - id: debian-packages
    resource: https://packages.debian.org/trixie/libgtk-3-0t64
    title: Debian GTK runtime package
  - id: fedora-packages
    resource: https://packages.fedoraproject.org/pkgs/python3.14/python3-devel/
    title: Fedora native Python development headers
  - id: compositor-readiness
    resource: https://www.freedesktop.org/software/systemd/man/latest/sd_notify.html
    title: Native startup notification protocol
---

# Native Linux contribution

## Choose the native environment

Use this procedure for [STORY-001-009](epics/EPIC-001-desktop-foundation/STORY-001-009-make-linux-contribution-setup-reproducible.md). The [target manifest](../config/desktop/targets.json) owns the exact distribution, CPU, libc, filesystem, display and security profiles. Both x86-64 and ARM64 require native execution. PRIN-004, PRIN-006, PRIN-007 and PRIN-016 require recording the inputs and observed outcome of each run; another CPU's result or a container cannot qualify a native contributor route.

- Ubuntu 24.04 LTS: ext4, glibc at the declared floor, native Wayland and native X11 as separate walkthroughs, with enabled AppArmor.
- Ubuntu 26.04 LTS: ext4, native GNOME Wayland and enabled AppArmor. An XWayland connection does not establish this session.
- Debian 13: ext4, native GNOME Wayland, enabled AppArmor and native unprivileged user namespaces.
- Fedora 44 Workstation: Btrfs, native GNOME Wayland, its vendor kernel and enforcing SELinux. Another Fedora edition or desktop requires its own qualification. A provider image still identifying as Cloud is refused even when GNOME is installed; use the inspected official Workstation provisioning route in [native qualification](native-qualification.md#provision-an-independent-native-profile) before this entry.

Other distributions, musl, 32-bit CPUs, emulated execution, network filesystems and synchronized checkout/data directories have no supported route in this procedure. An editor, container engine, provider account, maintainer membership and signing identity are optional or separate facilities. Use only synthetic or explicitly permitted public fixtures. [The workspace guide](developer-workspace.md) owns the shared commands and software pins; [the foundation report](native-foundation-report.md) describes the earlier mechanism evidence and its transfer limits.

## Install prerequisites with consent

Start with native Git, Python 3.12 or later, a vendor-supported graphical installation and permitted access to the primary download endpoints in the [toolchain manifest](../config/desktop/toolchain.json). Clone this repository into a contributor-owned directory on the declared filesystem. Paths with spaces and Unicode are supported; quote them in shell commands. Do not copy another checkout's tool/cache directories, stable configuration, research or credentials.

Run from the checkout under an ordinary account:

```bash
python3 scripts/linux_contributor.py prerequisites
python3 scripts/linux_contributor.py prerequisites --install
python3 scripts/linux_contributor.py setup
python3 scripts/linux_contributor.py doctor
```

The first command prints the selected distribution's exact package command and catalog sources without executing it. Inspect the configured vendor repositories and their signature policy before consenting. `--install` authorizes only those displayed package-manager commands through `sudo`; any additional confirmation prompt depends on the package manager and its configuration. No repository is added, and setup, diagnosis, builds and Electron run without elevation. A user without sudo can ask the VM administrator to perform the same reviewed OS-package transaction, then continue as the contributor.

[The package inventory](../config/desktop/linux-contributor.json) supplies compiler/headers, Python, Git, GUI/audio/accessibility libraries, GNOME/session tools, archive tools and the native packaging prerequisites. Debian-family systems use APT; Fedora uses DNF. GTK's package names differ between these distributions.[^ubuntu-packages][^debian-packages] Fedora supplies its Python headers through `python3-devel`.[^fedora-packages] Record the actual installed package versions and repository transaction for every trial. OS security updates follow the selected vendor repositories; the repository's developer tools and dependency graph remain pinned independently.

`setup` delegates to the existing frozen workspace bootstrap and records the checked manifest/lock hashes under `.tooling/linux-setup.json`. Repeat it deliberately: it retains checkout-local caches and installs the same graph without rewriting either lock. A failed setup invalidates that receipt. Setup refuses top-level environment/cache directory aliases into another checkout before writing; preserve the referenced environment and remove only the alias when repairing this condition. Never run setup as root, install global Node/pnpm/uv as a repair, copy tool directories from another checkout or regenerate locks to hide a resolution failure.

`doctor` is read-only, creates no bytecode/cache/environment directories and returns JSON with named checks, a pass/fail result and a controlled remediation. It checks the exact distribution/CPU route, checkout access/filesystem, libc, installed prerequisites, compiler target, namespace/security configuration, display connectivity, effective tool/package pins and unchanged setup inputs. It suppresses subprocess output and exception details instead of including environment variables, account/home paths or credential content. Share the doctor JSON separately; setup and session logs include upstream tool output and admitted fixture paths and need review before publication. Run it before setup to observe missing-tool guidance and after setup to confirm recovery. A plain SSH session intentionally fails the display check; use the private session below for automated native work.

Diagnosis does not prove active Electron sandboxing, native addon loading, actual Ozone backend, complete shutdown, writable data storage or durable restart. Those require the admitted native walkthrough. The [read-only GitHub provenance verifier](repository-policy.md) is a separate POSIX maintainer procedure; it is not needed to build or run Ohtia.

## Admit an independent profile before execution

Follow [independent native profile preparation](desktop-runtime.md#prepare-an-independent-native-profile) before the first app, test or preview launch. Use a dedicated account or native VM with its own OS-account home, fixed `.config`, `ohtia` research root and separate owned scratch root. A different data directory in the ordinary stable account is insufficient. The inspecting operator records actual CPU/virtualization, canonical roots, filesystem ownership/permissions, absence of credentials and native security/display configuration. Never populate inspection declarations from the sample without performing those checks.

Create the existing `runtime-profile.json` contract inside the inspected account's home, using that account's username and the selected native target. Declare the complete synthetic stable configuration, store and recovery roots with their sentinel digests. Retain an independent before/after inventory of every fixture file's digest, size, ownership, mode and modification time as well as the sentinel checks. Never point this exercise at private research. Do not copy a stable locator/store into the independent account.

Build and assemble without executing Electron. The following examples use an account named `isolated-user`; replace the account and absolute scratch paths with the inspected values and select `linux-arm64` when appropriate:

```bash
python3 scripts/workspace.py run build
python3 scripts/workspace.py run desktop:prepare linux-x64 /home/isolated-user/scratch/runtime-1
python3 scripts/linux_contributor.py doctor --profile /home/isolated-user/scratch/runtime-profile.json --runtime /home/isolated-user/scratch/runtime-1
```

The optional doctor arguments reuse the real runtime's profile/sentinel and prepared-byte admission without starting a process. `--runtime` requires `--profile`. Missing, foreign-home, aliased, overlapping, unverified or altered profiles fail admission. The runtime launcher, broker and utility retain their independent admission checks; a successful doctor is not a reusable authorization token.

## Ubuntu executable-specific sandbox allowance

Ubuntu's restricted unprivileged user namespaces require an administrator-reviewed allowance for the exact prepared Electron executable. Generate it after profile and byte admission:

```bash
python3 scripts/linux_contributor.py sandbox-policy /home/isolated-user/scratch/runtime-profile.json /home/isolated-user/scratch/runtime-1 > /home/isolated-user/scratch/runtime-1.apparmor
```

Inspect the generated profile name, absolute executable path and complete contents. Its name binds both the canonical executable path and prepared artifact identity, so identical bytes in another attempt directory receive a distinct allowance. It contains only the ABI/global include and the exact executable's `userns` allowance. It does not load a profile or change a kernel setting. Have the administrator validate it with `apparmor_parser --skip-kernel-load`, install those reviewed bytes as a root-owned mode-0644 file under `/etc/apparmor.d/` using the generated profile name, load that new profile with `apparmor_parser --add` and verify its kernel readback. Preserve existing policies; a colliding name requires inspection rather than replacement. Record the policy file hash and retain Ubuntu's global namespace restriction.

A new runtime directory needs its own exact-path allowance and native evidence. Do not use wildcards, a SUID helper, root Electron, `--no-sandbox` or a disabled global AppArmor restriction to pass startup. Debian and Fedora use their declared native policies; this command refuses to generate an Ubuntu allowance for them. Diagnose Fedora AVC denials through the targeted policy rather than setting SELinux permissive.

## Launch and verify in a private session

In an inspected graphical desktop, use the [ordinary dev command](desktop-runtime.md#build-assemble-and-launch). For automated VM work without an interactive display, the same account can start a fresh private DBus/GNOME Wayland session for each declared command:

```bash
python3 scripts/linux_contributor.py session doctor /home/isolated-user/scratch/runtime-profile.json /home/isolated-user/scratch/runtime-1
python3 scripts/linux_contributor.py session desktop:test /home/isolated-user/scratch/runtime-profile.json /home/isolated-user/scratch/runtime-1 --evidence /home/isolated-user/scratch/runtime-evidence-1
python3 scripts/linux_contributor.py session storage:test /home/isolated-user/scratch/runtime-profile.json /home/isolated-user/scratch/runtime-1 --evidence /home/isolated-user/scratch/storage-evidence-1
```

`session` admits the profile and runtime bytes before starting GNOME, creates a short, canonical, owner-only private IPC directory under the account’s OS-managed `/run/user/<uid>` and verifies that it is disjoint from all declared stable roots, waits for GNOME's `READY=1` UI-initialization notification and exactly one owned Wayland socket before invoking only the selected existing workspace command. It leaves Ozone selection automatic, removes X11 display inheritance and uses a filtered environment. It starts and stops its own private D-Bus daemon and compositor, bounds both owned helper process groups before reaping their anchors, ignores any inherited session-bus address and retains their log under that attempt’s admitted scratch directory. SIGINT, SIGTERM, SIGHUP and SIGQUIT request cooperative bounded cleanup through startup and the selected command, including the native smoke supervisor. Allow cleanup to finish; repeated signals do not bypass it. The inspected ordinary account must have an OS-created owner-only runtime directory; log into that account before using this entry. Short native IPC paths avoid making GNOME depend on the scratch pathname. Electron also creates a temporary singleton socket below its admitted scratch root: this Linux entry conservatively requires that root’s absolute pathname to fit within 60 UTF-8 bytes, counting multibyte characters by bytes. Doctor reports this constraint; app/test entries reject longer roots before starting helpers or creating evidence. Choose and inspect a shorter canonical owned scratch root while preserving prior attempts. This does not restrict the checkout path or redirect the application’s fixed configuration root. The startup notification distinguishes completed initialization from an early listening socket.[^compositor-readiness] No host desktop/DBus/credential mount, container or CI environment impersonation is needed. A headless software display is useful native session evidence; it does not establish physical GPU or monitor coverage.

For the complete sequence with native process/sandbox/display observations, use a fresh fixture and one command:

```bash
python3 scripts/linux_contributor.py session smoke /home/isolated-user/scratch/runtime-profile.json /home/isolated-user/scratch/runtime-1 --evidence /home/isolated-user/scratch/smoke-evidence-1
```

Ubuntu 24.04 also needs a separate native X11 trial. Use an independently admitted fresh fixture for that backend, or retain the previous owned synthetic generation before preparing its fresh state. Keep its receipts separate from Wayland:

```bash
env -u WAYLAND_DISPLAY XDG_SESSION_TYPE=x11 xvfb-run -a dbus-run-session -- python3 scripts/linux_contributor.py smoke /home/isolated-user/scratch/runtime-profile.json /home/isolated-user/scratch/runtime-1 /home/isolated-user/scratch/smoke-x11-1
```

Run `desktop:test` before initializing a store: it expects a missing locator and verifies the supervised runtime, actual IPC/CSP boundaries, multiple windows, service death/retry and shutdown. `storage:test` exercises opening, native binding identity, save/restart, migration/recovery and controlled failures. It leaves identified synthetic state; preserve that attempt before a new trial rather than deleting existing data to satisfy a fresh-fixture precondition. Run `diagnostics:test` with its own fresh evidence directory after those suites. Observe native process architecture, actual Wayland connection, active sandbox and complete process cessation independently; retain failed reports and check stable fixture metadata after every attempt.

For a visible development round trip, launch `dev` in the admitted graphical session, explicitly open local data, change appearance, save, exit and launch the same bytes again. Confirm the saved value, then exercise explicit retry after a utility failure. Use the automated suites' receipts alongside the operator's actual observations; do not infer graphical completion from a zero exit alone.

## Edit, check and package

Make a representative source edit in [the renderer](../packages/renderer/src/index.tsx), such as adding `data-contributor-trial="setup-23"` to its `select` and a matching `toHaveAttribute` expectation in the native desktop acceptance harness. Rebuild, prepare a fresh runtime attempt and observe the changed element through the native desktop acceptance check. Run the relevant renderer test and the shared checks, then restore the demonstration edit and repeat its affected check. Retain the actual diff, command exits and observations so an unchanged build cannot be presented as an editing trial.

```bash
python3 scripts/workspace.py run check
python3 scripts/linux_contributor.py package /home/isolated-user/scratch/package-1 --attempt 1
python3 scripts/workspace.py run hooks
python3 scripts/workspace.py run hooks:history
python3 -m unittest discover -s scripts/tests -v
git diff --check
```

`package` rebuilds the current checkout and consumes the selected native target, reuses the quality builder configuration and produces one unsigned DEB or RPM with its hash and locked input identities in `local-package.json`. It never installs or launches the result, publishes a release, accesses a signing identity or supplies a hosted-CI receipt. Use a fresh absolute package destination with an existing, canonical, writable parent for every attempt; aliases or inaccessible parents fail before creating the attempt or building. The [workspace library ZIP](developer-workspace.md#common-commands) is a separate handoff and cannot replace this native package. Installation and smoke against the final package bytes remain explicit native checks; [native quality builds](quality-builds.md) describes the corresponding hosted automation.

The [immutable Linux x86-64 E2E route](linux-e2e.md#run-locally-and-in-ci) is an additional reproducer: run `bash tools/linux-e2e/run.sh --output tmp/linux-e2e-attempt` on its admitted Docker/AppArmor host. If image/package/browser parity fails, restore the reviewed recipe/package inputs and obtain the matching input-addressed image. Do not download a substitute browser, disable a sandbox or treat this x86-64 container as ARM64 evidence.

## Diagnose and retry

- Debian’s `unprivileged_userns_clone` switch is disabled: ask the administrator to restore the qualified vendor namespace policy, then repeat doctor; never disable the Chromium sandbox.
- A missing/wrong tool or stale setup receipt: restore the reviewed manifests/locks and repeat `setup`. For a damaged cached artifact or local executable, remove only the diagnosed checkout-local entry and retry the same pin. Preserve lock hashes and record the failure/recovery.
- A network/hash failure: restore permitted access to the manifest's primary endpoint or the selected vendor repository, retain the failed attempt and repeat setup. Never disable integrity or signature verification.
- A denied checkout/data root: check canonical location, filesystem, owner and account permissions. Correct only the inspected synthetic fixture; do not elevate the application or redirect configuration to a stable account.
- An inaccessible display: use the admitted desktop or the private `session` entry. Check the native session packages and compositor log; a display string alone is insufficient.
- A Fedora RPM build reporting `libcrypt.so.1` missing: install the declared `libxcrypt-compat` package, repeat setup/doctor and retry packaging into a fresh destination. The builder's bundled Ruby needs that compatibility library; do not change the system crypt library or use an unreviewed Ruby.
- A native addon/ABI/CPU mismatch: rebuild and assemble the target's pinned Electron/addon pair, then repeat native storage acceptance. Developer Node's successful SQLite load cannot qualify Electron's runtime. Preserve the rejected bytes and receipt.
- An AppArmor/SELinux refusal: inspect the actual executable path and targeted kernel policy readback. Repair that reviewed allowance or policy; a sandbox-start failure remains an environment failure.
- A stable-sentinel change, malformed locator or uncertain storage publication: stop that execution path, preserve both stores and evidence and inspect the isolation/recovery contract before any retry.

## Record the contributor trial

Before timing, adopt the existing setup budgets from the [numeric policy](../config/desktop/resource-policy.json) and the hardware/network/cache assumptions in the [foundation contract](desktop-foundation-contract.md). Separate cold downloads from active setup/edit/check/package work; an elapsed setup command that overlaps downloads is not an exclusive measurement of either. Record actual hardware/vCPU/RAM, native host/guest architecture, distribution/kernel/libc, filesystem, compositor/security policy, network measurements or their absence, cache state, preinstalled prerequisites, every intervention and the person/agent performing the walkthrough.

Retain source tree and complete input hashes, before/after lock hashes, setup/doctor failures and remediations, repeated setup, source edit/rebuild, native window save/restart/failure, full checks, final package digest, stable-fixture comparison and shutdown evidence under ignored task data. Check the guide verbatim in each required distribution/CPU/backend cell. Initial operator trials and the later independent unfamiliar-contributor journey remain separate evidence; neither documentation nor a declared inspection substitutes for an observed run.

[^ubuntu-packages]: The vendor catalog identifies the Ubuntu runtime library and its distribution package dependencies.

[^debian-packages]: The vendor catalog identifies Debian's runtime library and its distribution package dependencies.

[^fedora-packages]: The vendor catalog identifies Fedora's native Python development header package.

[^compositor-readiness]: The native notification protocol marks completed initialization through a dedicated readiness message.
