---
type: EPIC
title: "EPIC-001 — Desktop foundation"
description: "Deliver a safe runnable desktop, reproducible native contribution environments and immutable build/release infrastructure with artifact-bound native coverage."
generated:
  by: claude-code/claude-opus-5-5
verified:
  by: human:AdrianMastronardi
tags: [epic, "comp:desktop", "comp:tooling", "comp:storage", "comp:docs"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/14
sources:
  - id: roadmap
    resource: "https://github.com/ohtia/ohtia/blob/main/docs/product-roadmap.md"
    title: "Product roadmap"
  - id: release-policy
    resource: "https://github.com/ohtia/ohtia/blob/main/docs/release-policy.md"
    title: "Desktop builds, releases and change notes"
  - id: issue-7
    resource: "https://github.com/ohtia/ohtia/issues/7"
    title: "Release-policy problem, scope, exclusions and acceptance"
  - id: roadmap-issue
    resource: "https://github.com/ohtia/ohtia/issues/9"
    title: "Publish the initial product roadmap and contributor foundation scope"
  - id: roadmap-pr
    resource: "https://github.com/ohtia/ohtia/pull/10"
    title: "Integrated product roadmap"
  - id: entity-identifiers
    resource: "https://github.com/ohtia/ohtia/blob/main/docs/adr/adr-0008-uuidv7-entity-identifiers.md"
    title: "Application-generated UUIDv7 entity identifiers"
  - id: architecture
    resource: "https://github.com/ohtia/ohtia/blob/main/docs/architecture.md"
    title: "System architecture"
  - id: frontend
    resource: "https://github.com/ohtia/ohtia/blob/main/docs/frontend-architecture.md"
    title: "Frontend architecture"
  - id: product
    resource: "https://github.com/ohtia/ohtia/blob/main/docs/product-definition.md"
    title: "Product definition and PRIN requirements"
  - id: decisions
    resource: "https://github.com/ohtia/ohtia/blob/main/docs/adr/index.md"
    title: "Architecture decision register and adopting contracts"
  - id: contribution
    resource: "https://github.com/ohtia/ohtia/blob/main/AGENTS.md"
    title: "Contribution, issue, worktree, checks and review requirements"
  - id: storage
    resource: "https://github.com/ohtia/ohtia/blob/main/docs/adr/adr-0006-sqlite-application-storage.md"
    title: "SQLite storage and effective engine identity"
  - id: migrations
    resource: "https://github.com/ohtia/ohtia/blob/main/docs/adr/adr-0007-sqlite-repositories-and-migrations.md"
    title: "Repository, native binding and migration authority"
  - id: recovery
    resource: "https://github.com/ohtia/ohtia/blob/main/docs/adr/adr-0010-pre-migration-recovery.md"
    title: "Checkpoint creation, retention and recovery"
  - id: bootstrap
    resource: "https://github.com/ohtia/ohtia/blob/main/docs/adr/adr-0036-application-preferences-and-bootstrap.md"
    title: "Preferences and fixed bootstrap locator"
  - id: diagnostics
    resource: "https://github.com/ohtia/ohtia/blob/main/docs/adr/adr-0013-private-content-free-structured-logging.md"
    title: "Content-free JSONL diagnostic contract"
  - id: quality
    resource: "https://github.com/ohtia/ohtia/blob/main/docs/adr/adr-0016-shared-quality-and-coverage-gates.md"
    title: "Shared gates and coverage contract"
  - id: tests
    resource: "https://github.com/ohtia/ohtia/blob/main/docs/adr/adr-0018-vitest-and-playwright-desktop-tests.md"
    title: "Runtime test inventories"
  - id: linux-e2e
    resource: "https://github.com/ohtia/ohtia/blob/main/docs/adr/adr-0019-immutable-linux-e2e-environment.md"
    title: "Immutable Linux E2E contract"
  - id: ci
    resource: "https://github.com/ohtia/ohtia/blob/main/docs/adr/adr-0020-github-policy-and-trusted-ci.md"
    title: "Trusted CI and independent authority"
  - id: security-baseline
    resource: "https://github.com/ohtia/ohtia/blob/main/docs/adr/adr-0000-security-verification-frameworks.md"
    title: "Security applicability and actual control evidence"
  - id: artifacts
    resource: "https://github.com/ohtia/ohtia/blob/main/docs/adr/adr-0021-versioned-desktop-artifacts.md"
    title: "Final artifact identity and exact-byte promotion"
  - id: execution-limits
    resource: "https://github.com/ohtia/ohtia/blob/main/docs/adr/adr-0011-bounded-durable-local-tasks.md"
    title: "Execution-limit defaults and admission"
  - id: localization
    resource: "https://github.com/ohtia/ohtia/blob/main/docs/adr/adr-0024-typed-localization-catalogs.md"
    title: "Typed catalogs and common locale resolution"
  - id: accessibility
    resource: "https://github.com/ohtia/ohtia/blob/main/docs/adr/adr-0023-desktop-accessibility-verification.md"
    title: "Applicable foundation-surface accessibility"
  - id: fonts
    resource: "https://github.com/ohtia/ohtia/blob/main/docs/adr/adr-0025-bundled-plex-and-noto-fonts.md"
    title: "Bundled font resources and glyph coverage"
  - id: adr-0001
    resource: "https://github.com/ohtia/ohtia/blob/main/docs/adr/adr-0001-monorepo-and-component-boundaries.md"
    title: "Component and dependency boundaries"
  - id: adr-0002
    resource: "https://github.com/ohtia/ohtia/blob/main/docs/adr/adr-0002-typescript-product-and-local-ipc.md"
    title: "TypeScript and local application port"
  - id: adr-0003
    resource: "https://github.com/ohtia/ohtia/blob/main/docs/adr/adr-0003-electron-desktop-boundaries.md"
    title: "Electron privilege and process boundaries"
  - id: adr-0004
    resource: "https://github.com/ohtia/ohtia/blob/main/docs/adr/adr-0004-javascript-development-toolchain.md"
    title: "JavaScript toolchain ownership"
  - id: adr-0005
    resource: "https://github.com/ohtia/ohtia/blob/main/docs/adr/adr-0005-python-repository-tooling.md"
    title: "Isolated repository Python tools"
  - id: adr-0014
    resource: "https://github.com/ohtia/ohtia/blob/main/docs/adr/adr-0014-restricted-rendering-and-csp.md"
    title: "Packaged rendering and CSP"
  - id: real-boundaries
    resource: "https://github.com/ohtia/ohtia/blob/main/docs/adr/adr-0017-real-boundary-integration-tests.md"
    title: "Integration evidence at actual boundaries"
  - id: adr-0022
    resource: "https://github.com/ohtia/ohtia/blob/main/docs/adr/adr-0022-react-vite-renderer.md"
    title: "Local React and Vite renderer"
  - id: phased-delivery
    resource: "Maintainer-approved EPIC-001 Linux-first delivery and two macOS/Windows signing follow-ups, 2026-10-30"
    title: "Linux-first foundation delivery and independent platform-signing qualification"
  - id: artifact-cell-contract
    resource: "Maintainer-approved EPIC-001 clarification of package identity, X11/Wayland qualification and exact-byte promotion, 2026-10-31"
    title: "One sealed package with artifact-bound evidence for every assigned native cell"
  - id: kde-desktop
    resource: "Maintainer-approved EPIC-001 KDE Plasma desktop qualification and native cell identifiers, 2026-11-02 and 2026-11-05"
    title: "KDE Plasma as a required Linux desktop with one identifier per native cell"
  - id: release-redesign
    resource: "Maintainer decisions on release, Linux repositories and update notice for EPIC-001, conversation of 2026-11-12"
    title: "Release redesign decisions"
epic_number: "001"
stories:
  - id: STORY-001-001
    title: "Qualify the desktop target and delivery contracts"
    concept: ./STORY-001-001-qualify-the-desktop-target-and-delivery-contracts.md
    resource: https://github.com/ohtia/ohtia/issues/15
  - id: STORY-001-002
    title: "Establish the locked workspace and developer toolchain"
    concept: ./STORY-001-002-establish-the-locked-workspace-and-developer-toolchain.md
    resource: https://github.com/ohtia/ohtia/issues/16
  - id: STORY-001-003
    title: "Define and verify the bounded application port"
    concept: ./STORY-001-003-define-and-verify-the-bounded-application-port.md
    resource: https://github.com/ohtia/ohtia/issues/17
  - id: STORY-001-004
    title: "Run the isolated desktop and supervised data service"
    concept: ./STORY-001-004-run-the-isolated-desktop-and-supervised-data-service.md
    resource: https://github.com/ohtia/ohtia/issues/18
  - id: STORY-001-005
    title: "Persist a minimal command with verified migration recovery"
    concept: ./STORY-001-005-persist-a-minimal-command-with-verified-migration-recovery.md
    resource: https://github.com/ohtia/ohtia/issues/19
  - id: STORY-001-006
    title: "Implement bounded diagnostics without private content"
    concept: ./STORY-001-006-implement-bounded-diagnostics-without-private-content.md
    resource: https://github.com/ohtia/ohtia/issues/20
  - id: STORY-001-007
    title: "Enforce shared verification and coverage gates"
    concept: ./STORY-001-007-enforce-shared-verification-and-coverage-gates.md
    resource: https://github.com/ohtia/ohtia/issues/21
  - id: STORY-001-008
    title: "Provide the reproducible sandboxed Linux E2E environment"
    concept: ./STORY-001-008-provide-the-reproducible-sandboxed-linux-e2e-environment.md
    resource: https://github.com/ohtia/ohtia/issues/22
  - id: STORY-001-009
    title: "Make Linux contribution setup reproducible"
    concept: ./STORY-001-009-make-linux-contribution-setup-reproducible.md
    resource: https://github.com/ohtia/ohtia/issues/23
  - id: STORY-001-010
    title: "Make Windows contribution setup reproducible"
    concept: ./STORY-001-010-make-windows-contribution-setup-reproducible.md
    resource: https://github.com/ohtia/ohtia/issues/24
  - id: STORY-001-011
    title: "Make macOS contribution setup reproducible"
    concept: ./STORY-001-011-make-macos-contribution-setup-reproducible.md
    resource: https://github.com/ohtia/ohtia/issues/25
  - id: STORY-001-012
    title: "Build and smoke-test native quality artifacts"
    concept: ./STORY-001-012-build-and-smoke-test-native-quality-artifacts.md
    resource: https://github.com/ohtia/ohtia/issues/26
  - id: STORY-001-013
    title: "Qualify signed installation and update mechanisms"
    concept: ./STORY-001-013-qualify-signed-installation-and-update-mechanisms.md
    resource: https://github.com/ohtia/ohtia/issues/27
  - id: STORY-001-014
    title: "Capture and assemble reviewed user change notes"
    concept: ./STORY-001-014-capture-and-assemble-reviewed-user-change-notes.md
    resource: https://github.com/ohtia/ohtia/issues/28
  - id: STORY-001-015
    title: "Prepare immutable candidates through trusted authority"
    concept: ./STORY-001-015-prepare-immutable-candidates-through-trusted-authority.md
    resource: https://github.com/ohtia/ohtia/issues/29
  - id: STORY-001-016
    title: "Promote and reconcile exact release artifacts"
    concept: ./STORY-001-016-promote-and-reconcile-exact-release-artifacts.md
    resource: https://github.com/ohtia/ohtia/issues/30
  - id: STORY-001-017
    title: "Verify the integrated foundation and contributor journeys"
    concept: ./STORY-001-017-verify-the-integrated-foundation-and-contributor-journeys.md
    resource: https://github.com/ohtia/ohtia/issues/31
  - id: STORY-001-018
    title: "Qualify the native foundation targets"
    concept: ./STORY-001-018-qualify-the-native-foundation-targets.md
    resource: https://github.com/ohtia/ohtia/issues/32
  - id: STORY-001-019
    title: "Qualify signed macOS distribution"
    concept: ./STORY-001-019-qualify-signed-macos-distribution.md
    resource: https://github.com/ohtia/ohtia/issues/81
  - id: STORY-001-020
    title: "Qualify signed Windows distribution"
    concept: ./STORY-001-020-qualify-signed-windows-distribution.md
    resource: https://github.com/ohtia/ohtia/issues/82
  - id: STORY-001-021
    title: "Qualify KDE Plasma as a required Linux desktop"
    concept: ./STORY-001-021-qualify-kde-plasma-as-a-required-linux-desktop.md
    resource: https://github.com/ohtia/ohtia/issues/145
  - id: STORY-001-022
    title: "Remove the Scaleway signing service"
    concept: ./STORY-001-022-remove-the-scaleway-signing-service.md
    resource: https://github.com/ohtia/ohtia/issues/256
  - id: STORY-001-023
    title: "Take the application version from the root manifest"
    concept: ./STORY-001-023-take-the-application-version-from-the-root-manifest.md
    resource: https://github.com/ohtia/ohtia/issues/257
  - id: STORY-001-024
    title: "Prepare a release without publishing it"
    concept: ./STORY-001-024-prepare-a-release-without-publishing-it.md
    resource: https://github.com/ohtia/ohtia/issues/258
  - id: STORY-001-025
    title: "Sign RPM packages in the protected environment"
    concept: ./STORY-001-025-sign-rpm-packages-in-the-protected-environment.md
    resource: https://github.com/ohtia/ohtia/issues/259
  - id: STORY-001-026
    title: "Write the first release notes into the unpublished release"
    concept: ./STORY-001-026-write-the-first-release-notes-into-the-unpublished-release.md
    resource: https://github.com/ohtia/ohtia/issues/260
  - id: STORY-001-027
    title: "Register the Ohtia repository from installed packages"
    concept: ./STORY-001-027-register-the-ohtia-repository-from-installed-packages.md
    resource: https://github.com/ohtia/ohtia/issues/261
  - id: STORY-001-028
    title: "Publish a prepared release"
    concept: ./STORY-001-028-publish-a-prepared-release.md
    resource: https://github.com/ohtia/ohtia/issues/262
  - id: STORY-001-029
    title: "Publish signed Ubuntu and Debian repositories"
    concept: ./STORY-001-029-publish-signed-ubuntu-and-debian-repositories.md
    resource: https://github.com/ohtia/ohtia/issues/263
  - id: STORY-001-030
    title: "Publish the signed Fedora repository"
    concept: ./STORY-001-030-publish-the-signed-fedora-repository.md
    resource: https://github.com/ohtia/ohtia/issues/264
  - id: STORY-001-031
    title: "Check for a newer version on startup"
    concept: ./STORY-001-031-check-for-a-newer-version-on-startup.md
    resource: https://github.com/ohtia/ohtia/issues/265
  - id: STORY-001-032
    title: "Show the update notice"
    concept: ./STORY-001-032-show-the-update-notice.md
    resource: https://github.com/ohtia/ohtia/issues/266
  - id: STORY-001-033
    title: "Qualify repository delivery on one Linux cell"
    concept: ./STORY-001-033-qualify-repository-delivery-on-one-linux-cell.md
    resource: https://github.com/ohtia/ohtia/issues/267
  - id: STORY-001-034
    title: "Qualify refusal of altered and wrongly signed packages"
    concept: ./STORY-001-034-qualify-refusal-of-altered-and-wrongly-signed-packages.md
    resource: https://github.com/ohtia/ohtia/issues/268
  - id: STORY-001-035
    title: "Extend repository qualification to the x86-64 cells"
    concept: ./STORY-001-035-extend-repository-qualification-to-the-x86-64-cells.md
    resource: https://github.com/ohtia/ohtia/issues/269
  - id: STORY-001-036
    title: "Extend repository qualification to the ARM64 cells"
    concept: ./STORY-001-036-extend-repository-qualification-to-the-arm64-cells.md
    resource: https://github.com/ohtia/ohtia/issues/270
  - id: STORY-001-037
    title: "Deliver the release security inventory"
    concept: ./STORY-001-037-deliver-the-release-security-inventory.md
    resource: https://github.com/ohtia/ohtia/issues/271
  - id: STORY-001-038
    title: "Withdraw a published release"
    concept: ./STORY-001-038-withdraw-a-published-release.md
    resource: https://github.com/ohtia/ohtia/issues/272
---

# EPIC-001 — Desktop foundation

## Description

A new contributor on Linux, Windows or macOS can build, run, diagnose, test and package the actual local application through a documented reproducible path. The foundation includes safe process and storage boundaries and the complete quality-build, release-preparation and release-publication infrastructure, with signed Linux package repositories and an update notice in the application, required by the integrated release policy and issue #7; it does not advertise a complete research product or authorize a public release.[^roadmap][^release-policy][^issue-7]

## Functional and technical specification

### SPEC-001-001: Purpose and public planning context

Ohtia needs a safe, reproducible desktop foundation before contributors can build research workflows on it. This EPIC delivers a minimal graphical application with a supervised local data service, a durable operation, verified process/storage boundaries, native contributor environments and the complete quality-build and release infrastructure. A new contributor must be able to prepare a clean machine, launch the application, make a representative change, run its checks and produce a package without undocumented debugging or maintainer secrets.[^roadmap]

The public [Product roadmap](../../product-roadmap.md#epic-001--desktop-application-foundation) defines the planning context and this foundation's boundaries. Its [desktop target baseline](../../product-roadmap.md#desktop-systems-and-processor-architectures) requires Linux on x86-64 and ARM64, Windows on x86-64 and macOS on Apple Silicon from the first runnable delivery. Windows ARM64 and Apple Intel are optional extensions; they require their own complete native evidence before inclusion, and their absence does not block the required foundation.[^roadmap][^roadmap-issue][^roadmap-pr]

The runnable result includes Electron main/preload/utility and React/Vite targets, a single trusted broker, versioned validated IPC, fixed account-native data-location bootstrap and atomic publication, minimal typed preference persistence and execution-limit initialization, compatible SQLite loading, exclusive transactional migrations and verified checkpoint recovery before the first schema transition. Required checks exercise the actual renderer → preload → main → data-service path, restrictive packaged CSP, invalid/spoofed/oversized messages, service failures and exclusion of development fixtures and privileged renderer imports.[^architecture][^roadmap]

The foundation is delivered through common infrastructure and Linux qualification in STORY-001-022 to STORY-001-037, which replace stories 013/015/016, and in story 017, with real macOS and Windows distribution qualification owned independently by 019 and 020. All required platforms retain native builds, runtime/contributor acceptance and verified retained-artifact provenance; platform credentials gate only the affected signed distribution. These follow-ups do not block later interface development that consumes the delivered common outputs.[^phased-delivery]

The same foundation includes maintained contributor setup, common local/CI checks, immutable Linux E2E preparation supplemented by native ARM64 evidence, target-specific packaging, signing and notarization, signed Linux package repositories, an update notice in the application, release preparation, publication of the exact prepared bytes, release notes and retention/failure/withdrawal procedures. The release policy owns publication readiness and authorization. Later research features extend these mechanisms with their own native journeys and compatibility fixtures; this EPIC does not require a complete research workflow to validate its foundation, and its completion does not authorize a public release.[^release-policy][^roadmap]

The basic menus and workspace, agent conversations, project onboarding, source work, academic editor and manuscript delivery remain separate product increments described in the public roadmap. They are not prerequisite return dependencies for this EPIC. The roadmap's identifiers are planning references rather than claims that implementation issues already exist; this concept and its stories define the executable foundation scope here.[^roadmap]

### SPEC-001-002: Foundation outcome and scope authority

Deliver one locally runnable and natively packageable desktop foundation, its safe minimal durable operation, and the entire build/release infrastructure. A contributor can clone a clean checkout, establish an isolated environment, launch the graphical application, verify the real local round trip, run the same required checks as CI and produce a local unsigned quality package without signing credentials, a provider account or private research. Deliver operational documentation with working commands, not speculative command names.[^roadmap][^architecture]

PRIN-002, PRIN-004–007, PRIN-010–013 and PRIN-016 govern the boundary: do not introduce agent authorship, fabricated review, hidden telemetry, unexplained failures or false platform guarantees. Product code is built from scratch. Current canonical repository documents and their adopting ADRs govern; the public roadmap and integrated canonical specifications provide scope, not authorization to copy an earlier implementation. Documentation requirements are not evidence of working software.[^product][^contribution]

Proposed decomposition and dependency projections require the owner's coverage review. Implementation-level routine choices remain with story owners within their routed contracts; new public interfaces, authority boundaries and material architecture changes require reviewed decisions before producers and consumers implement them. Qualifying OS-version, distribution, package and mechanism details within the declared required/optional target inventory is the explicit contract deliverable of STORY-001-001, empirically qualified by STORY-001-018, not a claim that they are already approved. Missing credentials, native facilities or external controls keep the corresponding capability acceptance gate open. STORY-001-022 to STORY-001-037, which replace stories 013/015/016, and story 017 deliver Linux signing and the shared pipeline without requiring Developer ID or Authenticode facilities; stories 019/020 own those real platform guarantees. Their absence never admits unsigned public installers or closes full-platform distribution readiness. SPEC-001-028 defines the capability-scoped handoff and preserves required platform membership.[^decisions][^phased-delivery]

Neither completing this EPIC nor merging a story authorizes public publication. A coherent usable research journey is required before the first stable release; this EPIC has one public channel, `stable`, and a preview channel is deferred.[^release-redesign] Infrastructure qualification uses isolated synthetic/public fixtures and controlled publication surfaces, with actual signed native probes where required. Product epics extend this infrastructure with real feature journeys and compatibility fixtures. Public publication remains disabled until its actual readiness evidence and separately identified maintainer authorization exist.[^release-policy]

Publication projection: keep the operational tasks, acceptance criteria, quality checks and complete consumer input contracts in the issue body. If the full projection exceeds the conservative local size budget, place whole applicable SPEC blocks in numbered continuation comments and link each comment from an ordered index in the body. This projection preserves the complete scope and standalone implementation handoff. Retain every routed block verbatim across the issue and its comments; never truncate or use a repository link as a substitute. Publication must read back every body, comment and permalink and repair an incomplete projection before treating the issue as published. Do not split a cohesive story solely to fit one body.

### SPEC-001-003: Qualify target, tooling and delivery contracts

STORY-001-001 owns D1a: reviewed tool selections, the fixed target contract and one numeric policy record. Start with the adopting ADRs, release policy and actual repository configuration. Fix the required targets: Linux x86-64 and ARM64, Windows x86-64, and Apple Silicon on macOS 26 and 27. Windows ARM64 and Apple Intel are optional; an included optional target requires its own complete native evidence and cannot be qualified by emulation or another CPU slice. Maintain all six declared OS/CPU candidates; 32-bit x86 and ARM are excluded. Review OS versions, Linux libc and display constraints, local filesystems, hardware assumptions, native dependencies, package formats, upgrade baselines and testing facilities. Record architecture aliases x64/amd64 and arm64/aarch64. Distinguish contributor environments, quality artifacts and public distribution without removing a required cell. A universal macOS package needs separate native evidence for both slices.[^roadmap][^decisions][^release-policy]

Select exact candidate patches within the version lines owned by the adopting ADRs for TypeScript, Electron, developer Node, pnpm, React and React DOM, Vite, typed ESLint, Prettier, Vitest, Playwright, SQLite, better-sqlite3, Kysely, Python, uv, Ruff and Pyrefly. Inspect current primary upstream metadata and published native artifacts during implementation; document compatibility assumptions and rejected alternatives. Version lines stay in their ADRs; exact resolutions and digests belong in locks and manifests. An incompatible or unavailable selection requires reviewed correction of its adopting decision. Host tools or peer metadata alone cannot establish native compatibility.[^decisions]

Evaluate a small set of installer, signing, notarization and updater mechanisms against the complete matrix, exact-byte promotion, interruption, schema admission, authenticity, version ordering and license obligations. Record reviewed provisional choices and the empirical checks that can reject them. D1a also defines bounded CI artifact retention and supported-release retirement rules. No successful native installation, signature or update is claimed from this decision record: native feasibility is D1b in STORY-001-018; final signed installation and repository update qualification is owned by STORY-001-022 to STORY-001-037 for Linux, which replace STORY-001-013, and final signed installation qualification by STORY-001-019 for macOS and STORY-001-020 for Windows; the application itself installs no update on any platform.[^release-redesign]

Publish one reviewed numeric record of finite positive byte, count, time, pending-request and initial-operation bounds, including startup, shutdown and process-tree budgets. State units, encoded-byte measurement, permitted ranges, failure outcomes, owners and rationale. STORY-001-003 implements those values in wire schemas and decoders; it cannot select a competing limit set. Changes require reviewed updates to the record and affected conformance fixtures. Set the initial contributor setup acceptance budget using explicit hardware, cache and network assumptions and available setup measurements; STORY-001-018 validates it empirically before formal newcomer trials. Measure cold downloads separately from active work. One machine cannot justify a universal duration promise.

D1a is usable when these reviewed selections and numeric contracts are available on the consumer base and host-independent metadata checks pass. Its acceptance does not require the complete native host matrix or an executable probe. Workspace 002 and portable IPC 003 can therefore integrate before native qualification. Missing empirical compatibility evidence stays assigned to D1b, never reported as successful. A failed native probe requires correction of the affected contract and consumers before the corresponding native delivery; it cannot silently narrow the matrix or change a version line.

| Operating system | x86-64          | ARM64                   |
| ---------------- | --------------- | ----------------------- |
| Linux            | Required        | Required                |
| Windows          | Required        | Optional                |
| macOS            | Optional, Intel | Required, Apple Silicon |

Every coordinated native qualification or distribution delivery enumerates the complete product inventory and its explicitly qualified distribution scope under SPEC-001-028. A missing required result within the admitted scope fails that delivery; a deferred platform remains required in the product inventory and ineligible for distribution until its owning follow-up passes. All-platform distribution still requires every mandatory cell and any optional cell actually included. Recurring quality CI uses the separately selected matrix in [ADR-0020](../../adr/adr-0020-github-policy-and-trusted-ci.md#recurring-hosted-quality-matrix), with explicit coverage and technical-debt boundaries rather than claiming untested distribution profiles. Cross-compilation, emulation or x86-64 execution on ARM does not qualify a native cell.[^roadmap]

### SPEC-001-004: Workspace and isolated tooling

[ADR-0005](../../adr/adr-0005-python-repository-tooling.md) governs isolated repository python tools in this delivery.[^adr-0005]

[ADR-0004](../../adr/adr-0004-javascript-development-toolchain.md) governs javascript toolchain ownership in this delivery.[^adr-0004]

[ADR-0001](../../adr/adr-0001-monorepo-and-component-boundaries.md) governs component and dependency boundaries in this delivery.[^adr-0001]

Create only real packages for shared contracts, domain/application behavior, renderer, preload, main and utility/data service. The concrete directory tree is a proposed implementation output, not an existing repository convention. Declare acyclic public interfaces and build outputs; forbid cross-package internal-path imports and domain dependencies on UI, packaging or provider SDKs. Use separate compiler/runtime/import policies for each privilege boundary.[^decisions]

Introduce a pnpm workspace, one committed JavaScript lockfile, package-local tools and exact manifest pins from the adopting ADRs. Add strict type checking separately from Vite transpilation, semantic typed lint, shared Prettier and appropriately scoped build/test commands. Manage actual Python repository dependencies with uv and a frozen lock, isolated per checkout, with Ruff/Pyrefly checks; preserve existing standalone standard-library scripts and their supported minimum. There is no Python product package, HTTP application server or end-user development-runtime requirement.[^decisions]

Proposed common command contract: expose clearly named bootstrap/setup, environment diagnosis, development launch, type/lint/format/test/build and local packaging entries through repository-owned tooling. Select exact names once and document them with their introduction; do not require an undeclared global executable or add a second formatter/checker authority. Keep local hook/manifest/image pins aligned and preserve LF/Windows batch CRLF conventions. Failed frozen resolution or effective-version mismatch stops with an actionable controlled diagnostic; never repair it through an unconstrained global upgrade or lockfile rewrite.

Verification: a clean dependency cache and frozen install resolve the committed graph without changing locks; each real package builds and forbids disallowed imports/cycles. An isolated second worktree has its own environments and no copied credentials. Check tooling changes against the existing repository policy tests and hook behavior rather than replacing them.

The workspace owner configures frozen resolution, architecture-specific optional native dependencies and deterministic failure reporting for all six declared target candidates, retaining optional Windows ARM64 and Apple Intel metadata without making their execution mandatory. It proves clean installation and package builds on the initial qualified development host and supplies the exact commands and lock inputs to 018. Actual required-profile frozen-install and native-addon acceptance is owned by 018, then rechecked by each native setup owner; it is not a returning prerequisite for closing the workspace itself. No target may silently disappear from the declared inventory.

STORY-001-002 phase prerequisites: integrate requires D1a from STORY-001-001. The Dependencies output registry defines each release condition and the common gate semantics; routing this block as context does not assign its owner's gates to another consumer.

### SPEC-001-005: Versioned bounded IPC and minimal operation contract

[ADR-0002](../../adr/adr-0002-typescript-product-and-local-ipc.md) governs typescript and local application port in this delivery.[^adr-0002]

Introduce one shared runtime-validated application port with versioned request/result/event envelopes, trusted correlation, operation identity, expected revision where applicable, bounded payloads and controlled errors. Proposed initial named operations are foundation status and one minimal persisted diagnostic preference replacement/read. STORY-001-003 owns the exact reviewed wire shapes, runtime decoders, cancellation and unknown-outcome semantics. It implements and tests the byte/count/time/pending/request values from STORY-001-001's approved D1a qualification record before consumers integrate; it cannot silently choose different numeric limits. Status exposes controlled artifact/service/engine readiness, not filesystem paths or credentials. The preference uses the existing declared appearance value contract, not an invented research entity or arbitrary key/value store.[^architecture]

Validate structure and size in both directions; main validates the actual sender frame/origin, named operation and permitted context. The service independently checks domain preconditions, versions and idempotency. A replay with the same operation ID/payload returns its recorded result; a different payload cannot reuse it. A lost acknowledgement cannot justify blindly repeating a mutation. Responses from a disposed window/service generation are rejected and subscriptions are disposed. An unsupported protocol version, stale expected revision, oversized/invalid message, unavailable service, timeout, cancellation or uncertain commit has its own controlled result and useful next action.

Expose named functions via preload; never expose raw ipcRenderer, SQL, arbitrary channels, filesystem paths, subprocess/HTTP proxies or credential objects. Renderer and domain types do not depend on Kysely, Electron internals or binding handles. Tests at this stage may use deterministic contract peers; they do not establish real process or durability evidence, which belong to their consuming stories. Numeric bounds and runtime decoders are executable contract outputs, not comments.[^decisions]

Verification: contract corpus includes accepted messages, wrong versions, spoofed identity, prototype/unknown fields, invalid/oversized UTF-8, duplicate IDs, stale revisions and invalid worker results. Producer/consumer conformance and error handling share this corpus. Check bounded queues, timeouts and subscription cleanup without claiming cancellation rolled back a committed effect.

The status/application port carries only the resolved supported interface-locale identifier and controlled message codes/typed parameters needed by the first surfaces. The trusted broker remains the locale authority; no renderer-supplied catalog path, OS-preference list, arbitrary display HTML or exception string becomes a configuration interface. The minimum locale/catalog/accessibility contract is SPEC-001-024 and is consumed before UI producers integrate.

STORY-001-003 phase prerequisites: integrate requires D1a from STORY-001-001; integrate requires W2 from STORY-001-002. The Dependencies output registry defines each release condition and the common gate semantics; routing this block as context does not assign its owner's gates to another consumer.

### SPEC-001-006: Graphical runtime, fixed bootstrap and process supervision

[ADR-0022](../../adr/adr-0022-react-vite-renderer.md) governs local react and vite renderer in this delivery.[^adr-0022]

[ADR-0014](../../adr/adr-0014-restricted-rendering-and-csp.md) governs packaged rendering and csp in this delivery.[^adr-0014]

[ADR-0003](../../adr/adr-0003-electron-desktop-boundaries.md) governs electron privilege and process boundaries in this delivery.[^adr-0003]

Assemble separate Electron main/preload/utility and React/Vite targets. Ship local production renderer assets through a constrained local protocol, context isolation, active renderer sandbox, no Node integration and restrictive packaged CSP. Reject privileged renderer imports, arbitrary external navigation/window creation, unsafe resource URLs, eval/inline bypasses and accidental development servers/catalogs/fixtures. This is a minimal foundation window and controlled diagnostic surface; full menus, Settings shell, design-system primitives and research navigation remain outside this foundation.[^architecture][^frontend]

The main broker is single-instance per OS user; another launch attaches to the existing broker or reports a controlled conflict. Additional windows cannot create independent database writers. Supervise one utility-process data service, enforce a bounded startup handshake and failures, reject obsolete service generations, and keep database work off renderer/main event loops. The runtime story closes with real status IPC against its supervised service, without storage; persistence is the independent next delivery. Service death keeps the window responsive and presents retry/exit guidance without an unbounded restart loop or duplicated commands. Shutdown proves local child cessation within the declared budget.

Implement the necessary first-use data-location bootstrap before enabling storage. Main resolves the fixed Electron userData configuration location and owns settings/data-location.json with exactly version 1 and an absolute data_directory string, at most 64 KiB. Validate supported versions, native aliases and overlap in either direction with the fixed settings directory. The fixed research root is governed by the [application bootstrap contract](../../architecture.md#application-preferences-and-bootstrap). Startup asks no location question and offers no location-changing control. A missing locator prepares the default root without opening or creating research data. Preserve existing records and data; mismatching locations are controlled errors. Successful default-store creation/open, compatibility admission and durable activation are completed with STORY-001-005.[^architecture][^bootstrap]

The broker publishes a complete locator through a same-directory temporary file, verified platform synchronization and atomic replacement only after the default store is validated. Preserve the previous confirmed record and all existing data on failed or uncertain publication, and evidence on malformed/newer/unreadable records. Do not redirect userData when the research location changes. Before a validated data location exists, errors are graphical and controlled; no fallback logs in the working directory or unknown root. Ordinary preferences load only after storage compatibility checks. Full researcher-facing location-change/management and Settings flows remain a later product capability; no unreviewed alternate bootstrap format is introduced.

Verification: run the built local assets with actual CSP and IPC, terminate the service, launch two instances/windows, interrupt locator publication, deny file access and use paths with spaces/non-ASCII/aliases. On every claimed OS observe sandbox, broker count, responsive errors, bounded shutdown and cleanup. Successful startup must not require provider credentials, private material or an external research service.

Run this runtime/bootstrap path natively on Linux x86-64 and ARM64, Windows x86-64, and Apple Silicon on macOS 26 and 27. Windows ARM64 and Apple Intel are optional; an included optional target requires its own complete native evidence and cannot be qualified by emulation or another CPU slice. Record host CPU, executable architecture, utility/addon architecture and final artifact identity. Cross-compilation, Rosetta or another emulated execution does not release a native-target gate. Locator atomic-publication and process-failure evidence must cover each required target's qualified filesystem/OS behavior.[^roadmap]

Before the first qualification or test launch, implement and enforce SPEC-001-023's independent native-profile/VM isolation and its stable-store exclusion checks. STORY-001-004 owns that launcher/admission contract along with the minimum shared locale service and accessible initial window/bootstrap messages in SPEC-001-024. It closes against a real supervised status path and pending fixed-root initialization without requiring the future storage service to create a store. Storage admission, saved-locale readback and recovery-specific text are completed by STORY-001-005 using the same contracts; they are not returning prerequisites for runtime 004.

STORY-001-004 phase prerequisites: integrate requires D1a from STORY-001-001; integrate requires W2 from STORY-001-002; integrate requires P3 from STORY-001-003; complete requires D1b from STORY-001-018; complete requires NH from Native hosts. The Dependencies output registry defines each release condition and the common gate semantics; routing this block as context does not assign its owner's gates to another consumer.

### SPEC-001-007: Durable store and pre-migration recovery

The supervised data service alone opens ohtia.db3 in the fixed account-native `ohtia` managed data root. Use Kysely's built-in dialect with the selected better-sqlite3 upstream bundled SQLite, through the exact trusted unpacked nativeBinding artifact for each Electron OS and CPU/libc target. Record sqlite_version(), sqlite_source_id() and compile options from that actual connection; reject mismatches before normal admission, without falling back to a system CLI/library or a different driver. Enable and verify foreign keys on every operational connection.[^storage]

Implement a minimal declared appearance preference read/change through the complete renderer → preload → main → service path, with schema/revision validation, expected revision and transactional idempotency receipts. No general Settings UI is needed to demonstrate the port. Use the architecture's existing appearance contract and preserve unrelated records. Fresh initialization follows required default execution-limit records before any future task admission; task dispatch itself is excluded here. No researcher project/manuscript schema is added merely as a scaffold demo. Verify restart persistence, replay, conflicting replay, stale change, failed writes and lost response without claiming success or repeating a committed effect.[^architecture][^bootstrap]

Implement ADR-0007's packaged ordered migration provider, explicit target/user_version, immutable executable-module SHA-256 manifest, Kysely history and ohtia_migration_artifacts consistency. Preserve historical module bytes across compiler/bundler changes. Reject newer/unsupported schemas, changed/missing/reordered history or artifact identities and unexpected source shapes before checkpoint/SQL. Revision zero has no history; an already-current valid schema gets no new checkpoint. Do not scan a research-selected migration directory, invoke downgrade methods or silently push generated schema.

Before the very first schema transition, close normal admission and quiesce all connections/writers through the single broker. Create the full database snapshot with backup() and a manifest in an operation's partial recovery directory; verify digest/length, integrity, foreign keys, source revision and metadata, flush and atomically publish it. Retained object references acquire pins when applicable; this EPIC does not implement object import. Use a dedicated reserved connection and Ohtia-owned BEGIN EXCLUSIVE around Migrator with disableTransactions: true; handle table rebuild foreign-key switching before the transaction, inspect returned errors and expected results, validate target/domain integrity, set target revision and commit once. A library success is not a confirmed commit. Restore/verify foreign-key enforcement before normal access.[^migrations][^recovery]

On pre-commit failure roll back data/schema/history/artifact metadata together and verify the source. After commit or uncertain interruption inspect the actual database and keep normal access closed until the source or target and supported retry/recovery path are established. Restore the verified complete snapshot via a separately validated temporary database with all operational connections closed; retain failed database/journals together and prevent their reattachment to the restored database. Never restore only metadata tables or claim an executable rollback downgrades data. Present minimal graphical failure/retry/recovery, preserve input and checkpoint evidence, and never resume external work automatically. The complete researcher storage-management interface is a later product capability; required safety works here.

Checkpoint retention, failure-copy cleanup and object pins follow ADR-0010. Destructive erasure and general backup/device-loss recovery are excluded and unavailable; later erasure must qualify purge, sanitization and interruption rules before enablement. That exclusion cannot allow this foundation to claim erased private content or discard needed recovery state. Tests use actual packaged binding and file-backed synthetic databases: empty/current/populated upgrade, repeat opening, corrupt snapshot, changed modules, incompatible newer schema, denied/full storage, concurrent startup/writes, foreign-key violation, interruption before/after/uncertain commit and restoration with matching history and artifact identities.

Apply ADR-0008 to any internal entity identity introduced by the foundation: generate UUIDv7 in the trusted data service, validate canonical lowercase textual spelling at text boundaries and enforce non-null unique 16-byte RFC-network-order BLOBs with version/variant and matching-reference constraints in SQLite. Keep declared preference keys and operation idempotency identifiers under their separate contracts; do not invent a project/entity just to exercise UUID storage. Include identifier conformance and physical constraint tests with synthetic fixtures, preserving identities through checkpoint/recovery.[^entity-identifiers]

Verify native binding/engine loading and actual file-backed migration/persistence/recovery on all required native targets in the target manifest. Record the loaded addon bytes, runtime ABI, engine identity and native execution architecture; a passing x86-64 binding or cross-built ARM64 addon is not ARM64 execution evidence.[^roadmap]

STORY-001-005 admits only the runtime context established by SPEC-001-023 and [ADR-0043](../../adr/adr-0043-ordinary-startup-modes.md); a valid stable locator is not an acceptable development fixture. Use the initial shared locale service/catalog contract from SPEC-001-024 for open, create, compatibility and recovery outcomes rather than hardcoded text or a second resolver.

Initialize a missing execution_limits preference during fresh store creation or an explicitly applicable migration in the same transaction as initialization, before exposing initialized readiness. ADR-0011 owns max_concurrent_inference and max_concurrent_local_processing: both default to 1 and valid saved values are positive integers. Preserve every existing valid saved limit instead of resetting it. A corrupt, unreadable or unsupported-version record is a controlled integrity/policy failure; an unexpectedly missing record in an already initialized current schema is not permission to silently insert defaults. Keep task-admission readiness false until a valid record is established; this does not implement task dispatch or the later Settings limit editor. Rollback preserves the previous confirmed preference/state, and recovery rereads the recovered record before readiness.[^execution-limits][^architecture]

Verify fresh initialization, populated migration with a missing record when that migration permits creation, preservation of nondefault valid limits, invalid/unsupported records, unexpected absence in a current schema, write failure and interruption before/after commit. Assert atomic data/schema/preference outcomes and no reported readiness with invalid policy. Store the locale record only under the shared typed preference boundary; before a validated store exists, system-language fallback does not claim saved values were loaded.

STORY-001-005 phase prerequisites: integrate requires W2 from STORY-001-002; integrate requires P3 from STORY-001-003; integrate requires D1b from STORY-001-018; complete requires R4 from STORY-001-004; complete requires NH from Native hosts. The Dependencies output registry defines each release condition and the common gate semantics; routing this block as context does not assign its owner's gates to another consumer.

### SPEC-001-008: Content-free diagnostics at the broker boundary

Implement ADR-0013's complete ohtia-log-v1 typed/runtime-validated catalog and JSONL writer. Emit one UTF-8 compact object plus LF per record, no BOM/duplicate keys/blank records, controlled event names, resource identity, validated severity pairs, optional actual event time, required observed time and the closed allowed attributes. Preserve the OpenTelemetry mapping without inventing trace IDs or unreported time. Map exceptions into controlled codes; no free-form exception, nested metadata bag or JSON fallback may bypass the catalog.[^diagnostics]

One main-owned writer under the validated data root serializes child events, append, rotation and deletion. Validate child metadata as untrusted and attach broker-owned identity. Enforce 5 MiB per file and five files total (25 MiB); rotate before overflow without splitting a record or retaining a sixth file. Repair an incomplete final line before further appends, reject oversized records without echoing them, and reconcile managed filenames/bounds at startup. Set current-account access restrictions. Logging failure preserves save capability and does not trigger recursive/error-content fallback output.

Exclude research text/titles/filenames/queries, prompts/responses/tool args, credentials/tokens/headers/signed URLs and SQL values across files, traces, SDK/runtime capture and stdout/stderr. Keep diagnostics local by default. The complete Settings viewer/delete/share-preview is a later product capability; define the controlled read/delete/catalog interfaces needed later without shipping an alternate diagnostic export or hidden telemetry surface.

Verify sensitive markers in accepted and rejected fields, process stderr and thrown/SDK errors never appear in outputs. Cover invalid cross-field records, unsupported schema, actual artifact identity, multibyte/exact-boundary rotation, interrupted append/rotation, concurrent append/delete, denied storage and log cleanup without changing durable application records. Do not wait for the later Settings screen to close this writer story.

STORY-001-006 phase prerequisites: integrate requires P3 from STORY-001-003; integrate requires R4 from STORY-001-004; integrate requires S5 from STORY-001-005; complete requires NH from Native hosts. The Dependencies output registry defines each release condition and the common gate semantics; routing this block as context does not assign its owner's gates to another consumer.

### SPEC-001-009: Shared checks and complete result accounting

[ADR-0017](../../adr/adr-0017-real-boundary-integration-tests.md) governs integration evidence at actual boundaries in this delivery.[^real-boundaries]

Introduce versioned common local/CI entries for types, semantic lint, format, meaningful tests, build and document/repository checks. Use the selected Vitest and Playwright packages, verifying compatibility with actual Electron automation. Product packages independently require at least 80% executable lines, 80% branches and 90% changed executable lines, including own unimported code; no per-file minimum. Tests/fixtures/generated/third-party code are excluded explicitly, not used to hide own code. A change with no executable changed lines has an inapplicable diff metric. Pure repository tooling uses meaningful behavior checks instead of accidental product coverage.[^quality]

Declare exact test/runtime inventories and deterministic shard accounting; the union must match the required inventory. Missing/invalid reports, skipped/cancelled/failed mandatory cases, preparation errors or an incomplete shard fail the aggregate even if a process returned zero. Inject independent failures into line/branch/diff coverage and own unimported-code accounting. Mocks remain useful for deterministic errors, but actual IPC, file-backed SQLite, utility process and packaged CSP tests are required at their consuming delivery. Separate portable DOM browser-engine inventories from packaged OS/native input and assistive evidence.[^quality][^tests]

Preserve existing repository hooks, policy/unit checks, committed-history secret scanning and the stable ci result. Conservative full relevant checks are the baseline; if affected-scope optimization is introduced, include consumers and shared contracts/locks/assets/tooling, use complete relevant checks on uncertain impact and verify omissions. Documentation-only changes may omit desktop builds only when no delivered/build inputs can be affected. A selected partition is not optional merely because it is expensive.

Verification: run identical entries locally and in CI, seeded failing/missing-report/shard cases and actual inventory checks. Record reviewed workflow/policy, run/attempt/head/base/tested checkout tree provenance; green names alone cannot prove admission. The test harness can close with its synthetic gate corpus before real feature suites exist, while every later consumer supplies its own required tests and instrumentation.

Inventory the required desktop OS and CPU combinations and optional extensions from the target manifest explicitly. Required native smoke, storage and runtime evidence cannot be replaced by browser runs, cross-compilation or emulation. A harness may close against deterministic accounting fixtures before all consumers exist, but it must detect a missing, failed or misclassified architecture partition rather than accepting an incomplete required-target result. Each consumer supplies real native tests before its own acceptance.[^roadmap]

STORY-001-007 phase prerequisites: integrate requires W2 from STORY-001-002; integrate requires PA from Policy authority. The Dependencies output registry defines each release condition and the common gate semantics; routing this block as context does not assign its owner's gates to another consumer.

### SPEC-001-010: Immutable Linux E2E execution

Provide the ADR-0019 Linux x86-64 E2E image built from its pinned recipe, identified by the fingerprint of its declared recipe inputs as defined by ADR-0040, and paired to the selected Playwright package/browser versions. Prepare reviewed OS/Electron dependencies in the image rather than resolving arbitrary APT state in each shard. Add a parity check and a local reproduction entry. Developer/build Node and Electron's runtime remain separate identified environments.[^linux-e2e]

Run as a non-root user with real Chromium/WebKit sandboxes, a private display/session and bounded shared memory/resources. Do not use no-sandbox flags, a host desktop/DBus/credential mount or a mismatch fallback download. Qualify the actual CI container policy; a sandbox-start failure is a failing environment. Container infrastructure is trusted ephemeral build machinery, not proof of hostile parser/agent confinement or Windows/macOS behavior.

Verify immutable image/package/browser parity, frozen dependencies, packaged/release-equivalent Electron launch, negative CSP/IPC cases and exact required shard inventory. Record cold/warm setup and test timings without asserting a speedup without measurements. The native Linux contributor route remains independently usable; this image is an additional reproducible path, not an end-user dependency or the Windows/macOS contribution path.

ADR-0019's pinned Linux x86-64 image retains that exact scope. Supplement it with native Linux ARM64 build/packaged smoke/boundary runs in the quality inventory; selecting or building an additional ARM64 image is an implementation choice requiring its own pins and sandbox evidence, not a prerequisite silently inferred from the existing image. Do not mark ARM64 verified by executing x86-64 under emulation on an ARM host. Record host and process/addon architectures for native evidence.[^roadmap]

Use the runtime 004 qualified launch/admission contract when starting the actual Electron executable. The pinned Linux environment may provide a dedicated ephemeral non-root account/profile with its own fixed configuration root, provided the reviewed launch checks prove it cannot read or attach a host stable locator/store. Verify absence of host stable-configuration/data mounts and refuse an unqualified context; a private display alone is not data isolation. This development/CI environment does not replace the independent native OS-profile/VM requirement for exact-byte final-candidate testing.

STORY-001-008 phase prerequisites: integrate requires W2 from STORY-001-002; integrate requires Q7 from STORY-001-007; integrate requires D1b from STORY-001-018; integrate requires PA from Policy authority; complete requires R4 from STORY-001-004; complete requires NH from Native hosts. The Dependencies output registry defines each release condition and the common gate semantics; routing this block as context does not assign its owner's gates to another consumer.

### SPEC-001-011: First-day contributor experience and environment diagnosis

The owner and public roadmap require excellent external contribution from day one on all required native combinations from the target manifest. Each OS delivery provides a native, documented clean-checkout path to verified prerequisites, frozen dependency installation, a development window, a representative source change, a durable restart round trip, the shared required checks and a local quality package. The path needs no maintainer repository membership, signing and notarization secret, provider account, paid inference or private material. Build from this repository rather than copying code/configuration from another Ohtia repository.[^roadmap][^contribution]

Proposed developer tooling: provide repository-owned idempotent setup/bootstrap and a read-only environment doctor that checks supported OS and CPU, effective interpreter/tool versions, lock consistency, native compiler/addon availability, display/sandbox prerequisites, path/permissions and expected commands. Give a controlled cause, exact remediation and safe retry for a missing/wrong tool, unsupported target, permission failure, network/cache failure or native load mismatch. Never dump environment variables, home paths, credential stores or arbitrary exception text into shareable output. Intentional installs explain sources/versions and elevate only the required OS-package step with consent; diagnosis never silently mutates a machine.

Keep checkout/worktree environments isolated, use local filesystem support from D1a, validated by the applicable D1b record, and document shell/editor/debug configurations only after their commands/files exist. Keep LF repository text and the explicit Windows batch exception. Support spaces/non-ASCII paths and deliberate repeat setup; document real constraints such as OS path lengths rather than hiding them through undocumented machine tweaks. Separate mandatory contributor prerequisites from optional editor/container conveniences and privileged release work. No container may substitute for native Windows/macOS verification.

Record a measured first-run budget adopted in D1a and validated by D1b, cold downloads versus active setup, actual hardware/OS/network/cache and consented failure/recovery observations. A clean supported machine and a person unfamiliar with the environment must follow the instructions on each required target and native profile without undocumented manual fixes. Story owners perform initial VM/native validation; STORY-001-017 independently verifies the full newcomer journey so these earlier stories do not depend on a returning integration story. README/CONTRIBUTING are short entry points; substantial procedures live under docs with proper indexes/frontmatter. Each OS story checks its own section/automation against the same command contract.[^decisions]

The complete clean-environment walkthrough is setup → launch → representative source change → checks → package, on each required native OS/CPU target and profile. The change must exercise editing, rebuild/reload and a meaningful relevant check without depending on research features absent from the foundation. Adopt its measured onboarding budget before trials, record all interventions and correct undocumented fixes.

State command host restrictions explicitly. The existing scripts/github_pr.py read-only provenance verifier requires POSIX process/pipe controls; it is not native Windows functionality. Provide a tested supported POSIX execution path, such as an isolated supported Linux environment or reviewed trusted POSIX host, for this maintainer verification procedure. Windows setup/dev/tests/build/package remain native and credential-free; the external-fork Actions approval and live pre-merge administrative verification remain separate maintainer procedures. An optional POSIX path does not establish native Windows application evidence.[^roadmap][^ci]

### SPEC-001-012: Linux native developer environment

Implement the native Linux route for the reviewed distributions/version/CPU/libc/display matrix from D1a, validated by the applicable D1b native record. State precisely which distribution versions are supported; do not imply every Linux distribution works. Pin developer tools and identify native compiler/headers, GUI libraries, desktop session/display and sandbox dependencies with reviewed installation sources. Keep package-manager variations behind clearly documented supported routes, not an unconstrained best-effort installer.

Implement and verify setup/doctor/dev/check/package entries on clean native systems or VMs, including non-root application execution, display/sandbox failure diagnostics, native addon loading, denied data-root access, spaces/non-ASCII checkout paths and a repeat run. Include the immutable Linux E2E path as an additional reproducer with parity failure guidance. Do not require a host DBus, private desktop or credentials for automated tests. Verify a durable command, restart and graceful service failure through the native built window.

Deliver Linux-specific developer docs and reviewed troubleshooting from observed failures. Optional editor tooling remains optional. Completion needs U9's actual clean-machine results for every claimed Linux target, not a Docker-only or cross-compile success.

Linux x86-64 and Linux ARM64 are both mandatory contributor targets. Verify native tool/addon/executable architecture, source-change/rebuild/check/package behavior and clean setup on the qualified distribution/libc routes for each. The x86-64 E2E container is additional evidence, not a replacement for the ARM64 native walkthrough.[^roadmap]

STORY-001-009 phase prerequisites: integrate requires W2 from STORY-001-002; integrate requires D1b from STORY-001-018; complete requires R4 from STORY-001-004; complete requires S5 from STORY-001-005; complete requires Q7 from STORY-001-007; complete requires L8 from STORY-001-008; complete requires B12 from STORY-001-012; complete requires NH from Native hosts. The Dependencies output registry defines each release condition and the common gate semantics; routing this block as context does not assign its owner's gates to another consumer.

### SPEC-001-013: Windows native developer environment

Implement a native Windows contributor route using the reviewed Windows versions/CPUs and primary shell from D1a, validated by the applicable D1b native record. Declare exact prerequisites and native toolchain/SDK requirements for the selected addon/installer path; verify effective architecture and avoid mixing incompatible toolchain/runtime artifacts. WSL may be documented as an optional narrower Linux path, but cannot be the evidence or sole route for native Windows cooperation.

Provide copyable commands in the chosen native shell, with correct quoting and executable policy guidance limited to the specific reviewed setup. Do not require global security-policy weakening, disabled antivirus or administrator rights for ordinary dev/check execution. Handle spaces/non-ASCII paths, path-length constraints, file locking, CRLF/LF behavior, native rebuild failures and denied storage with actionable diagnosis. Setup is repeatable and worktree environments/secrets stay isolated.

On a clean supported Windows machine/VM, follow only the documented procedure to frozen install, launch the real desktop, make/reopen the durable change, run shared checks and produce the local package. Verify service shutdown and locked-file recovery without leftover processes. U10 requires native observed results for every claimed Windows target, with optional editor debug configurations tested against the same commands.

Windows x86-64 is a required native contributor target. Windows ARM64 is optional; including it requires its own native contributor evidence. Verify the selected SDK/compiler and native runtime/addon architecture on each, including the representative source-change/rebuild/check/package route. An x86-64 process on Windows ARM64 or WSL execution cannot pass the native ARM64 gate. Document and test the separate POSIX-only maintainer provenance-verification route without requiring maintainer credentials for ordinary native contribution.[^roadmap]

STORY-001-010 phase prerequisites: integrate requires W2 from STORY-001-002; integrate requires D1b from STORY-001-018; complete requires R4 from STORY-001-004; complete requires S5 from STORY-001-005; complete requires Q7 from STORY-001-007; complete requires B12 from STORY-001-012; complete requires NH from Native hosts. The Dependencies output registry defines each release condition and the common gate semantics; routing this block as context does not assign its owner's gates to another consumer.

### SPEC-001-014: macOS native developer environment

Implement the reviewed macOS versions and CPU routes, checking native execution architecture and preventing accidental x86/ARM tool/addon mixing. Establish the actual required Apple developer tools/SDK and pinned language/package tools through reviewed sources. Document Rosetta only for an explicitly qualified route, never as unexamined equivalence. Ordinary source contribution cannot require a paid signing identity or access to maintainer certificates.

Provide shell-safe setup/doctor/dev/check/package commands, current-account permissions, relevant quarantine/unsigned-local-build explanations and minimal consented OS prerequisite steps. Do not globally disable Gatekeeper or another platform control to make the guide pass. Cover native addon errors, spaces/non-ASCII paths, missing developer tools, denied data root and interruption/retry.

Verify on a clean native machine/VM for each required CPU/OS profile and any optional CPU actually included: frozen install, real desktop and status/service failure, durable save/restart, shared required checks, local package and complete process shutdown. Verify optional editor debugging only when supplied. U11 records OS and CPU/tool identities and measured setup/recovery results, not a Linux run or an untested universal-binary assumption.

Apple Silicon ARM64 is the required macOS contributor target, qualified on macOS 26 and 27. Intel x86-64 is optional; including it requires its own native contributor evidence. Verify the representative source-change/rebuild/check/package route and loaded native addon on each. Rosetta evidence is supplementary only. If packaging uses a universal installer, verify both slices independently rather than inferring one from the other's successful run.[^roadmap]

STORY-001-011 phase prerequisites: integrate requires W2 from STORY-001-002; integrate requires D1b from STORY-001-018; complete requires R4 from STORY-001-004; complete requires S5 from STORY-001-005; complete requires Q7 from STORY-001-007; complete requires B12 from STORY-001-012; complete requires NH from Native hosts. The Dependencies output registry defines each release condition and the common gate semantics; routing this block as context does not assign its owner's gates to another consumer.

### SPEC-001-015: Quality builds and native packaged smoke tests

Extend the existing pull_request-to-main and push-to-main CI to invoke the common check/build entries. Application/assets/native dependency/lock/runtime/packaging/tool changes build the complete applicable declared Windows/macOS/Linux OS and CPU/package set with actual native smoke execution. Preserve ci aggregation and the reviewed config/github/ci-verification.json inventory, action full-SHA pins, read-only token and nonpersisted checkout credentials. Current allowlists contain only checkout/setup-python: adding setup, caching, artifacts or packaging actions requires reviewed catalog/policy changes and separately authorized live plan/apply/readback, not a silent exception.[^ci][^release-policy]

Identify each CI package by development prerelease version unique to run and attempt, source/tested tree, workflow definition, run/attempt, target/package and digest. Packages cannot impersonate reserved final versions. Exclude development catalogs, fixtures, secrets, machine paths and privileged renderer imports. Verify actual packaged asset URLs/CSP, local data-service startup, embedded binding/engine identity, persistence/restart, second-instance behavior, privacy-safe failures and child shutdown. Unsigned quality artifacts are review evidence, not signed release evidence.

PR jobs receive no signing and notarization/publication credentials and cannot promote their output into trusted execution. Every development/CI executable is isolated from stable data, publishes nothing to GitHub Releases or the package repositories and does not run the update check of SPEC-001-040. Use a separately qualified native profile/VM when exact final bytes require it; installing a second executable or setting a channel name alone does not isolate the fixed bootstrap location.[^release-policy]

A main push validates the actual integrated source and records its distinct identity; synthetic PR merge evidence cannot substitute. Fail on missing, unreadable, cancelled or failing required targets/partitions and keep all results attributable. Optional later nightly suites supplement required gates; no clock/issue/merge event publishes automatically. Record bounded CI artifact retention, cleanup and retrieval limitations without deleting sole supported-release copies.

The required recurring quality-build matrix follows [ADR-0020](../../adr/adr-0020-github-policy-and-trusted-ci.md#recurring-hosted-quality-matrix) and [the quality-build inventory](../../../config/quality/build-targets.json): hosted Ubuntu 26.04 on x64 and ARM64, hosted Windows Server x64 and Windows 11 ARM64, and hosted macOS 26 and 27 on Apple Silicon. Every selected cell and package format is mandatory. Windows Server does not qualify Windows 11 x64 distribution; Ubuntu jobs exercise GNOME and KDE Plasma on Wayland on both CPUs. Native Fedora 44 and Debian 13 x64 guests exercise GNOME and KDE Plasma on Wayland on KVM with their own vendor kernels and declared filesystems/policies; their ARM64 guest CI extension is retained in technical debt. The distribution target manifest and complete final-candidate qualification remain separate. Record the actual host/image, executable/addon architecture and packaged evidence in each result; missing or emulated-only required evidence fails the coordinated quality gate. Native ARM64 runs supplement the pinned Linux x86-64 E2E environment without claiming its parity. Linux cell identifiers, the desktop dimension and the `launcher` dispatch follow SPEC-001-031.

STORY-001-012 owns compatibility of the expanded CI inventory with scripts/github_pr.py, scripts/github_policy.py and their existing tests. Exercise multiple required native jobs, absent/extra/skipped jobs, wrong head/base/tested tree and stale workflow/policy identities against the trusted verifier. Keep its pull_request admission strict; a push-to-main run cannot pass the pre-merge PR check. Main quality builds retain their separate integrated-source provenance. Extend the reviewed verifier/tests only where the chosen inventory/provenance design requires it; one primary provenance step does not justify missing per-target checkout evidence.

STORY-001-012 phase prerequisites: integrate requires W2 from STORY-001-002; integrate requires Q7 from STORY-001-007; integrate requires D1b from STORY-001-018; integrate requires PA from Policy authority; complete requires R4 from STORY-001-004; complete requires S5 from STORY-001-005; complete requires G6 from STORY-001-006; complete requires L8 from STORY-001-008; complete requires NH from Native hosts. The Dependencies output registry defines each release condition and the common gate semantics; routing this block as context does not assign its owner's gates to another consumer.

### SPEC-001-016: Final signatures and installation

STORY-001-022 to STORY-001-037 replace STORY-001-013 and deliver Linux signing, the signed package repositories and their native qualification under SPEC-001-033 to SPEC-001-042, together with the common all-platform build/provenance/capability interfaces in SPEC-001-028.[^release-redesign] Linux signing runs in the protected GitHub environment `release-signing` under SPEC-001-037, which admits only the `main` branch and requires the maintainer's approval for every run; there is no independently administered signing service. Real macOS Developer ID/notarization and Windows Authenticode qualification belong to STORY-001-019 and STORY-001-020 respectively. Review exact dependency pins, bundled licenses/notices/source obligations and policy permission/allowlist changes. Qualify required external signing identities and native testing facilities explicitly; an absent provider, platform service or certificate cannot be replaced by a synthetic check and called signed installation evidence.[^release-policy][^artifacts]

Complete every package/sign/notarize/staple or other transformation before identifying final digests. Verify signatures/authenticity/integrity and install/launch those exact resulting bytes on the real target. Record source, locks, embedded runtime/binding/SQLite, target, package, schema/queued-work compatibility and native evidence. Do not require users to install Node, Python, Docker or terminal tooling. Test fixtures can exercise a minimal foundation release internally; qualification is not permission to advertise research capability.

Apply SPEC-001-028's artifact-to-cell contract to qualification packages: produce sealed packages separately from their native test jobs, and require the same final package digest in every assigned display/OS cell. SPEC-001-041 applies this mechanism to repository qualification: each cell records the package digest it installed, and two cells that share a package must record the same digest; independent per-cell builds cannot establish shared-package qualification.

The application contains no updater: it never downloads or installs an update, and the operating system's package manager authenticates and installs Linux packages from the signed repositories of SPEC-001-038.[^release-redesign] The data service admits compatible schemas and any delivered queued-work state at the next start under SPEC-001-007; future task schemas extend the same admission boundary before use. This EPIC has one public channel, `stable`, and one qualification zone, `test`; a preview channel is deferred. Development and qualification builds do not run the update check of SPEC-001-040. Exact final-version bytes are validated from the `test` zone in an independent native profile/VM and published later without rebuilding. Do not add a compiled channel name or redirect the fixed bootstrap path to simulate isolation.

Native scenarios follow SPEC-001-041: installation of version A from the package file, registration of the repository entry and key, update to version B through the system package manager with the saved value intact, and refusal by the package manager of a package altered after indexing, an index with an invalid signature and, on Fedora, an RPM signed with another key, leaving version A installed and working.[^release-redesign] Database downgrade is never automatic; pre-migration recovery remains ADR-0010. Qualification builds and the `test` zone cannot silently open or migrate a stable store. Qualification runs through Actions against the `test` zone of SPEC-001-038. A bounded exceptional manual pilot may supply learning evidence but cannot replace the recurring Actions-operated mechanism.

Linux repository qualification covers all twelve required Linux native cells in the target manifest: the complete scenario of SPEC-001-041 on the six GNOME cells, one per package, and the short scenario on the six KDE Plasma cells that STORY-001-021 qualifies, with the same package bytes as their GNOME counterpart.[^release-redesign] Native macOS/Windows builds and foundation smoke/provenance checks remain required now; their final signed installation qualification remains mandatory in 019/020 before those platforms become distribution eligible, and neither platform has an in-application update. Use actual native execution for each and verify per-target addon/runtime/package identity, cross-architecture rejection and compatible upgrades on that architecture. A universal macOS artifact may serve two target records only with independent native verification of both slices. Optional provider-runtime availability does not narrow the core desktop support matrix.[^roadmap]

STORY-001-013 phase prerequisites: integrate requires B12 from STORY-001-012; integrate requires D1b from STORY-001-018; integrate requires PA from Policy authority; complete requires K21 from STORY-001-021; complete requires NF from Native facilities; complete requires NH from Native hosts. The Dependencies output registry defines each release condition and the common gate semantics; routing this block as context does not assign its owner's gates to another consumer.

### SPEC-001-017: Safe note capture and editorial assembly

Capture in every PR whether installed users are affected. Relevant proposed notes identify the task, observable result, platforms, availability, compatibility/action requirements and issue/PR evidence; no public effect requires a reason. Classify capability, improvement, correction, deprecation/removal or security change. Several implementation issues can describe one user capability; internal refactoring/routine dependency changes without user effects do not require public bullets.[^release-policy]

Build reviewed note-input parsing and source-difference reconciliation as data processing, never interpolation of PR text into shell, evaluation of PR helpers or selection of privileged policy by untrusted content. Reconcile included PRs since the preceding published version, identified by the previous `v*` tag; the first release reviews all delivered scope. A preview channel is deferred, so no preview baseline applies.[^release-redesign] Retain unfinished-scope note inputs without announcing unavailable features.

Provide an editorial preview with concise task-oriented summary/improvements/corrections, prominent upgrade/compatibility actions and separate technical links. Detect omitted consequences and unsupported benefit/performance claims. Preserve migration/reinstall, removed support, format/adapter incompatibilities, consequential privacy/transfers, security urgency and known limitations. Canonical public GitHub release prose is English; later translated presentations preserve the meaning rather than maintaining another independently authored history. An application/website display is not introduced as a premature product screen here.

The sealed approval chain does not gate the published release body. `prepare-release.yml` writes the first notes text into the unpublished release body from the collected `ohtia-note` blocks under SPEC-001-036, the maintainer edits that body directly on GitHub, and `publish-release.yml` records the SHA-256 of the exact body as a release asset under SPEC-001-039.[^release-redesign] The sealed `assemble`, `propose` and `approve` operations stay available without gating publication. Public prose corrections retain before/after bytes/digests, reason and maintainer approval outside edit history; they never conceal changed packages. STORY-001-014 supplies deterministic source/note fixtures without depending on a future candidate or publication story.

STORY-001-014 can deliver safe note schemas, capture templates and editorial assembly using existing repository standard-library tooling and deterministic history fixtures. It need not wait for candidate/publication automation or the future workspace. If implementation chooses a new dependency or CI/policy change, add the actual prerequisite and compatibility checks before integrating that choice rather than assuming those outputs already exist. PR text always remains inert data.

### SPEC-001-018: Trusted candidate preparation and permanent version identity

Implement release preparation as `.github/workflows/prepare-release.yml`, a manually invoked workflow_dispatch operation distinct from publication, under SPEC-001-036.[^release-redesign] Both definitions execute only from protected main; reject another selected workflow branch/tag. Record immutable workflow-definition revision independently from application source. Workflow-ref admission and signing/publication credential binding are enforced through controls the dispatched definition cannot change: the protection rules of the GitHub environment `release-signing`, which admits only the `main` branch and requires the maintainer's approval for every run, and the tag ruleset; a guard/credential rule declared only inside that definition cannot certify its own authority. STORY-001-015 and STORY-001-016 are replaced by STORY-001-022 to STORY-001-037: STORY-001-024 delivers the preparation workflow, STORY-001-025 its signing job and STORY-001-028 the publication workflow. Preserve the repository baseline and surface unavailable facilities before privileged enablement.[^release-policy][^ci]

A maintainer selects an exact reviewed application commit already integrated through protected-main PR/required-check rules, through the optional `hash` input of ADR-0049; the workflow reads the version from the root `package.json` of that commit and has no version input.[^release-redesign] Resolve mutable names once and verify source admission and passed quality evidence, including actual integrated checkout/run identity. Subsequent main movement cannot change the selected candidate. Use frozen locks and identified native tools to build the complete declared platform set and qualify the admitted Linux distribution scope under SPEC-001-028; a PR artifact is not trusted input to execute.

Reserve each application version before building by creating the protected tag `reserved/v<version>` on the selected commit; the workflow stops when the tag exists, and a repository ruleset prevents deleting or moving these tags.[^release-redesign] A run that fails or is cancelled after reserving consumes the version, and the correction raises the version in source; gaps are acceptable. Creating a Git reference is atomic, so two runs cannot reserve one version. A rerun of the same run may continue only while its tag points to the same commit and no asset of the unpublished release would be replaced. A changed package, rebuilt replacement, re-sign or embedded version change requires a new version/candidate. Development prerelease/build-metadata identities cannot impersonate a final candidate.[^artifacts]

Retain final transformed packages, digests and complete manifest: app/component/source/locks/tools, OS and CPU/package, embedded runtime and engine, schema compatibility, licenses, workflow revision, run/attempt, required target verification and the notes text. Candidate storage is a GitHub Release that stays unpublished, titled with the version, holding every platform's packages, a digest file listing each asset's SHA-256, length and signing state, and a GitHub build attestation for every package; Actions artifacts are not candidate storage.[^release-redesign] Verify final signed bytes rather than earlier unsigned output. A failed/cancelled/incomplete/unreadable target blocks readiness; do not overwrite a candidate in place. Readiness also requires usable declared scope, installation/update/recovery evidence, corrected accepted defects and accurate reviewed notes. No publication waives a mandatory gate; a preview channel is deferred.

STORY-001-015 is replaced by STORY-001-022 to STORY-001-037. Qualification under SPEC-001-041 installs the retained final bytes of each prepared version from the `test` zone and applies SPEC-001-028's cell assignments: every cell records the package digest it installed, two cells that share a package record the same digest, and no cell can choose a package from one ordinary CI job and inherit another job's result.

Apply coordinated SemVer to the application, separate from schema/stored formats and internal packages. At stable 1.0+ use patch compatible correction, minor compatible capability/deprecation and major public incompatibility; during 0.x use minor new/deprecated/incompatible and patch compatible corrections/refinements. Always disclose incompatibility and migration action. A supported migration alone is not a breaking change; unsupported downgrade must be explained. A prerelease cannot become stable by renaming a download: prepare a new final-version candidate unless the original exact bytes already carried the intended stable version. Example versions in policy are illustrative, not an assigned first release.

Test a dispatch from a ref other than `main`, a commit outside `main` history, an existing reserved tag, missing evidence, an altered asset digest, simultaneous reservations, cancellation, rejected version reuse and an interrupted rerun of the same run. Observe the environment protection rules and the tag ruleset by live readback and a refused run from a non-`main` ref; synthetic tests alone cannot release the RA gate. Keep public publication disabled independently of successful preparation.

Candidate manifests enumerate the complete product target/profile inventory and its authenticated per-platform build, provenance and distribution-capability evidence. Linux infrastructure readiness requires every Linux profile and the retained macOS/Windows native build/provenance results in SPEC-001-028. Public full-platform readiness additionally requires actual 019/020 signed qualification; until then a macOS or Windows package carries `unsigned` in its asset name, is recorded as unsigned in the digest file and is listed under the fixed testing-only heading, and it is not a distributed installer.[^release-redesign] No implicit missing-target waiver or optional reclassification is permitted. Optional Windows ARM64 or Apple Intel artifacts may be included only with their own complete native evidence. Bind native evidence and target/package digests to every cell; an incomplete required build, an emulated ARM64 run or a universal package verified on only one CPU cannot qualify. Package-format grouping must not hide a missing native target. Later product features extend the same inventory rather than reclassifying ARM64 as future work.[^roadmap]

STORY-001-015 and STORY-001-016 are replaced by STORY-001-022 to STORY-001-037. The preparation and publication workflows close with fixture runs and actual native and signing evidence under SPEC-001-036, SPEC-001-037, SPEC-001-039 and SPEC-001-041; they do not claim a public-ready release before 017 supplies the integrated evidence. An internal qualification record remains ineligible for public promotion, and real public readiness always requires current genuine evidence and separate authorization. Story 017 is the final evidence sink and is not a prerequisite for closing STORY-001-022 to STORY-001-037.

STORY-001-015 phase prerequisites: integrate requires B12 from STORY-001-012; integrate requires I13 from STORY-001-013; integrate requires N14 from STORY-001-014; integrate requires PA from Policy authority; complete requires NF from Native facilities; complete requires NH from Native hosts; complete requires RA from Release authority. The Dependencies output registry defines each release condition and the common gate semantics; routing this block as context does not assign its owner's gates to another consumer.

### SPEC-001-019: Authorized publication, reconciliation and lifecycle

Provide a separate protected-main workflow_dispatch publication operation, `.github/workflows/publish-release.yml`, under SPEC-001-039.[^release-redesign] A maintainer's authorization identifies the exact version, commit and asset digests of one prepared unpublished release; there is one public channel, `stable`. The Linux-controlled rehearsal scope in SPEC-001-028 does not authorize a Linux-only public release; only signed Linux packages go to the repositories, and an asset still recorded as unsigned stays under the fixed testing-only heading and is not a distributed installer. The approval of the `release-signing` environment qualifies only if its page shows those exact identities; generic workflow execution, PR approval, merge, issue closure, schedule or Conventional Commit type never authorizes publication. Recheck current readiness and verify every asset against the digest file of the unpublished release immediately before exposing anything.[^release-policy]

Promote retained final packages byte-for-byte: no rebuild, dependency resolution, package re-sign or embedded-version edit; publication signs only the repository indexes of SPEC-001-038. Tags/releases identify the selected source/artifact set without triggering a replacement build. Serialize publication application-wide across versions, tags, release records, downloads and package repositories; lock the logical operation and reconcile remote state so cancelling a workflow does not lose the serialization guarantee. Upload and verify the complete authorized set before the release becomes public, writing packages first and each signed repository index last, so a failed upload leaves the previous index in place and preserves the previous supported stable until replacement readiness.

STORY-001-016 is replaced by STORY-001-022 to STORY-001-037: STORY-001-028 delivers the publication workflow, and STORY-001-029 and STORY-001-030 add its repository steps. Publication downloads every asset of the prepared unpublished release and verifies it against the digest file before any public change, then verifies the uploaded/downloadable package against that same digest. Publication selects the prepared version's assets by recorded digest, never a display-backend job label or the latest file matching a name.

A partial upload or repository-index failure or uncertain activation is incomplete, never success. Persist the visible surfaces and immutable identities, stop remaining promotion and require maintainer reconciliation where visibility is uncertain. Retry with the same candidate/version/digests to finish only missing operations; conflicting existing bytes/metadata fail closed. Exercise first publication, idempotent retry, tag/latest collisions, cancellation and failures before/after each externally visible step on controlled test surfaces; do not publish a public scaffold release as a test.

Implement retained supported packages/manifests/published notes with their recorded digest/verification and their compatible update/recovery baselines, bounded temporary CI retention and explicit retirement/restore-readability procedures. Never remove the only supported release copy. Withdrawal removes recommendations/update admission while preserving identity, affected-version notice and safe next action. Versions are not reused/replaced; a corrected package needs a new version, and promotion of prior bytes requires fresh compatibility assessment/authorization. Executable rollback does not undo data migration or recover device loss.

Once stable exists, document the every-two-weeks readiness review as assessment rather than mandatory publication; urgent security/data-integrity/severe-usability fixes use the same protected-main, candidate and evidence model. Unfinished behavior must stay behind reviewed/tested boundaries; urgency cannot select an unprotected branch. A separate maintenance line needs its own reviewed policy. This infrastructure can be qualified internally before the full integrated research journeys exist; actual public releases still require their own useful-scope evidence and authorization.

STORY-001-016 phase prerequisites: integrate requires I13 from STORY-001-013; integrate requires N14 from STORY-001-014; integrate requires C15 from STORY-001-015; integrate requires PA from Policy authority; complete requires RA from Release authority. The Dependencies output registry defines each release condition and the common gate semantics; routing this block as context does not assign its owner's gates to another consumer.

### SPEC-001-020: Scope exclusions and later capability boundaries

This foundation supplies the runtime, narrow application port, storage/bootstrap/preference primitives, contributor environments and delivery infrastructure. Full menus and shortcuts, workspace geometry, the Settings shell and presentation controls, the full design-system component expansion, Settings language controls and research navigation are outside this EPIC. Minimal bootstrap/failure controls and their shared locale resolver, complete first-surface catalogs and accessibility verification are in scope under SPEC-001-024. Later interface work extends that same service and message inventory rather than replacing it. The [public roadmap](../../product-roadmap.md#epics-and-product-acceptance) describes the later deliveries without making them prerequisites for this foundation.[^roadmap]

Agent roles/conversations, optional OpenAI/Anthropic adapters, credentials, project-scoped research tasks, budgets, handoffs, usage and quality evaluation are outside this EPIC. Core desktop support on the required OS/CPU targets does not imply that every optional provider runtime is available on them; later adapters must qualify their own native access/containment. Missing providers cannot block foundation startup, local deterministic checks or contribution. Initial OpenAlex/DOAJ discovery and future search/provider candidates likewise add no network or inference dependency here.[^roadmap]

Project onboarding/profile/notes, researcher-facing storage management and the complete diagnostic viewer/share flow, retained source import, parser containment, evidence/review records, the full manuscript AST/editor and editorial approval command, research stages and manuscript conversion/feedback are later capabilities. Feature schemas and mandatory controls arrive with their first consumer. No project/manuscript entity is invented merely as a demo; the minimal declared preference and actual migration safety remain foundation responsibilities.[^roadmap][^architecture]

The minimal window, bootstrap and error messages remain subject to the applicable product language/accessibility contract; do not advertise an untranslated or inaccessible scaffold as public product UI. Complete research-native pickers/credentials/IME/clipboard/assistive journeys and converter/resource budgets extend the same pipeline when those features exist. Integrated research qualification reuses the early pipeline; it does not postpone its implementation or block an earlier useful release that independently satisfies mandatory readiness.[^roadmap][^release-policy]

Use the integrated adopting ADRs as canonical choices: Kysely/better-sqlite3 and verified migrations, Electron privileges, UUIDv7 entities, typed preferences with a fixed bootstrap locator, and distinct collaboration authority. Do not recreate obsolete working-tree conflicts or select a different manuscript/usage/identity contract through scaffold code. Exact native compatibility and all unqualified enabling facilities still require actual evidence.[^decisions]

Complete knowledge interchange requires a later approved format; repository OKF is not a research-data serializer. General backup/device-loss recovery, destructive erasure, cloud/mobile delivery, exhaustive systematic review, external bibliography-manager synchronization, executable statistical analysis, certified methodological expertise and academic/defense certification are excluded. No real provider invocation, paid enrollment, public release, live setting mutation, commit or publication is authorized by local preparation.[^roadmap]

### SPEC-001-021: Integrated acceptance and ownership

STORY-001-017 owns integrated common-foundation and Linux-delivery verification, independently of earlier owners' narrower acceptance. It does not wait for 019/020 publisher facilities and cannot certify their deferred signed user routes. Those follow-ups perform their own affected final integration and human signed-installation and update-notice observations against the shared foundation. Use the actual integrated source, frozen inputs and final packaged artifacts on all required native OS and CPU targets. Demonstrate graphical first-use initialization and admission at the fixed account-native `ohtia` root, real durable operation/restart, single broker, safe service crash/recovery, actual packaged CSP/import boundaries, binding/engine identity, migration/checkpoint outcomes, content-free bounded diagnostics and complete common-gate evidence. Preserve source/tree/workflow/run/target/digest identity and limitations rather than treating a green ci name as proof.[^architecture][^quality]

Run the documented Linux, Windows and macOS contributor paths on fresh native x86-64 and ARM64 systems, covering all required targets with a person unfamiliar with each setup, including a representative source change, environment-doctor failure/remediation/retry and local unsigned package. Record cold/active time against the agreed budget, actual OS and CPU/hardware/cache/network, manual interventions and omissions; correct documentation/automation defects and repeat affected journeys. Do not turn the fresh-person availability gate into a fabricated reviewer identity or a self-review claimed as external validation.[^roadmap]

Rehearse signed release preparation and publication failure/withdrawal/retry on controlled surfaces with synthetic/public data, explicit test-surface authorization and the protected `release-signing` environment, preserving exact final digests through publication. Verify non-stable native-profile/VM isolation, stable-store preservation and no update check by development or qualification builds. Confirm public publication remains gated without a useful research journey and specific maintainer authorization. Real public publication is not an EPIC completion condition; qualified signing/install/update and release-control evidence are.

Keep semantic acceptance, local checks, hosted CI, actual native/assistive evidence, independent code reviews, signed content identity and human integration separate. No story may claim completion with accepted defects or unresolved mandatory platform/authority evidence. The EPIC closes only when all story outputs and these combined scenarios pass; later feature journeys extend rather than retroactively replace this evidence. Record actual platform/facility gaps and leave the corresponding work open.

Integrated acceptance must independently enumerate all required target records and their native setup → launch → representative source change → checks → package walkthrough, real boundary/storage/recovery tests and Linux repository installation and update evidence under SPEC-001-041. Real macOS/Windows publisher-signed installation evidence is supplied by 019/020; native runtime, storage, assistive and contributor acceptance on those platforms stays in 017. Record native host/executable/addon architecture, including independent macOS slices if universal packaging is used. Keep a required missing/failed cell open; narrowing scope is a separate reviewed decision. Recheck collaboration scenario 15's sensitive markers through foundation success/errors/stderr/traces, without claiming the later diagnostic-sharing interface exists.[^roadmap]

Integrated verification checks the first runtime isolation contract against stable-profile sentinels, complete initial locale catalogs/resolution and the actual bootstrap/recovery keyboard and assistive journeys. It consumes the security-applicability evidence produced by the core owners under SPEC-001-022, diagnostics owner under SPEC-001-025 and delivery owners under SPEC-001-026. Missing requirement-ID/applicability/evidence records are not work silently deferred to this final story; their producer must correct them before integrated acceptance.

STORY-001-017 owns the manual screen-reader and other applicable assistive journeys on every native target, plus catalog structure, contextual presentation and model-provenance checks for delivered locale messages. Record actual operators, tools, criteria, checked steps and generation provenance. Human linguistic review is optional; identify unreviewed translations without certifying fluency. Retain failed or missing mandatory results as unmet acceptance; earlier automated UI checks cannot replace the native assistive evidence.

STORY-001-017 phase prerequisites: complete requires U9 from STORY-001-009; complete requires U10 from STORY-001-010; complete requires U11 from STORY-001-011; complete requires B12 from STORY-001-012; complete requires R37 from STORY-001-037; complete requires W38 from STORY-001-038; complete requires N14 from STORY-001-014; complete requires D1b from STORY-001-018; complete requires K21 from STORY-001-021; complete requires NF from Native facilities; complete requires NH from Native hosts; complete requires NC from New contributors; complete requires RA from Release authority; complete requires UR from UI review facilities. The Dependencies output registry defines each release condition and the common gate semantics; routing this block as context does not assign its owner's gates to another consumer.

### SPEC-001-022: Security applicability and acceptance evidence

Apply ADR-0000 to this foundation's actual IPC, rendered assets, native processes, filesystem/storage, diagnostics and build/release authority. Use its ASVS L2 baseline including applicable L1, complementary web/API/LLM risk catalogs where relevant, Electron/native controls and operational recovery responsibilities. Record versioned requirement IDs, justified applicability/exclusions, implementation and reproducible evidence. Absence of a control is not an exclusion rationale; no agent/parser capability exists here to certify merely by naming the LLM catalog.[^security-baseline]

STORY-001-001 establishes the foundation applicability inventory and numeric controls alongside D1a. STORY-001-018 extends that inventory with actual native-probe isolation, runtime and filesystem evidence under D1b. Contract/runtime/storage owners extend it with actual positive/negative boundary tests; STORY-001-017 reconciles the complete final evidence. Diagnostics evidence is produced by STORY-001-006 under SPEC-001-025. Delivery/notes/signing/candidate/publication owners produce their own applicable ADR-0000 evidence under SPEC-001-026. Each retains the same versioned baseline and final-artifact scope; STORY-001-017 checks the combined inventory rather than inventing missing owner evidence. Scanners support this evidence rather than establishing conformance. A failed or unverified mandatory requirement blocks the affected capability from being claimed ready for real research. Findings retain cause, trigger, impact and verifiable references without fabricated mappings or human approval.

Verify spoofed sender/frame, invalid/oversized messages, unexpected navigation/resources, privileged imports, native artifact replacement, incompatible schema and unsafe file/locator aliases at the enforcing boundary. Record the actual artifact/OS and applicable test identifier for each control. Security tests use synthetic/public data; never collect private research or secrets as evidence. Product principles PRIN-004–007, PRIN-011 and PRIN-013 require traceable honest coverage and privacy-preserving failures, including administrative verification limits.[^product]

### SPEC-001-023: Isolation before the first development executable

Every CI executable, internal candidate and qualification build must run with application configuration and research data independent of the stable installation. Daily development instead uses the checkout-scoped instance selected by [ADR-0043](../../adr/adr-0043-ordinary-startup-modes.md), and an ordinary installed application needs no qualification profile. STORY-001-004 implements the first native launcher and admission checks before any renderer/broker/service launch; STORY-001-005 rechecks that context before opening a locator/store or creating a checkpoint. Contributor setup owners use that entry from their first runnable walkthrough. This control precedes packaging and cannot wait for STORY-001-012.[^release-policy]

Use a dedicated OS user profile or native VM with its own fixed Electron userData configuration root, settings/data-location.json and managed synthetic/public-data store. The isolation is environmental; neither selecting another research directory, installing a second executable, renaming a channel nor redirecting userData as a data-location change establishes it. The same final bytes can later be tested in that independent profile. A new profile may be prepared during setup, but first application launch remains blocked until the selected context is verified. An ordinary contributor needs no signing identity/provider account or stable-store copy.

The repository-owned qualification and test launcher accepts only a verified isolated execution profile from the supported setup procedure. If its expected native configuration boundary cannot be established, it exits with a controlled actionable diagnostic before app/broker startup and before reading the stable locator. The service additionally rejects a test/dev store or locator outside its admitted isolated context; paths resolve native aliases and cannot turn a stable path into a permitted synthetic store. This is protection against accidental execution and bad fixtures, not a claim of defense from an equivalent-privilege OS administrator.

Place synthetic stable-configuration, locator, store and recovery sentinels in the test's separate stable-profile fixture. Verify a launch in the stable or unverified context is refused without reading/migrating/changing those files. In the admitted independent profile, run startup, store initialization, migration failure/recovery and diagnosis, checking stable sentinel digests/metadata and no stable broker/child attachment. Test symlink/native-alias escape, missing isolation metadata and interruption before launch. Keep private research, developer credentials, the `stable` package repositories and the public update check out of the fixture. Verify this on all required native targets.

STORY-001-004's output includes the tested launcher/context contract before storage exists; STORY-001-005 and contributor stories consume it. They may use their own isolated fixtures without waiting for release automation. Failure to prove isolation blocks that executable/store path, not the unrelated ability to read documentation or edit source.

### SPEC-001-024: Minimum localized and accessible foundation surfaces

STORY-001-004 owns the minimum common locale service, typed versioned catalogs and accessible composition for the first status window, fixed-root bootstrap guidance and runtime/bootstrap errors. STORY-001-005 extends those same catalogs/controls for storage/open, create, compatibility and recovery outcomes; it does not create another locale resolver. STORY-001-003 supplies their bounded locale/message-code port shapes, STORY-001-007 supplies catalog/inventory failure gates, and STORY-001-017 verifies the integrated first-surface journeys. The full Settings language chooser, broad design-system library and future feature messages remain later work. First-consumer safeguards are delivered here without requiring a return dependency on the later interface epic.[^roadmap][^localization][^accessibility]

Use one trusted-broker resolver based on Electron app.getPreferredSystemLanguages(), with optional validated saved explicit choice supplied only after the data service admits its store. A supported explicit choice wins; otherwise inspect OS preferences in order, skipping invalid Intl.getCanonicalLocales tags and stripping extensions. For each, try the supported full base locale, then language+region without script/variants, then the canonical language fallback mapping before advancing to the next preference. Supported regional variants are retained; a mapped earlier preference wins over an exact later one. Empty/unmatched lists use en-US. The mapping is en→en-US, es→es-ES, pt→pt-PT, fr→fr-FR, de→de-DE, it→it-IT, nl→nl-NL, sv→sv-SE, da→da-DK, nb/no→nb-NO, fi→fi-FI, ca→ca-AD and ko→ko-KR; nn has no invented no/nb mapping. The explicit choice and system-mode contracts come from ADR-0024. Before SQLite is available, use system resolution without claiming saved choices loaded. Invalid saved presentation choices produce a controlled fallback rather than rewriting them.[^localization]

Provide structurally complete catalogs for every delivered message/accessible label for all current product locales: en-US, en-GB, en-AU, en-CA, es-ES, es-MX, es-AR, pt-BR, pt-PT, fr-FR, fr-CA, fr-BE, de-DE, de-AT, de-CH, it-IT, nl-NL, nl-BE, sv-SE, da-DK, nb-NO, fi-FI, ca-AD, ca-ES and ko-KR. Validate stable message keys, typed parameters, plural/select forms and syntax; a missing required key cannot be filled silently from another locale. Source/analysis/manuscript languages remain separate. All application-owned windows/messages, formatting and html.lang use the same resolved locale. Changing an application preference does not change OS settings. Keep protocol/error codes and developer diagnostics in their canonical representation, translating only the UI view. Never parse diagnostic prose into user messages.

Use semantic labels and controls, keyboard operation and visible focus, focus placement/restoration for errors/dialog dismissal, meaningful non-disruptive status announcements, error association and preserved pending input. Apply WCAG 2.2 AA and ADR-0023's eleven selected AAA criteria (1.4.6, 1.4.8, 2.1.3, 2.2.4, 2.2.5, 2.2.6, 2.4.8, 2.4.10, 2.4.12, 2.4.13, 3.3.6), with justified applicability rather than invented blanket AAA conformance. Include contrast, zoom/reflow to 320 CSS px, text spacing, forced colors, reduced motion, 40% pseudolocalization and Korean/mixed-script text. Bundle the first surfaces' required local font resources/glyphs under ADR-0025 with their licenses; the full typography/component catalog is a later consumer expansion, not a reason to defer readable Korean text.[^accessibility][^fonts]

Exercise every exact locale and fallback mapping, malformed tags, ordered-preference examples ([es-CL,en-GB]→es-ES; [nn-NO,en-GB]→en-GB; de-Latn-CH→de-CH), invalid saved choices and pre-store fallback. Verify actual fixed-root bootstrap, initialization, open, retry and recovery success/failure journeys, keyboard-only operation, focus, input preservation and the packaged accessibility tree on every required native target. STORY-001-017 defines and performs the manual screen-reader and other required assistive journeys with qualified tools and operators on all required native targets, and records the actual OS, CPU, artifact, tool, criterion and checked steps. It verifies delivered catalog structure, contextual presentation and actual model-generation provenance. Human linguistic review is a voluntary future improvement, not a required acceptance or release result; record it only if actually performed. Stories 004 and 005 provide complete catalogs and pass automated packaged keyboard, focus, input-preservation, reflow, glyph and accessibility-tree checks; their closure does not wait for 017 or claim manual usability or linguistic certification. Structural catalogs or automated tree checks do not certify fluency, screen-reader usability or complete conformance. A failed/unverified applicable mandatory criterion cannot yield a conformance claim.

The harness story can close against deterministic catalog/coverage failure fixtures before production UI exists; actual automated UI and message acceptance belongs to 004 and 005; manual assistive acceptance and catalog/provenance checks belong to 017. The integrated delivery and any public-ready candidate require the mandatory native assistive evidence; optional human linguistic review is not a prerequisite; a failed or unverified mandatory criterion cannot be waived by closing an earlier story. Minimum locale port/resolver/control work is closable with status/pending-path fixtures before live storage. Storage adds its real messages and saved-choice decode after runtime delivery; no locale story is made dependent on its own storage consumer.

### SPEC-001-025: Diagnostics security applicability and evidence

STORY-001-006 owns ADR-0000 applicability and evidence for the diagnostic catalog, worker-event validation, broker writer, filesystem access/rotation/deletion and automatic-capture boundaries. Apply its versioned ASVS L2 baseline including applicable L1 and relevant Electron/native filesystem/risk controls. Record concrete requirement IDs, applicability or justified exclusions, implementation/test references and actual artifact/OS evidence alongside privacy outcomes. An absent control is not inapplicable merely because this is a scaffold.[^security-baseline][^diagnostics]

Map tests to the real controlling boundary: malformed worker events, oversized/injected fields, secret markers in error/stderr/SDK capture, managed-path aliases/permissions, bounded rotation and deletion races, denied I/O and no content fallback. Preserve the local-only policy and demonstrate stable-profile isolation where the writer consumes the development context. A passing leak test alone is not the complete applicability record. Failed/unknown mandatory controls keep the affected path unready; scanner success is supporting evidence, not certification.

STORY-001-006 supplies this evidence with its completed writer; STORY-001-017 reconciles it with core and delivery inventories. Final integration cannot substitute for evidence no producing story was assigned to create.

### SPEC-001-026: Delivery security applicability and evidence

Each delivery owner applies ADR-0000's versioned ASVS L2 baseline including applicable L1 and relevant CI/native/operational controls to its own boundary. Record requirement IDs, applicability/exclusion reasons, enforcing implementation and reproducible positive/negative evidence on the actual candidate/artifacts, while distinguishing local synthetic tests from actual external enforcement. The common baseline does not transfer evidence production to final integration.[^security-baseline][^ci]

STORY-001-012 owns untrusted PR execution, action/token/checkout policy, complete target/result provenance and artifact isolation. STORY-001-013, STORY-001-015 and STORY-001-016 are replaced by STORY-001-022 to STORY-001-037; STORY-001-037 owns the security inventory of the release boundary under SPEC-001-042: the protected `release-signing` environment, the reserved tags, the workflows' ref admission, the signing job, the package repositories and the update check.[^release-redesign] STORY-001-019 and STORY-001-020 produce their own actual macOS/Windows publisher-facility, final signed artifact and native user-route security evidence under SPEC-001-029/030. STORY-001-014 owns inert parsing of untrusted PR notes, editorial content/approval integrity and no authority selected by input text. Each supplies its boundary's applicability record before acceptance; STORY-001-017 reconciles the combined record rather than creating their missing checks.

Exercise wrong workflow/event/head/base/target, stale or unreviewed policy, attempted candidate-controlled verifier replacement, secret-bearing PR contexts, malicious notes, altered signatures/digests, duplicate version/reservation races and partial/uncertain activation as applicable to the named owner. Record expected denial and the actual enforcing control, with explicit live/readback evidence for external authority. A green workflow name or a synthetic policy mock cannot establish live signing/publication enforcement. Failed/unreadable mandatory evidence blocks the affected guarantee; do not invent a CWE mapping or approval to close it.

### SPEC-001-027: Native feasibility and frozen workspace qualification

STORY-001-018 owns D1b, the measured native qualification of the D1a choices using the workspace from 002. It is a separate closable story so workspace and portable IPC never wait for the native test harness they enable. Add a real, non-shipping workspace package at the proposed path tools/desktop-probes/ under the single root pnpm lock and common command entries. This is new probe code, not an existing repository tool: its issue must exist before implementation, and all executable code, tests and build configuration follow AGENTS.md's two independent code reviews, checks and signed-commit requirements.[^contribution][^decisions]

On each required target and native profile in the [target manifest](../../../config/desktop/targets.json), perform a clean-cache frozen workspace installation and build without changing locks or requiring undocumented global tools. Exercise the actual selected native addon with the prospective packaged Electron utility runtime; record host, executable and addon architectures, runtime ABI, effective embedded Node and SQLite identity, artifact and tool digests, peer and engine constraints and native dependency availability. Validate the active renderer sandbox and constrained local resources, qualified filesystem atomic-publication primitives, and a minimal installer and updater mechanism feasibility path. Engine metadata, an in-memory database, cross-build success, emulation and a universal binary exercised on one CPU cannot substitute for native results.[^real-boundaries][^roadmap]

Before any qualification executable, manually provision and verify an independent native profile or VM with separate configuration and research roots and permitted synthetic or public fixtures. Refuse stable or unverified contexts; check stable locator, store and recovery sentinels before and after the probe. Do not read public update feeds or copy developer credentials. This owner supplies its early manual admission, without waiting for runtime 004's automated launcher, product storage, final installers or release automation. Keep the probe harness and fixtures out of shipped artifacts; later product implementations are built from scratch against the contracts rather than copied automatically from the harness.

Qualify selection feasibility here; STORY-001-022 to STORY-001-037, which replace STORY-001-013, own final Linux signed installation and updates through the signed repositories; STORY-001-019/020 own actual macOS/Windows publisher-signed qualification. All require their real applicable facilities. D1b does not require the finished release pipeline or its credentials. State each mechanism assumption and its signing-qualification owner; refuse the later guarantee until that owner supplies actual evidence. Use native observations to validate or revise the onboarding budget with review before 017's newcomer trials, separating cold downloads from active setup and recording cache, hardware and network conditions.

Release a target-specific D1b record only after that target's complete required probes and frozen installation pass on the actual consumer base. A consumer limited to a target subset may integrate against those passing records; missing other cells remain unqualified. STORY-001-018 closes only after every required profile passes and its source compatibility and limitations are reconciled. Apple Intel and Windows ARM64 are optional; Apple Silicon requires macOS 26 and 27. Optional absence does not substitute for native evidence or prevent required-scope completion. Runtime and storage can begin controlled implementation using D1a and available isolated hosts, but their complete native acceptance needs all applicable D1b records. This permits useful early work without treating an incomplete matrix as delivered.

Verification includes incompatible or unavailable addon artifacts, wrong runtime ABI or architecture, denied filesystem access, failed sandbox initialization, altered locks and accidental stable-profile execution. A failed mandatory probe leaves its target unqualified and requires correction of the owning contract and affected consumers. D1b is evidence and reviewed assumptions, not the final application, signing authority or permission to publish.

STORY-001-018 phase prerequisites: integrate requires D1a from STORY-001-001; integrate requires W2 from STORY-001-002; complete requires NH from Native hosts. The Dependencies output registry defines each release condition and the common gate semantics; routing this block as context does not assign its owner's gates to another consumer.

### SPEC-001-028: Linux-first delivery and platform capability admission

Deliver common build, qualification, signing, release-preparation and publication foundations through STORY-001-022 to STORY-001-037, which replace stories 013/015/016, and story 017, with Linux repository qualification under SPEC-001-041: the complete scenario on the six GNOME cells and the short scenario on the six KDE cells with the same package bytes.[^release-redesign] Required Linux scope is the twelve OS/CPU/desktop cells in the target manifest: Ubuntu 26.04, Fedora 44 and Debian 13, each with GNOME and KDE Plasma on Wayland, on x86-64 and ARM64, as SPEC-001-031 defines. Windows 11 x86-64 and Apple Silicon on macOS 26/27 remain required product platforms with native foundation/contributor checks, builds and retained-artifact attestations. Their real publisher signing and signed user-route acceptance belong to independent stories 019 and 020. Neither is a prerequisite of STORY-001-022 to STORY-001-037, story 017 or unrelated interface development.[^phased-delivery]

The candidate/capability contract enumerates every product target and package format, its actual build/provenance and native-runtime evidence, signing/installation qualification and distribution eligibility. `prepare-release.yml` implements it under SPEC-001-036: each platform declares whether its packages are signed, and the digest file of the unpublished release records every asset's signing state.[^release-redesign] An absent, unknown, failed, expired or revoked capability is ineligible. Internal macOS/Windows unsigned or ad-hoc builds remain clearly identified: an unsigned package carries `unsigned` in its asset name, is listed under the fixed testing-only heading of the unpublished release, is removed from the release at publication, never enters a package repository and cannot become a distributed installer or a successful signed result. Only signed Linux packages go to the repositories. Do not rename a required platform optional or silently omit it. Full-platform public readiness requires M19 and W20 in addition to the current readiness evidence; no public scaffold or Linux-only product release is authorized by infrastructure completion.

Separate the final artifact inventory from the native qualification-cell inventory, following [ADR-0021](../../adr/adr-0021-versioned-desktop-artifacts.md) and the package grouping in [ADR-0038](../../adr/adr-0038-desktop-delivery-mechanisms.md#packages-and-tools). A package record has a unique artifact identifier, package format, native CPU architecture or declared universal slices, distribution installation-policy profile, final SHA-256 and byte length, plus the existing source/build/signing provenance. A cell record identifies its required OS/version, CPU, desktop, filesystem/security policy, native display backend and scenarios, and explicitly references the assigned artifact identifier and digest for each required package role/format. One artifact can serve several cells, and one cell can require several artifacts, such as separate macOS DMG and ZIP packages. Every required cell and package role/format must have an assignment, and no grouping may hide a missing cell or format. Display sessions belong to the cell inventory, not to the package-variant identity. Preserve ADR-0038's distinct Ubuntu/Debian installation-policy profiles; reuse across supported OS versions within a compatible package profile requires explicit assignments and successful evidence for every assigned cell, never an assumption that all DEBs or same-named files are interchangeable.[^artifact-cell-contract]

For example, the macOS 26 and 27 Apple Silicon cells both consume one sealed DMG with digest H; each Linux CPU and package profile consumes its own sealed package, and Debian retains its separate package-policy profile. Build/package/sign once for each final artifact identity and complete all byte-changing transformations before sealing its digest and length. Retain those bytes, distribute them to separate native test jobs and verify their digest/length before installation or extraction. Test jobs may install and inspect the package but cannot rebuild, re-sign, change its embedded version or repack it. Record the original package digest and the installed-payload comparison separately; a matching extracted executable alone does not identify the final installer. A changed sealed package requires a new candidate/version and fresh affected evidence under the existing permanent-version rules.

Every cell/scenario result binds the immutable candidate identity, or the controlled qualification identity before candidates exist, its assigned artifact identifier/final digest, actual execution workflow/run/attempt, observed native environment and result. Preserve build-run provenance separately from test-run identity: independent test jobs and retries need not share the build run. Installation/update/recovery scenarios identify every final package they consume, including the previous supported baseline when applicable. A shared digest does not replace independent native execution, required scenarios, authenticity, provenance or platform eligibility. Native execution cannot be inferred from an environment label. Duplicate results for one cell cannot fill another cell, and unavailable, skipped, failed, stale, unreadable or wrong-identity evidence cannot satisfy an assignment. Retain failed attempts; retry only against the same sealed bytes and record which required scenario each result covers.

Stories 013, 015 and 016 are replaced by STORY-001-022 to STORY-001-037. `prepare-release.yml` builds, signs and seals each prepared version's packages in jobs separate from the native test consumers, reusing the build entry points of the existing `ci.yml` with the exact version rather than a second builder; STORY-001-033 delivers the reusable qualification harness of SPEC-001-041.[^release-redesign] Existing `scripts/quality_native.py` and `.github/workflows/ci.yml` build ordinary quality packages per cell; their structure and green results are not final-candidate qualification. Use `scripts/installation_native.py` as the existing installation-evidence boundary to inspect when defining the shared contract, without treating its current backend-specific build entry as the new manifest or copying qualification tooling into product code. `publish-release.yml` publishes only the assets of the prepared unpublished release, and story 017 verifies the integrated assignments, evidence and published bytes. Stories 019/020 apply the same relationship to their separately qualified final platform formats and OS profiles. These responsibilities add no returning dependency on a consumer.

Each Linux profile declares a GNOME and a KDE Plasma session cell under SPEC-001-031. Verify that both desktop cells of one OS, profile and CPU consume H and satisfy their independent required scenarios, natively and in a positive fixture. Reject an adversarial fixture in which one session consumes package P and the other consumes package Q with different digests even though version, source and filename match; neither package is ready for shared promotion. Also reject a missing assigned cell, a duplicate substituted for another cell, wrong candidate/artifact/run/environment identity, stale or failed required evidence, altered transferred bytes and a publication upload whose digest differs from the admitted artifact. Exercise the real sealed-package path natively in qualification and each candidate, not only synthetic schema fixtures: each assigned cell installs the transferred bytes after verifying their digest and length. Native sharing between the GNOME and KDE cells of one profile and CPU uses the real sealed-package path; the mixed-package and substitution rules keep their synthetic fixtures.

Run normal builds, native automated qualification, preparation and publication from GitHub Actions; no laptop cross-platform build, per-PR manual catalog, repeated manual per-file signing or permanent personal VM fleet is the operating procedure. Prefer verified hosted facilities; use separately approved, cost-capped temporary native guests/hosts where needed, with independent teardown on cancellation/runner loss. Prove actual OS/CPU/filesystem/security/display identity and ordinary-user token/session; runner defaults or a username are insufficient. A native compositor/session with a virtual display may support its recorded software-display scope, but Xvfb does not prove Wayland and neither proves physical/assistive behavior. Keep actual Windows 11 x86-64, Fedora ARM64 and Debian ARM64 facility gaps visible; first probe real ARM KVM support before selecting paid infrastructure. Native guest licensing, including Windows entitlement and virtual hardware requirements, must be established before use. Build outside expensive guests where possible and transfer exact sealed packages for tests.

Use one pinned reusable build/sign/final-verify core for qualification and candidates. PR-safe workflow/admission tests use ephemeral identities and synthetic fixtures without production secrets; protected-main entry points alone may invoke real signing/publication authority. Linux signing runs in the protected GitHub environment `release-signing` under SPEC-001-037: the environment admits only the `main` branch and requires the maintainer's approval for every run, the build job runs without secrets, and the signing job checks the package digest, installs no project dependency and runs no project code.[^release-redesign] There is no independently administered signing service, because the project has one maintainer and a service administered by the same person adds no independent control. Verify the protection rules by readback and a refused run from a non-`main` ref, and model GitHub-account, dependency, runner, storage-provider and signing-subkey compromise. One account merging, dispatching and approving is not independent approval; several keys held by one person are not independent custody. The environment approval, the `main`-only rule, a signing job without project code, the yearly subkey expiry and offline revocation bound the exposure of the signing subkey without providing hardware isolation. Keep the primary certification key and its revocation certificate offline with the maintainer, document residual single-custodian availability risk and qualify renewal, revocation and recovery. Provider/cost/account changes require their own exact authorization.

GitHub build attestations are immediate scope on every platform and require no Developer ID or Windows publisher certificate. For retained qualification/candidate artifacts, verify exact source, repository, admitted workflow identity, run/attempt and final digest; bind native-signing transformations to build provenance. Public-log metadata and artifact privacy need separate review. Attestations supplement native signatures and the signed repository indexes; they do not establish publisher trust, safe code or a claimed SLSA L3 pipeline. Do not add attestations to every disposable test file or allow an attested PR artifact to authorize its own privileged execution.

Candidate storage is a GitHub Release that stays unpublished, visible only to people with write access; Actions artifacts are not candidate storage, because the repository is public and artifacts expire.[^release-redesign] Qualification uses the `test` repository zone of SPEC-001-038, which is publicly reachable but unlinked; protecting it with credentials is deferred, and the zone alone is not isolation or a distribution boundary. The R2 bucket, the `packages.ohtia.com` domain binding and the bucket-limited write credential are external facilities the maintainer creates; specify endpoints/policies in validated configuration. Rehearse destructive publication lifecycle on separately approved nonpublic fixtures. Public immutable-release settings and their actual protection may be adopted only with authorized live proof; an immutable tag/asset does not make a repository upload atomic. Version reservation is the protected tag `reserved/v<version>` of SPEC-001-036: a repository ruleset protects `reserved/v*` and `v*` tags against deletion and update, the ruleset change is applied only with the maintainer's authorization and read back, and a failed run keeps its tag; the tag does not replace publication serialization.

This EPIC has no signed update catalog and no catalog key: the application neither downloads nor installs an update, so nothing would consume one.[^release-redesign] Linux packages are authenticated by the signed apt and dnf repository indexes and the embedded RPM signature, made with the signing subkey of SPEC-001-037. The subkey is valid for one year, renewed annually, and revoked and replaced with the offline primary key without changing the identity that installed systems trust. STORY-001-025 writes the custody procedure for export, renewal, revocation and recovery. Record credential/provider/certificate expiries, annual costs, backups and maintainer-absence procedures without exposing secrets.

The application only checks and notifies under SPEC-001-040: it never downloads or installs an update and contains no updater and no native DEB or RPM installation adapter.[^release-redesign] On startup, when the setting is enabled, the trusted main process asks GitHub for the latest published version; the setting is enabled by default and changed in Settings, there is no first-run notice, and a manual "Check for updates" command runs the same request. The request runs through the trusted main process, never the renderer, with a bounded response size and timeout from the numeric policy record, and the notice and its dialog are accessible and localized. Do not transmit research content or introduce default usage analytics. The first Linux installation is from a package file; the package registers the Ohtia repository and its public key under SPEC-001-038, and the operating system then downloads, verifies and installs later versions with its own signature checks. There is no separate independently authenticated graphical first-installation route.

Qualification uses two versions under SPEC-001-041: the installed version A and the prepared version B. When a published version exists, A is the latest published version; otherwise the harness builds A itself from the same commit with a lower version, as a qualification build registered against the `test` zone, and discards it afterwards. A is never reserved, never attached to a release and never appears in the version history; B is always a real prepared version.[^release-redesign] If schema-change coverage needs a fixture, agree a deterministic synthetic non-shipping package/profile variant and its evidence limits; do not introduce a gratuitous production migration or claim a same-schema update proves migration. Test one Linux cell, `linux-x64-ubuntu-26-04-gnome`, end-to-end through real signing, installation from the package file, update through the repository and refusal before expanding to the remaining cells. Closure of the release flow still requires the real R37 gate from STORY-001-037; a fixture rehearsal is not R37.

Qualify the builder's actual signing callbacks and byte transformations before provider provisioning. The pinned NSIS path signs its generated uninstaller during construction; macOS signing changes addon bytes before the inventory binding/outer seal is refreshed. Constrain remote signing requests without exposing private keys to dependency execution, and record its residual request-authority risk. Compute final digests only after all applicable transforms. Adding a newly qualified macOS/Windows signer later requires a new coordinated candidate/version; never re-sign and replace previously sealed unsigned bytes under an old candidate.

Initial mechanism qualification covers the complete, refusal and short scenarios of SPEC-001-041 on their assigned cells. Each candidate still verifies all admitted native cells and retained supported-baseline paths, final digests/authenticity, native runtime, schema admission/refusal and provenance. Repeat affected adversarial campaigns when mechanism/policy/key/storage inputs change. Human observations remain genuine and scoped to their actual artifact/criteria; any reuse requires explicit compatible inputs and invalidation rules, never fabricated exact-artifact acceptance. Initial foundation assistive/newcomer checks stay in 017; 019/020 add the affected real signed-user-route checks. Retry transient tests/transfers against the same sealed bytes while retaining both results; rebuilding/re-signing/changing frozen inputs requires a new candidate/version. Retention/retirement must manage growing supported baselines instead of silently dropping them.

### SPEC-001-029: macOS publisher signing and distribution qualification

STORY-001-019 enables real macOS distribution after the common foundation. Consume V17's integrated common/native-build and Linux-delivery result, the R37 release flow from STORY-001-037 it verifies and the per-target capability contract in SPEC-001-028. Provider enrollment, local design and ephemeral callback fixtures may proceed earlier; integration uses the actual delivered common contracts. Neither STORY-001-022 to STORY-001-037, story 017 nor Windows story 020 waits for this output. Required native scope is Apple Silicon on macOS 26 and 27, APFS and WindowServer; optional Intel or universal output requires its own independent native slices/evidence before inclusion.

With separately authorized maintainer facilities, verify actual Apple Developer Program activation, legal publisher/team identity, Developer ID Application certificate and private-key custody, notarization authentication and permitted CI access. Do not assume enrollment, ad-hoc signing or a past certificate establishes NF. Prefer a protected Actions-compatible signing capability and temporary native facilities over recurring laptop signing or a permanent rented Mac. Confirm exact credential lifetimes, renewal/cost, backup/recovery, provider failure and maintainer-absence routes before enabling authority; secrets stay out of Git, PRs and logs. Never weaken Gatekeeper, sandboxing or entitlements globally to pass qualification.

Extend the shared core with constrained real nested/helper/addon signing, minimum justified entitlements/hardened runtime, the existing inventory-binding refresh and outer app seal, notarization, stapling and final DMG plus ZIP creation, in the macOS job of `prepare-release.yml` and `publish-release.yml`, where signing happens during packaging.[^release-redesign] Inspect the pinned `tooling/quality-package.mjs` hooks and builder behavior; preserve build-to-final transformation provenance and compute separate final digests after every transform. Verify the intended Developer ID/team and complete signatures, not merely a successful command. Keep real-signed internal scaffolding in the unpublished release, visible only to people with write access.

On clean isolated native accounts, exercise graphical first install from the exact final DMG, quarantine/Gatekeeper and online/offline stapling acceptance, launch/sandbox/addon/storage identity, then installation of the next version's signed DMG over a supported compatible baseline after the application's update notice sends the user to the official download page; macOS has no in-application update and no update catalog.[^release-redesign] Test same-candidate continuation/reinstall, wrong CPU or signing identity, unexpected publisher or digest mismatch, revoked or expired credentials, incompatible or newer schema, denied access, full disk, network/notary loss and interruption at nested-sign/notary/staple/install boundaries. Preserve stable-profile sentinels and controlled recovery; no database downgrade or unsafe mutation replay. Record actual operator and tools for affected keyboard/screen-reader/signature/authorization/error/recovery observations; unchanged common foundation evidence may be reused only with its explicit compatibility scope.

Qualify the protected-environment signing and publication allow/deny/readback for this platform in its own job, including changed workflow/policy/source/input and arbitrary signing requests. Add final artifact/license/notices/source and ADR-0000 versioned applicability/control evidence with actual native/external positive/negative cases. M19 identifies exact source/workflow/run/attempt/DMG/ZIP and native results on both OS families, plus the admitted capability and rejected unauthorized cases. Verify that `prepare-release.yml` and `publish-release.yml` keep macOS packages recorded as unsigned under the fixed testing-only heading while that evidence is absent and record them as signed with the new qualified capability without bypassing other gates. A new version/candidate is required for newly signed final bytes. Complete a private exact-byte candidate/publication/retry/withdrawal rehearsal and affected final human checks; do not publish a public scaffold to demonstrate success.

STORY-001-019 phase prerequisites: integrate requires V17 from STORY-001-017; integrate requires PA from Policy authority; complete requires NF from Native facilities; complete requires NH from Native hosts; complete requires RA from Release authority; complete requires UR from UI review facilities. All facilities and evidence are scoped to macOS and the actual affected native user route, with the full registry release conditions. Missing real facilities block M19 and macOS distribution, not the delivered common/Linux foundations or independent Windows work.

### SPEC-001-030: Windows publisher signing and distribution qualification

STORY-001-020 enables real Windows distribution after the common foundation. Consume V17's integrated common/native-build and Linux-delivery result, its verified R37 release flow from STORY-001-037 and the capability contract in SPEC-001-028. Enrollment/eligibility research, local design and ephemeral callback fixtures may proceed earlier; integration uses actual delivered common contracts. Neither STORY-001-022 to STORY-001-037, story 017 nor macOS story 019 waits for this output. Required native scope is Windows 11 x86-64 on NTFS and an ordinary graphical desktop; optional Windows ARM64 needs independent native evidence. Windows Server builds, WSL, ARM Windows emulation or cross-compilation do not qualify the Windows 11 x86-64 user route.

Select and separately authorize an actual eligible publisher-signing facility before credentials or spending. Confirm individual/legal-name and jurisdiction eligibility, Windows-trusted code-signing chain, key protection/custody, constrained Actions-compatible callback/API, timestamp service, cost/renewal/recovery and any per-release human approval. No particular provider is preselected. A self-signed certificate, the Linux OpenPGP key or a service that admits organizations but not the maintainer's legal circumstances is insufficient. A foundation-supplied certificate may name a different publisher and impose existing-release/manual-approval conditions; explicitly review those before relying on it. No paid account or public scaffold release is implied by this issue.

Use the common core to sign the application and relevant nested Ohtia binaries, the NSIS-generated uninstaller during construction and the final per-user offline NSIS installer with constrained Authenticode and trusted timestamps, in the Windows job of `prepare-release.yml` and `publish-release.yml`, where signing happens during packaging.[^release-redesign] Inspect the pinned builder callbacks and license/source rules for bundled upstream binaries; do not re-sign prohibited upstream content. Build on admitted Actions facilities without exposing private signing keys to dependency/PR execution. Verify actual certificate chain, intended publisher, timestamp and final signed bytes through native Windows trust, retaining build-to-final provenance. Signing does not promise warning-free SmartScreen reputation. Compute final digests only after all transforms, and keep real-signed internal qualification bytes in the unpublished release, visible only to people with write access.

On clean isolated ordinary Windows 11 x86-64 accounts, test exact-installer first installation, native publisher/authorization prompts, offline-installed startup and installation of the next version's signed installer over a supported compatible baseline after the application's update notice sends the user to the official download page; Windows has no in-application update and no update catalog.[^release-redesign] Preserve per-user scope, sandbox and research isolation; no global antivirus/UAC/policy weakening or per-machine-installer substitution. Exercise same-candidate continuation/reinstall, wrong CPU/key/publisher/digest, incompatible/newer schema, revoked/expired credentials, locked files, denied privilege/access, restart-required/cancelled restart, full disk, network loss and interruption of signing/install/uninstall. Record the actual native user token/session and stable sentinels and controlled refusal/recovery; no database downgrade or automatic mutation replay. Qualify the facility's Windows license entitlement and virtual hardware where applicable before running guests.

Observe real allow/deny/readback of the protected environment and the selected signing facility for workflow/policy/source/input-bound signing and distribution requests, including arbitrary callback attempts. Supply final package/helper/license/notices/source inventories and versioned ADR-0000 applicability/control IDs with native/external positive/negative evidence. W20 identifies the exact source/workflow/run/attempt/package/certificate/timestamp and native results, rejected unauthorized cases and admitted Windows capability. Test that `prepare-release.yml` and `publish-release.yml` keep Windows packages recorded as unsigned under the fixed testing-only heading without that evidence and record them as signed with the newly qualified capability without bypassing other target gates. Newly signed bytes require a new version/candidate. Complete private exact-byte candidate/publication/retry/withdrawal rehearsal plus genuine affected keyboard/screen-reader/publisher/error/recovery observations; common evidence reuse must have an explicit compatible scope. No public scaffold release is a test requirement.

STORY-001-020 phase prerequisites: integrate requires V17 from STORY-001-017; integrate requires PA from Policy authority; complete requires NF from Native facilities; complete requires NH from Native hosts; complete requires RA from Release authority; complete requires UR from UI review facilities. All facilities and evidence are scoped to Windows and its actual affected native user route, with the full registry release conditions. Missing real facilities block W20 and Windows distribution, not the delivered common/Linux foundations or independent macOS work.

### SPEC-001-031: KDE Plasma desktop qualification

STORY-001-021 makes KDE Plasma 6 on Wayland a required Linux desktop with the same standing as GNOME, on every supported Linux distribution and CPU. KDE adds native cells, not packages: each KDE cell consumes the same sealed package as its GNOME counterpart under SPEC-001-028 and the package grouping in [ADR-0038](../../adr/adr-0038-desktop-delivery-mechanisms.md#packages-and-tools). A missing or failing KDE cell blocks the same results as a missing or failing GNOME cell. Recurring KDE cells become required in the same pull request that first passes them; there is no period in which they may fail without effect.[^kde-desktop]

Before this story, GNOME is implicit. A cell is `(target, profile, backend)` with no desktop dimension in [desktop_probes.py](../../../scripts/desktop_probes.py) and [delivery_admission.py](../../../scripts/delivery_admission.py), and the session launchers, the native focus helper and the admission checks are fixed to GNOME and to Fedora Workstation. Add a required `desktop` dimension, with values `gnome` and `kde`, to Linux cells in [targets.json](../../../config/desktop/targets.json), `desktop_contract.py`, `desktop_probes.py`, `delivery_admission.py` and the evidence schemas. Each Linux distribution profile lists both desktops. Twelve required Linux cells result: three distributions, two CPUs and two desktops, all on Wayland. Required native records across all platforms rise from nine to fifteen; the recurring matrix rises from eight to twelve cells and from ten to fourteen package results, with the same six hosted runner labels.[^kde-desktop]

"KDE" means each distribution's official identity and packages, without GNOME: Fedora KDE, Ubuntu with its `kubuntu-desktop` metapackage, and Debian with its KDE task. GitHub provides no desktop or Kubuntu runner image: hosted Ubuntu KDE cells install `kubuntu-desktop` on the `ubuntu-26.04` and `ubuntu-26.04-arm` images, as hosted GNOME cells install `gnome-shell` and `gnome-session` today. Only Plasma 6 qualifies. Plasma moves within a distribution release, so evidence records the observed Plasma version and the contract does not pin it. Fedora and Debian ARM64 KDE cells follow [TD-001](../../technical-debt.md#td-001--fedora-and-debian-arm64-guests-in-recurring-ci): paid, approved, ephemeral guests in qualification and in each candidate, outside recurring CI. Plasma 5, Kubuntu 24.04, X11 sessions, other desktops, `safeStorage` and KWallet, physical graphics qualification and lifting TD-001 are outside this block.[^kde-desktop]

Cell identifiers name the cell, not where it runs, and the display backend leaves the identifier because [ADR-0042](../../adr/adr-0042-wayland-only-linux-support.md) makes Wayland the only Linux backend. Every native cell identifier on every platform follows `<target>-<profile>`, followed by `-<desktop>` on Linux. `<target>` is the target identifier in the target manifest, built from the Node.js and Electron platform name (`linux`, `win32` or `darwin`) and the CPU (`x64` or `arm64`). `<profile>` is the operating-system profile with dots replaced by hyphens, such as `ubuntu-26-04`, `windows-11` or `macos-26`. `<desktop>` is `gnome` or `kde`. The same identifier is used in recurring CI, KVM guests, Scaleway guests, evidence and delivery admission, whose `cell_specs` keys already follow this rule for Windows and macOS and replace the Linux `-wayland` suffix with the desktop. A recurring cell whose profile is not a distribution profile keeps that profile in its identifier: the hosted Windows x64 cell runs Windows Server 2025, so its identifier `win32-x64-windows-server-2025` stays distinct from the Windows 11 admission cell `win32-x64-windows-11`, which Windows Server does not qualify. The display backend remains a recorded field with the single value `wayland`.[^kde-desktop]

| Previous identifier          | Cell identifier                  | Runs in                |
| ---------------------------- | -------------------------------- | ---------------------- |
| `ubuntu-26-04-x64-wayland`   | `linux-x64-ubuntu-26-04-gnome`   | Hosted CI              |
| `ubuntu-26-04-arm64-wayland` | `linux-arm64-ubuntu-26-04-gnome` | Hosted CI              |
| `fedora-44-x64-vm`           | `linux-x64-fedora-44-gnome`      | KVM guest in CI        |
| `debian-13-x64-vm`           | `linux-x64-debian-13-gnome`      | KVM guest in CI        |
| `fedora-44-arm64-scaleway`   | `linux-arm64-fedora-44-gnome`    | Scaleway guest, manual |
| `debian-13-arm64-scaleway`   | `linux-arm64-debian-13-gnome`    | Scaleway guest, manual |
| None                         | `linux-x64-ubuntu-26-04-kde`     | Hosted CI              |
| None                         | `linux-arm64-ubuntu-26-04-kde`   | Hosted CI              |
| None                         | `linux-x64-fedora-44-kde`        | KVM guest in CI        |
| None                         | `linux-x64-debian-13-kde`        | KVM guest in CI        |
| None                         | `linux-arm64-fedora-44-kde`      | Scaleway guest, manual |
| None                         | `linux-arm64-debian-13-kde`      | Scaleway guest, manual |
| `windows-x64`                | `win32-x64-windows-server-2025`  | Hosted CI              |
| `windows-arm64`              | `win32-arm64-windows-11`         | Hosted CI              |
| `macos-26-arm64`             | `darwin-arm64-macos-26`          | Hosted CI              |
| `macos-27-arm64`             | `darwin-arm64-macos-27`          | Hosted CI              |

Recurring jobs are named `native (<cell identifier>)` and their artifacts `quality-<cell identifier>-<run>-<attempt>`. The full-suite job follows the same `<target>-<profile>` rule and is named `full-suite (linux-x64-ubuntu-26-04)`, without a desktop because it runs no desktop session: its tests are desktop-independent and its Linux E2E runs in the immutable container with its own virtual display. It is not duplicated per desktop; desktop-specific behavior is covered by the native cells. The required status check stays `ci`, and [ruleset-main.json](../../../config/github/ruleset-main.json) does not change. Because identifiers no longer end in `-vm` or `-wayland`, `.github/workflows/ci.yml` stops dispatching on suffixes: each cell in [build-targets.json](../../../config/quality/build-targets.json) and each workflow matrix entry declares `launcher` as `display-session` (hosted Linux in a private session through `quality_display.py`), `kvm` (`quality_vm.py`) or `workspace` (Windows and macOS through `quality:build`). The VM acceleration step runs when `launcher` is `kvm`. A test requires the workflow matrix `id`, `runner` and `launcher` values to equal `build-targets.json` exactly. Apply the identifiers and the full-suite job name to `build-targets.json`, [ci-verification.json](../../../config/github/ci-verification.json), the workflow, `test_github_pr.py`, `test_linux_e2e_image_ci.py`, `cell()` in `scaleway_cycle.py`, the Linux keys in `cell_specs` and their tests, and update the package lists in [linux-contributor.json](../../../config/desktop/linux-contributor.json), the virtual-machine configuration in [virtual-machines.json](../../../config/quality/virtual-machines.json), `SAFE_PROGRAMS` in `scaleway_cycle.py` and the cell count in `quality_delivery.py`. Retained evidence from earlier runs keeps the names it was recorded with; documents that describe current cells use the new identifiers.[^kde-desktop]

`/etc/os-release` identifies the desktop only on Fedora, so desktop identity combines several observations:

| Distribution | `os-release`                                   | Package that proves the desktop       | Observed Plasma              |
| ------------ | ---------------------------------------------- | ------------------------------------- | ---------------------------- |
| Fedora 44    | `ID=fedora`, `VERSION_ID=44`, `VARIANT_ID=kde` | `fedora-release-identity-kde-desktop` | 6.8.2 (Fedora 44 repository) |
| Ubuntu 26.04 | `ID=ubuntu`, `VERSION_ID=26.04`, no variant    | `kubuntu-desktop`                     | 6.6.6 (Kubuntu 26.04.1 ISO)  |
| Debian 13    | `ID=debian`, `VERSION_ID=13`, no variant       | `task-kde-desktop`                    | 6.3.6 (13.7 ISO)             |

A KDE cell passes admission only when the distribution identity and its package in that table are present, `gnome-shell` is not installed, `XDG_CURRENT_DESKTOP=KDE`, `XDG_SESSION_TYPE=wayland` and `KDE_SESSION_VERSION=6` hold, and the Wayland peer that serves the application is `kwin_wayland`, observed from the process itself; [quality_native.py](../../../scripts/quality_native.py) observes a Wayland peer today without identifying the compositor. A GNOME cell applies the inverse checks and keeps `VARIANT_ID=workstation` on Fedora. Debian 13 ships `kwin-x11` in its KDE live image, so an X11 session is possible there and must be rejected rather than reported as a pass. Replace the fixed checks in `linux_contributor.py`, `quality_native.py` and `installation_native.py` with this desktop-specific admission, and update `test_desktop_probes.py`, which rejects `fedora-kde` today.[^kde-desktop]

One Plasma session launcher, [plasma_session.py](../../../scripts/plasma_session.py), replaces the GNOME-only branches in `quality_display.py`, `linux_contributor.py`, `scaleway_guest.py` and `tooling/quality-packaging/guest-run.py`. It runs on a private D-Bus session bus, from `dbus-run-session` or the contributor route's own bus, and refuses a bus that already has a KWin. It starts `kwin_wayland --virtual --no-lockscreen --no-global-shortcuts` with a short owner-only runtime directory, the fixed socket name `wayland-ohtia` and `--width 1280 --height 720` as its own child process, so the caller keeps supervising, cancelling and cleaning up the command it runs in the session, as the GNOME launchers do. Before starting KWin, it runs `dbus-update-activation-environment` on the private bus with explicit values for `XDG_RUNTIME_DIR`, `WAYLAND_DISPLAY` (`wayland-ohtia`), `XDG_CURRENT_DESKTOP`, `XDG_SESSION_TYPE`, `KDE_SESSION_VERSION` and `QT_QPA_PLATFORM`, and fails the cell if that command fails; KWin itself does not receive `WAYLAND_DISPLAY`. KWin activates `xdg-desktop-portal` as it starts, and the portal chooses its backends from `XDG_CURRENT_DESKTOP` in its own environment, so only an update that precedes KWin makes the portal use `xdg-desktop-portal-kde` and its bus-activated backends start with the session's runtime directory and display. Ready means the Wayland socket exists, `org.kde.KWin` and `org.kde.plasmashell` have owners on the private bus, checked with `NameHasOwner`, `StartServiceByName` for `org.freedesktop.impl.portal.desktop.kde` succeeds, and the owner of `org.freedesktop.portal.Desktop`, started with `StartServiceByName` and identified with `GetConnectionUnixProcessID`, has `XDG_CURRENT_DESKTOP=KDE` and the session's runtime directory in its own environment; a listing that includes activatable names does not count. Failure to become ready within 60 seconds fails the cell, and KWin alone without `plasmashell` does not qualify. After the command, the session fails if `plasmashell` or KWin exited during it. Teardown stops `plasmashell` and then KWin, each as a whole process group even after its leader exited, and fails if any member of either group remains. It then releases the document portal mount and stops every remaining process of the account whose own readable environment carries the session's runtime directory as `XDG_RUNTIME_DIR`, such as bus-activated services that outlive the session, except the bus daemon, identified with `GetConnectionUnixProcessID` before KWin starts, and the launcher and its ancestors, each bound to its start time. It signals through a process handle whose start time it checked after opening it, so a reused process identifier is never signalled, and fails if any such process remains. Because this marker selects processes, the launcher refuses the account's `/run/user/<uid>` and refuses to start when another process, other than the bus daemon and the launcher's ancestors, already carries the runtime directory; a caller may pass the session runtime in its own `XDG_RUNTIME_DIR`, as the contributor and Scaleway routes do. A process whose environment cannot be read, because it rewrote its environment area as Chromium does or is not dumpable, is outside this cleanup and remains the caller's to supervise. The launcher exports the `kwin_wayland` process identifier as `OHTIA_NATIVE_COMPOSITOR_PID`, through the mechanism `scaleway_guest.py` and `quality_display.py` already use for `gnome-shell`. Every environment allowlist keeps `KDE_SESSION_VERSION`, and evidence records the desktop environment Chromium effectively observes.[^kde-desktop]

KDE cells install no GNOME packages and no recommended or weak dependencies. The hosted workflow dependency step, the KVM guest configuration in [quality_vm.py](../../../scripts/quality_vm.py) and the Scaleway guest preparation become specific to each desktop. Each KDE cell installs its distribution's official KDE set:

- Ubuntu 26.04: `kubuntu-desktop` with `--no-install-recommends`.
- Debian 13: `task-kde-desktop` with `--no-install-recommends`.
- Fedora 44: `fedora-release-identity-kde-desktop` with `--allowerasing`, and the `kde-desktop` group with `install_weak_deps=False`.

It adds explicitly `at-spi2-core`, `xdg-utils`, `xdg-desktop-portal-kde`, `xsettingsd`, the Breeze GTK theme (`breeze-gtk-theme` on Ubuntu and Debian, `breeze-gtk-gtk3` on Fedora) and the Plasma GTK settings module (`kde-config-gtk-style` on Ubuntu and Debian, `kde-gtk-config` on Fedora), so GTK, and therefore Electron's native theme path on KDE, follows Plasma's settings. It also installs every package of the same distribution's GNOME list except `gnome-shell` and `gnome-session`, which keeps GTK 3 and the existing runtime libraries. The display manager that the official set installs, SDDM on Ubuntu and Debian and `plasma-login-manager` on Fedora, is not used: the session launcher starts KWin itself, and evidence records that no display-manager process runs.[^kde-desktop]

Add `scripts/quality_kwin_focus.py`, the KDE counterpart of `quality_wayland_input.py`; it activates a window through a KWin script instead of compositor keyboard input. It takes the application's main process identifier as its only argument, a positive decimal integer. It writes a script to the private runtime directory that selects, from `workspace.windowList()`, the normal windows whose `pid` equals that identifier, and sets `workspace.activeWindow` to the first one in that list that is not active. It loads the script with `org.kde.kwin.Scripting.loadScript`, runs it with `org.kde.kwin.Script.run` on `/Scripting/Script<id>`, then unloads it with `unloadScript` and deletes the file, also when a step fails. It applies the same owned-session guard as the GNOME helper: unprivileged, `XDG_SESSION_TYPE=wayland`, `XDG_CURRENT_DESKTOP=KDE`, `KDE_SESSION_VERSION=6`, a set `XDG_RUNTIME_DIR`, and `org.kde.KWin` owned on the session bus by the process in `OHTIA_NATIVE_COMPOSITOR_PID`, checked with `GetConnectionUnixProcessID`. It refuses an ordinary desktop before importing `gi` or opening a bus, and its refusals are bounded messages without tracebacks. [command-native-focus.mjs](../../../tooling/command-native-focus.mjs) selects the helper by `XDG_CURRENT_DESKTOP`, keeps its limit of three attempts and records `headless KWin script activation` as the strategy on KDE; the GNOME helper and its strategy do not change. Script completion alone never qualifies activation; the final check that the window has actual OS focus remains mandatory on both desktops.[^kde-desktop]

Read-only inspection and isolated runs established these facts; they guide the implementation and are not qualification evidence:

- `kubuntu-desktop`, `kwin-wayland` and `plasma-workspace` are published for amd64 and arm64 on Ubuntu 26.04, and `task-kde-desktop`, `kwin-wayland` and `plasma-workspace` likewise on Debian 13. Kubuntu's [26.04 release directory](https://cdimage.ubuntu.com/kubuntu/releases/26.04/release/) lists no ARM64 desktop image, so its ARM64 cell uses the official packages on the hosted image. Fedora publishes `fedora-release-identity-kde-desktop` for aarch64. Scaleway guests keep their provider images and install the official KDE packages, as `quality_vm.py` and `scaleway_qualification.py` install the Workstation identity today.
- On Fedora 44 x86-64 with Plasma 6.8.2, in an isolated home and on a private bus, `kwin_wayland --virtual` started `plasmashell --no-respawn` and both took their bus names in under a second without a physical display. The same run has not been done on Kubuntu or Debian, nor on ARM64.
- In that isolated session, a script loaded through `org.kde.kwin.Scripting.loadScript` and run through `org.kde.kwin.Script.run` set `workspace.activeWindow` to a GTK 3 Wayland window selected by process identifier from `workspace.windowList()`. The window that had lost focus to a later window reported itself active again, and the other reported itself inactive.
- Without an activation environment update, every portal backend started by D-Bus activation failed: `xdg-desktop-portal-kde` aborted with signal 6 and `xdg-desktop-portal-gtk` reported `cannot open display`, and the session did not end when its command exited. After a `dbus-update-activation-environment` call ran before `plasmashell`, `xdg-desktop-portal-kde` started and the session ended within 0.1 seconds of its command ending. When the private bus started before the session's runtime directory existed, every bus-activated portal backend aborted with `XDG_RUNTIME_DIR is invalid or not set` until `XDG_RUNTIME_DIR` was added to that call; the launcher then became ready and ran its command in about 6 seconds.
- On Ubuntu 26.04 x86-64 with Plasma 6.6.6, when that call ran after KWin started, KWin had already activated `xdg-desktop-portal`, which logged that it chose the GTK backend as a last-resort fallback for every interface, including `Settings`; `org.freedesktop.portal.Settings.ReadOne` for `org.freedesktop.appearance` `color-scheme` returned 0 from that backend. With the same values set before KWin started, it returned 2 from `xdg-desktop-portal-kde`. After each session, a bus-activated `plasma_waitforname org.kde.KSplash` carrying the session's runtime directory remained for about a minute.
- [`base/nix/xdg_util.cc`](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/base/nix/xdg_util.cc) on Chromium's main branch reports KDE 4 when `XDG_CURRENT_DESKTOP=KDE` and `KDE_SESSION_VERSION` is not `5` or `6`. The allowlists in `quality_native.py`, `desktop_probes.py` and `tooling/desktop-launch.mjs` drop that variable today, so a KDE cell would run with the wrong desktop environment.
- `command-native-focus.mjs`, used by the workspace, settings, shortcut and command journeys, calls `quality_wayland_input.py` whenever `OHTIA_NATIVE_COMPOSITOR_PID` is set. That helper uses `org.gnome.Mutter.RemoteDesktop` and refuses any desktop other than GNOME.
- The Electron 45.0.0 linux-x64 archive contains no `libqt*_shim.so`, so its native theme path on KDE cannot use Qt and relies on GTK. The linux-arm64 archive is confirmed during implementation.
- GitHub's `ubuntu-26.04` image 20261026.180.1 and `ubuntu-26.04-arm` image 20261026.168.1 list no GNOME, KDE, Plasma, compositor or display-manager package; among display packages they list only `xvfb` and `dbus`. GitHub documents 14 GB of SSD storage for both public Linux runners.
- Simulated installations in the official `ubuntu:26.04` (26.04.1), `debian:13` (13.7) and `fedora:44` container images, which start nearly empty and so overstate the increase on a runner or cloud image, gave these totals:

  | Distribution and set                         | With recommended or weak | Without               |
  | -------------------------------------------- | ------------------------ | --------------------- |
  | Ubuntu, `kubuntu-desktop`                    | 2044 packages, 4781 MB   | 981 packages, 1692 MB |
  | Debian, `task-kde-desktop`                   | 2040 packages, 5723 MB   | 880 packages, 1804 MB |
  | Fedora, `kde-desktop` group and KDE identity | 1307 packages, 4 GiB     | 990 packages, 3 GiB   |

- Recommended dependencies add `libreoffice-core`, `firefox`, `snapd`, `cups` and `network-manager` on Ubuntu, and `libreoffice-core`, `firefox-esr`, `gimp` and `orca` on Debian. Without them, Ubuntu omits `at-spi2-core`, `breeze-gtk-theme`, `kde-config-gtk-style` and `xdg-utils`; Debian also omits `xdg-desktop-portal-kde` and `xsettingsd`; and Fedora without weak dependencies omits `breeze-gtk-gtk3` and `xsettingsd`. `gnome-shell` is absent in every simulated set. Debian installs `xserver-xorg-core` even without recommended packages and `kwin-x11` only with them.
- `kubuntu-desktop` and `task-kde-desktop` depend on SDDM, and Fedora's `kde-desktop` group installs `plasma-login-manager`. SDDM's Ubuntu maintainer script enables its service for the next boot and does not start it; the hosted runner does not reboot, and KVM guests run with `-no-reboot`.
- The kernel limit of 108 bytes on a Unix socket path applies to `XDG_RUNTIME_DIR` plus the socket name; a long private runtime path makes `kwin_wayland` fail at startup.
- `BASIC2-A8C-32G` is [listed at €0.1378 per hour](https://www.scaleway.com/en/pricing/virtual-instances-pricing/). With the one-hour lease in [scaleway.json](../../../config/installation/scaleway.json), each extra ARM64 cell attempt costs about €0.14 plus its block storage, and cells run one at a time.

Each KDE cell receives the same evidence as its GNOME counterpart, through the same procedures. The native foundation procedure in [native-qualification.md](../../native-qualification.md) is adapted to the Plasma session, and its 29 cases run once on each of the six KDE cells in an independent native KVM guest with official KDE packages and a virtual software display, under its independent-profile rule, for 174 new assessments recorded in the [native foundation report](../../native-foundation-report.md). These runs are not part of recurring CI or of the Scaleway workflow. The four recurring KDE cells run package results and the `runtime`, `storage`, `diagnostics` and `startup` suites declared as `SUITES` in [quality_delivery.py](../../../scripts/quality_delivery.py). The [Scaleway qualification workflow](../../scaleway-qualification.md) extends to the Fedora and Debian ARM64 KDE cells; it runs unsigned packaged suites and establishes no signing, installation authority or update behavior, which belong to STORY-001-022 to STORY-001-037, the replacements of STORY-001-013. The contributor route of [linux-contribution.md](../../linux-contribution.md), with `doctor`, private session, test run and package, runs on the three x86-64 KDE distributions and on hosted Ubuntu ARM64. Each KDE cell records observed distribution, kernel, filesystem, security policy, Plasma version, compositor process, focus strategy and Chromium desktop environment; Fedora uses Btrfs and enforcing SELinux, and Ubuntu and Debian use ext4 and AppArmor. The storage and time limits in `scaleway.json`, the KVM host's 10 GiB free-space check and the guests' 16 GiB root disk in `quality_vm.py`, and the hosted runner's disk are observed to be enough for KDE or raised with measured values, and recurring KDE job durations stay within the job timeout. Ordinary profiles are not admissible as qualification evidence, and automated evidence uses only synthetic fixtures.[^kde-desktop]

Automated evidence qualifies the KDE cells; no human check is required, as for the GNOME cells. The maintainer may optionally install the quality package on their own Fedora 44 KDE x86-64 desktop and check window operations, a second launch, a theme change, clipboard and persistence after restart. That observation is not qualification evidence and not an acceptance criterion; it is recorded separately with the observed Plasma version, and a defect it finds gets its own issue.[^kde-desktop]

The story updates the bodies of the issues for STORY-001-013, STORY-001-015, STORY-001-016 and STORY-001-017 so their Linux scope names the twelve cells and every cell uses the new identifiers, and the bodies of the EPIC-002 native interface and title-bar issues ([#52](https://github.com/ohtia/ohtia/issues/52), [#55](https://github.com/ohtia/ohtia/issues/55)) so they include KDE, as SPEC-002-022 already covers each desktop environment in the native inventory. If the locked Electron cannot draw title bar overlay controls on a qualified KDE environment, #55 reports a blocker, and any fallback requires an amendment to [ADR-0039](../../adr/adr-0039-integrated-window-title-bar.md). Documentation adds a new ADR for the desktop as a required qualification dimension and the cell identifier format, with the rejected optional-desktop alternative, and adds it to the ADR register. Every document under `docs/` and every root guidance file that names a cell identifier, a CI job name or a Linux desktop assumption limited to GNOME is updated to the twelve Linux cells, both desktops and the new names. This includes [ADR-0020](../../adr/adr-0020-github-policy-and-trusted-ci.md), whose matrix and documentation-only rule name the full-suite job, [ADR-0038](../../adr/adr-0038-desktop-delivery-mechanisms.md), [ADR-0042](../../adr/adr-0042-wayland-only-linux-support.md), [ADR-0044](../../adr/adr-0044-linux-graphics-compatibility.md), the [ADR register](../../adr/index.md), [desktop-foundation-contract.md](../../desktop-foundation-contract.md), [desktop-runtime.md](../../desktop-runtime.md), [linux-contribution.md](../../linux-contribution.md), [native-foundation-report.md](../../native-foundation-report.md), [native-qualification.md](../../native-qualification.md), [quality-builds.md](../../quality-builds.md), [repository-policy.md](../../repository-policy.md), [scaleway-qualification.md](../../scaleway-qualification.md), [technical-debt.md](../../technical-debt.md), whose TD-001 names four omitted ARM64 guest cells (Fedora and Debian, on GNOME and KDE), and the [bundle index](../../index.md) and directory indexes whose descriptions change. Two kinds of text keep the previous names: retained evidence records, which keep the names they were recorded with, and the previous-identifier column of this block's identifier table. Changed documents keep the repository's frontmatter and index rules. The contract notes that [Kubuntu 26.04 has shorter vendor support](https://www.theregister.com/a/5288531), to April 2029, than Ubuntu 26.04; the KDE cell's end of support follows the existing retirement procedure. A document that carries a human `verified` declaration and changes in meaning follows the repository's verification rule: the implementer reports what changed in each one to the maintainer, who decides whether to reconfirm it.

STORY-001-021 phase prerequisites: integrate requires B12 from STORY-001-012; integrate requires U9 from STORY-001-009; integrate requires D1b from STORY-001-018; integrate requires PA from Policy authority; complete requires NH from Native hosts. The Dependencies output registry defines each release condition and the common gate semantics; routing this block as context does not assign its owner's gates to another consumer.

### SPEC-001-032: Release redesign and replaced scope

The maintainer decided on 2026-11-12 to close STORY-001-013, STORY-001-015 and STORY-001-016 and to deliver their remaining purpose through STORY-001-022 to STORY-001-037.[^release-redesign] The earlier stories grew beyond a reviewable unit: 27 pull requests were integrated for STORY-001-013 without one accepted checkbox, most of them for a signing service that was never deployed. Their integrated work stays in the repository history; no result is claimed for them beyond what their issues record. Every new story fits one pull request with one commit. A story that cannot fit is split before implementation rather than extended.

The redesign replaces the following requirements, and each affected block states its current requirement directly. The Ed25519 signed update catalog, its key lifecycle and its refresh and expiry operations are removed, because the application no longer downloads or installs an update and nothing consumes a catalog. The installed updater that downloads and installs packages, its native DEB and RPM installation adapters and the independently authenticated graphical first-installation route are removed; the operating system installs and updates Ohtia from signed package repositories. The independently administered signing service of ADR-0041 is removed; signing runs in a protected GitHub environment. The preview channel is deferred; this EPIC has one public channel, stable, and one qualification zone, test. Permanent version reservation uses a protected Git tag. Candidate storage is a GitHub Release that stays unpublished. The sealed editorial approval chain of STORY-001-014 no longer gates the published release body; the maintainer edits the unpublished release body and publication records its digest. The complete native scenario on all twelve Linux cells is replaced by the scope in SPEC-001-041. Explicit user-invoked update checking as the only mode is replaced by a default-enabled startup check under SPEC-001-040.

These requirements stay in force: packages are built from frozen dependencies on a commit integrated in protected `main`; a published version is never reused for different bytes; publication never rebuilds or signs a package again; preparation and publication are separate manual operations run from protected `main`; pull-request jobs receive no signing or publication credential; macOS and Windows remain required targets that are ineligible for distribution until STORY-001-019 and STORY-001-020 pass; the application and its data service stay unprivileged; and no public release is made without separate maintainer authorization.

STORY-001-017, STORY-001-019 and STORY-001-020 keep their integrated-acceptance and publisher-signing scope. They consume output R37 from STORY-001-037, defined in SPEC-001-042, in place of I13, C15 and F16.

### SPEC-001-033: Removal of the Scaleway signing service

STORY-001-022 deletes the complete signing service, not only the parts that reference the workflows removed by pull request #255.[^release-redesign] Observed starting points on `main` at `398bba2`: the composite actions `.github/actions/installation-attestor` and `.github/actions/installation-signing-worker`; `tooling/installation-signer.mjs` and every `tooling/installation-signing*.mjs`; `scripts/installation_signing_image.py`, `scripts/installation_signing_metadata.py`, `scripts/installation_signing_policies.py`, `scripts/installation_signing_worker.py`, `scripts/installation_build_contract.py` and `scripts/installation_source.py`; `tools/installation-signer/`; `config/installation/signing-*.json`; the tests `tests/installation-signing*.test.ts`, `tests/installation-scaleway-signing.test.ts`, `tests/installation-authority.test.ts`, `tests/fixtures/signing-*.ts` and `scripts/tests/test_installation_signing_*.py`, `test_installation_attestor.py` and `test_installation_source.py`; and `docs/linux-signing-administration.md`. The implementer confirms each path and finds further consumers by search before deleting; a module still imported by retained code is reported, not deleted blindly.

Keep the Scaleway ARM qualification, recovery and access-preflight workflows, their scripts and `docs/scaleway-*.md`; they serve native tests, not signing. Keep `tooling/update-admission.mjs` and the `installation-*` qualification tooling only where a retained workflow or test still imports it; remove what only the signing service used. Update `config/quality/cases.json` and `config/quality/inventory.json` through their existing generators or comparators so the accounted inventory matches discovery, update `docs/index.md`, and remove links to deleted files. ADR-0041 is not deleted; it is already deprecated by ADR-0050. The story changes no installed behavior. The provider resources the maintainer created in the `ohtia-signing` Scaleway Project and the disposable test secrets are outside the repository; the story lists them for the maintainer to retire and does not touch them.

### SPEC-001-034: Decision record and policy alignment

[ADR-0050](../../adr/adr-0050-signed-linux-repositories-and-update-notices.md) records the architecture decision: Linux signing in a protected GitHub environment, distribution through signed apt and dnf repositories, a notify-only application and removal of the Ed25519 catalog.[^release-redesign] It deprecates ADR-0041. The decision record, the amendments to ADR-0038 and ADR-0049, and the alignment of `docs/release-policy.md` and `docs/change-notes.md` with SPEC-001-035, SPEC-001-036 and SPEC-001-039 are integrated together with these stories' publication, not through a story: a decision taken during preparation is written when it is taken. Implementers read ADR-0050 and the release policy on the base branch before starting; an older document that still conflicts with them is reported and corrected rather than followed.

### SPEC-001-035: Application version held in source

The application version lives only in the root `package.json`.[^release-redesign] The six workspace packages under `packages/` stay at `0.0.0`, because they are never published separately. A pull request raises the version immediately before a release is prepared; between releases `main` keeps the last prepared version. In `0.x`, a new capability or an incompatible change raises the minor number and a correction raises the patch number, as the release policy states.

Observed starting points: `scripts/quality_native.py` passes `0.0.0-dev.<run>.<attempt>` to the packager through `extraMetadata.version`; `scripts/quality_delivery.py`, `scripts/scaleway_build.py` and the contributor scripts build the same literal; `tooling/quality-package.mjs` accepts only `^0\.0\.0-dev\.`; `packages/utility/src/entry.ts` passes a fixed `release: "0.0.0"` when opening the store; About and diagnostics read `app.getVersion()`. STORY-001-023 adds one helper that reads and validates the root version as a final `major.minor.patch` without leading zeroes, makes every producer derive `<version>-dev.<run>.<attempt>` from it, relaxes the packaging check to that shape, and passes the packaged version to the data service in place of the literal. A release build passes the exact root version with no suffix. A continuous-integration package is never renamed into a release: the version is embedded in the DEB and RPM metadata and in the packaged manifest, so a release package is always built again from the same commit. Tests cover a valid version, a malformed version, the development shape for a version other than `0.0.0`, and that About shows the packaged value.

### SPEC-001-036: Prepare-release workflow

`.github/workflows/prepare-release.yml` is a manual `workflow_dispatch` workflow that runs only from protected `main` and refuses any other ref.[^release-redesign] Its one input is the optional `hash` of ADR-0049: empty selects the dispatch commit, otherwise a full lowercase commit SHA that is that commit or one of its ancestors. It has no version input; it reads the version from the root `package.json` of the selected commit using the helper of SPEC-001-035.

Its steps are, in order: resolve the commit and version once and pass them to every job, and stop if `v<version>` exists or another run created `reserved/v<version>`; build the packages of every declared platform with the exact version, reusing the build entry points of the existing `ci.yml` rather than a second builder; sign the RPM packages under SPEC-001-037; create the tag `reserved/v<version>` on the selected commit once every package is built and signed; produce a GitHub build attestation for every final package; create a GitHub Release that stays unpublished titled with the version and attach every platform's packages and a digest file listing each asset's SHA-256, length and signing state; write the first notes text under the rule below; and copy the Linux packages to the `test` zone under SPEC-001-038. STORY-001-024 delivers the workflow through the unpublished release with unsigned packages and attestations; STORY-001-025 adds signing and moves the reservation after it; STORY-001-026 adds the notes; STORY-001-029 and STORY-001-030 add the `test` zone copy.

A repository ruleset protects `reserved/v*` and `v*` tags against deletion and update; the story prepares the ruleset change as a reviewable plan and applies it only with the maintainer's authorization, then reads it back. Creating a Git reference is atomic, so two runs cannot reserve one version. A run that fails before reserving consumes nothing; a run that fails after reserving consumes the version: the correction raises the version in source. A rerun of the same run may continue only while its tag points to the same commit and no asset of the unpublished release would be replaced; otherwise it refuses.

The workflows cover Linux, macOS and Windows from the start, with one independent job per platform, so a change to one platform's job does not touch another's. Each platform declares whether its packages are signed. Linux packages are signed under SPEC-001-037. macOS and Windows packages stay unsigned until STORY-001-019 and STORY-001-020 add their signing to their own jobs; on those platforms signing happens during packaging, so their jobs may take a different shape from the Linux build-then-sign sequence. The digest file records each asset's signing state as `embedded` for a package that carries its own signature, `repository` for a DEB of a signed platform, which apt authenticates through the signed repository index, or `unsigned`. An unsigned package carries `unsigned` in its asset name, is recorded as unsigned in the digest file, and is listed in the release body under a fixed heading stating that it is for testing only and is not a distributed installer. `publish-release.yml` removes every unsigned asset and that heading before the release becomes public, so a public release holds only signed packages; unsigned packages stay available to the maintainer as artifacts of the preparation run. The build jobs run without secrets. Only the signing job and the upload job use the `release-signing` environment or a write token.

The first notes text comes from the `ohtia-note` blocks of the pull requests whose merge commits lie between the previous `v*` tag and the selected commit, or the whole history when no `v*` tag exists. STORY-001-026 collects them with the existing `collect` operation of `scripts/change_notes.py`, treats every block as inert data, groups user-impact notes by `change_id` and kind, omits `impact: none` records from the public text, and writes the result as the unpublished release body. The maintainer then edits the body directly on GitHub. The sealed `assemble`, `propose` and `approve` chain stays available but does not gate publication.

### SPEC-001-037: Linux signing identity and custody

There is one signing identity, the existing OpenPGP key held by the maintainer outside the repository.[^release-redesign] No new identity is generated. The primary certification key and its revocation certificate stay offline with the maintainer. A signing-only subkey, valid for one year and renewed annually, is exported without usable primary material and stored with its passphrase as secrets of the GitHub environment `release-signing`. The environment admits only the `main` branch and requires the maintainer's approval for every run. If the subkey is exposed, the maintainer revokes it with the primary key and provisions a new one; packages and repositories keep the same primary identity.

The public key is committed to the repository as a file, with its primary fingerprint recorded in one configuration record. The signing job checks that the imported subkey belongs to that fingerprint before use and refuses otherwise. The signing job downloads the built package from the build job, verifies its SHA-256 against the build job's digest, signs the RPM with `rpmsign`, and verifies the result with `rpm --checksig` against a key ring holding only the committed public key, rejecting unsigned, NOKEY and wrong-key results. It installs no project dependencies and runs no project code; its tools come from the runner image or pinned packages. Digests in the unpublished release are computed after signing. The DEB carries no embedded signature: apt authenticates packages through the signed repository index. The same subkey signs the apt and dnf repository indexes in SPEC-001-038.

STORY-001-025 writes the custody procedure as a Playbook under `docs/`: export of the subkey, creation of the environment and its protection rules, renewal, revocation and recovery, with the commands the maintainer runs on their own machine. The implementing agent never opens the maintainer's private key material; it uses a disposable key for tests. The maintainer creates the environment and its secrets; the story verifies the protection rules by reading them back and records a refused run from a non-`main` ref.

### SPEC-001-038: Signed Linux package repositories

Linux is distributed through three package repositories that the operating system uses to install and update Ohtia.[^release-redesign] They are hosted on Cloudflare R2 behind the maintainer's domain. The addresses put the zone first: `https://packages.ohtia.com/stable/ubuntu/`, `/stable/debian/`, `/stable/fedora/`, and the same three under `/test/`. Ubuntu and Debian are separate apt repositories because their packages differ; Fedora is a dnf repository. `stable` is the public zone. `test` is used only by qualification; it is publicly reachable but unlinked, and protecting it with credentials is deferred. Checked on 2026-11-12: R2 offers 10 GB-month of standard storage free and charges no egress; each Linux package is 120 to 132 MiB, about 760 MiB for the six packages of one version.

Each apt repository holds the `amd64` and `arm64` packages, a `Packages` index, and a `Release` file signed as `InRelease` with the subkey of SPEC-001-037. The Fedora repository holds the `x86_64` and `aarch64` packages and `repodata` whose `repomd.xml` has a detached signature. Index generation runs in the workflow from the exact packages of the unpublished release, after verifying their digests; it never rebuilds or re-signs a package. Uploads write packages first and the signed index last, so a client never sees an index naming a missing file. A failed upload leaves the previous index in place and reports the incomplete state.

STORY-001-027 makes each package register its repository on installation. The DEB installs the public key under `/usr/share/keyrings/` and a source entry under `/etc/apt/sources.list.d/` that names that key ring with `signed-by` and the `stable` address of its distribution. The RPM installs a file under `/etc/yum.repos.d/` with `gpgcheck=1`, `repo_gpgcheck=1` and the key location, and the key file. These are packaged files with fixed root-owned paths, declared under the maintainer-script rules of ADR-0038; removal of the package removes them. A qualification build may point the same files at the `test` zone through a build input that a release build cannot set.

STORY-001-029 adds the apt repositories and STORY-001-030 the dnf repository: the index builder, the copy to `test` in `prepare-release.yml` and the copy to `stable` in `publish-release.yml`. The R2 bucket, the `packages.ohtia.com` domain binding and a write credential limited to that bucket are external facilities the maintainer creates; the credential is a secret of the `release-signing` environment. The stories prepare the exact resource list for the maintainer and verify access by readback.

### SPEC-001-039: Publish-release workflow

`.github/workflows/publish-release.yml` is a separate manual `workflow_dispatch` workflow that runs only from protected `main`.[^release-redesign] Its input is the version of a prepared unpublished release. It never builds or signs a package. Its steps are, in order: find the unpublished release and the `reserved/v<version>` tag and refuse when either is missing or the release is already public; download every asset and verify it against the digest file of the unpublished release; wait for the maintainer's approval through the `release-signing` environment, whose approval page shows the version, commit and asset digests; copy the signed Linux packages to the `stable` zone and publish the signed indexes under SPEC-001-038; remove from the release every asset recorded as unsigned and the testing-only heading, leaving the digest file unchanged as the record of what was prepared; record the SHA-256 of the exact unpublished release body as a release asset; remove the unpublished state so the release becomes public and latest; and create the tag `v<version>` on the reserved commit.

A retry reconciles the actual state and continues with the same version and bytes: it finishes missing uploads and never replaces a published asset. When a step fails after a public surface changed, the workflow reports which surfaces are public and stops. STORY-001-028 delivers the workflow without the repository steps, which STORY-001-029 and STORY-001-030 add. Tests run the workflow logic against a fixture repository state: missing unpublished release, altered asset, already public release, and an interrupted run that is resumed.

### SPEC-001-040: Update check and notice in the application

The application only checks and notifies on Linux, Windows and macOS; it never downloads or installs an update in this EPIC.[^release-redesign] On startup, when the setting is enabled, the main process requests GitHub's latest-release endpoint for `ohtia/ohtia`, which returns the latest published release with its version and notes. The setting is a configuration flag enabled by default that the researcher changes in Settings; there is no first-run notice. A manual "Check for updates" command runs the same request. The request carries no research content, identifier or account, has a bounded response size and timeout taken from the numeric policy record, and runs through the trusted main process, never the renderer. A failed, slow or malformed response is silent on startup and reported only for the manual command. A development or qualification build does not check.

The result is "newer version available" only when the returned version is a final version greater than the running one under SemVer precedence. STORY-001-031 delivers the check, the setting through the existing settings boundary of EPIC-002, the port method and event that expose the result, and tests against a local server: newer, equal, older, prerelease, malformed body, oversized body, timeout and disabled setting.

STORY-001-032 delivers the interface. When a newer version is available, a small button with a download icon appears in the title bar of `WorkspaceChrome`. It uses neutral or primary tokens, never the `attention.*` tokens or `triangle-alert`, so it cannot be confused with the "new" and "needs your attention" marks of EPIC-003. It appears without popup, sound or animation, and it does not appear or change while the researcher is writing; it waits for the next moment the design system allows. The button opens a dialog showing the installed version, the new version, the release notes as inert text and how to update on the current system: on Linux, that the system updates Ohtia with its other software, with a control that opens the system software centre; on Windows and macOS, a control that opens the official download page in the browser. About shows the same state. Every text uses the typed catalogs in all supported locales, the dialog follows the single-modal and focus rules, and the exact texts and a capture are presented to the maintainer for approval before integration.

### SPEC-001-041: Native qualification of repository delivery

Qualification proves that a prepared version installs from its package and that the next version arrives through the repository with the researcher's data intact.[^release-redesign] It uses the `test` zone and two versions: the installed version A and the prepared version B. When a published version exists, A is the latest published version. For the first qualification no earlier version exists, so the harness builds A itself from the same commit with a lower version, as a qualification build registered against the `test` zone, and discards it afterwards; A is never reserved, never attached to a release and never appears in the version history. B is always a real prepared version.

The complete scenario runs on the six GNOME cells, one per package. On a clean native guest: install version A from the package file; confirm the repository entry and key are registered; start Ohtia, create the store and save a value; make version B available in the `test` zone; update through the system package manager; start Ohtia again and confirm the saved value, the running version and the sandbox and policy state required by ADR-0038 for that distribution. The refusal scenario of STORY-001-034 shows that the package manager refuses a package altered after indexing, an index with an invalid signature and, on Fedora, an RPM signed with another key, leaving version A installed and working. The short scenario runs on the six KDE cells with the same package bytes as their GNOME counterpart: install, start Ohtia and observe the update button when a newer version is published in the test fixture.

STORY-001-033 delivers the complete scenario on `linux-x64-ubuntu-26-04-gnome` and the reusable harness. STORY-001-035 extends it to the remaining x86-64 cells and STORY-001-036 to the ARM64 cells, the Fedora and Debian ones on separately authorized ephemeral Scaleway guests. Each cell records the package digest it installed; two cells that share a package must record the same digest. No result is reported for a cell without its native execution.

### SPEC-001-042: Release security inventory and output R37

STORY-001-037 delivers the security inventory for the release boundary under ADR-0000 and SPEC-001-026: requirement identifiers, applicability or exclusion reasons, the enforcing control and reproducible positive and negative evidence for the protected environment, the reserved tags, the workflows' ref admission, the signing job, the repositories and the update check.[^release-redesign] It distinguishes synthetic tests from live readback of the environment protection rules and the tag ruleset.

Output R37 is released when STORY-001-022 to STORY-001-036 are integrated, their checks pass on the base branch, the inventory is integrated, and the qualification records of SPEC-001-041 cover all twelve Linux cells. R37 replaces I13, C15 and F16 for STORY-001-017, STORY-001-019 and STORY-001-020.

### SPEC-001-043: Withdrawal of a published release

A published version that must no longer be offered is withdrawn; it is never replaced, and its version is never reused.[^release-redesign] `.github/workflows/withdraw-release.yml` is a manual `workflow_dispatch` workflow that runs only from protected `main`, takes a published version and a reason, and waits for the maintainer's approval in the `release-signing` environment. Its steps are, in order: refuse a version that is not public; regenerate and publish the signed indexes of the three `stable` repositories without that version's packages, uploading the signed index last, so new installations receive the previous version; mark the GitHub Release as a prerelease so it is no longer the latest release that the update check of SPEC-001-040 reports; and prepend a fixed heading with the reason to the release body. The tags `v<version>` and `reserved/v<version>`, the release and its assets stay, so the identity and evidence of the version are preserved.

Withdrawal does not downgrade installed systems: a package manager keeps an installed newer version. Researchers who already installed the withdrawn version receive the correction as a new, higher version, and the data store is never downgraded. A retry reconciles the actual state and continues; when a step fails after a public surface changed, the workflow reports which surfaces changed and stops. STORY-001-038 delivers the workflow and tests its logic against a fixture state: a version that is not public, the only published version, a repeated withdrawal and an interrupted run that is resumed.

## Affected components

- Desktop: Electron main/preload/renderer/utility lifecycle, native packaging, bootstrap and update notices.
- Storage: one data-service authority, a minimal durable preference, packaged binding and migration/checkpoint recovery.
- Tooling: real workspace, isolated environments, shared gates, native CI, trusted preparation/publication and notes.
- Documentation: contributor setup/troubleshooting and operator procedures with canonical owners.

## Dependencies

Local design and controlled fixtures may proceed before integration or completion evidence. A start gate, if declared, precedes executable implementation; integration gates precede integration or use of changed authority, and completion gates precede closing the complete consumer. Runtime, storage and privileged execution always obey their admission controls. Gates belong only to their named consumer. Verify the required output on the actual consumer base or external facility with passing checks; issue closure is not delivery evidence. No story waits for its consumers. Native blocked-by relationships represent every declared inter-story prerequisite, including integration and completion gates. The documented phase and output evidence determine when each dependency applies; these relationships add no start prohibition for work permitted before that phase and do not make producer closure a substitute for usable output. External prerequisites without an issue remain documented. Every future issue body includes its own complete input definitions, these semantics, ordered tasks and acceptance criteria. Include every routed SPEC block in full in the body or, when needed for size, in numbered continuation comments linked from the body. Keep each block whole and preserve a complete ordered index. Verify comment content and permalinks by readback; the issue is not complete until its body and all required comments are present and linked. Bare codes, bundle links or omitted qualifiers cannot replace the applicable text.

### Output contracts

- **D1a — STORY-001-001:** Reviewed tool selections within adopting ADR lines, declared OS and package contracts with explicit required/optional scope, provisional delivery mechanism choices, one approved numeric qualification record with units and failure outcomes, retention rules and initial setup budget. The record and host-independent metadata checks are available on the consumer base. It claims no empirical native success and does not require the complete native host matrix.
- **D1b — STORY-001-018:** Measured native feasibility records and unchanged-lock clean workspace installation and builds for the required Linux, Windows and macOS target/profile set, including actual runtime, addon and SQLite identities, sandbox, filesystem and installer or updater mechanism feasibility. A target record is usable only after its complete probes pass on the consumer base; a subset consumer needs its relevant records. The story requires the complete mandatory target/profile set declared in the target manifest; optional targets remain unqualified until their own evidence passes. It validates the onboarding budget before newcomer trials and does not replace final signing or repository qualification in STORY-001-022 to STORY-001-037.
- **W2 — STORY-001-002:** Workspace manifests, exact locks, isolated tooling and frozen install/build commands integrated and passing on the consumer base.
- **P3 — STORY-001-003:** Versioned application-port schemas, numeric message limits, error/lifecycle semantics and conformance tests integrated and passing on the consumer base.
- **R4 — STORY-001-004:** Isolated native runtime launcher/context contract, single broker and real supervised status path, fixed bootstrap primitives and minimum shared locale/accessibility surfaces; required runtime/isolation/UI checks pass on the consumer base. Automated packaged UI checks are included; manual assistive acceptance and catalog/provenance checks are owned by 017 and is not a prerequisite for closing 004.
- **S5 — STORY-001-005:** Packaged binding identity, durable round trip, migration and checkpoint-recovery implementation; real file-backed success/failure tests pass on the consumer base. The shared catalogs and automated storage UI checks pass; manual assistive acceptance and catalog/provenance checks belong to 017.
- **G6 — STORY-001-006:** Typed diagnostic catalog and bounded writer; privacy-marker, rotation and I/O failure tests pass on the consumer base.
- **Q7 — STORY-001-007:** Shared command entry points, inventory accounting and independent coverage-failure checks pass on the consumer base.
- **L8 — STORY-001-008:** Input-addressed Linux image built from its pinned recipe, and local launcher; package/image parity, non-root Electron sandbox startup and required inventory checks pass on the consumer base.
- **U9 — STORY-001-009:** Linux clean-install contribution procedure and observed setup/diagnostic/desktop/check results integrated and repeatable.
- **U10 — STORY-001-010:** Windows native clean-install contribution procedure and observed setup/diagnostic/desktop/check results integrated and repeatable.
- **U11 — STORY-001-011:** macOS clean-install contribution procedure on every declared CPU and observed setup/diagnostic/desktop/check results integrated and repeatable.
- **B12 — STORY-001-012:** Native quality artifacts and required target/run/tree/digest evidence; current integrated-source build and full required packaged smoke matrix pass.
- **I13 — STORY-001-013:** Common Actions build/sign/verify and externally qualified Linux signing/capability interfaces, actual Linux signed install/update/failure/compatibility evidence on all twelve required Linux cells, and retained native macOS/Windows build/smoke/attestation records with explicit distribution-ineligible state. It needs no 015/016 or real macOS/Windows publisher facilities; those final guarantees are M19/W20. STORY-001-022 to STORY-001-037 replace this story, and for the remaining consumers STORY-001-017, STORY-001-019 and STORY-001-020 this output is replaced by R37 from STORY-001-037.
- **K21 — STORY-001-021:** The required Linux desktop dimension, `<target>-<profile>[-<desktop>]` cell identifiers on every platform, `launcher` dispatch, desktop-specific admission, Plasma session launcher and KWin focus helper integrated and passing on the consumer base, with the recurring `ci` requiring twelve Linux cells and fourteen package results. All six KDE cells record 29 of 29 native foundation cases and pass every packaged case, the Fedora and Debian ARM64 KDE cells on approved ephemeral Scaleway guests. It provides no signed installation or update evidence; that is R37 from STORY-001-037.
- **V17 — STORY-001-017:** Integrated common-foundation/native runtime, storage, privacy, locale, genuine assistive/contributor and build/provenance evidence on the required platform matrix, with complete Linux R37 delivery/rehearsal evidence from STORY-001-037 and explicit deferred macOS/Windows signed distribution capabilities. Actual integrated-source checks and owner evidence pass; it does not certify M19/W20.
- **M19 — STORY-001-019:** Actual macOS Developer ID/hardened-runtime/notarization/stapling and final DMG/ZIP identities, private candidate/publication rehearsal and signed user-route native/security/license/affected-human evidence on macOS 26/27 ARM64; capability admission passes with real facilities.
- **W20 — STORY-001-020:** Actual Windows publisher/chain/timestamp and final Authenticode package identities, private candidate/publication rehearsal and signed user-route native/security/license/affected-human evidence on Windows 11 x86-64; capability admission passes with real facilities.
- **N14 — STORY-001-014:** Versioned note-input/assembly schema, safe editorial pipeline and passing first-release/stable/preview/correction fixtures, available on the consumer base.
- **C15 — STORY-001-015:** Protected-main workflow admission and independent authority qualified; permanent candidate identity, retained final bytes and native verification manifest available for controlled internal qualification. Missing mandatory manual assistive evidence, required catalog/provenance checks or requested platform distribution capability is rejected by public-readiness admission. Linux infrastructure readiness and the complete declared build/provenance inventory are qualified under SPEC-001-028; full-platform readiness additionally requires M19/W20. Model-generated translations without human linguistic review do not fail that gate. This output qualifies the mechanism without claiming a public-ready product before 017 supplies the actual remaining evidence. STORY-001-022 to STORY-001-037 replace this story, and for the remaining consumers STORY-001-017, STORY-001-019 and STORY-001-020 this output is replaced by R37 from STORY-001-037.
- **F16 — STORY-001-016:** Separate publication operation and controlled Linux-surface rehearsal pass for exact-byte promotion, global serialization, partial failure, retries, withdrawal and retention, with rejection of unqualified macOS/Windows distribution requests. Their actual platform extension is M19/W20; public product authorization remains separate. STORY-001-022 to STORY-001-037 replace this story, and for the remaining consumers STORY-001-017, STORY-001-019 and STORY-001-020 this output is replaced by R37 from STORY-001-037.
- **NH — Native hosts:** Available qualified native hosts/runners for the consumer's required OS and CPU runs, including independent configuration/research profiles, supported filesystem/display/sandbox/tool dependencies and permitted synthetic/public fixtures. Actual native host/executable/addon identities and successful required runs release this gate; cross-compilation/emulation or an unavailable target cannot. For D1b and common foundation runtime/contributor acceptance, supply all required native target/profile cells; Linux repository qualification under SPEC-001-041 uses every Linux cell, and 019/020 require their own native signed user routes. A subset consumer can use only its explicitly scoped passing records; missing applicable cells cannot pass.
- **NF — Native facilities:** Maintainer-provided valid signing/notarization identities and permitted services with actual required signed-package/native verification evidence for the consumer's capability scope. For 013/015/016/017 this is the real Linux RPM and repository signing identity of SPEC-001-037 and all admitted Linux profiles; Developer ID/notary facilities belong to 019, Windows publisher facilities to 020. Mock credentials or a past certificate claim do not release the affected gate; deferred platform facilities never count as delivered.
- **UR — UI review facilities:** Qualified operators and supported native assistive tools for the consumer's first-surface manual journeys, with actual artifact/OS and CPU/criterion results and any optional linguistic-review scope recorded separately. Required failed/unverified criteria cannot be certified by catalog/automation success.
- **RA — Release authority:** Maintainer-approved workflow-ref/policy/credential controls and controlled publication surfaces with actual observed deny/allow/readback, not a workflow guard certifying itself; for the release flow these are the protection rules of the `release-signing` environment and the tag ruleset under SPEC-001-036 and SPEC-001-037, and there is no independently administered signing service.[^release-redesign] The common signing boundary is produced in 013 without waiting for 015/016; 015 qualifies its candidate-specific binding and 016 its publication authority; STORY-001-022 to STORY-001-037 replace those three stories. Scope 013/015/016/017 facilities to Linux/common operation and keep the packages of an unqualified platform recorded as unsigned; 019/020 qualify their own real credential/native/publication extensions before M19/W20. No consumer waits for a facility implemented by a story that depends on it.
- **PA — Policy authority:** For selected workflow/action/token/administrative changes, maintainer authorization of the exact versioned policy plan plus successful live apply/readback precedes integration or use of the changed authority. When no live change is required, record the reviewed scope/current-policy compatibility evidence and why no administrative write is needed. Local design and fixtures may proceed; no blanket permission or unperformed live conformity is inferred.
- **NC — New contributors:** An external contributor or person unfamiliar with the setup can follow the guide from a clean native environment on each required OS/CPU target and profile, including a representative source change; consented observations and complete result records are available.
- **RF — Release facilities:** The `release-signing` GitHub environment with its `main`-only rule, required maintainer approval and signing secrets, and the Cloudflare R2 bucket bound to `packages.ohtia.com` with a bucket-limited write credential. The maintainer creates them; each is released by readback evidence named in SPEC-001-037 and SPEC-001-038.
- **R37 — STORY-001-037:** STORY-001-022 to STORY-001-036 integrated with passing checks on the consumer base, the twelve-cell repository qualification record and the release security inventory. It replaces I13, C15 and F16 for STORY-001-017, STORY-001-019 and STORY-001-020 under SPEC-001-042.
- **W38 — STORY-001-038:** The `withdraw-release.yml` workflow of SPEC-001-043 integrated with passing checks on the consumer base, so the integrated rehearsal of STORY-001-017 can withdraw a published version on controlled surfaces.
- **Outputs of STORY-001-022 to STORY-001-036:** V23 the root-version helper; D24 the prepare workflow with an unpublished release; K25 the committed public key and fingerprint record; S25 signed RPM packages in the unpublished release; N26 the notes text in the unpublished release; R27 packages that register the repository; P28 the publish workflow; A29 the apt repositories, upload path and R2 access; F30 the Fedora repository; C31 the check result on the port; U32 the update notice; H33 the qualification harness; F34 the refusal scenario; X35 the harness for all three distributions; Q36 the twelve-cell record. Each is usable when its story is merged and its checks pass on the consumer base.

### Consumer prerequisites

| Producer             | Consumer      | Output | Phase     | Release condition | Projection | Spec         |
| -------------------- | ------------- | ------ | --------- | ----------------- | ---------- | ------------ |
| STORY-001-001        | STORY-001-002 | D1a    | integrate | Base+checks       | native     | SPEC-001-004 |
| STORY-001-001        | STORY-001-003 | D1a    | integrate | Base+checks       | native     | SPEC-001-005 |
| STORY-001-002        | STORY-001-003 | W2     | integrate | Base+checks       | native     | SPEC-001-005 |
| STORY-001-001        | STORY-001-004 | D1a    | integrate | Base+checks       | native     | SPEC-001-006 |
| STORY-001-002        | STORY-001-004 | W2     | integrate | Base+checks       | native     | SPEC-001-006 |
| STORY-001-003        | STORY-001-004 | P3     | integrate | Base+checks       | native     | SPEC-001-006 |
| STORY-001-018        | STORY-001-004 | D1b    | complete  | Base+checks       | native     | SPEC-001-006 |
| Native hosts         | STORY-001-004 | NH     | complete  | External evidence | documented | SPEC-001-006 |
| STORY-001-002        | STORY-001-005 | W2     | integrate | Base+checks       | native     | SPEC-001-007 |
| STORY-001-003        | STORY-001-005 | P3     | integrate | Base+checks       | native     | SPEC-001-007 |
| STORY-001-018        | STORY-001-005 | D1b    | integrate | Base+checks       | native     | SPEC-001-007 |
| STORY-001-004        | STORY-001-005 | R4     | complete  | Base+checks       | native     | SPEC-001-007 |
| Native hosts         | STORY-001-005 | NH     | complete  | External evidence | documented | SPEC-001-007 |
| STORY-001-003        | STORY-001-006 | P3     | integrate | Base+checks       | native     | SPEC-001-008 |
| STORY-001-004        | STORY-001-006 | R4     | integrate | Base+checks       | native     | SPEC-001-008 |
| STORY-001-005        | STORY-001-006 | S5     | integrate | Base+checks       | native     | SPEC-001-008 |
| Native hosts         | STORY-001-006 | NH     | complete  | External evidence | documented | SPEC-001-008 |
| STORY-001-002        | STORY-001-007 | W2     | integrate | Base+checks       | native     | SPEC-001-009 |
| Policy authority     | STORY-001-007 | PA     | integrate | External evidence | documented | SPEC-001-009 |
| STORY-001-002        | STORY-001-008 | W2     | integrate | Base+checks       | native     | SPEC-001-010 |
| STORY-001-007        | STORY-001-008 | Q7     | integrate | Base+checks       | native     | SPEC-001-010 |
| STORY-001-018        | STORY-001-008 | D1b    | integrate | Base+checks       | native     | SPEC-001-010 |
| Policy authority     | STORY-001-008 | PA     | integrate | External evidence | documented | SPEC-001-010 |
| STORY-001-004        | STORY-001-008 | R4     | complete  | Base+checks       | native     | SPEC-001-010 |
| Native hosts         | STORY-001-008 | NH     | complete  | External evidence | documented | SPEC-001-010 |
| STORY-001-002        | STORY-001-009 | W2     | integrate | Base+checks       | native     | SPEC-001-012 |
| STORY-001-018        | STORY-001-009 | D1b    | integrate | Base+checks       | native     | SPEC-001-012 |
| STORY-001-004        | STORY-001-009 | R4     | complete  | Base+checks       | native     | SPEC-001-012 |
| STORY-001-005        | STORY-001-009 | S5     | complete  | Base+checks       | native     | SPEC-001-012 |
| STORY-001-007        | STORY-001-009 | Q7     | complete  | Base+checks       | native     | SPEC-001-012 |
| STORY-001-008        | STORY-001-009 | L8     | complete  | Base+checks       | native     | SPEC-001-012 |
| STORY-001-012        | STORY-001-009 | B12    | complete  | Base+checks       | native     | SPEC-001-012 |
| Native hosts         | STORY-001-009 | NH     | complete  | External evidence | documented | SPEC-001-012 |
| STORY-001-002        | STORY-001-010 | W2     | integrate | Base+checks       | native     | SPEC-001-013 |
| STORY-001-018        | STORY-001-010 | D1b    | integrate | Base+checks       | native     | SPEC-001-013 |
| STORY-001-004        | STORY-001-010 | R4     | complete  | Base+checks       | native     | SPEC-001-013 |
| STORY-001-005        | STORY-001-010 | S5     | complete  | Base+checks       | native     | SPEC-001-013 |
| STORY-001-007        | STORY-001-010 | Q7     | complete  | Base+checks       | native     | SPEC-001-013 |
| STORY-001-012        | STORY-001-010 | B12    | complete  | Base+checks       | native     | SPEC-001-013 |
| Native hosts         | STORY-001-010 | NH     | complete  | External evidence | documented | SPEC-001-013 |
| STORY-001-002        | STORY-001-011 | W2     | integrate | Base+checks       | native     | SPEC-001-014 |
| STORY-001-018        | STORY-001-011 | D1b    | integrate | Base+checks       | native     | SPEC-001-014 |
| STORY-001-004        | STORY-001-011 | R4     | complete  | Base+checks       | native     | SPEC-001-014 |
| STORY-001-005        | STORY-001-011 | S5     | complete  | Base+checks       | native     | SPEC-001-014 |
| STORY-001-007        | STORY-001-011 | Q7     | complete  | Base+checks       | native     | SPEC-001-014 |
| STORY-001-012        | STORY-001-011 | B12    | complete  | Base+checks       | native     | SPEC-001-014 |
| Native hosts         | STORY-001-011 | NH     | complete  | External evidence | documented | SPEC-001-014 |
| STORY-001-002        | STORY-001-012 | W2     | integrate | Base+checks       | native     | SPEC-001-015 |
| STORY-001-007        | STORY-001-012 | Q7     | integrate | Base+checks       | native     | SPEC-001-015 |
| STORY-001-018        | STORY-001-012 | D1b    | integrate | Base+checks       | native     | SPEC-001-015 |
| Policy authority     | STORY-001-012 | PA     | integrate | External evidence | documented | SPEC-001-015 |
| STORY-001-004        | STORY-001-012 | R4     | complete  | Base+checks       | native     | SPEC-001-015 |
| STORY-001-005        | STORY-001-012 | S5     | complete  | Base+checks       | native     | SPEC-001-015 |
| STORY-001-006        | STORY-001-012 | G6     | complete  | Base+checks       | native     | SPEC-001-015 |
| STORY-001-008        | STORY-001-012 | L8     | complete  | Base+checks       | native     | SPEC-001-015 |
| Native hosts         | STORY-001-012 | NH     | complete  | External evidence | documented | SPEC-001-015 |
| STORY-001-012        | STORY-001-013 | B12    | integrate | Base+checks       | native     | SPEC-001-016 |
| STORY-001-018        | STORY-001-013 | D1b    | integrate | Base+checks       | native     | SPEC-001-016 |
| Policy authority     | STORY-001-013 | PA     | integrate | External evidence | documented | SPEC-001-016 |
| STORY-001-021        | STORY-001-013 | K21    | complete  | Base+checks       | native     | SPEC-001-016 |
| Native facilities    | STORY-001-013 | NF     | complete  | External evidence | documented | SPEC-001-016 |
| Native hosts         | STORY-001-013 | NH     | complete  | External evidence | documented | SPEC-001-016 |
| STORY-001-012        | STORY-001-015 | B12    | integrate | Base+checks       | native     | SPEC-001-018 |
| STORY-001-013        | STORY-001-015 | I13    | integrate | Base+checks       | native     | SPEC-001-018 |
| STORY-001-014        | STORY-001-015 | N14    | integrate | Base+checks       | native     | SPEC-001-018 |
| Policy authority     | STORY-001-015 | PA     | integrate | External evidence | documented | SPEC-001-018 |
| Native facilities    | STORY-001-015 | NF     | complete  | External evidence | documented | SPEC-001-018 |
| Native hosts         | STORY-001-015 | NH     | complete  | External evidence | documented | SPEC-001-018 |
| Release authority    | STORY-001-015 | RA     | complete  | External evidence | documented | SPEC-001-018 |
| STORY-001-013        | STORY-001-016 | I13    | integrate | Base+checks       | native     | SPEC-001-019 |
| STORY-001-014        | STORY-001-016 | N14    | integrate | Base+checks       | native     | SPEC-001-019 |
| STORY-001-015        | STORY-001-016 | C15    | integrate | Base+checks       | native     | SPEC-001-019 |
| Policy authority     | STORY-001-016 | PA     | integrate | External evidence | documented | SPEC-001-019 |
| Release authority    | STORY-001-016 | RA     | complete  | External evidence | documented | SPEC-001-019 |
| STORY-001-009        | STORY-001-017 | U9     | complete  | Base+checks       | native     | SPEC-001-021 |
| STORY-001-010        | STORY-001-017 | U10    | complete  | Base+checks       | native     | SPEC-001-021 |
| STORY-001-011        | STORY-001-017 | U11    | complete  | Base+checks       | native     | SPEC-001-021 |
| STORY-001-012        | STORY-001-017 | B12    | complete  | Base+checks       | native     | SPEC-001-021 |
| STORY-001-037        | STORY-001-017 | R37    | complete  | Base+checks       | native     | SPEC-001-042 |
| STORY-001-038        | STORY-001-017 | W38    | complete  | Base+checks       | native     | SPEC-001-043 |
| STORY-001-014        | STORY-001-017 | N14    | complete  | Base+checks       | native     | SPEC-001-021 |
| STORY-001-018        | STORY-001-017 | D1b    | complete  | Base+checks       | native     | SPEC-001-021 |
| STORY-001-021        | STORY-001-017 | K21    | complete  | Base+checks       | native     | SPEC-001-021 |
| Native facilities    | STORY-001-017 | NF     | complete  | External evidence | documented | SPEC-001-021 |
| Native hosts         | STORY-001-017 | NH     | complete  | External evidence | documented | SPEC-001-021 |
| New contributors     | STORY-001-017 | NC     | complete  | External evidence | documented | SPEC-001-021 |
| Release authority    | STORY-001-017 | RA     | complete  | External evidence | documented | SPEC-001-021 |
| UI review facilities | STORY-001-017 | UR     | complete  | External evidence | documented | SPEC-001-021 |
| STORY-001-001        | STORY-001-018 | D1a    | integrate | Base+checks       | native     | SPEC-001-027 |
| STORY-001-002        | STORY-001-018 | W2     | integrate | Base+checks       | native     | SPEC-001-027 |
| Native hosts         | STORY-001-018 | NH     | complete  | External evidence | documented | SPEC-001-027 |
| STORY-001-017        | STORY-001-019 | V17    | integrate | Base+checks       | native     | SPEC-001-029 |
| Policy authority     | STORY-001-019 | PA     | integrate | External evidence | documented | SPEC-001-029 |
| Native facilities    | STORY-001-019 | NF     | complete  | External evidence | documented | SPEC-001-029 |
| Native hosts         | STORY-001-019 | NH     | complete  | External evidence | documented | SPEC-001-029 |
| Release authority    | STORY-001-019 | RA     | complete  | External evidence | documented | SPEC-001-029 |
| UI review facilities | STORY-001-019 | UR     | complete  | External evidence | documented | SPEC-001-029 |
| STORY-001-017        | STORY-001-020 | V17    | integrate | Base+checks       | native     | SPEC-001-030 |
| Policy authority     | STORY-001-020 | PA     | integrate | External evidence | documented | SPEC-001-030 |
| Native facilities    | STORY-001-020 | NF     | complete  | External evidence | documented | SPEC-001-030 |
| Native hosts         | STORY-001-020 | NH     | complete  | External evidence | documented | SPEC-001-030 |
| Release authority    | STORY-001-020 | RA     | complete  | External evidence | documented | SPEC-001-030 |
| UI review facilities | STORY-001-020 | UR     | complete  | External evidence | documented | SPEC-001-030 |
| STORY-001-009        | STORY-001-021 | U9     | integrate | Base+checks       | native     | SPEC-001-031 |
| STORY-001-012        | STORY-001-021 | B12    | integrate | Base+checks       | native     | SPEC-001-031 |
| STORY-001-018        | STORY-001-021 | D1b    | integrate | Base+checks       | native     | SPEC-001-031 |
| Policy authority     | STORY-001-021 | PA     | integrate | External evidence | documented | SPEC-001-031 |
| Native hosts         | STORY-001-021 | NH     | complete  | External evidence | documented | SPEC-001-031 |
| STORY-001-023        | STORY-001-024 | V23    | start     | Base+checks       | native     | SPEC-001-036 |
| STORY-001-024        | STORY-001-025 | D24    | start     | Base+checks       | native     | SPEC-001-036 |
| STORY-001-024        | STORY-001-026 | D24    | start     | Base+checks       | native     | SPEC-001-036 |
| STORY-001-025        | STORY-001-027 | K25    | start     | Base+checks       | native     | SPEC-001-038 |
| STORY-001-025        | STORY-001-028 | S25    | start     | Base+checks       | native     | SPEC-001-039 |
| STORY-001-026        | STORY-001-028 | N26    | start     | Base+checks       | native     | SPEC-001-039 |
| STORY-001-027        | STORY-001-029 | R27    | start     | Base+checks       | native     | SPEC-001-038 |
| STORY-001-028        | STORY-001-029 | P28    | start     | Base+checks       | native     | SPEC-001-038 |
| STORY-001-029        | STORY-001-030 | A29    | start     | Base+checks       | native     | SPEC-001-038 |
| STORY-001-023        | STORY-001-031 | V23    | start     | Base+checks       | native     | SPEC-001-040 |
| STORY-001-031        | STORY-001-032 | C31    | start     | Base+checks       | native     | SPEC-001-040 |
| STORY-001-029        | STORY-001-033 | A29    | start     | Base+checks       | native     | SPEC-001-041 |
| STORY-001-032        | STORY-001-033 | U32    | start     | Base+checks       | native     | SPEC-001-041 |
| STORY-001-033        | STORY-001-034 | H33    | start     | Base+checks       | native     | SPEC-001-041 |
| STORY-001-034        | STORY-001-035 | F34    | start     | Base+checks       | native     | SPEC-001-041 |
| STORY-001-030        | STORY-001-035 | F30    | start     | Base+checks       | native     | SPEC-001-041 |
| STORY-001-035        | STORY-001-036 | X35    | start     | Base+checks       | native     | SPEC-001-041 |
| STORY-001-036        | STORY-001-037 | Q36    | start     | Base+checks       | native     | SPEC-001-042 |
| STORY-001-030        | STORY-001-038 | F30    | start     | Base+checks       | native     | SPEC-001-043 |
| Release facilities   | STORY-001-025 | RF     | complete  | External evidence | documented | SPEC-001-037 |
| Release facilities   | STORY-001-029 | RF     | complete  | External evidence | documented | SPEC-001-038 |
| Native hosts         | STORY-001-033 | NH     | complete  | External evidence | documented | SPEC-001-041 |
| Native hosts         | STORY-001-035 | NH     | complete  | External evidence | documented | SPEC-001-041 |
| Native hosts         | STORY-001-036 | NH     | complete  | External evidence | documented | SPEC-001-041 |

Base+checks means the full named output is integrated and its required checks pass on the actual consumer base. External evidence means the output registry's observed facility or authorization conditions hold. Every internal row uses a native blocked-by relationship together with its documented phase and output gate. External rows remain documented because no corresponding issue exists. Setup owners need B12 for final package acceptance while their environment construction proceeds earlier. Refresh actual delivery and GitHub relationships before a future publication; this table is design, not live blocker state.

## Execution order

The complete internal graph is acyclic across all phases and projections: a topological order is 001, 002, 003, 018, 004, 005, 006, 007, 008, 012, 009, 010, 011, 021, 013, 014, 015, 016, 017, 019, 020. This is a proof order, not an instruction to serialize those stories. Shared verification 007 and editorial tooling 014 can start with independent local design and fixtures; any selected live CI-policy change must satisfy its conditional PA integration gate; all other stories can begin their permitted contract/design/fixture work subject to their declared execution admission controls. Runtime 004 releases real process verification; store 005 releases the durable path; gates 007 and environment 008 support native quality evidence.

Splitting D1a decisions in 001 from D1b native probes in 018 lets workspace 002 and portable contracts 003 integrate without the complete native host matrix. Probe code is built after the real workspace, preventing an issue-level cycle. A passing D1b target record can release a subset consumer; every required target/profile remains mandatory for full qualification and coordinated delivery; optional absence does not block completion. Splitting the application port 003 from runtime 004 permits independently checked privilege contracts. Keeping migration/checkpoint safety together in 005 avoids a durable-store story waiting on its own recovery consumer. Separating Linux E2E 008 from three native contributor stories 009–011 permits OS-specific work and validates that containers do not stand in for native systems. Each setup story closes its documented environment with owner-run clean-machine evidence; unfamiliar-contributor integrated acceptance belongs only to 017. These splits provide independently useful deliveries rather than one issue per file.

Quality builds 012 are unsigned evidence. Release preparation, signing, the Linux repositories, the update notice and their qualification belong to STORY-001-022 to STORY-001-037, which replace 013, 015 and 016. Notes 014 uses deterministic history fixtures and has no dependency on future releases. Preparation and publication remain separate manual operations run from protected `main`, which makes publication of the exact prepared bytes testable. Integrated verification 017 owns combined common-foundation/contribution and Linux-delivery evidence; earlier stories never wait for it. Independent platform deliveries 019/020 consume its usable V17 result and qualify real macOS/Windows signed distribution respectively; they never become return prerequisites of STORY-001-022 to STORY-001-037 or 017. Their enrollment and fixture design can proceed earlier. EPIC-002 consumes its own delivered common output contracts and does not wait for platform signing or EPIC-001 closure.

Candidate parallel work includes port, tooling-gate and note design; platform setup 009–011 after the common command contract stabilizes; and release automation fixtures while native qualification proceeds. Workspace/lockfile/build-map edits have one integrating owner (002 until integrated, then the affected story owner), IPC schemas are owned by 003, migration registry by 005, shared check inventory by 007/012, OS-specific setup sections by their respective native stories, `prepare-release.yml` and `publish-release.yml` by STORY-001-024 to STORY-001-030 in their dependency order, and platform-specific signing jobs by 019/020. Shared-file overlap requires review and current-base checks, not a fabricated dependency. Native/signing/UI-review resources are reserved explicitly; worktrees do not remove machine or merge conflicts. Each story verifies compatibility with actual delivered inputs; 017 owns final combined acceptance.

KDE Plasma qualification 021 extends the delivered native quality, Linux contribution and native foundation outputs with a second required desktop and one identifier per native cell. It consumes only closed producers, so it never waits for delivery stories; Linux repository qualification under SPEC-001-041 and integrated verification 017 need its twelve-cell result before they close, and their design and fixture work can proceed in parallel.

Likely bottlenecks are measured stack/addon/target feasibility, native machines/signing identities and maintainer-provided release facilities, followed by final native evidence. Durations are unknown. The next story does not wait for an unrelated numbered wave; no return dependency on a later research/interface increment is introduced. External facilities are enabling conditions with observable release evidence, not assumed available.

The release redesign adds STORY-001-022 to STORY-001-038 and deprecates 013, 015 and 016 as replaced under SPEC-001-032. Its graph is acyclic. STORY-001-022 and STORY-001-023 have no prerequisite. STORY-001-024 follows STORY-001-023; STORY-001-025 and STORY-001-026 follow STORY-001-024; STORY-001-027 follows STORY-001-025; STORY-001-028 follows STORY-001-025 and STORY-001-026; STORY-001-029 follows STORY-001-027 and STORY-001-028; STORY-001-030 follows STORY-001-029; STORY-001-031 follows STORY-001-023; STORY-001-032 follows STORY-001-031; STORY-001-033 follows STORY-001-029 and STORY-001-032; STORY-001-034 follows STORY-001-033; STORY-001-035 follows STORY-001-030 and STORY-001-034; STORY-001-036 follows STORY-001-035; STORY-001-037 follows STORY-001-036. Cleanup STORY-001-022 can run beside every other story. The application track STORY-001-031 and STORY-001-032 can run beside the workflow track STORY-001-024 to STORY-001-030 once STORY-001-023 is integrated; they share no module. `prepare-release.yml` is edited by STORY-001-024, STORY-001-025, STORY-001-026, STORY-001-029 and STORY-001-030 and `publish-release.yml` by STORY-001-028, STORY-001-029 and STORY-001-030, so those stories integrate in their dependency order. Integrated verification of the redesign belongs to STORY-001-037; STORY-001-017 keeps the integrated acceptance of the whole foundation. STORY-001-038 follows STORY-001-030 and is independent of the qualification chain; STORY-001-017 needs its withdrawal workflow, output W38, before it closes. The likely bottlenecks are the maintainer-provided facilities RF and the paid ARM64 guests of STORY-001-036; durations are unknown.

## Acceptance criteria

- [ ] The first development executable refuses stable or unverified profiles and preserves stable locator, store and recovery sentinels.
- [ ] All initial application messages and accessible labels use the complete 25-locale catalogs and the shared resolver.
- [ ] Automated packaged keyboard, focus, reflow, glyph and accessibility-tree checks pass for the first surfaces.
- [ ] Integrated manual assistive journeys and required catalog/provenance checks pass with actual artifact evidence. Model-generated translations do not require human linguistic review for closure.
- [ ] D1a supplies one approved numeric policy record with units and failure outcomes.
- [ ] D1b proves frozen installation, builds and native feasibility for all required native target/profile cells in the target manifest.
- [ ] STORY-001-021 qualifies KDE Plasma 6 on Wayland on all six KDE cells with the same native foundation and packaged evidence as their GNOME counterparts, and the recurring `ci` requires all twelve Linux cells.
- [ ] All required targets have native development and packaged verification evidence; 32-bit, emulation and cross-build-only results cannot substitute.
- [ ] A frozen build launches the graphical desktop and proves renderer → preload → main → data service → file-backed SQLite save and reopen.
- [ ] Invalid, spoofed or oversized messages and stale state have controlled bounded outcomes.
- [ ] Second-instance conflicts and process failures preserve one broker, responsive guidance and bounded child shutdown.
- [ ] The packaged CSP, sandbox, import boundaries and asset exclusions remain active.
- [ ] The actual loaded native binding and embedded engine identities match the artifact records.
- [ ] Every schema transition uses an exclusive migration and verified pre-migration checkpoint with successful failure and recovery tests.
- [ ] Execution limits initialize atomically to 1/1 and preserve valid saved values; invalid initialized state cannot report readiness.
- [ ] Content-free diagnostic schemas and local privacy pass real sensitive-marker tests.
- [ ] Diagnostic rotation, deletion and denied-I/O paths enforce bounded retention without content fallback.
- [ ] Every real product package meets the independent line, branch and diff coverage gates.
- [ ] All required local, CI and native result inventories are complete; missing evidence fails ci.
- [ ] Fresh native contributors on all required targets complete documented setup, diagnosis, launch, a representative change, checks and unsigned packaging within the reviewed measured conditions.
- [ ] PR, integrated-source and final signed-artifact evidence remain distinct and attributable.
- [ ] Unsigned quality artifacts cannot grant candidate or publication authority.
- [ ] STORY-001-022 to STORY-001-037 deliver the prepared and published release flow, signed Linux repositories, the update notice and repository qualification on all twelve Linux cells under SPEC-001-041; STORY-001-019 and STORY-001-020 independently deliver the remaining required macOS/Windows signed user routes before full-platform distribution readiness.
- [ ] A version is reserved once, built from the version in source, published without rebuilding or signing again, and its Linux packages are identical by digest in the unpublished release, the repositories and every cell that installed them.
- [ ] The application never downloads or installs an update; it reports a newer published version through the title-bar notice, and the startup check can be disabled in Settings.
- [ ] Non-stable runtime and update paths preserve stable-store isolation and compatible failure and recovery behavior.
- [ ] Release preparation enforces immutable source and workflow identity and reserves each version once with the protected tag `reserved/v<version>`.
- [ ] The unpublished release binds final digests, signing state and build attestations for every platform's packages, and publication records the digest of the exact published notes.
- [ ] Publication enforces global serialization and exact-byte publication of the prepared release without rebuilding or signing a package again.
- [ ] Partial publication, retry and withdrawal preserve artifact identities and the supported previous stable release.
- [ ] Retention and retirement follow the reviewed policy and preserve required support evidence.
- [ ] Public publication remains disabled without useful product readiness, complete genuine evidence and separate maintainer authorization.
- [ ] Each security-control producer supplies its ADR-0000 applicability record and observed enforcing-boundary evidence.
- [ ] Each mandatory external facility or authorization is verified before its affected guarantee is accepted.
- [ ] STORY-001-017 records common-foundation/native-contributor and Linux-delivery results and limits without requiring M19/W20; those follow-ups remain explicit EPIC obligations until their actual platform guarantees pass. No accepted defect or mandatory unknown is treated as complete.

## GitHub distribution

| Block        | Class       | Destination                                                                                       |
| ------------ | ----------- | ------------------------------------------------------------------------------------------------- |
| SPEC-001-001 | context     | DOCUMENT                                                                                          |
| SPEC-001-002 | operational | EPIC                                                                                              |
| SPEC-001-003 | operational | EPIC,STORY-001-001,STORY-001-002,STORY-001-003,STORY-001-012,STORY-001-013                        |
| SPEC-001-004 | operational | STORY-001-002,STORY-001-003,STORY-001-004,STORY-001-007                                           |
| SPEC-001-005 | operational | STORY-001-003,STORY-001-004,STORY-001-005,STORY-001-006                                           |
| SPEC-001-006 | operational | STORY-001-004,STORY-001-005,STORY-001-009,STORY-001-010,STORY-001-011                             |
| SPEC-001-007 | operational | STORY-001-005,STORY-001-012,STORY-001-013,STORY-001-017                                           |
| SPEC-001-008 | operational | STORY-001-006,STORY-001-012,STORY-001-017                                                         |
| SPEC-001-009 | operational | STORY-001-007,STORY-001-008,STORY-001-012,STORY-001-017                                           |
| SPEC-001-010 | operational | STORY-001-008,STORY-001-009,STORY-001-012                                                         |
| SPEC-001-011 | operational | STORY-001-009,STORY-001-010,STORY-001-011,STORY-001-017                                           |
| SPEC-001-012 | operational | STORY-001-009                                                                                     |
| SPEC-001-013 | operational | STORY-001-010                                                                                     |
| SPEC-001-014 | operational | STORY-001-011                                                                                     |
| SPEC-001-015 | operational | STORY-001-012,STORY-001-013,STORY-001-015,STORY-001-017,STORY-001-021                             |
| SPEC-001-016 | operational | STORY-001-013,STORY-001-015,STORY-001-016,STORY-001-017,STORY-001-019,STORY-001-020               |
| SPEC-001-017 | operational | STORY-001-014,STORY-001-015,STORY-001-016                                                         |
| SPEC-001-018 | operational | STORY-001-015,STORY-001-016,STORY-001-017                                                         |
| SPEC-001-019 | operational | STORY-001-016,STORY-001-017                                                                       |
| SPEC-001-020 | context     | DOCUMENT                                                                                          |
| SPEC-001-021 | operational | STORY-001-017,EPIC                                                                                |
| SPEC-001-022 | operational | STORY-001-001,STORY-001-003,STORY-001-004,STORY-001-005,STORY-001-017,STORY-001-018               |
| SPEC-001-023 | operational | STORY-001-004,STORY-001-005,STORY-001-006,STORY-001-009,STORY-001-010,STORY-001-011               |
| SPEC-001-024 | operational | STORY-001-003,STORY-001-004,STORY-001-005,STORY-001-007,STORY-001-017                             |
| SPEC-001-025 | operational | STORY-001-006,STORY-001-017                                                                       |
| SPEC-001-026 | operational | STORY-001-012,STORY-001-013,STORY-001-014,STORY-001-015,STORY-001-016,STORY-001-017               |
| SPEC-001-027 | operational | STORY-001-018,STORY-001-004,STORY-001-005,STORY-001-008,STORY-001-012,STORY-001-013,STORY-001-021 |
| SPEC-001-028 | operational | STORY-001-013,STORY-001-015,STORY-001-016,STORY-001-017,STORY-001-019,STORY-001-020,STORY-001-021 |
| SPEC-001-029 | operational | STORY-001-019                                                                                     |
| SPEC-001-030 | operational | STORY-001-020                                                                                     |
| SPEC-001-031 | operational | STORY-001-021                                                                                     |
| SPEC-001-032 | operational | EPIC,STORY-001-017,STORY-001-019,STORY-001-020                                                    |
| SPEC-001-033 | operational | STORY-001-022                                                                                     |
| SPEC-001-034 | operational | EPIC                                                                                              |
| SPEC-001-035 | operational | STORY-001-023                                                                                     |
| SPEC-001-036 | operational | STORY-001-024,STORY-001-025,STORY-001-026,STORY-001-029,STORY-001-030                             |
| SPEC-001-037 | operational | STORY-001-025,STORY-001-027,STORY-001-029,STORY-001-030,STORY-001-037                             |
| SPEC-001-038 | operational | STORY-001-027,STORY-001-029,STORY-001-030,STORY-001-033,STORY-001-038                             |
| SPEC-001-039 | operational | STORY-001-028,STORY-001-029,STORY-001-030                                                         |
| SPEC-001-040 | operational | STORY-001-031,STORY-001-032,STORY-001-038                                                         |
| SPEC-001-041 | operational | STORY-001-033,STORY-001-034,STORY-001-035,STORY-001-036                                           |
| SPEC-001-042 | operational | STORY-001-037,STORY-001-017,STORY-001-019,STORY-001-020                                           |
| SPEC-001-043 | operational | STORY-001-038,STORY-001-017                                                                       |

## Source attribution

[^roadmap]: Defines the public foundation scope, declared required/optional target inventory, contributor walkthrough and later capability boundaries; planning is not implementation evidence.

[^phased-delivery]: Approves Linux-first completion of the four delivery/integration stories, native macOS/Windows builds and GitHub attestations now, and two independent stories for their real signed distribution.

[^artifact-cell-contract]: Defines separate final-package and native-cell inventories, shared session package identity, digest-bound evidence and rejection of mixed-package qualification.

[^kde-desktop]: Approves KDE Plasma 6 as a required Linux desktop with GNOME parity, official distribution identities, immediately required recurring cells, one `<target>-<profile>[-<desktop>]` identifier per native cell on every platform without the display backend, KWin script focus activation and an optional maintainer observation.

[^release-policy]: Defines channel readiness, quality and candidate separation, permanent versions, note review, publication authority and retention.

[^issue-7]: Defines the approved release-policy problem and acceptance that require full build and release infrastructure here.

[^architecture]: Defines the process authority, application port, fixed locator, runtime readiness and storage admission boundaries.

[^frontend]: Defines local graphical composition, responsive error handling and renderer privilege separation.

[^product]: Defines researcher authorship, human confirmation, provenance and local-first product principles cited by PRIN identifier.

[^decisions]: Registers the adopting decisions that own technology lines and require reviewed changes for incompatible selections.

[^contribution]: Requires issue-first implementation, isolated worktrees, English documentation, applicable checks and code review before signed commits.

[^storage]: Defines file-backed SQLite authority and verification of the effective packaged engine rather than a host CLI.

[^migrations]: Defines trusted binding loading, repositories, exclusive immutable migrations and compatibility admission.

[^recovery]: Requires verified whole-database checkpoints before migration and consistent recovery without failed journals.

[^bootstrap]: Defines the fixed version-1 locator, 64 KiB limit, graphical storage selection and typed presentation preferences.

[^diagnostics]: Defines the content-free event catalog, broker-owned JSONL writer, bounded retention and prohibited private content.

[^quality]: Defines shared local and CI gates, independent coverage dimensions and failure on missing required results.

[^tests]: Defines Vitest and real desktop Playwright inventories and their evidence boundaries.

[^linux-e2e]: Defines the immutable Linux x86-64 test image and active non-root sandbox; other native cells require separate evidence.

[^ci]: Defines trusted workflow provenance, protected-source admission and independently enforced privileged authority.

[^security-baseline]: Defines versioned security applicability and evidence at the actual enforcing control, including justified exclusions.

[^artifacts]: Defines final transformed artifact identities, permanent versions and exact-byte promotion without rebuilding.

[^roadmap-issue]: Defines the public roadmap scope and original target inventory; the current target manifest defines the required/optional scope.

[^roadmap-pr]: Integrates the public roadmap and architecture references through PR #10.

[^entity-identifiers]: Defines trusted UUIDv7 allocation, canonical text conversion and enforced binary entity identity.

[^execution-limits]: Defines atomic 1/1 concurrency defaults, valid persisted limits and controlled admission of invalid state.

[^localization]: Defines the 25 supported locales, typed catalogs, ordered system-language resolution and explicit-choice handling.

[^accessibility]: Defines WCAG 2.2 AA, selected AAA criteria and honest native manual assistive evidence for applicable journeys.

[^fonts]: Defines packaged Plex and Noto resources, licenses and readable multilingual glyph coverage.

[^adr-0001]: Component and dependency boundaries are governed by the named adopting ADR; its contract applies to the delivery using this boundary.

[^adr-0002]: TypeScript and local application port are governed by the named adopting ADR; its contract applies to the delivery using this boundary.

[^adr-0003]: Electron privilege and process boundaries are governed by the named adopting ADR; its contract applies to the delivery using this boundary.

[^adr-0004]: JavaScript toolchain ownership are governed by the named adopting ADR; its contract applies to the delivery using this boundary.

[^adr-0005]: Isolated repository Python tools are governed by the named adopting ADR; its contract applies to the delivery using this boundary.

[^adr-0014]: Packaged rendering and CSP are governed by the named adopting ADR; its contract applies to the delivery using this boundary.

[^real-boundaries]: Integration evidence at actual boundaries are governed by the named adopting ADR; its contract applies to the delivery using this boundary.

[^adr-0022]: Local React and Vite renderer are governed by the named adopting ADR; its contract applies to the delivery using this boundary.

[^release-redesign]: Maintainer decisions on release, Linux repositories and update notice for EPIC-001, conversation of 2026-11-12.
