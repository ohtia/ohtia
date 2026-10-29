---
type: EPIC
title: "EPIC-001 — Desktop foundation"
description: "Deliver a safe runnable desktop, reproducible native contribution environments and verified immutable build/release infrastructure."
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
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
---

# EPIC-001 — Desktop foundation

## Description

A new contributor on Linux, Windows or macOS can build, run, diagnose, test and package the actual local application through a documented reproducible path. The foundation includes safe process and storage boundaries and the complete quality-build, signed-candidate and release-promotion infrastructure required by the integrated release policy and issue #7; it does not advertise a complete research product or authorize a public release.[^roadmap][^release-policy][^issue-7]

## Functional and technical specification

### SPEC-001-001: Purpose and public planning context

Ohtia needs a safe, reproducible desktop foundation before contributors can build research workflows on it. This EPIC delivers a minimal graphical application with a supervised local data service, a durable operation, verified process/storage boundaries, native contributor environments and the complete quality-build and release infrastructure. A new contributor must be able to prepare a clean machine, launch the application, make a representative change, run its checks and produce a package without undocumented debugging or maintainer secrets.[^roadmap]

The public [Product roadmap](../../product-roadmap.md#epic-001--desktop-application-foundation) defines the planning context and this foundation's boundaries. Its [desktop target baseline](../../product-roadmap.md#desktop-systems-and-processor-architectures) requires Linux on x86-64 and ARM64, Windows on x86-64 and macOS on Apple Silicon from the first runnable delivery. Windows ARM64 and Apple Intel are optional extensions; they require their own complete native evidence before inclusion, and their absence does not block the required foundation.[^roadmap][^roadmap-issue][^roadmap-pr]

The runnable result includes Electron main/preload/utility and React/Vite targets, a single trusted broker, versioned validated IPC, fixed account-native data-location bootstrap and atomic publication, minimal typed preference persistence and execution-limit initialization, compatible SQLite loading, exclusive transactional migrations and verified checkpoint recovery before the first schema transition. Required checks exercise the actual renderer → preload → main → data-service path, restrictive packaged CSP, invalid/spoofed/oversized messages, service failures and exclusion of development fixtures and privileged renderer imports.[^architecture][^roadmap]

The same foundation includes maintained contributor setup, common local/CI checks, immutable Linux E2E preparation supplemented by native ARM64 evidence, target-specific packaging, signing and notarization, updates, trusted candidate preparation, explicit exact-byte promotion, release-note review and retention/failure/withdrawal procedures. The release policy owns publication readiness and authorization. Later research features extend these mechanisms with their own native journeys and compatibility fixtures; this EPIC does not require a complete research workflow to validate its foundation, and its completion does not authorize a public release.[^release-policy][^roadmap]

The basic menus and workspace, agent conversations, project onboarding, source work, academic editor and manuscript delivery remain separate product increments described in the public roadmap. They are not prerequisite return dependencies for this EPIC. The roadmap's identifiers are planning references rather than claims that implementation issues already exist; this concept and its stories define the executable foundation scope here.[^roadmap]

### SPEC-001-002: Foundation outcome and scope authority

Deliver one locally runnable and natively packageable desktop foundation, its safe minimal durable operation, and the entire build/release infrastructure. A contributor can clone a clean checkout, establish an isolated environment, launch the graphical application, verify the real local round trip, run the same required checks as CI and produce a local unsigned quality package without signing credentials, a provider account or private research. Deliver operational documentation with working commands, not speculative command names.[^roadmap][^architecture]

PRIN-002, PRIN-004–007, PRIN-010–013 and PRIN-016 govern the boundary: do not introduce agent authorship, fabricated review, hidden telemetry, unexplained failures or false platform guarantees. Product code is built from scratch. Current canonical repository documents and their adopting ADRs govern; the public roadmap and integrated canonical specifications provide scope, not authorization to copy an earlier implementation. Documentation requirements are not evidence of working software.[^product][^contribution]

Proposed decomposition and dependency projections require the owner's coverage review. Implementation-level routine choices remain with story owners within their routed contracts; new public interfaces, authority boundaries and material architecture changes require reviewed decisions before producers and consumers implement them. Qualifying OS-version, distribution, package and mechanism details within the declared required/optional target inventory is the explicit contract deliverable of STORY-001-001, empirically qualified by STORY-001-018, not a claim that they are already approved. Missing credentials, native facilities or external controls keep the corresponding acceptance gate open.[^decisions]

Neither completing this EPIC nor merging a story authorizes public publication. A coherent usable research journey is required before the first stable release; preview carries the same mandatory engineering and data-protection gates. Infrastructure qualification uses isolated synthetic/public fixtures and controlled publication surfaces, with actual signed native probes where required. Product epics extend this infrastructure with real feature journeys and compatibility fixtures. Public publication remains disabled until its actual readiness evidence and separately identified maintainer authorization exist.[^release-policy]

Publication projection: keep the operational tasks, acceptance criteria, quality checks and complete consumer input contracts in the issue body. If the full projection exceeds the conservative local size budget, place whole applicable SPEC blocks in numbered continuation comments and link each comment from an ordered index in the body. This projection preserves the complete scope and standalone implementation handoff. Retain every routed block verbatim across the issue and its comments; never truncate or use a repository link as a substitute. Publication must read back every body, comment and permalink and repair an incomplete projection before treating the issue as published. Do not split a cohesive story solely to fit one body.

### SPEC-001-003: Qualify target, tooling and delivery contracts

STORY-001-001 owns D1a: reviewed tool selections, the fixed target contract and one numeric policy record. Start with the adopting ADRs, release policy and actual repository configuration. Fix the required targets: Linux x86-64 and ARM64, Windows x86-64, and Apple Silicon on macOS 26 and 27. Windows ARM64 and Apple Intel are optional; an included optional target requires its own complete native evidence and cannot be qualified by emulation or another CPU slice. Maintain all six declared OS/CPU candidates; 32-bit x86 and ARM are excluded. Review OS versions, Linux libc and display constraints, local filesystems, hardware assumptions, native dependencies, package formats, upgrade baselines and testing facilities. Record architecture aliases x64/amd64 and arm64/aarch64. Distinguish contributor environments, quality artifacts and public distribution without removing a required cell. A universal macOS package needs separate native evidence for both slices.[^roadmap][^decisions][^release-policy]

Select exact candidate patches within the version lines owned by the adopting ADRs for TypeScript, Electron, developer Node, pnpm, React and React DOM, Vite, typed ESLint, Prettier, Vitest, Playwright, SQLite, better-sqlite3, Kysely, Python, uv, Ruff and Pyrefly. Inspect current primary upstream metadata and published native artifacts during implementation; document compatibility assumptions and rejected alternatives. Version lines stay in their ADRs; exact resolutions and digests belong in locks and manifests. An incompatible or unavailable selection requires reviewed correction of its adopting decision. Host tools or peer metadata alone cannot establish native compatibility.[^decisions]

Evaluate a small set of installer, signing, notarization and updater mechanisms against the complete matrix, exact-byte promotion, interruption, schema admission, authenticity, version ordering and license obligations. Record reviewed provisional choices and the empirical checks that can reject them. D1a also defines bounded CI artifact retention and supported-release retirement rules. No successful native installation, signature or update is claimed from this decision record: native feasibility is D1b in STORY-001-018, and final signed installation and update qualification remains STORY-001-013.

Publish one reviewed numeric record of finite positive byte, count, time, pending-request and initial-operation bounds, including startup, shutdown and process-tree budgets. State units, encoded-byte measurement, permitted ranges, failure outcomes, owners and rationale. STORY-001-003 implements those values in wire schemas and decoders; it cannot select a competing limit set. Changes require reviewed updates to the record and affected conformance fixtures. Set the initial contributor setup acceptance budget using explicit hardware, cache and network assumptions and available setup measurements; STORY-001-018 validates it empirically before formal newcomer trials. Measure cold downloads separately from active work. One machine cannot justify a universal duration promise.

D1a is usable when these reviewed selections and numeric contracts are available on the consumer base and host-independent metadata checks pass. Its acceptance does not require the complete native host matrix or an executable probe. Workspace 002 and portable IPC 003 can therefore integrate before native qualification. Missing empirical compatibility evidence stays assigned to D1b, never reported as successful. A failed native probe requires correction of the affected contract and consumers before the corresponding native delivery; it cannot silently narrow the matrix or change a version line.

| Operating system | x86-64          | ARM64                   |
| ---------------- | --------------- | ----------------------- |
| Linux            | Required        | Required                |
| Windows          | Required        | Optional                |
| macOS            | Optional, Intel | Required, Apple Silicon |

Every coordinated native qualification or distribution delivery enumerates every required cell and any optional cell actually included; a missing mandatory native result fails that delivery. Recurring quality CI uses the separately selected matrix in [ADR-0020](../../adr/adr-0020-github-policy-and-trusted-ci.md#recurring-hosted-quality-matrix), with explicit coverage and technical-debt boundaries rather than claiming untested distribution profiles. Cross-compilation, emulation or x86-64 execution on ARM does not qualify a native cell.[^roadmap]

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

Before the first development or test launch, implement and enforce SPEC-001-023's independent native-profile/VM isolation and its stable-store exclusion checks. STORY-001-004 owns that launcher/admission contract along with the minimum shared locale service and accessible initial window/bootstrap messages in SPEC-001-024. It closes against a real supervised status path and pending fixed-root initialization without requiring the future storage service to create a store. Storage admission, saved-locale readback and recovery-specific text are completed by STORY-001-005 using the same contracts; they are not returning prerequisites for runtime 004.

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

STORY-001-005 admits only the isolated native configuration/store context established by SPEC-001-023; a valid stable locator is not an acceptable development fixture. Use the initial shared locale service/catalog contract from SPEC-001-024 for open, create, compatibility and recovery outcomes rather than hardcoded text or a second resolver.

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

Provide the ADR-0019 Linux x86-64 E2E image pinned by version and digest and paired to the selected Playwright package/browser versions. Prepare reviewed OS/Electron dependencies in the image rather than resolving arbitrary APT state in each shard. Add a parity check and a local reproduction entry. Developer/build Node and Electron's runtime remain separate identified environments.[^linux-e2e]

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

PR jobs receive no signing and notarization/publication credentials and cannot promote their output into trusted execution. Every development/CI executable is isolated from stable data and neither publishes nor consumes public update feeds. Use a separately qualified native profile/VM when exact final bytes require it; installing a second executable or setting a channel name alone does not isolate the fixed bootstrap location.[^release-policy]

A main push validates the actual integrated source and records its distinct identity; synthetic PR merge evidence cannot substitute. Fail on missing, unreadable, cancelled or failing required targets/partitions and keep all results attributable. Optional later nightly suites supplement required gates; no clock/issue/merge event publishes automatically. Record bounded CI artifact retention, cleanup and retrieval limitations without deleting sole supported-release copies.

The required recurring quality-build matrix follows [ADR-0020](../../adr/adr-0020-github-policy-and-trusted-ci.md#recurring-hosted-quality-matrix) and [the quality-build inventory](../../../config/quality/build-targets.json): hosted Ubuntu 24.04 and 26.04 on x64 and ARM64, hosted Windows Server x64 and Windows 11 ARM64, and hosted macOS 26 and 27 on Apple Silicon. Every selected cell and package format is mandatory. Windows Server does not qualify Windows 11 x64 distribution; Ubuntu jobs separately exercise X11 and GNOME/Wayland on both versions and CPUs. Native Fedora 44 and Debian 13 x64 guests exercise GNOME/Wayland on KVM with their own vendor kernels and declared filesystems/policies; their ARM64 guest CI extension is retained in technical debt. The distribution target manifest and complete final-candidate qualification remain separate. Record the actual host/image, executable/addon architecture and packaged evidence in each result; missing or emulated-only required evidence fails the coordinated quality gate. Native ARM64 runs supplement the pinned Linux x86-64 E2E environment without claiming its parity.

STORY-001-012 owns compatibility of the expanded CI inventory with scripts/github_pr.py, scripts/github_policy.py and their existing tests. Exercise multiple required native jobs, absent/extra/skipped jobs, wrong head/base/tested tree and stale workflow/policy identities against the trusted verifier. Keep its pull_request admission strict; a push-to-main run cannot pass the pre-merge PR check. Main quality builds retain their separate integrated-source provenance. Extend the reviewed verifier/tests only where the chosen inventory/provenance design requires it; one primary provenance step does not justify missing per-target checkout evidence.

STORY-001-012 phase prerequisites: integrate requires W2 from STORY-001-002; integrate requires Q7 from STORY-001-007; integrate requires D1b from STORY-001-018; integrate requires PA from Policy authority; complete requires R4 from STORY-001-004; complete requires S5 from STORY-001-005; complete requires G6 from STORY-001-006; complete requires L8 from STORY-001-008; complete requires NH from Native hosts. The Dependencies output registry defines each release condition and the common gate semantics; routing this block as context does not assign its owner's gates to another consumer.

### SPEC-001-016: Final signatures, installation and authenticated updates

Implement the D1a-selected and D1b-qualified installer, signing, notarization and update mechanisms for every declared target, including Linux. Review exact dependency pins, bundled licenses/notices/source obligations and policy permission/allowlist changes. Qualify required external signing identities and native testing facilities explicitly; an absent provider, platform service or certificate cannot be replaced by a synthetic check and called signed installation evidence.[^release-policy][^artifacts]

Complete every package/sign/notarize/staple or other transformation before identifying final digests. Verify signatures/authenticity/integrity and install/launch those exact resulting bytes on the real target. Record source, locks, embedded runtime/binding/SQLite, target, package, schema/queued-work compatibility and native evidence. Do not require users to install Node, Python, Docker or terminal tooling. Test fixtures can exercise a minimal foundation release internally; qualification is not permission to advertise research capability.

Implement updater admission for authenticity, digest, OS and CPU/package, compatible schemas and any delivered queued-work state; future task schemas extend the same admission boundary before use. Qualify development/preview/stable ordering, prerelease uniqueness and explicit preview opt-in without an Ohtia account. No public feed is consumed by development builds. External maintainer-controlled distribution metadata determines channel eligibility, allowing exact final-version bytes to be validated in an independent native profile/VM and promoted later. Do not add a compiled channel name or redirect the fixed bootstrap path to simulate isolation.

Native scenarios include first installation, supported baseline upgrade, interrupted download/install/activation, corrupted/mismatched package, bad signature, wrong target, incompatible/newer schema, safe refusal and a claimed compatible executable rollback. Database downgrade is never automatic; pre-migration recovery remains ADR-0010. Preview/stable channel changes cannot silently open or migrate a stable store. STORY-001-013 can close with manually initiated signed qualification artifacts and a controlled update endpoint before candidate automation exists, avoiding a dependency cycle with its consumers.

Installer/signature/notarization/update qualification covers all required native targets in the target manifest. Use actual native execution for each and verify per-target addon/runtime/package identity, cross-architecture rejection and compatible upgrades on that architecture. A universal macOS artifact may serve two target records only with independent native verification of both slices. Optional provider-runtime availability does not narrow the core desktop support matrix.[^roadmap]

STORY-001-013 phase prerequisites: integrate requires B12 from STORY-001-012; integrate requires D1b from STORY-001-018; integrate requires PA from Policy authority; complete requires NF from Native facilities; complete requires NH from Native hosts. The Dependencies output registry defines each release condition and the common gate semantics; routing this block as context does not assign its owner's gates to another consumer.

### SPEC-001-017: Safe note capture and editorial assembly

Capture in every PR whether installed users are affected. Relevant proposed notes identify the task, observable result, platforms, availability, compatibility/action requirements and issue/PR evidence; no public effect requires a reason. Classify capability, improvement, correction, deprecation/removal or security change. Several implementation issues can describe one user capability; internal refactoring/routine dependency changes without user effects do not require public bullets.[^release-policy]

Build reviewed note-input parsing and source-difference reconciliation as data processing, never interpolation of PR text into shell, evaluation of PR helpers or selection of privileged policy by untrusted content. For stable, reconcile included PRs since the preceding stable; first stable reviews all delivered scope. Stable notes include changes already offered only in preview. Preview uses the preceding preview of the same intended stable or the complete scope when absent, explicitly naming the baseline. Retain unfinished-scope note inputs without announcing unavailable features.

Provide an editorial preview with concise task-oriented summary/improvements/corrections, prominent upgrade/compatibility actions and separate technical links. Detect omitted consequences and unsupported benefit/performance claims. Preserve migration/reinstall, removed support, format/adapter incompatibilities, consequential privacy/transfers, security urgency and known limitations. Canonical public GitHub release prose is English; later translated presentations preserve the meaning rather than maintaining another independently authored history. An application/website display is not introduced as a premature product screen here.

Bind approved note content/digest, baseline, channel and approval to immutable candidate annotations separately from package identity. Edits invalidate prior note approval. Exact-byte preview-to-stable promotion can attach a newly reviewed stable note and replace the canonical release body under the same application version with explicit authorization, retaining the preview note evidence. Public prose corrections retain before/after bytes/digests, reason and maintainer approval outside edit history; they never conceal changed packages. STORY-001-014 supplies deterministic source/note fixtures without depending on a future candidate or publication story.

STORY-001-014 can deliver safe note schemas, capture templates and editorial assembly using existing repository standard-library tooling and deterministic history fixtures. It need not wait for candidate/publication automation or the future workspace. If implementation chooses a new dependency or CI/policy change, add the actual prerequisite and compatibility checks before integrating that choice rather than assuming those outputs already exist. PR text always remains inert data.

### SPEC-001-018: Trusted candidate preparation and permanent version identity

Implement candidate preparation as a manually invoked workflow_dispatch operation distinct from publication. Both definitions execute only from protected main; reject another selected workflow branch/tag. Record immutable workflow-definition revision independently from application source. Qualify workflow-ref admission, trusted verification-policy selection and signing/publication credential binding through controls the dispatched definition cannot change; a guard/credential rule declared only inside that definition cannot certify its own authority. STORY-001-015 owns the review and qualification of those external controls with the maintainer, preserving the repository baseline and surfacing unavailable facilities before privileged enablement.[^release-policy][^ci]

A maintainer selects an exact reviewed application commit already integrated through protected-main PR/required-check rules and a reserved version. Resolve mutable names once and verify source admission and passed quality evidence, including actual integrated checkout/run identity. Subsequent main movement cannot change the selected candidate. Use frozen locks and identified native tools to assemble the full required matrix through qualified signing/update mechanisms; a PR artifact is not trusted input to execute.

Atomically reserve each application version at preparation admission and permanently bind it to one candidate/source/fixed input set. A rejected/failed/cancelled internal candidate consumes the version; gaps are acceptable. Serialize reservation and reject concurrent reuse. Idempotent continuation can finish the same retained preparation with fixed inputs but cannot replace an identified final package. A changed package, rebuilt replacement, re-sign or embedded version change requires a new version/candidate. Development prerelease/build-metadata identities cannot impersonate a final candidate.[^artifacts]

Retain final transformed packages, digests and complete manifest: app/component/source/locks/tools, OS and CPU/package, embedded runtime and engine, schema compatibility, licenses, workflow revision, run/attempt, required target verification and approved notes. Verify final signed bytes rather than earlier unsigned output. A failed/cancelled/incomplete/unreadable target blocks readiness; do not overwrite a candidate in place. Readiness also requires usable declared scope, installation/update/recovery evidence, corrected accepted defects and accurate reviewed notes. No public preview waives a mandatory gate.

Apply coordinated SemVer to the application, separate from schema/stored formats and internal packages. At stable 1.0+ use patch compatible correction, minor compatible capability/deprecation and major public incompatibility; during 0.x use minor new/deprecated/incompatible and patch compatible corrections/refinements. Always disclose incompatibility and migration action. A supported migration alone is not a breaking change; unsupported downgrade must be explained. A prerelease cannot become stable by renaming a download: prepare a new final-version candidate unless the original exact bytes already carried the intended stable version. Example versions in policy are illustrative, not an assigned first release.

Test wrong workflow ref/source admission, candidate-controlled verifier replacement, missing evidence, altered digest/notes, simultaneous reservations, cancellation, rejected version reuse and interrupted same-candidate continuation. Observe effective external deny/allow and credential boundaries; synthetic tests alone cannot release the RA gate. Keep public publication disabled independently of successful internal candidate preparation.

Candidate admission and readiness require the complete required target/profile set in the target manifest. Optional Windows ARM64 or Apple Intel artifacts may be included only with their own complete native evidence. Bind native evidence and target/package digests to every cell; an incomplete required build, an emulated ARM64 run or a universal package verified on only one CPU cannot qualify. Package-format grouping must not hide a missing native target. Later product features extend the same inventory rather than reclassifying ARM64 as future work.[^roadmap]

STORY-001-015 closes the candidate preparation mechanism using controlled internal candidates, actual native and signing evidence and positive and negative admission fixtures. It verifies rejection of missing mandatory manual assistive evidence or required catalog/provenance checks; it does not claim a public-ready candidate before 017 supplies that evidence. An internal qualification record remains ineligible for public promotion. Story 016 can qualify its controlled publication mechanism with synthetic approval fixtures, while real public readiness always requires current genuine evidence and separate authorization. Story 017 is the final evidence sink and is not a prerequisite for closing 015 or 016.

STORY-001-015 phase prerequisites: integrate requires B12 from STORY-001-012; integrate requires I13 from STORY-001-013; integrate requires N14 from STORY-001-014; integrate requires PA from Policy authority; complete requires NF from Native facilities; complete requires NH from Native hosts; complete requires RA from Release authority. The Dependencies output registry defines each release condition and the common gate semantics; routing this block as context does not assign its owner's gates to another consumer.

### SPEC-001-019: Authorized publication, reconciliation and lifecycle

Provide a separate protected-main workflow_dispatch publication operation. A maintainer's authorization identifies exact candidate, version, source, required targets, approved note identity and preview/stable channel. An environment approval qualifies only if it displays and retains those exact identities; generic workflow execution, PR approval, merge, issue closure, schedule or Conventional Commit type never authorizes publication. Recheck current readiness, final digests, notes and target set immediately before exposing anything.[^release-policy]

Promote retained final packages byte-for-byte: no rebuild, dependency resolution, re-sign or embedded-version edit. Tags/releases identify the selected source/artifact set without triggering a replacement build. Serialize publication application-wide across preview/stable, versions, tags, release records, downloads and update feeds; lock the logical operation and reconcile remote state so cancelling a workflow does not lose the serialization guarantee. Preview cannot advance stable latest. Upload and verify the complete required set before public release/feed activation, preserving previous supported stable until replacement readiness.

A partial upload/feed failure or uncertain activation is incomplete, never success. Persist the visible surfaces and immutable identities, stop remaining promotion and require maintainer reconciliation where visibility is uncertain. Retry with the same candidate/version/digests to finish only missing operations; conflicting existing bytes/metadata fail closed. Exercise first publication, idempotent retry, racing channels, tag/latest collisions, cancellation and failures before/after each externally visible step on controlled test surfaces; do not publish a public scaffold release as a test.

Implement retained supported packages/manifests/approved notes/verification and their compatible update/recovery baselines, bounded temporary CI retention and explicit retirement/restore-readability procedures. Never remove the only supported release copy. Withdrawal removes recommendations/update admission while preserving identity, affected-version notice and safe next action. Versions are not reused/replaced; a corrected package needs a new version, and promotion of prior bytes requires fresh compatibility assessment/authorization. Executable rollback does not undo data migration or recover device loss.

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

STORY-001-017 owns final integrated verification, independently of earlier owners' narrower acceptance. Use the actual integrated source, frozen inputs and final packaged artifacts on all required native OS and CPU targets. Demonstrate graphical first-use initialization and admission at the fixed account-native `ohtia` root, real durable operation/restart, single broker, safe service crash/recovery, actual packaged CSP/import boundaries, binding/engine identity, migration/checkpoint outcomes, content-free bounded diagnostics and complete common-gate evidence. Preserve source/tree/workflow/run/target/digest identity and limitations rather than treating a green ci name as proof.[^architecture][^quality]

Run the documented Linux, Windows and macOS contributor paths on fresh native x86-64 and ARM64 systems, covering all required targets with a person unfamiliar with each setup, including a representative source change, environment-doctor failure/remediation/retry and local unsigned package. Record cold/active time against the agreed budget, actual OS and CPU/hardware/cache/network, manual interventions and omissions; correct documentation/automation defects and repeat affected journeys. Do not turn the fresh-person availability gate into a fabricated reviewer identity or a self-review claimed as external validation.[^roadmap]

Rehearse signed candidate preparation and publication failure/withdrawal/retry on controlled surfaces with synthetic/public data, explicit test-surface authorization and qualified external authority, preserving exact final digests through promotion. Verify non-stable native-profile/VM isolation, stable-store preservation and no public feed use by development builds. Confirm public publication remains gated without a useful research journey and specific maintainer authorization. Real public publication is not an EPIC completion condition; qualified signing/install/update and release-control evidence are.

Keep semantic acceptance, local checks, hosted CI, actual native/assistive evidence, independent code reviews, signed content identity and human integration separate. No story may claim completion with accepted defects or unresolved mandatory platform/authority evidence. The EPIC closes only when all story outputs and these combined scenarios pass; later feature journeys extend rather than retroactively replace this evidence. Record actual platform/facility gaps and leave the corresponding work open.

Integrated acceptance must independently enumerate all required target records and their native setup → launch → representative source change → checks → package walkthrough, real boundary/storage/recovery tests and applicable signed-install/update evidence. Record native host/executable/addon architecture, including independent macOS slices if universal packaging is used. Keep a required missing/failed cell open; narrowing scope is a separate reviewed decision. Recheck collaboration scenario 15's sensitive markers through foundation success/errors/stderr/traces, without claiming the later diagnostic-sharing interface exists.[^roadmap]

Integrated verification checks the first runtime isolation contract against stable-profile sentinels, complete initial locale catalogs/resolution and the actual bootstrap/recovery keyboard and assistive journeys. It consumes the security-applicability evidence produced by the core owners under SPEC-001-022, diagnostics owner under SPEC-001-025 and delivery owners under SPEC-001-026. Missing requirement-ID/applicability/evidence records are not work silently deferred to this final story; their producer must correct them before integrated acceptance.

STORY-001-017 owns the manual screen-reader and other applicable assistive journeys on every native target, plus catalog structure, contextual presentation and model-provenance checks for delivered locale messages. Record actual operators, tools, criteria, checked steps and generation provenance. Human linguistic review is optional; identify unreviewed translations without certifying fluency. Retain failed or missing mandatory results as unmet acceptance; earlier automated UI checks cannot replace the native assistive evidence.

STORY-001-017 phase prerequisites: complete requires U9 from STORY-001-009; complete requires U10 from STORY-001-010; complete requires U11 from STORY-001-011; complete requires B12 from STORY-001-012; complete requires I13 from STORY-001-013; complete requires N14 from STORY-001-014; complete requires C15 from STORY-001-015; complete requires F16 from STORY-001-016; complete requires D1b from STORY-001-018; complete requires NF from Native facilities; complete requires NH from Native hosts; complete requires NC from New contributors; complete requires RA from Release authority; complete requires UR from UI review facilities. The Dependencies output registry defines each release condition and the common gate semantics; routing this block as context does not assign its owner's gates to another consumer.

### SPEC-001-022: Security applicability and acceptance evidence

Apply ADR-0000 to this foundation's actual IPC, rendered assets, native processes, filesystem/storage, diagnostics and build/release authority. Use its ASVS L2 baseline including applicable L1, complementary web/API/LLM risk catalogs where relevant, Electron/native controls and operational recovery responsibilities. Record versioned requirement IDs, justified applicability/exclusions, implementation and reproducible evidence. Absence of a control is not an exclusion rationale; no agent/parser capability exists here to certify merely by naming the LLM catalog.[^security-baseline]

STORY-001-001 establishes the foundation applicability inventory and numeric controls alongside D1a. STORY-001-018 extends that inventory with actual native-probe isolation, runtime and filesystem evidence under D1b. Contract/runtime/storage owners extend it with actual positive/negative boundary tests; STORY-001-017 reconciles the complete final evidence. Diagnostics evidence is produced by STORY-001-006 under SPEC-001-025. Delivery/notes/signing/candidate/publication owners produce their own applicable ADR-0000 evidence under SPEC-001-026. Each retains the same versioned baseline and final-artifact scope; STORY-001-017 checks the combined inventory rather than inventing missing owner evidence. Scanners support this evidence rather than establishing conformance. A failed or unverified mandatory requirement blocks the affected capability from being claimed ready for real research. Findings retain cause, trigger, impact and verifiable references without fabricated mappings or human approval.

Verify spoofed sender/frame, invalid/oversized messages, unexpected navigation/resources, privileged imports, native artifact replacement, incompatible schema and unsafe file/locator aliases at the enforcing boundary. Record the actual artifact/OS and applicable test identifier for each control. Security tests use synthetic/public data; never collect private research or secrets as evidence. Product principles PRIN-004–007, PRIN-011 and PRIN-013 require traceable honest coverage and privacy-preserving failures, including administrative verification limits.[^product]

### SPEC-001-023: Isolation before the first development executable

Every development/CI executable, internal candidate and preview must run with application configuration and research data independent of the stable installation. STORY-001-004 implements the first native launcher and admission checks before any renderer/broker/service launch; STORY-001-005 rechecks that context before opening a locator/store or creating a checkpoint. Contributor setup owners use that entry from their first runnable walkthrough. This control precedes packaging and cannot wait for STORY-001-012.[^release-policy]

Use a dedicated OS user profile or native VM with its own fixed Electron userData configuration root, settings/data-location.json and managed synthetic/public-data store. The isolation is environmental; neither selecting another research directory, installing a second executable, renaming a channel nor redirecting userData as a data-location change establishes it. The same final bytes can later be tested in that independent profile. A new profile may be prepared during setup, but first application launch remains blocked until the selected context is verified. An ordinary contributor needs no signing identity/provider account or stable-store copy.

The repository-owned dev/test launcher accepts only a verified isolated execution profile from the supported setup procedure. If its expected native configuration boundary cannot be established, it exits with a controlled actionable diagnostic before app/broker startup and before reading the stable locator. The service additionally rejects a test/dev store or locator outside its admitted isolated context; paths resolve native aliases and cannot turn a stable path into a permitted synthetic store. This is protection against accidental execution and bad fixtures, not a claim of defense from an equivalent-privilege OS administrator.

Place synthetic stable-configuration, locator, store and recovery sentinels in the test's separate stable-profile fixture. Verify a launch in the stable or unverified context is refused without reading/migrating/changing those files. In the admitted independent profile, run startup, store initialization, migration failure/recovery and diagnosis, checking stable sentinel digests/metadata and no stable broker/child attachment. Test symlink/native-alias escape, missing isolation metadata and interruption before launch. Keep private research, developer credentials and public update feeds out of the fixture. Verify this on all required native targets.

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

STORY-001-012 owns untrusted PR execution, action/token/checkout policy, complete target/result provenance and artifact isolation. STORY-001-013 owns trusted installer/signature/notarization/updater admission and native package integrity. STORY-001-014 owns inert parsing of untrusted PR notes, editorial content/approval integrity and no authority selected by input text. STORY-001-015 owns protected-main definition/source/policy admission, external signing controls, version reservation and final immutable manifests. STORY-001-016 owns publication authority, global serialization, complete activation, digest-preserving reconciliation/withdrawal and retained evidence. Each supplies its boundary's applicability record before acceptance; STORY-001-017 reconciles the combined record rather than creating their missing checks.

Exercise wrong workflow/event/head/base/target, stale or unreviewed policy, attempted candidate-controlled verifier replacement, secret-bearing PR contexts, malicious notes, altered signatures/digests, duplicate version/reservation races and partial/uncertain activation as applicable to the named owner. Record expected denial and the actual enforcing control, with explicit live/readback evidence for external authority. A green workflow name or a synthetic policy mock cannot establish live signing/publication enforcement. Failed/unreadable mandatory evidence blocks the affected guarantee; do not invent a CWE mapping or approval to close it.

### SPEC-001-027: Native feasibility and frozen workspace qualification

STORY-001-018 owns D1b, the measured native qualification of the D1a choices using the workspace from 002. It is a separate closable story so workspace and portable IPC never wait for the native test harness they enable. Add a real, non-shipping workspace package at the proposed path tools/desktop-probes/ under the single root pnpm lock and common command entries. This is new probe code, not an existing repository tool: its issue must exist before implementation, and all executable code, tests and build configuration follow AGENTS.md's two independent code reviews, checks and signed-commit requirements.[^contribution][^decisions]

On each required target and native profile in the [target manifest](../../../config/desktop/targets.json), perform a clean-cache frozen workspace installation and build without changing locks or requiring undocumented global tools. Exercise the actual selected native addon with the prospective packaged Electron utility runtime; record host, executable and addon architectures, runtime ABI, effective embedded Node and SQLite identity, artifact and tool digests, peer and engine constraints and native dependency availability. Validate the active renderer sandbox and constrained local resources, qualified filesystem atomic-publication primitives, and a minimal installer and updater mechanism feasibility path. Engine metadata, an in-memory database, cross-build success, emulation and a universal binary exercised on one CPU cannot substitute for native results.[^real-boundaries][^roadmap]

Before any qualification executable, manually provision and verify an independent native profile or VM with separate configuration and research roots and permitted synthetic or public fixtures. Refuse stable or unverified contexts; check stable locator, store and recovery sentinels before and after the probe. Do not read public update feeds or copy developer credentials. This owner supplies its early manual admission, without waiting for runtime 004's automated launcher, product storage, final installers or release automation. Keep the probe harness and fixtures out of shipped artifacts; later product implementations are built from scratch against the contracts rather than copied automatically from the harness.

Qualify selection feasibility here; STORY-001-013 still owns final signed, notarized installation and authenticated update evidence with actual platform facilities. D1b does not require the finished 013 pipeline or its credentials. State any mechanism assumption that only 013 can prove and refuse the later guarantee until it does. Use native observations to validate or revise the onboarding budget with review before 017's newcomer trials, separating cold downloads from active setup and recording cache, hardware and network conditions.

Release a target-specific D1b record only after that target's complete required probes and frozen installation pass on the actual consumer base. A consumer limited to a target subset may integrate against those passing records; missing other cells remain unqualified. STORY-001-018 closes only after every required profile passes and its source compatibility and limitations are reconciled. Apple Intel and Windows ARM64 are optional; Apple Silicon requires macOS 26 and 27. Optional absence does not substitute for native evidence or prevent required-scope completion. Runtime and storage can begin controlled implementation using D1a and available isolated hosts, but their complete native acceptance needs all applicable D1b records. This permits useful early work without treating an incomplete matrix as delivered.

Verification includes incompatible or unavailable addon artifacts, wrong runtime ABI or architecture, denied filesystem access, failed sandbox initialization, altered locks and accidental stable-profile execution. A failed mandatory probe leaves its target unqualified and requires correction of the owning contract and affected consumers. D1b is evidence and reviewed assumptions, not the final application, signing authority or permission to publish.

STORY-001-018 phase prerequisites: integrate requires D1a from STORY-001-001; integrate requires W2 from STORY-001-002; complete requires NH from Native hosts. The Dependencies output registry defines each release condition and the common gate semantics; routing this block as context does not assign its owner's gates to another consumer.

## Affected components

- Desktop: Electron main/preload/renderer/utility lifecycle, native packaging, bootstrap and updates.
- Storage: one data-service authority, a minimal durable preference, packaged binding and migration/checkpoint recovery.
- Tooling: real workspace, isolated environments, shared gates, native CI, trusted preparation/publication and notes.
- Documentation: contributor setup/troubleshooting and operator procedures with canonical owners.

## Dependencies

Local design and controlled fixtures may proceed before integration or completion evidence. A start gate, if declared, precedes executable implementation; integration gates precede integration or use of changed authority, and completion gates precede closing the complete consumer. Runtime, storage and privileged execution always obey their admission controls. Gates belong only to their named consumer. Verify the required output on the actual consumer base or external facility with passing checks; issue closure is not delivery evidence. No story waits for its consumers. Native blocked-by relationships represent every declared inter-story prerequisite, including integration and completion gates. The documented phase and output evidence determine when each dependency applies; these relationships add no start prohibition for work permitted before that phase and do not make producer closure a substitute for usable output. External prerequisites without an issue remain documented. Every future issue body includes its own complete input definitions, these semantics, ordered tasks and acceptance criteria. Include every routed SPEC block in full in the body or, when needed for size, in numbered continuation comments linked from the body. Keep each block whole and preserve a complete ordered index. Verify comment content and permalinks by readback; the issue is not complete until its body and all required comments are present and linked. Bare codes, bundle links or omitted qualifiers cannot replace the applicable text.

### Output contracts

- **D1a — STORY-001-001:** Reviewed tool selections within adopting ADR lines, declared OS and package contracts with explicit required/optional scope, provisional delivery mechanism choices, one approved numeric qualification record with units and failure outcomes, retention rules and initial setup budget. The record and host-independent metadata checks are available on the consumer base. It claims no empirical native success and does not require the complete native host matrix.
- **D1b — STORY-001-018:** Measured native feasibility records and unchanged-lock clean workspace installation and builds for the required Linux, Windows and macOS target/profile set, including actual runtime, addon and SQLite identities, sandbox, filesystem and installer or updater mechanism feasibility. A target record is usable only after its complete probes pass on the consumer base; a subset consumer needs its relevant records. The story requires the complete mandatory target/profile set declared in the target manifest; optional targets remain unqualified until their own evidence passes. It validates the onboarding budget before newcomer trials and does not replace final signing or update qualification in 013.
- **W2 — STORY-001-002:** Workspace manifests, exact locks, isolated tooling and frozen install/build commands integrated and passing on the consumer base.
- **P3 — STORY-001-003:** Versioned application-port schemas, numeric message limits, error/lifecycle semantics and conformance tests integrated and passing on the consumer base.
- **R4 — STORY-001-004:** Isolated native runtime launcher/context contract, single broker and real supervised status path, fixed bootstrap primitives and minimum shared locale/accessibility surfaces; required runtime/isolation/UI checks pass on the consumer base. Automated packaged UI checks are included; manual assistive acceptance and catalog/provenance checks are owned by 017 and is not a prerequisite for closing 004.
- **S5 — STORY-001-005:** Packaged binding identity, durable round trip, migration and checkpoint-recovery implementation; real file-backed success/failure tests pass on the consumer base. The shared catalogs and automated storage UI checks pass; manual assistive acceptance and catalog/provenance checks belong to 017.
- **G6 — STORY-001-006:** Typed diagnostic catalog and bounded writer; privacy-marker, rotation and I/O failure tests pass on the consumer base.
- **Q7 — STORY-001-007:** Shared command entry points, inventory accounting and independent coverage-failure checks pass on the consumer base.
- **L8 — STORY-001-008:** Digest-pinned Linux image and local launcher; package/image parity, non-root Electron sandbox startup and required inventory checks pass on the consumer base.
- **U9 — STORY-001-009:** Linux clean-install contribution procedure and observed setup/diagnostic/desktop/check results integrated and repeatable.
- **U10 — STORY-001-010:** Windows native clean-install contribution procedure and observed setup/diagnostic/desktop/check results integrated and repeatable.
- **U11 — STORY-001-011:** macOS clean-install contribution procedure on every declared CPU and observed setup/diagnostic/desktop/check results integrated and repeatable.
- **B12 — STORY-001-012:** Native quality artifacts and required target/run/tree/digest evidence; current integrated-source build and full required packaged smoke matrix pass.
- **I13 — STORY-001-013:** Selected installer/signature/notarization/updater implementations, signed qualification artifacts and actual native install/update/failure/compatibility evidence for every target.
- **N14 — STORY-001-014:** Versioned note-input/assembly schema, safe editorial pipeline and passing first-release/stable/preview/correction fixtures, available on the consumer base.
- **C15 — STORY-001-015:** Protected-main workflow admission and independent authority qualified; permanent candidate identity, retained final bytes and native verification manifest available for controlled internal qualification. Missing mandatory manual assistive evidence or required catalog/provenance checks is rejected by public-readiness admission. Model-generated translations without human linguistic review do not fail that gate. This output qualifies the mechanism without claiming a public-ready product before 017 supplies the actual remaining evidence.
- **F16 — STORY-001-016:** Separate publication operation and controlled-surface rehearsal pass for exact-byte promotion, global serialization, partial failure, retries, withdrawal and retention.
- **NH — Native hosts:** Available qualified native hosts/runners for the consumer's required OS and CPU runs, including independent configuration/research profiles, supported filesystem/display/sandbox/tool dependencies and permitted synthetic/public fixtures. Actual native host/executable/addon identities and successful required runs release this gate; cross-compilation/emulation or an unavailable target cannot. For D1b, supply all required native target/profile cells; an applicable target subset can be used earlier only after its own complete record passes.
- **NF — Native facilities:** Maintainer-provided valid signing and notarization identities and permitted platform services, with actual required signed-package/native verification evidence. Mock credentials or a past certificate claim do not release the gate.
- **UR — UI review facilities:** Qualified operators and supported native assistive tools for the consumer's first-surface manual journeys, with actual artifact/OS and CPU/criterion results and any optional linguistic-review scope recorded separately. Required failed/unverified criteria cannot be certified by catalog/automation success.
- **RA — Release authority:** Maintainer-approved independent workflow-ref/policy/credential controls and test publication surfaces with observed deny/allow evidence; real external authorization and readback, not a workflow guard certifying itself.
- **PA — Policy authority:** For selected workflow/action/token/administrative changes, maintainer authorization of the exact versioned policy plan plus successful live apply/readback precedes integration or use of the changed authority. When no live change is required, record the reviewed scope/current-policy compatibility evidence and why no administrative write is needed. Local design and fixtures may proceed; no blanket permission or unperformed live conformity is inferred.
- **NC — New contributors:** An external contributor or person unfamiliar with the setup can follow the guide from a clean native environment on each required OS/CPU target and profile, including a representative source change; consented observations and complete result records are available.

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
| STORY-001-013        | STORY-001-017 | I13    | complete  | Base+checks       | native     | SPEC-001-021 |
| STORY-001-014        | STORY-001-017 | N14    | complete  | Base+checks       | native     | SPEC-001-021 |
| STORY-001-015        | STORY-001-017 | C15    | complete  | Base+checks       | native     | SPEC-001-021 |
| STORY-001-016        | STORY-001-017 | F16    | complete  | Base+checks       | native     | SPEC-001-021 |
| STORY-001-018        | STORY-001-017 | D1b    | complete  | Base+checks       | native     | SPEC-001-021 |
| Native facilities    | STORY-001-017 | NF     | complete  | External evidence | documented | SPEC-001-021 |
| Native hosts         | STORY-001-017 | NH     | complete  | External evidence | documented | SPEC-001-021 |
| New contributors     | STORY-001-017 | NC     | complete  | External evidence | documented | SPEC-001-021 |
| Release authority    | STORY-001-017 | RA     | complete  | External evidence | documented | SPEC-001-021 |
| UI review facilities | STORY-001-017 | UR     | complete  | External evidence | documented | SPEC-001-021 |
| STORY-001-001        | STORY-001-018 | D1a    | integrate | Base+checks       | native     | SPEC-001-027 |
| STORY-001-002        | STORY-001-018 | W2     | integrate | Base+checks       | native     | SPEC-001-027 |
| Native hosts         | STORY-001-018 | NH     | complete  | External evidence | documented | SPEC-001-027 |

Base+checks means the full named output is integrated and its required checks pass on the actual consumer base. External evidence means the output registry's observed facility or authorization conditions hold. Every internal row uses a native blocked-by relationship together with its documented phase and output gate. External rows remain documented because no corresponding issue exists. Setup owners need B12 for final package acceptance while their environment construction proceeds earlier. Refresh actual delivery and GitHub relationships before a future publication; this table is design, not live blocker state.

## Execution order

The complete internal graph is acyclic across all phases and projections: a topological order is 001, 002, 003, 018, 004, 005, 006, 007, 008, 012, 009, 010, 011, 013, 014, 015, 016, 017. This is a proof order, not an instruction to serialize those stories. Shared verification 007 and editorial tooling 014 can start with independent local design and fixtures; any selected live CI-policy change must satisfy its conditional PA integration gate; all other stories can begin their permitted contract/design/fixture work subject to their declared execution admission controls. Runtime 004 releases real process verification; store 005 releases the durable path; gates 007 and environment 008 support native quality evidence.

Splitting D1a decisions in 001 from D1b native probes in 018 lets workspace 002 and portable contracts 003 integrate without the complete native host matrix. Probe code is built after the real workspace, preventing an issue-level cycle. A passing D1b target record can release a subset consumer; every required target/profile remains mandatory for full qualification and coordinated delivery; optional absence does not block completion. Splitting the application port 003 from runtime 004 permits independently checked privilege contracts. Keeping migration/checkpoint safety together in 005 avoids a durable-store story waiting on its own recovery consumer. Separating Linux E2E 008 from three native contributor stories 009–011 permits OS-specific work and validates that containers do not stand in for native systems. Each setup story closes its documented environment with owner-run clean-machine evidence; unfamiliar-contributor integrated acceptance belongs only to 017. These splits provide independently useful deliveries rather than one issue per file.

Quality builds 012 are unsigned evidence. Signed native installation/update 013 closes with controlled qualification packages before candidate automation 015, so neither needs a returning output from its consumer. Notes 014 uses deterministic history fixtures and has no dependency on future releases. Candidate preparation 015 consumes qualified installers and note schemas; publication 016 consumes retained candidates. Keeping them separate preserves independent authority and makes exact-byte promotion testable. Integrated verification 017 owns combined foundation/contribution/release evidence and is a sink; earlier stories never wait for it.

Candidate parallel work includes port, tooling-gate and note design; platform setup 009–011 after the common command contract stabilizes; and release automation fixtures while native qualification proceeds. Workspace/lockfile/build-map edits have one integrating owner (002 until integrated, then the affected story owner), IPC schemas are owned by 003, migration registry by 005, shared check inventory by 007/012, OS-specific setup sections by their respective native stories and release records/authority by 015/016. Shared-file overlap requires review and current-base checks, not a fabricated dependency. Native/signing/UI-review resources are reserved explicitly; worktrees do not remove machine or merge conflicts. Each story verifies compatibility with actual delivered inputs; 017 owns final combined acceptance.

Likely bottlenecks are measured stack/addon/target feasibility, native machines/signing identities and externally enforced release authority, followed by final native evidence. Durations are unknown. The next story does not wait for an unrelated numbered wave; no return dependency on a later research/interface increment is introduced. External facilities are enabling conditions with observable release evidence, not assumed available.

## Acceptance criteria

- [ ] The first development executable refuses stable or unverified profiles and preserves stable locator, store and recovery sentinels.
- [ ] All initial application messages and accessible labels use the complete 25-locale catalogs and the shared resolver.
- [ ] Automated packaged keyboard, focus, reflow, glyph and accessibility-tree checks pass for the first surfaces.
- [ ] Integrated manual assistive journeys and required catalog/provenance checks pass with actual artifact evidence. Model-generated translations do not require human linguistic review for closure.
- [ ] D1a supplies one approved numeric policy record with units and failure outcomes.
- [ ] D1b proves frozen installation, builds and native feasibility for all required native target/profile cells in the target manifest.
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
- [ ] Native signed installation and authenticated update qualification pass for every required target.
- [ ] Non-stable runtime and update paths preserve stable-store isolation and compatible failure and recovery behavior.
- [ ] Trusted candidate preparation enforces immutable source and workflow identity and permanent version reservation.
- [ ] Candidate manifests bind final digests, target identities, compatibility metadata and reviewed editorial notes.
- [ ] Publication enforces global serialization and exact-byte promotion of the approved candidate.
- [ ] Partial publication, retry and withdrawal preserve artifact identities and the supported previous stable release.
- [ ] Retention and retirement follow the reviewed policy and preserve required support evidence.
- [ ] Public publication remains disabled without useful product readiness, complete genuine evidence and separate maintainer authorization.
- [ ] Each security-control producer supplies its ADR-0000 applicability record and observed enforcing-boundary evidence.
- [ ] Each mandatory external facility or authorization is verified before its affected guarantee is accepted.
- [ ] STORY-001-017 records integrated results and limits; no accepted defect or mandatory unknown is treated as complete.

## GitHub distribution

| Block        | Class       | Destination                                                                              |
| ------------ | ----------- | ---------------------------------------------------------------------------------------- |
| SPEC-001-001 | context     | DOCUMENT                                                                                 |
| SPEC-001-002 | operational | EPIC                                                                                     |
| SPEC-001-003 | operational | EPIC, STORY-001-001, STORY-001-002, STORY-001-003, STORY-001-012, STORY-001-013          |
| SPEC-001-004 | operational | STORY-001-002, STORY-001-003, STORY-001-004, STORY-001-007                               |
| SPEC-001-005 | operational | STORY-001-003, STORY-001-004, STORY-001-005, STORY-001-006                               |
| SPEC-001-006 | operational | STORY-001-004, STORY-001-005, STORY-001-009, STORY-001-010, STORY-001-011                |
| SPEC-001-007 | operational | STORY-001-005, STORY-001-012, STORY-001-013, STORY-001-017                               |
| SPEC-001-008 | operational | STORY-001-006, STORY-001-012, STORY-001-017                                              |
| SPEC-001-009 | operational | STORY-001-007, STORY-001-008, STORY-001-012, STORY-001-017                               |
| SPEC-001-010 | operational | STORY-001-008, STORY-001-009, STORY-001-012                                              |
| SPEC-001-011 | operational | STORY-001-009, STORY-001-010, STORY-001-011, STORY-001-017                               |
| SPEC-001-012 | operational | STORY-001-009                                                                            |
| SPEC-001-013 | operational | STORY-001-010                                                                            |
| SPEC-001-014 | operational | STORY-001-011                                                                            |
| SPEC-001-015 | operational | STORY-001-012, STORY-001-013, STORY-001-015, STORY-001-017                               |
| SPEC-001-016 | operational | STORY-001-013, STORY-001-015, STORY-001-016, STORY-001-017                               |
| SPEC-001-017 | operational | STORY-001-014, STORY-001-015, STORY-001-016                                              |
| SPEC-001-018 | operational | STORY-001-015, STORY-001-016, STORY-001-017                                              |
| SPEC-001-019 | operational | STORY-001-016, STORY-001-017                                                             |
| SPEC-001-020 | context     | DOCUMENT                                                                                 |
| SPEC-001-021 | operational | STORY-001-017, EPIC                                                                      |
| SPEC-001-022 | operational | STORY-001-001, STORY-001-003, STORY-001-004, STORY-001-005, STORY-001-017, STORY-001-018 |
| SPEC-001-023 | operational | STORY-001-004, STORY-001-005, STORY-001-006, STORY-001-009, STORY-001-010, STORY-001-011 |
| SPEC-001-024 | operational | STORY-001-003, STORY-001-004, STORY-001-005, STORY-001-007, STORY-001-017                |
| SPEC-001-025 | operational | STORY-001-006, STORY-001-017                                                             |
| SPEC-001-026 | operational | STORY-001-012, STORY-001-013, STORY-001-014, STORY-001-015, STORY-001-016, STORY-001-017 |

| SPEC-001-027 | operational | STORY-001-018, STORY-001-004, STORY-001-005, STORY-001-008, STORY-001-012, STORY-001-013 |

## Source attribution

[^roadmap]: Defines the public foundation scope, declared required/optional target inventory, contributor walkthrough and later capability boundaries; planning is not implementation evidence.

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
