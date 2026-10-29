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

Follow this procedure to build, run, change, test and package Ohtia on Apple Silicon with macOS 26 or 27. Use a separate native VM or dedicated account with synthetic data and a logged-in graphical session. Keep it independent of your ordinary Ohtia installation and research materials, as required by PRIN-004–007 and PRIN-016.

## Prepare the Mac

Use a native ARM64 Terminal, an ordinary account and an account-owned directory on local, unsynchronized APFS storage. Check the Apple developer tools:

```bash
xcode-select -p
xcrun --find clang
/usr/bin/python3 --version
```

If developer tools are absent, run `xcode-select --install`, complete Apple's installation dialog and retry these checks.[^apple-tools] A selected full Xcode installation also works. Complete any Apple license prompt before continuing. The bootstrap requires Apple's Python 3.9 or later; it installs the project's pinned tools locally.

Clone the public repository:

```bash
mkdir -p "$HOME/src"
git clone https://github.com/ohtia/ohtia.git "$HOME/src/ohtia"
cd "$HOME/src/ohtia"
```

Prepare the issue branch and task worktree through the [contribution workflow](../CONTRIBUTING.md#prepare-repository-changes). Run the remaining commands from that worktree. The repository hooks refuse `main` and `master`.

## Install the project tools

```bash
/usr/bin/python3 scripts/macos_contributor.py doctor
/usr/bin/python3 scripts/macos_contributor.py setup --install-tools
.tooling/python/bin/python3 scripts/macos_contributor.py doctor --workspace
```

All three commands must exit successfully. The first doctor checks the native OS/CPU, filesystem, permissions, Apple tools and graphical session without installing anything. Setup downloads the versions pinned in the [toolchain manifest](../config/desktop/toolchain.json), verifies their hashes and installs frozen dependencies into this worktree. The final doctor checks the installed tools. No global package manager or paid developer identity is required.

Repeat setup to check that the existing installation can be reused without changing the lockfiles:

```bash
/usr/bin/python3 scripts/macos_contributor.py setup --install-tools
git diff --exit-code -- pnpm-lock.yaml uv.lock
```

## Prepare the launch profile

Create the research and scratch directories in the independent account:

```bash
mkdir -p "$HOME/ohtia" "$HOME/ohtia-contributor-scratch"
ohtia_scratch="$HOME/ohtia-contributor-scratch"
ohtia_profile="$ohtia_scratch/runtime-profile.json"
```

Follow [native profile inspection](native-qualification.md#provision-an-independent-native-profile), then create `runtime-profile.json` using the [runtime profile contract](desktop-runtime.md#prepare-an-independent-native-profile). Set `target` to `darwin-arm64`, use the actual account home and its fixed `Library/Application Support` configuration root, and record the inspected research, scratch and stable-sentinel roots. On a fresh VM without a stable installation, use synthetic stable configuration/store/recovery fixtures as described there. Record only checks you actually performed; copying the example does not inspect the account.

Save the completed profile at the path in `ohtia_profile` before continuing. Configuration, research, scratch and stable roots must satisfy the linked inspection procedure; do not redirect the native configuration root or run Ohtia as root.

## Build and run

Choose a prepared directory that does not exist yet:

```bash
ohtia_prepared="$ohtia_scratch/runtime-1"
.tooling/python/bin/python3 scripts/workspace.py run build
.tooling/python/bin/python3 scripts/workspace.py run desktop:prepare darwin-arm64 "$ohtia_prepared"
.tooling/python/bin/python3 scripts/macos_contributor.py doctor --workspace --profile "$ohtia_profile" --prepared "$ohtia_prepared"
.tooling/python/bin/python3 scripts/workspace.py run dev "$ohtia_profile" "$ohtia_prepared"
```

The window should show that the local service is responding. Open/create the synthetic local store, change an appearance preference and save it. Quit using the window's exit control, run the same `dev` command again, open the store and confirm that the saved preference remains. Quit before continuing.

## Make and check a visible change

In `packages/renderer/src/desktop.tsx`, replace `<h1 id="title">{text("title")}</h1>` with `<h1 id="title">Ohtia contributor</h1>`. Then run:

```bash
.tooling/python/bin/python3 scripts/workspace.py run typecheck
.tooling/python/bin/python3 scripts/workspace.py run test
.tooling/python/bin/python3 scripts/workspace.py run build
.tooling/python/bin/python3 scripts/workspace.py run desktop:prepare darwin-arm64 "$ohtia_scratch/runtime-2"
.tooling/python/bin/python3 scripts/workspace.py run dev "$ohtia_profile" "$ohtia_scratch/runtime-2"
```

The checks must pass and the window must display `Ohtia contributor`. Quit, restore the original heading in the source file and rebuild a fresh canonical runtime for the remaining steps:

```bash
.tooling/python/bin/python3 scripts/workspace.py run build
ohtia_prepared="$ohtia_scratch/runtime-3"
.tooling/python/bin/python3 scripts/workspace.py run desktop:prepare darwin-arm64 "$ohtia_prepared"
```

Prepared runtimes are immutable: rebuilding source does not update an existing runtime directory. Run build/test commands sequentially because they can regenerate the same outputs.

## Run the native tests

The desktop suite needs an absent locator. With Ohtia stopped, preserve the synthetic configuration and store created in this walkthrough together under a new scratch directory:

```bash
ohtia_saved="$ohtia_scratch/before-native-tests-1"
mkdir "$ohtia_saved" &&
  mv "$HOME/Library/Application Support/Ohtia" "$ohtia_saved/configuration" &&
  mv "$HOME/ohtia" "$ohtia_saved/store" &&
  mkdir "$HOME/ohtia"
```

Continue only if the preservation commands succeed. If either location contains data you cannot identify as this walkthrough's synthetic state, use a fresh independent account instead.

Run desktop acceptance before storage acceptance, using new evidence directories:

```bash
.tooling/python/bin/python3 scripts/workspace.py run desktop:test "$ohtia_profile" "$ohtia_prepared" "$ohtia_scratch/desktop-evidence-1"
.tooling/python/bin/python3 scripts/workspace.py run storage:test "$ohtia_profile" "$ohtia_prepared" "$ohtia_scratch/storage-evidence-1"
```

Both commands must exit successfully. Results are written to `desktop-evidence-1/receipt.json` and `storage-evidence-1/storage-receipt.json` under scratch. These suites exercise the local service, failure/retry, persistence/restart and shutdown using the built runtime.

## Run the shared checks

```bash
.venv/bin/pre-commit install
.tooling/python/bin/python3 scripts/workspace.py run check
.tooling/python/bin/python3 scripts/workspace.py run hooks
.tooling/python/bin/python3 scripts/workspace.py run hooks:history
.tooling/python/bin/python3 -m unittest discover -s scripts/tests -v
.tooling/python/bin/python3 scripts/desktop_contract.py
git diff --check
```

Every command must exit successfully. Review any formatter changes and rerun affected checks. For new files, also run `.venv/bin/pre-commit run --files <paths>` because `--all-files` includes only files known to Git. The [workspace guide](developer-workspace.md) describes the shared commands.

## Build a local package

Use the restored source and canonical runtime:

```bash
.tooling/python/bin/python3 scripts/macos_contributor.py package --profile "$ohtia_profile" --prepared "$ohtia_prepared" --output "$ohtia_scratch/package-1"
```

Expect an ARM64 DMG and ZIP under `package-1/packages` and a `package-1/packages.json` receipt with their hashes. Use a new output directory for another attempt. These are local development packages with ad-hoc signatures; the command requires no signing/notarization credentials and does not publish a release. The separate `package:local` command creates a library archive, not a desktop installer. [Native quality builds](quality-builds.md) describes CI's additional tests against installed package payloads.

If macOS blocks an intentionally trusted local build, verify its source and package identity, then use Apple's per-application **Open Anyway** action in System Settings → Privacy & Security if offered.[^apple-gatekeeper] Keep Gatekeeper, SIP and the application sandbox enabled.

## Resolve common failures

- **Missing Apple tools or license:** run `xcode-select --install`, complete Apple's dialogs and retry `doctor`. If the wrong Xcode is selected, have the machine owner select the intended installation.
- **Unsupported OS/CPU or Rosetta:** use Apple Silicon with macOS 26 or 27 and a native ARM64 Terminal. Recreate the worktree's tool environment through the same setup command.
- **No graphical session:** log into the independent account in the Mac's graphical console and retry `doctor`. SSH alone is insufficient.
- **Download or hash failure:** check HTTPS access to the manifest's artifact endpoints, npm and PyPI, then retry setup. Keep the lockfiles unchanged; do not disable TLS verification.
- **Setup already in progress:** wait for that process to finish. If it stopped, inspect the PID in `.tooling/setup.lock` and remove the lock only after confirming it is stale.
- **Hooks refuse the branch:** resume the issue branch/worktree from the contribution workflow; do not run the walkthrough's edits on `main` or `master`.
- **Profile or prepared-runtime refusal:** correct the profile using the inspection procedure, or build a new runtime directory if its bytes changed.
- **Native addon mismatch:** rerun workspace diagnosis, rebuild and assemble a new runtime from the unchanged locks. Do not substitute a developer-Node binding for the Electron binding.
- **Denied checkout or research access:** use an account-owned local APFS directory and correct its permissions. Run as the ordinary inspected account.

[^apple-tools]: Apple documents the consented Terminal installation and the full-Xcode alternative.

[^apple-gatekeeper]: Apple documents the per-application exception after source verification; managed settings may restrict availability.
