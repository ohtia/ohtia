---
type: Specification
title: "Frontend architecture"
description: "Graphical research workflows, Electron interface boundaries, state ownership, editing, localization, and verification."
verified:
  by: human:AdrianMastronardi
sources:
  - id: context-isolation
    resource: "https://www.electronjs.org/docs/latest/tutorial/context-isolation"
    title: "Electron — Context isolation"
  - id: electron-security
    resource: "https://www.electronjs.org/docs/latest/tutorial/security"
    title: "Electron — Security"
  - id: electron-accessibility
    resource: "https://www.electronjs.org/docs/latest/tutorial/accessibility"
    title: "Electron — Accessibility"
  - id: wcag
    resource: "https://www.w3.org/TR/WCAG22/"
    title: "W3C — Web Content Accessibility Guidelines 2.2"
---

# Frontend architecture

## Scope and structure

The frontend is a React and strict TypeScript research interface inside Electron, built with [Vite](adr/adr-0022-react-vite-renderer.md). [Product definition](product-definition.md) defines its behavior; [System architecture](architecture.md) defines authority, connections and execution. The renderer depends on a typed application port, never provider SDKs, SQL or Electron modules.

Separate presentation components, feature controllers and application-port contracts. A controller translates user intent and domain read models into component state; it does not recreate persistence or permission rules. The Electron composition supplies a preload-backed port; tests and a separate development catalog can supply deterministic doubles. Development fixtures, secret material and test-only entry points are excluded from shipped product code.

Module boundaries follow responsibilities: project opening/settings, Navigator, source library/reader, knowledge inspection, manuscript editor, conversations/findings, connection setup and task activity. Shared primitives cover controls, dialogs, typography, focus and layout; a separate generic design-system product is not required before useful research flows exist.

## Electron boundary

Main owns window lifecycle, native pickers, authorized external navigation, credentials and application-data-service supervision. Preload exposes explicit operations such as opening a selected project, reading its model, submitting a domain command and subscribing to scoped events. Do not expose `ipcRenderer`, a generic channel dispatcher or unrestricted Electron objects. Electron's context-isolation documentation specifically cautions against forwarding unrestricted IPC access.[^context-isolation]

The renderer uses context isolation, process sandboxing and no Node integration. Load packaged application assets through a constrained local protocol and restrictive CSP. Treat source text, imported Markdown, provider output, citations and links as untrusted data. Sanitize permitted rendered structures; reject active content and navigation that could gain a privileged bridge. These controls follow Electron's documented security guidance.[^electron-security]

At runtime, validate IPC envelopes and payload sizes in both directions. Main validates sender frame/origin, selected project handle, command identity and expected versions before dispatch. The application data service rechecks domain preconditions; static TypeScript types are not runtime authorization. Resource reads resolve opaque IDs through the service instead of accepting arbitrary paths from content.

External provider login uses a supported system-browser or provider-managed flow. Validate callback correlation and allowed destinations. An embedded login page is not part of the privileged application origin. Unknown links require safe destination handling, and imported content cannot register protocol handlers, open arbitrary applications or request permissions.

## Installation and first use

