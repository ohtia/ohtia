---
type: Playbook
title: Native Windows contribution
description: Prepare, diagnose, edit, verify and package Ohtia in an independent native Windows x64 contributor profile.
verified:
  by: human:AdrianMastronardi
sources:
  - id: powershell-zip
    resource: https://learn.microsoft.com/en-us/powershell/scripting/install/install-powershell-on-windows
    title: Installing PowerShell on Windows
  - id: execution-policy
    resource: https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_execution_policies
    title: About execution policies
  - id: native-compiler
    resource: https://learn.microsoft.com/en-us/cpp/build/building-on-the-command-line
    title: Use the Microsoft C++ Build Tools from the command line
  - id: shell-environment
    resource: https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_environment_variables
    title: PowerShell environment variables
  - id: python-windows
    resource: https://docs.python.org/3/using/windows.html
    title: Using Python on Windows
---

# Native Windows contribution

## Native prerequisites

This procedure implements [STORY-001-010](epics/EPIC-001-desktop-foundation/STORY-001-010-make-windows-contribution-setup-reproducible.md) using the [locked workspace](developer-workspace.md), [isolated desktop runtime](desktop-runtime.md) and [native quality builder](quality-builds.md). Use native x64 Windows 11 25H2 build 26200 or a later supported Windows 11 release, local fixed NTFS and an ordinary account's logged-in desktop. Windows ARM64, x86 emulation and WSL do not establish this route's native acceptance. PRIN-004–007, PRIN-011 and PRIN-016 require preserving actual provenance, research privacy and the limits of each observation.

