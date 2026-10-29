# Architecture decision register

The conventions for this register are defined in [Architecture decisions](../architecture-decisions.md).

## Technical foundations and toolchains

- [ADR-0000 — Security verification with explicit desktop applicability](adr-0000-security-verification-frameworks.md) — Use ASVS L2 and complementary risk/testing frameworks with evidence scoped to actual desktop boundaries.
- [ADR-0001 — One repository with explicit build boundaries](adr-0001-monorepo-and-component-boundaries.md) — Use one repository and declared package interfaces while assembling compatible components into the desktop release.
- [ADR-0002 — TypeScript product services with local IPC](adr-0002-typescript-product-and-local-ipc.md) — Use strict TypeScript across the desktop product and exchange validated local messages without a Python application server.
- [ADR-0003 — Electron desktop with explicit privilege boundaries](adr-0003-electron-desktop-boundaries.md) — Use Electron with a React and TypeScript renderer separated from privileged local services.
- [ADR-0004 — Node, pnpm, ESLint and Prettier toolchain](adr-0004-javascript-development-toolchain.md) — Use a locked TypeScript workspace with reproducible tools, a native Windows contributor shell and separate type, lint and format checks.
- [ADR-0005 — Isolated Python tooling for repository maintenance](adr-0005-python-repository-tooling.md) — Use CPython, uv, Ruff and Pyrefly for developer tooling without making Python an installed-product dependency.

## Data and files

- [ADR-0006 — SQLite application storage](adr-0006-sqlite-application-storage.md) — Store structured records and manuscript revisions in ohtia.db3, with retained binary files in the managed object directory.
- [ADR-0007 — Kysely, better-sqlite3 and exclusive migrations](adr-0007-sqlite-repositories-and-migrations.md) — Use Kysely with better-sqlite3 for typed SQLite access and reviewed migrations inside Ohtia's exclusive transaction and recovery boundary.
- [ADR-0008 — Application-generated UUIDv7 entity identifiers](adr-0008-uuidv7-entity-identifiers.md) — Generate internal entity UUIDv7 identifiers in the trusted data service and store them as 16-byte SQLite blobs.
- [ADR-0009 — Ohtia-managed copies of imported files](adr-0009-managed-imported-files.md) — Store imported bytes under objects/ using a two-character SHA-256 prefix and the complete lowercase digest.
- [ADR-0010 — Pre-migration database recovery](adr-0010-pre-migration-recovery.md) — Preserve data, schema and migration metadata in a verified SQLite checkpoint for upgrade recovery.

## Execution and containment

- [ADR-0011 — Persisted local task intent with bounded execution](adr-0011-bounded-durable-local-tasks.md) — Define durable task and attempt states, local scheduling limits, cancellation, application exit and recovery.
- [ADR-0012 — Capabilities bound to one supervised attempt](adr-0012-attempt-bound-process-capabilities.md) — Bind worker effects to a random per-attempt capability and reject replay or stale scope through the trusted broker.
- [ADR-0013 — Structured diagnostics without research content](adr-0013-private-content-free-structured-logging.md) — Define a versioned local JSONL diagnostic format mapped to OpenTelemetry, with privacy controls and bounded file retention.
- [ADR-0014 — Allowed document structures and restrictive CSP](adr-0014-restricted-rendering-and-csp.md) — Render untrusted content through the academic schema and enforce the packaged application content security policy.
- [ADR-0015 — Restricted processes for untrusted content](adr-0015-isolated-content-processing.md) — Process imported content in disposable environments without database, credential or general filesystem authority.

## Quality, CI and delivery

- [ADR-0016 — Shared quality commands and per-package coverage](adr-0016-shared-quality-and-coverage-gates.md) — Run the same required checks locally and in CI with explicit coverage and behavioral acceptance gates.
- [ADR-0017 — Integration evidence at real local boundaries](adr-0017-real-boundary-integration-tests.md) — Verify SQLite, IPC, packaged processes and provider capabilities at the boundaries that determine their behavior.
- [ADR-0018 — Vitest and Playwright with explicit runtime coverage](adr-0018-vitest-and-playwright-desktop-tests.md) — Use Vitest for pure/component tests and Playwright for browser and Electron journeys with complete declared inventories.
- [ADR-0019 — Pinned Linux environment for frontend verification](adr-0019-immutable-linux-e2e-environment.md) — Pin the Linux E2E image and browser dependencies while preserving actual desktop sandbox and coverage requirements.
- [ADR-0020 — Declared GitHub policy and restricted CI authority](adr-0020-github-policy-and-trusted-ci.md) — Verify CI provenance before merge, require approval for external fork workflows and separate PR execution from publication authority.
- [ADR-0021 — Versioned immutable desktop artifacts](adr-0021-versioned-desktop-artifacts.md) — Trace each desktop release to its source, locked components and final signed package without rebuilding during promotion.
- [ADR-0040 — Input-addressed hosted producer for the Linux E2E image](adr-0040-hosted-linux-e2e-image-producer.md) — Identify the Linux E2E image by its declared recipe inputs, build it only on GitHub-hosted runners when no publication exists, and re-run waiting checks automatically.