The installed app opens to create/open/recent-project actions. A missing provider never blocks local use or requires the researcher to run a command. The application initializes its managed data store once after the one-time native graphical location choice and explicit open/create confirmation defined by [the bootstrap boundary](architecture.md#application-preferences-and-bootstrap). New-project setup creates a research project in the application SQLite database and records enough context for an initial focus without requiring a full research profile or a new storage directory for each thesis. Storage-location changes are a separate settings flow. A failed data upgrade presents the bounded pre-migration recovery path rather than a general backup-management flow.

A connection wizard detects a compatible runtime or offers a supported installation/selection path, explains external processing and account requirements, and runs bounded diagnostics before activation. Installation of optional external software is explicit and shows source and version. Never download and execute a dependency because a document or agent requested it.

Represent installation, authentication, account capability, operation readiness and restriction compatibility separately. A login succeeding does not prove a model or tool is usable. Offer sign out, disconnect, disable, reconnect and credential removal with their actual scopes; disconnecting Ohtia does not silently sign the researcher out of unrelated applications.

Each release provides a tested OS/CPU support matrix, integrity/signing information, supported update/recovery behavior and a graceful explanation for unavailable optional features. Packaging-tool selection and concrete platform versions are delivery decisions, not inferred from Electron's availability.

## Research workspace

The workspace has a project context bar, a left project explorer, a central document/tab area and an optional right conversation/findings area. [Workspace layout](workspace-layout.md) owns deterministic geometry, accessible panel interaction, the layout preference record and acceptance scenarios. [System architecture](architecture.md#application-preferences-and-bootstrap) owns the shared preference storage boundary. Panels can be resized, hidden and restored; a focus mode and a narrow-window arrangement preserve the selected content and keyboard route. Persist non-sensitive preferences separately from research content.

The Navigator is the default project surface, showing stage, focus, relevant artifacts, pending reviews and possible next actions. The explorer distinguishes project-selected sources, research artifacts, manuscripts and deliveries. A separate source-library view lets the researcher associate an existing source with the active project without copying its files or importing another project's notes and confirmations. Tabs retain stable document identity within their project; changing projects cancels subscriptions and prevents late results from appearing in the new scope.

A source reader and a draft finding can open side by side with the exact evidence highlighted. Show source/version, representation, examined scope and limitations near the finding. Missing access and outdated anchors remain visible; a scroll position or a highlighted sentence is not proof the user reviewed it.

Conversation is one interaction surface, not the authoritative knowledge store. Useful outputs become attributable proposals or analysis records with stable local identities. Chat history, derived knowledge, source notes and researcher manuscript text remain distinguishable. Model-generated prose remains a proposal until the researcher approves explicit, version-bound editorial changes through the [editorial review flow](agent-collaboration.md#editorial-proposals-and-approval). Show original/proposed content, rationale and provenance; keep the approval command separate from accepting a chat response or confirming evidence.

## Contributor identity and character presentation

Use [Ohtia and agent identity](agent-identity.md) for the active contributor label, specialist identity and distinction from the product character and human supervisor. Named AI contributions remain attributable in every panel arrangement; the central region or a full-width chat does not determine their author. Opening a contributor profile, switching a visual mode or showing a stored notice starts no inference.

Expose **Settings → Appearance → Characters** through the named `character_presentation` preference. The identity specification owns its exact values, defaults, cross-window behavior and reduced-motion precedence. Dispatch only committed, relevant presentation events, coalesce coincident notices, preserve static recovery and keep all information/actions usable with characters hidden. [Design system](design-system.md) owns illustration and animation rendering; no new character artwork or runtime event binding is implied by the specification.

## State and command lifecycle

Authoritative content lives in application-data-service read models and commands. Renderer memory owns presentation state: selected tab, panel geometry, unsaved editor changes, transient selection and pending interaction. Provider tokens and mutable database records never live in localStorage. Preference persistence uses an explicit non-sensitive schema.

Every async response belongs to a project, request and resource/version. Discard obsolete responses after navigation, project closure or a newer request. Event subscriptions have explicit disposal, bounded queues and sequence-gap handling; requery the relevant model when a stream is incomplete. A disconnected stream does not imply a failed or successful command.

A command carries an idempotency key and the expected resource version where applicable. Keep the same key while resolving an uncertain outcome; do not generate a new operation just because a response was lost. Display submission, confirmed success, conflict, rejection and uncertain result distinctly. Reconcile through the service's command receipt before retrying an uncertain mutation.

Human confirmation is a separate explicit action that shows the exact proposal version and evidence scope. Revalidate at execution and announce success only after a valid receipt. Reopening the read model can fail after a successful command; show that refresh problem separately without repeating the successful mutation.

## Manuscript editor boundary

The editor is an internal module behind a port that exchanges the [draft format's](draft-format.md) document model, stable anchors, commands, selection and diagnostics. [ADR-0032](adr/adr-0032-prosemirror-editor-boundary.md) selects ProseMirror behind that port. No other feature imports its types or treats its internal JSON as canonical manuscript storage. Demonstrate fidelity and desktop input behavior before enabling the editor; the choice does not certify an implementation.

Keep unsaved changes local to the active project/document, visibly distinguish saving from durable completion and preserve a recoverable buffer when a save fails. Save carries the expected revision; a conflict never silently replaces either side. The data service stores canonical Markdown as `TEXT` in a new SQLite revision and advances the current pointer atomically; the renderer does not synchronize an external editable `draft.md`. Generated Markdown output is a delivery, not a second live document. Autosave is bounded and coalesces idle edits without launching inference. Undo/redo belongs to editing history and does not undo an already recorded human review by pretending it never occurred.

Stable block IDs and source/version anchors survive permitted transformations. Comments retain the exact version and quote they examined; relocated suggestions are separate, reviewable hypotheses. Pasting or importing produces only supported document structures, with explicit diagnostics for unsupported material. Keep original imports for recovery. Formulae are data in a restricted grammar, not executable TeX or HTML. [Temml/MathML](adr/adr-0033-temml-mathml-rendering.md) renders validated formulas with the [bundled Plex/Noto fonts](adr/adr-0025-bundled-plex-and-noto-fonts.md). The trusted [TypeScript parser and AST](adr/adr-0031-canonical-typescript-draft-ast.md) own Markdown interpretation and serialization.

IME composition, keyboard editing, clipboard behavior, focus and assistive semantics must be checked in the packaged desktop context. No global shortcut should steal text-composition keystrokes or disable the OS's expected navigation. Selection changes cannot be used as inferred consent for a provider action.

## Connections, tasks and consumption

Connection settings expose enabled state, supported access mode, effective account/runtime and readiness for the selected operation. API-key and provider-login flows have distinct labels; never imply that purchasing any subscription makes all adapters available.

Application Settings provides separate concurrency controls for inference and local processing, both defaulting to 1. These preferences apply across projects and windows. Explain that higher concurrency can increase resource use and overlapping provider usage; show when an adapter imposes a lower limit. Apply changes using [ADR-0011](adr/adr-0011-bounded-durable-local-tasks.md#scheduling-and-required-limits): reducing a limit leaves admitted work running, and increasing it never resumes paused work or clears uncertain outcomes.

Before an external research action, present the destination, input scope and enforceable work limits in research language. For a bounded batch, summarize selected sources, operation and stop conditions. Show progress, pending approvals, partial results, quota failures, cancellation requested and confirmed cessation as distinct conditions. Keep the project usable while processing runs.

A cost/usage display distinguishes measured, estimated and unknown values. A cancel button does not claim that remote billing stopped. When uncertainty prevents safe retry, offer reconciliation or a clearly described new attempt. Opening the activity panel cannot resume external work automatically. Present task state separately from its attempt phase: an approval wait can belong to a running attempt, while `blocked` work has not been admitted. Use the exact lifecycle and required actions in [ADR-0011](adr/adr-0011-bounded-durable-local-tasks.md#task-states-and-transitions); do not translate an unknown outcome into failure or cancellation.

Closing the last window and choosing Quit use [the application-exit flow](adr/adr-0011-bounded-durable-local-tasks.md#application-exit). Keep the window visible while active work is awaited or stopped, pause further dispatch, and present the defined keep-working/wait/cancel actions. Quit with unresolved remote work requires its distinct acknowledgement after local cessation is proved. On restart, show paused accepted tasks and offer explicit continuation after revalidation; restoring tabs or enabling a connection does not start them.

## Diagnostics

**Settings → Diagnostics** provides **View logs**, a read-only viewer for the active diagnostic file and retained archives, and **Delete logs**, with explicit confirmation. Use named broker operations to read/delete the managed logs; the renderer receives validated event data and never an arbitrary filesystem API. Present event values as text, with UTC time, severity and controlled event name visible. Use the ADR's version-aware decoder and display bounded unsupported/invalid-record diagnostics instead of arbitrary raw payloads. Load bounded portions of the retained files so inspection keeps the interface responsive.

Apply the storage, rotation and privacy rules in [ADR-0013](adr/adr-0013-private-content-free-structured-logging.md). Explain that deletion removes technical diagnostics and leaves research history intact. Refresh the viewer after deletion as new events arrive; show access, logging and partial-deletion failures accurately. Sharing a diagnostic bundle requires an explicit preview and user action.

## Localization and accessibility

Keep user-facing text in [typed catalogs](adr/adr-0024-typed-localization-catalogs.md) with checked interpolation/plural contracts. Use its single resolver and **Settings → Language** preference: explicit user choice takes precedence, and system mode follows the ADR's ordered matching and fallback rules. The [product definition](product-definition.md#languages-and-accessibility) owns the locale inventory. Format dates, numbers and accessible labels through the same locale service.

Changing UI locale does not change source language, rewrite existing model output or translate the manuscript. Analysis language is an explicit operation input. Catalog checks verify structure, while fluent human review assesses meaning, naturalness and terminology. Preserve provenance of machine assistance and the actual review performed.

Use WCAG 2.2 AA as the interface's accessibility target, with the selected AAA criteria and evidence scope defined in [ADR-0023](adr/adr-0023-desktop-accessibility-verification.md).[^wcag] Verify complete keyboard journeys, focus order/restoration, perceivable loading/errors, contrast, text scaling, reduced motion and semantic names. Announce completed actions and task outcomes without announcing every streaming token. Large source lists remain navigable when virtualized; item counts and keyboard focus must describe the real collection.

Electron exposes Chromium's accessibility support to assistive technology, which makes an accessible HTML interface technically viable; it does not certify WCAG conformance.[^electron-accessibility] Automated accessibility tests do not establish conformance. Each release's evidence names the tested OS, packaged artifact, assistive technology and journeys where manual testing was performed, and states omissions. Declare supported combinations and record actual screen-reader journeys separately from DOM checks.

## Design system

[Design system](design-system.md) owns visual identity, the reference/semantic/component token layers, light/dark appearance, typography, icons, primitives and research-state presentation. [Workspace layout](workspace-layout.md) owns panel geometry and layout-specific component measurements. Its values and variants are the implementation contract, rather than a component library's defaults. ADRs retain ownership of font, localization and accessibility choices.

Implement local semantic React primitives against those tokens and the packaged CSP. Consumers provide translated content and domain callbacks; primitives do not acquire database/provider authority or implement a second locale service. Keep the development catalog separate from product assets, using the same primitives, tokens and CSP with synthetic states. Component API/usage documentation accompanies the delivered implementation.

## Verification and build boundaries

[ADR-0018](adr/adr-0018-vitest-and-playwright-desktop-tests.md) selects Vitest and Playwright with explicit browser versus Electron coverage; [ADR-0019](adr/adr-0019-immutable-linux-e2e-environment.md) defines reproducible Linux E2E preparation. Unit tests cover pure presentation logic, version/receipt handling and locale formatting. Component tests cover forms, proposal review, pending/uncertain operations and editing events. Contract tests exercise the preload/application-data-service port with runtime-invalid inputs and stale scope. Electron integration tests run the packaged or release-equivalent artifact with its actual CSP, preload and permissions.

Verify create/open/reopen, local offline work, project switching, file-picking boundaries, unsaved edits, recovery, connection-disabled behavior, task cancellation and long source documents. Include source-content attacks, malicious links, invalid IPC senders, denied permissions and attempted access outside a selected project. Synthetic fixtures must not require paid inference or credentials.

The shipped renderer uses Electron's Chromium runtime; a multi-browser web test matrix does not establish desktop OS behavior. Test platform-specific file permissions, dialogs, credential availability, input methods, process shutdown and packaging on the actual release matrix. Use real provider conformance separately from deterministic frontend tests, with explicit authorization for chargeable calls.

The production build must reject development catalog/fixtures and prevent renderer imports of privileged implementation packages. Lock dependency versions, identify the packaged artifact's source and verify update compatibility before installation. The ADR register selects renderer, editor, math, test and toolchain responsibilities. Exact compatible patches and installer/signing/update tools are established with their delivery evidence; named components are not proof of a packaged feature.

[^context-isolation]: Electron describes the isolated preload world and cautions against exposing unrestricted IPC through a bridge.

[^electron-security]: Electron's guidance informs runtime isolation and content handling; Ohtia still validates its own domain messages.

[^wcag]: WCAG provides testable accessibility criteria; adopting a target does not constitute a conformance finding.

[^electron-accessibility]: Electron documents its accessibility tree and assistive-technology integration; compliance still depends on Ohtia's UI and tested desktop journeys.
