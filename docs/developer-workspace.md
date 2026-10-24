---
type: Playbook
title: Locked developer workspace
description: Bootstrap isolated contributor tools, build the six package boundaries and verify the frozen workspace without changing research data.
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
---

# Locked developer workspace

## Scope and prerequisites

The workspace provides reproducible contributor tools, frozen dependency installation and six TypeScript package boundaries. The [workspace and developer tooling specification](epics/EPIC-001-desktop-foundation/STORY-001-002-establish-the-locked-workspace-and-developer-toolchain.md) defines this work. Its inputs are the reviewed [desktop foundation contract](desktop-foundation-contract.md), [target inventory](../config/desktop/targets.json) and [toolchain manifest](../config/desktop/toolchain.json). The [architecture decisions](adr/index.md) own technology version lines; manifests and locks own exact resolutions. The [provenance, evidence, uncertainty, coverage and honest stopping principles](product-definition.md#product-principles) (PRIN-004–007 and PRIN-016) require distinguishing downloaded metadata, developer-process execution and native desktop qualification.

Start with Git, a native conventional Python interpreter supporting Python 3.12 or later, a checkout on a supported local filesystem and permitted HTTPS access to the manifest's primary download endpoints and package registries. The bootstrap interpreter is an explicit prerequisite; subsequent managed commands use the downloaded pinned interpreter. Use an ordinary account. On Windows, invoke Python from the native PowerShell route selected by the [JavaScript tooling decision](adr/adr-0004-javascript-development-toolchain.md); the Windows contributor story owns its portable-shell provisioning and execution-policy checks. Never lower execution policy to run setup. Native OS installation procedures belong to their contributor stories, and verification on each supported platform follows the [native platform verification specification](epics/EPIC-001-desktop-foundation/STORY-001-018-qualify-the-native-foundation-targets.md).

Python tools serve repository maintenance. Product packages use TypeScript and have no end-user interpreter requirement. The renderer preview is a separate local development catalog that runs independently of Electron and research storage. The [isolated desktop runtime specification](epics/EPIC-001-desktop-foundation/STORY-001-004-run-the-isolated-desktop-and-supervised-data-service.md) defines native launcher isolation and admission checks before application execution.

## Bootstrap and frozen setup

Run from the task worktree. On Windows use `python` for the explicitly installed bootstrap interpreter when that is its native command name; arguments and repository entry points are identical.

```bash
python3 scripts/workspace.py bootstrap
python3 scripts/workspace.py setup
python3 scripts/workspace.py doctor
```

`bootstrap` downloads only the current OS/CPU's reviewed tool artifacts, checks SHA-256 before extraction and installs Node, the pnpm wrapper and native executable, uv and conventional CPython under `.tooling/`. pnpm's native distributions are pinned for all six targets in the toolchain manifest; its first-use downloader is disabled. `setup` also performs `pnpm install --frozen-lockfile`, `uv lock --check` and `uv sync --frozen --all-groups`, then verifies effective tool/package versions. Setup and managed package commands check that both locks retain their original hashes, including when an operation fails. Workspace settings require frozen resolution and reject stale installed dependencies; managed commands also force pnpm to fail instead of starting an implicit install. It never repairs the graph by rewriting a lock or upgrading a global tool.

`pnpm-lock.yaml` is one committed JavaScript lockfile. The selected pnpm writes a multi-document YAML stream containing package-manager dependencies and workspace dependencies; the YAML hook accepts that native format. `uv.lock` contains the actual repository dependencies, including the configured pre-commit, Ruff and Pyrefly tools. `ruff.toml` remains the Python lint/format authority. Existing standalone standard-library scripts retain their Python 3.12 minimum and can still run without a virtual environment or third-party dependencies.

Each checkout owns `.tooling/`, `.venv/` and `.cache/`, including pnpm's store/cache/state, uv's cache, the managed hook-command environments and the optional Playwright browser cache. Setup removes inherited Python environment overrides and supplies absolute local runtime paths. It uses the repository's credential-free `.npmrc` instead of user-level npm credentials. Do not copy these directories, credentials, `.env` files or stable application configuration between worktrees. A second checkout runs its own bootstrap and setup from the same committed inputs. These ignored environments are disposable tools, not research storage.

Repeat setup to reconcile the same frozen inputs. A concurrent setup fails with the owner lock's path; check its PID and confirm cessation before removing a stale `.tooling/setup.lock`. A missing executable, effective version mismatch, download/hash failure or frozen-resolution failure stops with a diagnostic. Restore network access or the reviewed input, or remove only the named damaged local tool and rerun setup. Do not use an unconstrained global upgrade, bypass package policies or regenerate locks to make setup pass. `doctor` verifies the four runtime/tool versions, developer Node's OS/CPU identity, installed Python-tool versions and every declared JavaScript dependency pin; it does not certify graphical-session, filesystem, sandbox, Electron-native or signing compatibility.

## Common commands

The Python entry supplies the local runtime environment and invokes only declared root package scripts. It does not require global Node, pnpm, uv, Ruff, Pyrefly, Vite or TypeScript executables.

```bash
python3 scripts/workspace.py run typecheck
python3 scripts/workspace.py run lint
python3 scripts/workspace.py run format:check
python3 scripts/workspace.py run format
python3 scripts/workspace.py run test
python3 scripts/workspace.py run build
python3 scripts/workspace.py run check
python3 scripts/workspace.py run boundaries
python3 scripts/workspace.py run dev
python3 scripts/workspace.py run package:local
```

`typecheck` generates public declarations in dependency order, separately runs strict TypeScript checks and checks the preview and new typed Python maintenance entry points with Pyrefly's strict preset against the standalone Python minimum. Main/preload compiler configurations include DOM declarations because Electron's unified declaration file refers to DOM types; main's lint policy forbids browser globals. Portable contracts/domain have no DOM or Node ambient types; renderer has DOM/React and no Node ambient types. Utility has Node types. Runtime imports are checked independently of ambient declarations.

`lint` refreshes public declarations before running semantic typed ESLint, the package boundary checker and Ruff. `format:check` and `format` use the shared Prettier configuration and Ruff, with versions aligned to the repository hooks. Node-based hooks explicitly select the manifest's developer Node patch. `test` builds package inputs, runs Vitest's declared `tests/**/*.test.ts` inventory and retains the complete Python script/policy suite. Compiler commands clear generated package outputs before regenerating them so removed sources cannot survive in a library archive. `build` compiles the actual package graph and produces the renderer library with Vite; Vite transpilation does not replace the type-check gate. `check` combines type, lint, format, test and build. Package manifests also expose their own compiler build/type commands.

`dev` builds dependencies and serves the separate appearance-control preview on loopback with a fixed port and strict collision failure. The preview changes transient component state and reports that it is unsaved. It makes no storage, IPC or research-readiness claim. Stop it with Ctrl+C. The preview directory is outside all package build outputs.

`package:local` builds and archives only declared package outputs/manifests and lock/target inputs in `artifacts/workspace-libraries.zip`. The completed ZIP replaces the previous archive only after writing succeeds; validation or write failures preserve the previous file. This is a local library handoff archive, not a runnable Electron application or native installer. Native quality packaging remains with the [native quality packaging specification](epics/EPIC-001-desktop-foundation/STORY-001-012-build-and-smoke-test-native-quality-artifacts.md); final signing/install/update qualification remains with the [signed installation and update specification](epics/EPIC-001-desktop-foundation/STORY-001-013-qualify-signed-installation-and-update-mechanisms.md). No publication command or signing credential is involved.

## Public packages and privilege boundaries

All packages export their root only, with `dist/index.js` and `dist/index.d.ts`. Import another package through its declared `@ohtia/...` root. Each package declares exact dependencies and its build outputs; [the boundary policy](../config/workspace-boundaries.json) defines permitted package/external/builtin imports. Internal package dependencies use `workspace:*`.

- `packages/contracts`: the existing appearance value contract and its runtime predicate, with no privileged dependencies.
- `packages/domain`: appearance fallback and system-color resolution, depending only on shared contracts.
- `packages/renderer`: a controlled React appearance selector receiving its labels and callbacks from its consumer. It has no persistence or process authority.
- `packages/preload`: a runtime isolation guard for the future named bridge. Its library output is a composition input; the native runtime owner must bundle its actual sandbox-compatible preload entry rather than loading this ESM library as a preload script.
- `packages/main`: construction of restrictive Electron renderer preferences after requiring an absolute preload asset path. This does not authorize a window, navigation or sender.
- `packages/utility`: a disposable in-memory SQLite engine inspection using the selected native binding and Kysely, closing its database on success or failure. It opens no researcher files and defines no application schema.

The checker rejects undeclared dependencies, prohibited renderer/domain imports, cross-package filesystem imports, package subpaths, computed dynamic imports, CommonJS imports, symlinked sources, source-level compiler references and package dependency cycles across runtime, development, optional and peer declarations. It checks import/export declarations, type imports and dynamic import expressions through the TypeScript syntax tree. Tests include deliberate authority violations and a cyclic manifest. Allowed runtime dependencies do not authorize every API of an otherwise permitted module; subsequent boundary owners still implement their operation-specific admission controls. IPC and wire schemas follow the [bounded application-port specification](epics/EPIC-001-desktop-foundation/STORY-001-003-define-and-verify-the-bounded-application-port.md), and storage follows the [persistent storage specification](epics/EPIC-001-desktop-foundation/STORY-001-005-persist-a-minimal-command-with-verified-migration-recovery.md).

## Native qualification handoff

The workspace declares Linux, Windows and macOS on both x64 and ARM64. `supportedArchitectures` includes each OS/CPU combination and glibc, retaining architecture-specific optional native dependencies in the frozen graph. The target manifest retains the required distribution/filesystem/display/package profiles. Architecture aliases resolve through the bootstrap's tested target selector; unsupported 32-bit architectures fail. Matching architecture strings do not detect or qualify every emulation mechanism.

For each real native host, the native qualification procedure uses both locks, root and package manifests, workspace settings, compiler and import policies, and toolchain and target manifests from the checkout being tested. Start with empty checkout-local caches/environments, run `setup`, `doctor`, `check` and `package:local`, record both lock hashes before/after and retain actual command exits and host identities. Verify selected optional native artifacts, then run the native qualification probes for Electron and its addons with the required isolation and observations of the actual artifacts and runtimes. A developer-Node SQLite result cannot qualify Electron's different embedded runtime or another native target. Cross-builds and emulation cannot replace any mandatory native cell.

Measure cold tool/dependency/browser downloads separately from active setup/build work under the foundation contract's hardware/network assumptions. Record OS/CPU, physical/virtual/emulated status, filesystem, session, cache state, throughput, timings, interventions and omissions. Keep evidence under ignored task data. Initial-host success and metadata checks leave the other cells unqualified; the native qualification work supplies the complete six-target evidence separately from this workspace and tooling change.

## Repository verification

Use the managed hook executable after setup, in addition to the workspace commands:

```bash
.venv/bin/pre-commit install
python3 scripts/workspace.py run hooks
python3 scripts/workspace.py run hooks:history
python3 -m unittest discover -s scripts/tests -v
python3 scripts/desktop_contract.py
git diff --check
```

On Windows the managed hook executable is `.venv/Scripts/pre-commit.exe`. Include untracked implementation files explicitly with `pre-commit run --files <paths>` before review; `--all-files` selects files already known to Git. The current [CI workflow](../.github/workflows/ci.yml) runs repository hooks, committed-history scanning and policy tests. The [shared verification specification](epics/EPIC-001-desktop-foundation/STORY-001-007-enforce-shared-verification-and-coverage-gates.md) defines enforcement and complete result accounting for the shared product checks. Local command results, independent code reviews, signed commit content identity, hosted CI and human integration remain separate evidence.