## Interface foundations

- [ADR-0022 — React renderer built with Vite](adr-0022-react-vite-renderer.md) — Build local renderer assets with React and Vite while keeping Electron privileges outside the web component tree.
- [ADR-0023 — WCAG 2.2 AA and scoped desktop accessibility evidence](adr-0023-desktop-accessibility-verification.md) — Target WCAG 2.2 AA and selected AAA criteria while reporting actual packaged-interface and assistive-technology coverage.
- [ADR-0024 — Typed catalogs and operating-system locale selection](adr-0024-typed-localization-catalogs.md) — Resolve interface language from user choice, ordered OS preferences and explicit regional fallbacks through one typed catalog service.
- [ADR-0025 — Bundled IBM Plex typography with Noto fallback](adr-0025-bundled-plex-and-noto-fonts.md) — Distribute identified local fonts for interface, manuscript, code and mathematics without remote font requests.
- [ADR-0039 — Integrated window title bar](adr-0039-integrated-window-title-bar.md) — Combine the window title bar, application-menu entry and workspace context bar in one 48 px row drawn with platform window controls.

## Inference and search integrations

- [ADR-0026 — Capability-declared adapters with explicit access modes](adr-0026-capability-declared-adapters.md) — Keep inference and search integrations behind distinct contracts with verified capabilities and account access.
- [ADR-0027 — Scoped agent contexts with mediated research tools](adr-0027-scoped-agent-contexts.md) — Agents receive restricted per-attempt inputs and create proposals through application-controlled operations.
- [ADR-0028 — Current authorization for mediated provider transfers](adr-0028-mediated-provider-transfers.md) — Authorize each Ohtia-controlled transfer against current restrictions and scope without holding database transactions over the network.
- [ADR-0029 — Versioned operation profiles and bounded usage reporting](adr-0029-operation-profiles-and-usage-reports.md) — Select permitted model capabilities per operation and retain partial or late consumption without granting stale research authority.

## Academic documents and research review

- [ADR-0030 — Academic Markdown behind an editor-independent boundary](adr-0030-academic-markdown-boundary.md) — Keep canonical manuscript text and a versioned document model independent of the chosen editor library.
- [ADR-0031 — One TypeScript draft parser and versioned AST](adr-0031-canonical-typescript-draft-ast.md) — Keep academic Markdown interpretation and serialization in one trusted TypeScript module with AST exchange at the editor boundary.
- [ADR-0032 — ProseMirror behind an Ohtia editor boundary](adr-0032-prosemirror-editor-boundary.md) — Use ProseMirror directly with an academic schema and keep its internal types and persistence model private.
- [ADR-0033 — Temml and native MathML with Plex Math](adr-0033-temml-mathml-rendering.md) — Convert restricted mathematical LaTeX to MathML with Temml while retaining source and reporting unsupported constructs.
- [ADR-0034 — Pandoc DOCX and Typst PDF from the validated AST](adr-0034-pandoc-typst-manuscript-delivery.md) — Generate academic deliveries from exact manuscript snapshots with isolated writers and explicit fidelity reports.
- [ADR-0035 — Research review bound to exact content versions](adr-0035-version-bound-research-review.md) — Persist human decisions and analysis against immutable versions and reject stale confirmations.

## Application configuration

- [ADR-0036 — Typed SQLite preferences with a separate bootstrap locator](adr-0036-application-preferences-and-bootstrap.md) — Keep transactional preferences, a fixed account-native research root and a separate native configuration locator.

## Research-agent collaboration

- [ADR-0037 — Application-mediated collaboration among specialist agents](adr-0037-application-mediated-agent-collaboration.md) — Coordinate bounded specialist contributions through durable application records while preserving direct interaction and human authority.

## Native delivery mechanisms

- [ADR-0038 — Native desktop packages with authenticated update admission](adr-0038-desktop-delivery-mechanisms.md) — Select provisional six-target packages, native signing and updater admission while preserving immutable candidate bytes and recovery boundaries.
