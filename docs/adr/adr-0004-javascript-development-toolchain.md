---
type: DecisionRecord
title: "ADR-0004 — Node, pnpm, ESLint and Prettier toolchain"
description: "Use a locked TypeScript workspace with reproducible tools, a native Windows contributor shell and separate type, lint and format checks."
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
sources:
  - id: node
    resource: "https://github.com/nodejs/Release/blob/main/schedule.json"
    title: "Node.js — Release schedule"
  - id: pnpm
    resource: "https://pnpm.io/workspaces"
    title: "pnpm — Workspaces"
  - id: powershell
    resource: https://github.com/PowerShell/PowerShell/releases/tag/v7.6.8
    title: PowerShell native release metadata
  - id: lint
    resource: "https://registry.npmjs.org/typescript-eslint/8.71.2"
    title: "typescript-eslint — Package metadata"
---

# ADR-0004 — Node, pnpm, ESLint and Prettier toolchain

## Context

Multiple package managers, tool versions and implicit global dependencies hide incompatible resolutions. A bundler that transpiles TypeScript does not run its full type checker; format and lint serve different purposes. Biome and Oxlint are alternatives for their respective scopes; retain ESLint for typed ecosystem rules and the existing shared Prettier formatter rather than asserting an unmeasured speed advantage.

## Decision

Use Node `26.12.*` for developer/build tooling, a pnpm `12.14.*` workspace and one committed lockfile for JavaScript/TypeScript packages. npm, Yarn and Bun are alternatives; retaining pnpm makes the package dependency graph and frozen resolution explicit without claiming exclusivity or measured speed superiority.[^node][^pnpm]

Use ESLint `10.13.*` with typescript-eslint `8.71.*` for semantic lint and Prettier `3.9.*` for formatting.[^lint] The TypeScript compiler selected in [ADR-0002](adr-0002-typescript-product-and-local-ipc.md) runs as a separate type-checking gate. The selected versions have published engine/peer compatibility; exact patches and transitive versions are locked and must pass an integrated clean build. Do not equate version availability with tested Ohtia compatibility.

Use PowerShell `7.6.*` (`pwsh.exe`, native x64 or ARM64) as the primary Windows contributor shell. Invoke without user profiles, preserve native command exit codes and use UTF-8 text. Windows PowerShell, Git Bash, cmd and WSL are supplemental paths, not substitutes for the native contributor acceptance journey. Honor effective organizational/user execution policy; never add Bypass/Unrestricted flags or change machine-wide policy. If AllSigned applies, supply reviewed signed scripts or report the enabling condition rather than weakening policy. Use its pinned portable ZIP in a worktree-local tooling root as the primary bootstrap, without routine elevation or Microsoft Update registration. Resolve the exact executable there rather than accepting an unrelated PATH installation. Do not silently replace its patch through Store, MSI or update-manager defaults; tool updates follow reviewed pin changes. Exact patches and distribution digests belong in the [foundation manifest](../../config/desktop/toolchain.json); the target contract identifies invocation and native facilities.[^powershell]

CI uses frozen installs and package-local tools. Prettier retains this repository's one-source-line Markdown paragraphs. Share base compiler/lint settings but keep renderer, preload, main and utility runtime constraints distinct. Electron's bundled Node is a separate runtime from developer Node; record and test it rather than assuming they match.

Keep manifest/hook/image pins coordinated in dependency changes. A tool major/minor transition checks diagnostics, compiler API consumers, native modules and build output before adoption.

## Consequences

A common toolchain reduces installation variation but requires coordinated updates. Never ask researchers to install Node or pnpm for the graphical product. Reconsider a component after demonstrated incompatibility or a measured maintenance benefit, while preserving lockfiles, type coverage and the named quality gates.

[^node]: The official release schedule defines the selected Node release family's support window; developer Node and Electron Node remain separate.

[^pnpm]: pnpm defines workspace dependencies and a shared lockfile; Ohtia selects it over other valid package managers.

[^lint]: The package metadata declares typed-lint engine and compiler peer requirements; integrated compatibility is verified with exact locked patches.

[^powershell]: The primary release metadata identifies native Windows distribution archives; archive availability does not prove contributor execution or policy compatibility.