Use an independent Windows VM or dedicated OS account without stable Ohtia, private research, provider credentials or maintainer credentials. Inspect it using [native profile preparation](native-qualification.md#provision-an-independent-native-profile) before any application launch. Configuration stays at the account-native `AppData\Roaming\Ohtia`; research stays at the account-native `ohtia` directory. A second checkout, renamed app or different research folder does not establish isolation.

Install native Git for Windows from [Git's Windows download](https://git-scm.com/downloads/win) and a conventional native x64 CPython 3.12 or later from [Python's Windows downloads](https://www.python.org/downloads/windows/). Verify the publisher in their installation interfaces. The Python command below must resolve to that interpreter, rather than an unresolved Store installation alias or an x86/ARM process. An installed Store-distributed interpreter is acceptable when it meets those native conventional-interpreter requirements; an alias that only opens an installer is not an interpreter. Python installation is an explicit bootstrap prerequisite; the subsequent workspace setup installs its manifest-pinned interpreter locally.[^python-windows] An administrator may need to provision Windows or prerequisite OS packages; ordinary setup, development, checks and packaging run without elevation.

The Windows-supplied `curl.exe` must retain its Schannel backend and valid OS trust policy. The doctor reports its actual version; consented archive downloads use the [workspace's native Windows HTTPS adapter](developer-workspace.md#bootstrap-and-frozen-setup). Keep Windows trusted roots current through Windows Update or approved organization policy. A certificate error stops setup with a trust-specific repair; it never authorizes an insecure retry or a server-certificate import.

The normal route consumes the pinned native better-sqlite3 prebuild and the builder's NSIS tools; it requires no installed Visual Studio compiler or Windows SDK. A prebuild failure stops setup or native admission rather than authorizing a different SQLite engine, an implicit source rebuild or another dependency graph. For an explicitly reviewed source-build investigation, install Visual Studio 2022 Build Tools with **Desktop development with C++**, MSVC v143 x64/x86 tools at compiler 19.44 or later and Windows 11 SDK 10.0.26100.0 or later. Use the installer's consent flow and open its **x64 Native Tools Command Prompt**, then the checkout's pinned `pwsh.exe -NoProfile`; `doctor --compiler` checks the effective x64 compiler banner and selected SDK headers.[^native-compiler] Record exact versions and artifact identities with the investigation; a successful compiler check does not qualify a changed addon.

## Clone and prepare the shell

Start in the independent account's native desktop terminal. Built-in Windows PowerShell is only the entry for installing the reviewed portable PowerShell; the subsequent journey uses its worktree-local `pwsh.exe`. Clone the public repository without credentials into an owned, unsynchronized local directory. Keep the full checkout root within 80 UTF-16 code units: this route uses a conservative bound for nested tools and packages instead of changing global long-path settings. Spaces and non-ASCII characters are permitted. Never copy `.tooling`, `.venv`, `.cache`, `node_modules`, secrets or application settings from another checkout.

Inspect existing branches and worktrees first and resume an existing task when present, following [Branches and worktrees](../AGENTS.md#branches-and-worktrees). For a fresh clone, replace `24` below with the existing issue assigned to the work. Keep the main checkout separate and run every subsequent setup/edit/check command from the new task worktree. The example keeps spaces and non-ASCII characters in the actual worktree's parent.

```powershell
$ohtiaSource = Join-Path $env:USERPROFILE 'source é\ohtia'
git clone --config core.autocrlf=false https://github.com/ohtia/ohtia.git $ohtiaSource
if ($LASTEXITCODE -ne 0) { throw 'Clone failed.' }
Set-Location -LiteralPath $ohtiaSource
git status --short
git worktree list
git branch --list
$ohtiaIssue = 24
$ohtiaBranch = "chore/issue-$ohtiaIssue"
$ohtiaWorktree = Join-Path (Split-Path -Parent $ohtiaSource) "ohtia-worktrees\issue-$ohtiaIssue"
git fetch origin main
if ($LASTEXITCODE -ne 0) { throw 'Base fetch failed.' }
git worktree add -b $ohtiaBranch $ohtiaWorktree origin/main
if ($LASTEXITCODE -ne 0) { throw 'Worktree creation failed; inspect existing work before retrying.' }
Set-Location -LiteralPath $ohtiaWorktree
python -B scripts/windows_contributor.py shell --install-tools
if ($LASTEXITCODE -ne 0) { throw 'Shell setup stopped; follow the controlled diagnostic.' }
$env:POWERSHELL_TELEMETRY_OPTOUT = '1'
$env:POWERSHELL_UPDATECHECK = 'Off'
$env:PSModuleAnalysisCachePath = 'NUL'
& '.\.tooling\powershell\pwsh.exe' -NoProfile
```

`shell --install-tools` explicitly consents to downloading only the [toolchain manifest's](../config/desktop/toolchain.json) pinned portable ZIP from Microsoft's PowerShell release. It verifies SHA-256 before extraction and installs the full archive atomically under `.tooling/powershell`, with the shared exclusive setup lock. It does not register Microsoft Update, install an MSI or substitute a PATH/Store shell.[^powershell-zip] Repeating the command verifies the existing version and native process/OS architecture. A failed download never becomes an executable installation.

Honor effective organization/user execution policy. No command here changes it or supplies Bypass/Unrestricted flags. The procedure uses native executables and interactive commands; it does not need activation scripts or unsigned `.ps1` files. An organization requiring additional reviewed signatures or blocking the downloaded executable must approve that prerequisite through its own procedure; preserve the controlled failure and do not weaken policy.[^execution-policy] AllSigned environments must already trust the required Microsoft-signed bundled modules under their organization's policy. If initial publisher trust requires interactive consent, an authorized operator reviews it through that organization's normal interactive procedure before noninteractive diagnosis; the doctor cannot grant trust or lower policy.

## Diagnose and install

Run all following PowerShell commands from the checkout in its pinned `-NoProfile` shell. Check native exits explicitly: PowerShell does not otherwise turn every nonzero native exit into a terminating error. UTF-8 diagnostics are emitted by the Python entry; do not capture whole environment dumps, home paths, credentials or arbitrary child errors into shareable reports.

```powershell
python -B scripts/windows_contributor.py doctor
if ($LASTEXITCODE -ne 0) { throw 'Resolve the reported prerequisites before setup.' }
python -B scripts/windows_contributor.py setup --install-tools
if ($LASTEXITCODE -ne 0) { throw 'Frozen setup failed; preserve the attempt and retry safely.' }
& '.\.tooling\python\python.exe' -B scripts/windows_contributor.py doctor --workspace
if ($LASTEXITCODE -ne 0) { throw 'Workspace diagnosis failed.' }
```

The doctor disables PowerShell telemetry, update checks, its diagnostic pipe and module-analysis file cache in its child process before querying the shell. The interactive example also suppresses telemetry/update checks and the file cache for that terminal session; it changes no persistent user or machine setting.[^shell-environment]

`doctor` performs diagnosis without installing workspace tools or changing Ohtia configuration/research data. It checks the actual Windows build, native host/interpreter agreement, ordinary token, visible desktop, canonical local NTFS home/checkout, tool/cache aliases, checkout length, Git, exact PowerShell version/architecture and effective policy. It does not download tools, create checkout tool/cache directories, launch Electron, read a stable locator or manufacture an isolation declaration. PowerShell/.NET can maintain their ordinary account-local startup optimization cache under `AppData\Local\Microsoft\PowerShell`; disabling the module-analysis cache does not suppress that runtime cache. `--workspace` also inspects the shared effective tools and installed pins. Optional `--compiler` reports a missing/wrong SDK/compiler separately from normal prebuild requirements.

`setup --install-tools` installs manifest-pinned Node, pnpm, uv and conventional Python plus both frozen dependency graphs through the shared entry. Both locks retain their hashes on success and failure. The tool captures child output privately and emits controlled remediation; a contained Job Object owns long-lived installation/build processes. A timeout or uncertain cleanup is not permission to remove a writer's lock. Download sources, checkout-local caches and command semantics are defined by the [workspace guide](developer-workspace.md#bootstrap-and-frozen-setup). Repeat setup deliberately after correcting a failure; no global package manager or maintainer identity is required.

## Inspect the profile and launch

Prepare `runtime-profile.json` with the exact [native runtime schema](desktop-runtime.md#prepare-an-independent-native-profile), `target: win32-x64`, the inspected native account home and `AppData/Roaming` configuration parent. Create its fixed `ohtia` research root and a disjoint scratch directory within that independent account. Inspect ACLs, junctions/reparse points, volume locality and synchronization services. Record the actual inspecting actor. Use separate synthetic stable configuration, locator, store and recovery fixtures when the VM has no stable installation; do not copy private stable data. Retain before/after sentinel digests and metadata with the native attempt.

Set these variables to the inspected absolute paths; `$env:USERPROFILE` is only a convenient expression after native inspection, not proof of the account's authoritative home. The prepared directory must be new. Create the inspection record before running diagnosis or development. The directory commands below preserve existing directories; inspect any existing contents rather than assuming they are disposable. After creating the roots, write and inspect the profile record before continuing with build and admission.

```powershell
$ohtiaPython = Join-Path $PWD '.tooling\python\python.exe'
$ohtiaScratch = Join-Path $env:USERPROFILE 'ohtia-contributor-scratch'
$ohtiaResearch = Join-Path $env:USERPROFILE 'ohtia'
New-Item -ItemType Directory -Force -ErrorAction Stop -Path $ohtiaResearch, $ohtiaScratch | Out-Null
$ohtiaProfile = Join-Path $ohtiaScratch 'runtime-profile.json'
```

Write the exact profile record at `$ohtiaProfile` using the inspected roots, actual actor and stable fixture digests described above. Do not continue until that inspection is complete. Then run:

```powershell
$ohtiaPrepared = Join-Path $ohtiaScratch 'runtime-1'
& $ohtiaPython scripts/workspace.py run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
& $ohtiaPython scripts/workspace.py run desktop:prepare win32-x64 $ohtiaPrepared
if ($LASTEXITCODE -ne 0) { throw 'Runtime preparation failed.' }
& $ohtiaPython -B scripts/windows_contributor.py doctor --workspace --profile $ohtiaProfile --prepared $ohtiaPrepared
if ($LASTEXITCODE -ne 0) { throw 'Native profile or runtime admission failed.' }
& $ohtiaPython scripts/workspace.py run desktop:test $ohtiaProfile $ohtiaPrepared (Join-Path $ohtiaScratch 'runtime-evidence-1')
if ($LASTEXITCODE -ne 0) { throw 'Native runtime acceptance failed.' }
& $ohtiaPython scripts/workspace.py run dev $ohtiaProfile $ohtiaPrepared
if ($LASTEXITCODE -ne 0) { throw 'Development launch failed.' }
```

Run `desktop:test` before the first store creation: its missing-locator fixture requires no existing synthetic database or locator. Subsequent storage acceptance may use the initialized synthetic store. Preserve the evidence rather than deleting stores to make a fixture fit.

The common launcher validates profile exclusions and immutable prepared bytes before starting the broker; main and utility independently recheck their context. Unverified/stable profiles and native alias escapes must fail before reading a stable locator or starting an app. Do not redirect `APPDATA`, `USERPROFILE` or Electron `userData` to simulate isolation.

Observe the real desktop status and explicitly open/create the synthetic store. Change its appearance preference, use the window's exit control and relaunch using the same command to verify the saved value. Observe service cessation and no remaining attempt executable. Ctrl+C or disappearance of the top-level process alone does not prove full shutdown. Run the runtime/storage failure controls below and independently compare all stable fixture bytes and metadata afterward.

## Edit, rebuild, check and package

For the representative edit, temporarily replace `<h1 id="title">{text("title")}</h1>` with `<h1 id="title">Ohtia contributor</h1>` in `packages/renderer/src/desktop.tsx`, using an editor and saving the file. Preserve bridge, storage and catalog contracts. The shared check includes the actual build; prepare a new runtime from those edited outputs and observe the changed heading before exiting the window.

```powershell
& $ohtiaPython scripts/workspace.py run check
if ($LASTEXITCODE -ne 0) { throw 'Edited-source checks and build failed.' }
$ohtiaEdited = Join-Path $ohtiaScratch 'runtime-2'
& $ohtiaPython scripts/workspace.py run desktop:prepare win32-x64 $ohtiaEdited
if ($LASTEXITCODE -ne 0) { throw 'Edited runtime preparation failed.' }
& $ohtiaPython scripts/workspace.py run dev $ohtiaProfile $ohtiaEdited
if ($LASTEXITCODE -ne 0) { throw 'Edited development launch failed.' }
```

Restore only that disposable heading edit in the editor, preserving unrelated changes. Repeat the shared check and assemble a third, new runtime before final storage acceptance and packaging. Do not reuse `runtime-1` or `runtime-2`; avoid concurrent commands that regenerate `dist`. The shared check accounts for the complete applicable Python suite through the declared inventory; raw unittest skips are not a replacement for it.

```powershell
& $ohtiaPython scripts/workspace.py run check
if ($LASTEXITCODE -ne 0) { throw 'Restored-source checks and build failed.' }
$ohtiaPrepared = Join-Path $ohtiaScratch 'runtime-3'
& $ohtiaPython scripts/workspace.py run desktop:prepare win32-x64 $ohtiaPrepared
if ($LASTEXITCODE -ne 0) { throw 'Restored runtime preparation failed.' }
& $ohtiaPython scripts/workspace.py run hooks
if ($LASTEXITCODE -ne 0) { throw 'Repository hooks failed.' }
& $ohtiaPython scripts/workspace.py run hooks:history
if ($LASTEXITCODE -ne 0) { throw 'Committed-history secret scan failed.' }
git diff --check
if ($LASTEXITCODE -ne 0) { throw 'Whitespace checks failed.' }
& $ohtiaPython scripts/workspace.py run storage:test $ohtiaProfile $ohtiaPrepared (Join-Path $ohtiaScratch 'storage-evidence-1')
if ($LASTEXITCODE -ne 0) { throw 'Native storage acceptance failed.' }
& $ohtiaPython -B scripts/windows_contributor.py package --profile $ohtiaProfile --prepared $ohtiaPrepared --output (Join-Path $ohtiaScratch 'package-1')
if ($LASTEXITCODE -ne 0) { throw 'Native local packaging failed.' }
```

The first `run hooks` also opts into the pinned hook repository/revision and language-runtime downloads defined by [the hook configuration](../.pre-commit-config.yaml) and [workspace cache procedure](developer-workspace.md#bootstrap-and-frozen-setup). The configuration fixes Node and the Go compiler for building Gitleaks; Python hook packages come from PyPI, Node from its vendor distribution and Go from `dl.google.com/go`. These are checkout-local quality tools, not OS prerequisites or product dependencies; no global Go installation, administrator terminal or maintainer credentials are needed. Preserve failed hook setup, restore access to those sources and retry with the same configuration.

Running the package command explicitly opts into first-use downloads of the toolsets selected and checksum-verified by the builder pinned in `pnpm-lock.yaml`: its default NSIS 3.0.4.1 and resources 3.4.1 archives come from the `electron-userland/electron-builder-binaries` GitHub release repository. The builder's embedded checksums and frozen package integrity bind those inputs; there is no global NSIS installation, unsigned-script policy change or elevation. The build uses only the worktree-local `.cache/quality-builder`; preserve download failures and retry with a fresh package attempt after restoring HTTPS access.

Use the [shared verification](shared-verification.md) and [quality build](quality-builds.md) contracts for inventory accounting and complete native packaged smoke coverage. The contributor package entry reuses that builder after common admission, fixes `win32-x64`/NSIS and per-user/no-elevation installation, and emits `packages.json` with prepared-record and final-package SHA-256 identities. It requires a fresh canonical output inside admitted scratch, disjoint from the immutable prepared tree. It cannot publish, sign, update a stable installation or certify release readiness. `package:local` remains the separate library ZIP and is not a substitute for this runnable Windows package.

Local native success, required hosted artifacts, human newcomer/assistive acceptance, signed release qualification and integration are separate evidence. Optional editor/debug configurations are not needed by this procedure. Retain actual OS/build/hardware, native executable/utility/addon identities, source and lock hashes, command exits, downloaded/cached bytes, elapsed/active/download timings, interventions and omissions. Use the [foundation onboarding budget](desktop-foundation-contract.md#contributor-setup-acceptance); a machine with preinstalled prerequisites or a warm cache does not establish a cold newcomer duration.

## Separate POSIX maintainer verification

`scripts/github_pr.py` requires POSIX process/pipe controls. It is a maintainer provenance procedure, not a native Windows application prerequisite. Use a separate supported Linux environment or trusted POSIX host, its own clean checkout and tools, and the [repository policy procedure](repository-policy.md). A maintainer authorizes credentials there only when live GitHub verification needs them. Ordinary Windows setup/dev/check/build/package requires none. WSL may host this narrower POSIX maintenance work; it supplies no native Windows desktop, addon or ARM64 evidence.

The credential-free POSIX smoke below checks command availability and the verifier's synthetic regression suite. It does not certify live branch protections or an actual pull request. Run the live verifier only with the arguments and authorization from the repository policy guide.

```bash
python3 scripts/github_pr.py --help
python3 -m unittest discover -s scripts/tests -p test_github_pr.py -v
```

## Recovery

- **Missing/wrong tool or architecture:** use the exact native x64 interpreter and checkout shell. Preserve the failed attempt, confirm process cessation, remove only the named damaged local tool/cache and repeat `shell --install-tools` or `setup --install-tools`. A wrong addon or engine requires restoring reviewed bytes or a reviewed qualification change, not an alternate system SQLite or unconstrained rebuild.
- **Compiler/SDK:** the normal prebuild route does not need them. For source-build investigation, use `doctor --compiler` from a fresh selected x64 Native Tools environment. Repair the C++ workload/SDK through its installer with consent; never mix ARM/x86 tools with x64 runtime artifacts.
- **Network/cache failure or interrupted setup:** restore HTTPS access to pinned primary release endpoints and npm/Python registries, retain digest-failure evidence and retry. `.partial` downloads are not installed. Check the PID in `.tooling/setup.lock` and native descendant processes before removing a stale lock. Never remove a live lock or rewrite a frozen lockfile.
- **File locking/access denied:** exit the attempt through its window, inspect its actual remaining processes, close checkout editors/build tools holding files and retry after restoring account ACLs. Preserve research, checkpoints and failed package attempts. Do not disable antivirus, use routine Administrator terminals or force-delete occupied stores. A fresh attempt directory avoids overwriting immutable runtime/package evidence.
- **Paths:** quote arguments, use PowerShell's call operator `&` for executable paths and `-LiteralPath` when changing directories. Reject network/synchronized roots, junctions/reparse aliases and roots longer than the documented conservative limit. Move the checkout to a shorter owned NTFS path and repeat setup; do not enable global path-policy workarounds.
- **Line endings:** keep repository LF rules and the explicit Windows batch CRLF exception from `.gitattributes`. Use clone-local `core.autocrlf=false`; configure an optional editor to honor `.editorconfig`. Check `git diff --check` and hooks after editing; do not normalize unrelated files.
- **Denied research storage or native admission:** retain the original locator/store/recovery fixture and controlled graphical error. Reinspect the independent account, ACLs, aliases, stable exclusions and prepared hashes; use the same shared admission contract. A doctor success is not authority to bypass a later storage refusal.
- **Shareable diagnosis:** the contributor entry suppresses raw child errors, account paths, environment values and credential stores. Retain detailed native evidence only in ignored, access-controlled scratch. Share controlled diagnostics and input/package digests; inspect other tools' output before publishing it.

[^powershell-zip]: Microsoft documents the portable ZIP route; the repository manifest owns the exact patch and SHA-256.

[^execution-policy]: Execution policy is inspected and honored without changing machine/user policy.

[^native-compiler]: Microsoft's developer command environments select compiler, target and SDK together; the optional source-build check does not replace native addon qualification.

[^python-windows]: The bootstrap interpreter is a native prerequisite; the locked workspace supplies subsequent exact tool versions.

[^shell-environment]: Microsoft documents startup environment controls and the Windows NUL cache target; these controls apply only to the child/session.
