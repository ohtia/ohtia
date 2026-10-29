---
type: Playbook
title: Native macOS contribution
description: Set up, diagnose, edit, verify and package Ohtia in an independent Apple Silicon macOS contributor profile.
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
sources:
  - id: apple-tools
    resource: https://developer.apple.com/documentation/xcode/installing-the-command-line-tools/
    title: Installing the command-line tools
  - id: apple-gatekeeper
    resource: https://support.apple.com/en-gb/102445
    title: Open apps safely on your Mac
---

# Native macOS contribution

## Native prerequisites

This procedure implements [STORY-001-011](epics/EPIC-001-desktop-foundation/STORY-001-011-make-macos-contribution-setup-reproducible.md) using the [locked workspace](developer-workspace.md), [isolated runtime](desktop-runtime.md) and existing [quality packager](quality-builds.md). Use Apple Silicon running macOS 26 or 27, local APFS, an ordinary account and its logged-in graphical session. Intel, Rosetta, macOS 15 and universal packages are outside this contributor route. PRIN-004–007, PRIN-011 and PRIN-016 require preserving actual inputs, private data and limits of native observations.

Use a separate native VM or dedicated macOS account with no stable installation, research materials or provider credentials. Inspect native architecture, account home, local unsynchronized volumes, graphical session and stable roots before any application launch, following [native profile inspection](native-qualification.md#provision-an-independent-native-profile). A separate checkout, research directory or application name alone does not establish isolation. Never run Ohtia as root or redirect its native configuration root. Do not copy tool environments, credentials or stable stores from another account.

Install Apple developer tools only if absent. The Apple-supplied `/usr/bin/python3`, Git, `xcrun`, Clang, SDK, `codesign`, `diskutil` and `launchctl` are prerequisites. In Terminal, `xcode-select --install` opens Apple's installation/consent flow; complete it yourself and retry diagnosis.[^apple-tools] A full selected Xcode installation also works. Accept Apple's license in its own interface if required. Setup never installs OS packages, selects an Xcode globally, uses sudo or requests a paid developer identity. The selected [toolchain manifest](../config/desktop/toolchain.json) owns Python, Node, pnpm, uv, Electron and native-addon patches and download digests; [ADR-0004](adr/adr-0004-javascript-development-toolchain.md), [ADR-0005](adr/adr-0005-python-repository-tooling.md) and [ADR-0007](adr/adr-0007-sqlite-repositories-and-migrations.md) own their version lines.

Clone this public repository into an account-owned local directory, including spaces or non-ASCII characters if desired. Keep sufficient free space for a second runtime and DMG/ZIP outputs. Run the following commands from that checkout, in a native Terminal, without a pre-existing virtual environment. No global package manager is required.

## Diagnose and install

The [native evaluation](macos-contribution-report.md) records observed inputs, results and limits. The initial entry supports Apple's Python 3.9 or later; the shared maintenance entry subsequently uses the pinned conventional Python. `doctor` only inspects: it does not create a tool directory, download, repair permissions, read application settings or launch Electron. Its output omits account/home paths, environment values and arbitrary subprocess errors. It checks OS family, native interpreter/hardware agreement, Rosetta refusal, ordinary-account access, local APFS, Git, developer tools/SDK and a GUI session. Availability of that session is not independent-profile admission or an OS sandbox observation.

```bash
/usr/bin/python3 scripts/macos_contributor.py doctor
/usr/bin/python3 scripts/macos_contributor.py setup --install-tools
.tooling/python/bin/python3 scripts/macos_contributor.py doctor --workspace
```

`--install-tools` explicitly consents to downloads into this checkout: the manifest's authenticated Python archive first, then the shared bootstrap's Node, pnpm, uv and frozen dependency installation. Python comes from the manifest's pinned Astral Python Build Standalone release; JavaScript and Python packages use the workspace's pinned registries and lockfiles. The initial download is SHA-256 checked before extraction or interpreter execution. Extraction rejects escaping paths/links and special entries. The shared installer verifies effective tools and both lockfiles. No unpinned global Python installation is necessary.

Repeat the same setup command deliberately; it reconciles existing pins without changing locks. Concurrent setup is refused by the shared owner lock. Interrupted downloads leave no executable partial interpreter; keep failed evidence, confirm that the previous process has stopped and retry. Setup's elapsed time includes downloads and installation; it is not a separately measured active-work result. The [workspace guide](developer-workspace.md#bootstrap-and-frozen-setup) explains checkout-local caches and lock integrity. Avoid running commands that regenerate `dist` concurrently.

## Admit and launch

Create the independent profile's research directory at its native `~/ohtia` and a separate scratch directory inside its home. Inspect them and prepare `runtime-profile.json` exactly as specified by [Isolated desktop runtime](desktop-runtime.md#prepare-an-independent-native-profile), with `target: darwin-arm64`, the actual account home, its fixed `Library/Application Support` configuration root and the three inspected stable sentinel roots. Record the actual inspecting actor; a sample record is not approval. When a fresh test VM has no stable installation, use explicitly synthetic stable configuration/store/recovery fixtures and document that limitation. Do not touch an ordinary account's private roots to create such fixtures.

Set these shell variables to the inspected absolute paths. The example assumes the scratch directory has been created in this independent account; create the profile there before continuing. The prepared attempt directory must not exist yet.

```bash
mkdir -p "$HOME/ohtia" "$HOME/ohtia-contributor-scratch"
ohtia_scratch="$HOME/ohtia-contributor-scratch"
ohtia_profile="$ohtia_scratch/runtime-profile.json"
ohtia_prepared="$ohtia_scratch/runtime-1"
.tooling/python/bin/python3 scripts/workspace.py run build
.tooling/python/bin/python3 scripts/workspace.py run desktop:prepare darwin-arm64 "$ohtia_prepared"
.tooling/python/bin/python3 scripts/macos_contributor.py doctor --workspace --profile "$ohtia_profile" --prepared "$ohtia_prepared"
.tooling/python/bin/python3 scripts/workspace.py run dev "$ohtia_profile" "$ohtia_prepared"
```

Profile diagnosis uses the actual common launch admission and verifies prepared file/link hashes without spawning Electron. Unverified/stable profiles fail before broker startup. The dev entry rechecks admission and sentinels; broker and utility also recheck their native context. Research remains at the fixed account-native root; configuration remains under `~/Library/Application Support/Ohtia`.

In the window, observe responsive service status, explicitly open/create the synthetic store, select an appearance preference and quit. Relaunch with the same dev command, open the same store and verify that preference. Use the window's exit control; Ctrl+C is an interruption, not proof of full shutdown. The automated suites below additionally cover failure/retry, persistence, migrations and storage-access failures. Retain process observations and check that no attempt executable remains alive after exit.

## Edit, rebuild and verify

Use a disposable visible edit in `packages/renderer/src/desktop.tsx`: replace `<h1 id="title">{text("title")}</h1>` with `<h1 id="title">Ohtia contributor</h1>`. Preserve all bridge, catalog and storage contracts. Run the common tests and rebuild, then prepare a **new** runtime directory and launch it to inspect the changed heading. This exercises source editing, actual local assets and meaningful checks without a research feature or provider account.

```bash
.tooling/python/bin/python3 scripts/workspace.py run typecheck
.tooling/python/bin/python3 scripts/workspace.py run test
.tooling/python/bin/python3 scripts/workspace.py run build
.tooling/python/bin/python3 scripts/workspace.py run desktop:prepare darwin-arm64 "$ohtia_scratch/runtime-2"
.tooling/python/bin/python3 scripts/workspace.py run dev "$ohtia_profile" "$ohtia_scratch/runtime-2"
```

Quit the previous window before launching a new runtime. Restore the disposable edit, rebuild and assemble another fresh runtime before native acceptance: those suites intentionally expect the canonical heading. Do not change a test merely to accept an unexplained failure. Prepared runtime bytes are immutable; editing source or rebuilding does not update an existing attempt. Do not submit this illustrative edit with unrelated work.

The common required commands remain identical to CI:

```bash
.tooling/python/bin/python3 scripts/workspace.py run check
.tooling/python/bin/python3 scripts/workspace.py run hooks
.tooling/python/bin/python3 scripts/workspace.py run hooks:history
.tooling/python/bin/python3 -m unittest discover -s scripts/tests -v
.tooling/python/bin/python3 scripts/desktop_contract.py
git diff --check
```

Install hooks with `.venv/bin/pre-commit install`. Explicitly include new files in a focused `.venv/bin/pre-commit run --files <paths>` before review. Hooks need a real Git checkout, not a source archive. The POSIX-only maintainer provenance verifier `scripts/github_pr.py` runs natively on macOS; it is separate from credential-free setup and never authorizes publication. Optional editors and debugger integrations are not prerequisites and no editor-specific setup is supplied here.

Run native suites only against synthetic state in the admitted profile and use new evidence directories. The desktop suite requires an absent locator; preserve any prior owned synthetic configuration/store together under scratch before a fresh suite generation, then run desktop before storage. Never remove or adopt an unknown store. Use a fresh independent profile if ownership is uncertain.

```bash
.tooling/python/bin/python3 scripts/workspace.py run desktop:test "$ohtia_profile" "$ohtia_prepared" "$ohtia_scratch/desktop-evidence-1"
.tooling/python/bin/python3 scripts/workspace.py run storage:test "$ohtia_profile" "$ohtia_prepared" "$ohtia_scratch/storage-evidence-1"
```

Retain actual native process/addon identities and before/after stable sentinel observations alongside the suites. Their exact case inventories and limitations remain in the [runtime](desktop-runtime.md#native-verification) and [storage](storage.md) contracts. A successful doctor cannot replace loaded-addon, enforced sandbox, complete cessation or durable restart evidence.

## Build a local quality package

Use the pinned interpreter, an admitted profile and an unchanged prepared runtime. This entry uses the existing native quality builder with ad-hoc signing and no identity discovery, notarization or publication credentials. It produces separate ARM64 DMG and ZIP packages, hashes and a `packages.json` receipt inside a new scratch directory. The fixed development version is disposable and must not be published or treated as a reserved release.

```bash
.tooling/python/bin/python3 scripts/macos_contributor.py package --profile "$ohtia_profile" --prepared "$ohtia_prepared" --output "$ohtia_scratch/package-1"
```

The builder binds the post-signature native addon bytes and reseals the bundle. Archive construction alone is not packaged runtime evidence: extract the ZIP with `/usr/bin/ditto -x -k`, or mount the DMG read-only with `/usr/bin/hdiutil attach -readonly -nobrowse`, inspect the native bundle and run the common admitted acceptance path against its actual payload. Preserve the original package and its digest. [Native quality builds](quality-builds.md) defines CI's installed-payload smoke and provenance; local packages do not satisfy hosted CI or human integration. `package:local` separately produces only the workspace library archive and is not a desktop installer.

macOS may label local packages as unidentified or block quarantined downloads. Verify the repository source and exact package identity first. For an intentionally trusted local build, use Apple's per-application **Open Anyway** action in System Settings → Privacy & Security if offered, then retry within the independent profile. Do not globally disable Gatekeeper, SIP or quarantine checks, strip quarantine recursively, or use `--no-sandbox`. Ad-hoc signatures do not establish Developer ID, notarization or distribution trust.[^apple-gatekeeper]

## Recovery

- **Missing developer tools or license:** run `xcode-select --install`, finish Apple's consent/license interface, then rerun `doctor`. If multiple Xcodes are installed, have the machine owner select the intended installation; do not silently modify global selection.
- **Wrong OS, Intel Python or Rosetta:** use the required Apple Silicon OS and native Terminal. Check `/usr/bin/uname -m` and `/usr/sbin/sysctl -in sysctl.proc_translated`; ARM64 with no translation is required. Recreate this checkout's tool environment using the same setup entry; another slice's success is not native evidence.
- **Network/cache/hash failure:** verify HTTPS access to the manifest's exact artifact endpoints, npm and PyPI. Retry setup; it authenticates cached Python before reuse. Preserve failed attempts. Remove only the named damaged checkout-local tool/cache after confirming no command is active. Never regenerate locks, disable TLS checks or upgrade global tools to repair setup.
- **Interrupted or concurrent setup:** inspect `.tooling/setup.lock` locally and confirm its recorded PID has stopped. Remove that lock only when stale, then retry the same setup command. Do not kill unrelated processes or erase a running setup's environment.
- **Denied checkout or research root:** use account-owned local APFS and restore only the intended account permissions. Do not launch with sudo or grant broad disk access as a workaround. Retain the controlled graphical failure; the storage suite exercises permission failure/recovery with synthetic directories.
- **Native addon or ABI mismatch:** run workspace doctor, rebuild and assemble a new `darwin-arm64` attempt from the unchanged locks. Retain the previous attempt's identities. Do not substitute a developer-Node binding for Electron's ABI or edit a prepared manifest to accept replaced bytes.
- **No GUI session:** log into the independent account in the native graphical console and rerun doctor. SSH access alone does not qualify a graphical session. A controlled startup failure must remain visible; do not weaken the sandbox to bypass it.
- **Rejected profile or changed prepared bytes:** follow the runtime inspection procedure and correct the actual isolation/path problem. Use the native account home and fixed configuration root. Rebuild a fresh attempt for changed bytes; never modify stable data or claim an uninspected record is approved.

Record exact OS/build, hardware/RAM, APFS, tool/SDK identities, both lock hashes, cache state, actual download timings/throughput, active work, interventions and command exits. Adopt the existing [numeric onboarding budgets](../config/desktop/resource-policy.json) before trials: cold downloads and active work are separate measurements. A reused VM with empty checkout caches proves that setup condition, not a pristine OS or an unfamiliar person's unaided trial. [Integrated contributor verification](epics/EPIC-001-desktop-foundation/STORY-001-017-verify-the-integrated-foundation-and-contributor-journeys.md) owns that independent newcomer assessment.

[^apple-tools]: Apple documents the consented Terminal installation and the full-Xcode alternative.

[^apple-gatekeeper]: Apple documents the per-application exception after source verification; managed settings may restrict availability.
