---
type: EPIC
title: "EPIC-004 — Thesis onboarding, project workspace, recovery and diagnostics"
description: "Deliver thesis onboarding, initial local writing and workspace controls, with verified recovery and diagnostics."
generated: { by: codex/gpt-6.2-sol }
verified:
  by: human:AdrianMastronardi
tags: ["epic", "comp:app", "comp:desktop", "comp:storage", "comp:llm"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/402
sources:
  - id: roadmap
    resource: "https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/product-roadmap.md"
    title: "Product roadmap"
  - id: product
    resource: "https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/product-definition.md"
    title: "Product definition and principles"
  - id: workflow
    resource: "https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/thesis-workflow.md"
    title: "Thesis workflow"
  - id: framework
    resource: "https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/exploration-action-framework.md"
    title: "Exploration–Action Framework"
  - id: architecture
    resource: "https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/architecture.md"
    title: "System architecture"
  - id: frontend
    resource: "https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/frontend-architecture.md"
    title: "Frontend architecture"
  - id: workspace
    resource: "https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/workspace-layout.md"
    title: "Workspace layout and acceptance scenarios"
  - id: presentation
    resource: "https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/research-presentation.md"
    title: "Research presentation API"
  - id: character-api
    resource: "https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/character-presentation.md"
    title: "Character presentation API"
  - id: design
    resource: "https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/design-system.md"
    title: "Ohtia design system"
  - id: data
    resource: "https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/data-model.md"
    title: "Data model"
  - id: format
    resource: "https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/draft-format.md"
    title: "Canonical academic manuscript format"
  - id: port
    resource: "https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/application-port.md"
    title: "Bounded application port"
  - id: storage
    resource: "https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/storage.md"
    title: "Storage contracts and native verification"
  - id: diagnostics
    resource: "https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/diagnostics.md"
    title: "Content-free broker diagnostics"
  - id: verification
    resource: "https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/shared-verification.md"
    title: "Shared verification"
  - id: collaboration
    resource: "https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/agents/agent-collaboration.md"
    title: "Agent collaboration"
  - id: virgilio
    resource: "https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/agents/agent-virgilio.md"
    title: "Virgilio operations"
  - id: evaluation
    resource: "https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/agents/agent-collaboration-evaluation.md"
    title: "Agent collaboration evaluation"
  - id: character
    resource: "https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/agents/agent-identity.md"
    title: "Ohtia and agent identity"
  - id: epic2
    resource: "https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/epics/EPIC-002-basic-interface/epic.md"
    title: "EPIC-002 basic interface outputs"
  - id: epic3
    resource: "https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/epics/EPIC-003-research-agents/epic.md"
    title: "EPIC-003 research agents outputs"
  - id: adr6
    resource: "https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/adr/adr-0006-sqlite-application-storage.md"
    title: "ADR-0006 Application storage"
  - id: adr7
    resource: "https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/adr/adr-0007-sqlite-repositories-and-migrations.md"
    title: "ADR-0007 SQLite repositories and migrations"
  - id: adr8
    resource: "https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/adr/adr-0008-uuidv7-entity-identifiers.md"
    title: "ADR-0008 UUIDv7 entity identifiers"
  - id: adr10
    resource: "https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/adr/adr-0010-pre-migration-recovery.md"
    title: "ADR-0010 Pre-migration recovery"
  - id: adr13
    resource: "https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/adr/adr-0013-private-content-free-structured-logging.md"
    title: "ADR-0013 Private-content-free structured logging"
  - id: adr14
    resource: "https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/adr/adr-0014-restricted-rendering-and-csp.md"
    title: "ADR-0014 Restricted rendering and CSP"
  - id: adr23
    resource: "https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/adr/adr-0023-desktop-accessibility-verification.md"
    title: "ADR-0023 Desktop accessibility verification"
  - id: adr30
    resource: "https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/adr/adr-0030-academic-markdown-boundary.md"
    title: "ADR-0030 Canonical academic Markdown boundary"
  - id: adr31
    resource: "https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/adr/adr-0031-canonical-typescript-draft-ast.md"
    title: "ADR-0031 Canonical TypeScript manuscript AST"
  - id: adr32
    resource: "https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/adr/adr-0032-prosemirror-editor-boundary.md"
    title: "ADR-0032 ProseMirror editor boundary"
  - id: adr35
    resource: "https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/adr/adr-0035-version-bound-research-review.md"
    title: "ADR-0035 Version-bound research review"
  - id: adr36
    resource: "https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/adr/adr-0036-application-preferences-and-bootstrap.md"
    title: "ADR-0036 Application preferences and bootstrap"
  - id: adr51
    resource: "https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/adr/adr-0051-research-agent-task-execution.md"
    title: "ADR-0051 Research-agent task execution"
  - id: adr52
    resource: "https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/adr/adr-0052-current-provider-dispatch-authorization.md"
    title: "ADR-0052 Current provider dispatch authorization"
  - id: tree
    resource: "https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/packages/contracts/src/project-types.ts"
    title: "Inspected project type catalog in the base checkout"
  - id: peer-feedback-publication
    resource: "EPIC-004 publication-readiness peer feedback reviewed in the refinement discussion on 2026-11-25"
    title: "Publication readiness, implementation gaps and simplifications"
  - id: peer-feedback
    resource: "EPIC-004 peer feedback shared in the maintainer refinement discussion on 2026-11-25"
    title: "EPIC-004 peer feedback and publication blockers"
  - id: navigator-deadline-display
    resource: "EPIC-004 refinement discussion on 2026-11-25 about reading the thesis deadline directly in Navigator"
    title: "Navigator deadline display and profile schedule"
  - id: profile-document-view
    resource: "EPIC-004 maintainer refinement discussion on 2026-11-25 approving the research profile tab in Documents and its Navigator entry paths"
    title: "Research profile view in Documents"
  - id: thesis-entry-clarification
    resource: "EPIC-004 refinement discussion on 2026-11-25 about optional topic exploration, entry with an established question and manuscript terminology"
    title: "Thesis entry paths and manuscript terminology"
  - id: decision-thesis-only
    resource: "EPIC-004 maintainer refinement discussion on 2026-11-25 about thesis-only scope and atomic story boundaries"
    title: "Thesis-only delivery scope and atomic story review"
epic_number: "004"
stories:
  - id: STORY-004-001
    title: "Browse current project collections"
    concept: ./STORY-004-001-browse-project-collections.md
    resource: https://github.com/ohtia/ohtia/issues/403
  - id: STORY-004-002
    title: "Rename the working project title"
    concept: ./STORY-004-002-rename-project.md
    resource: https://github.com/ohtia/ohtia/issues/404
  - id: STORY-004-003
    title: "Close a thesis in the current window"
    concept: ./STORY-004-003-close-project.md
    resource: https://github.com/ohtia/ohtia/issues/405
  - id: STORY-004-004
    title: "Persist the initial thesis profile"
    concept: ./STORY-004-004-record-thesis-profile.md
    resource: https://github.com/ohtia/ohtia/issues/406
  - id: STORY-004-005
    title: "Review an exact profile version"
    concept: ./STORY-004-005-review-profile-version.md
    resource: https://github.com/ohtia/ohtia/issues/407
  - id: STORY-004-006
    title: "Record stage entry and reentry"
    concept: ./STORY-004-006-review-stage-entry.md
    resource: https://github.com/ohtia/ohtia/issues/408
  - id: STORY-004-007
    title: "Choose the current research focus"
    concept: ./STORY-004-007-choose-research-focus.md
    resource: https://github.com/ohtia/ohtia/issues/409
  - id: STORY-004-008
    title: "Suggest feasible next actions"
    concept: ./STORY-004-008-suggest-next-actions.md
    resource: https://github.com/ohtia/ohtia/issues/410
  - id: STORY-004-009
    title: "Confirm the Onboarding milestone"
    concept: ./STORY-004-009-confirm-onboarding-milestone.md
    resource: https://github.com/ohtia/ohtia/issues/411
  - id: STORY-004-010
    title: "Request bounded Virgilio onboarding guidance"
    concept: ./STORY-004-010-request-virgilio-guidance.md
    resource: https://github.com/ohtia/ohtia/issues/412
  - id: STORY-004-011
    title: "Save researcher notes"
    concept: ./STORY-004-011-save-researcher-notes.md
    resource: https://github.com/ohtia/ohtia/issues/413
  - id: STORY-004-012
    title: "Validate canonical title and paragraphs"
    concept: ./STORY-004-012-validate-canonical-manuscript.md
    resource: https://github.com/ohtia/ohtia/issues/414
  - id: STORY-004-013
    title: "Save versioned manuscript records"
    concept: ./STORY-004-013-save-manuscript-revisions.md
    resource: https://github.com/ohtia/ohtia/issues/415
  - id: STORY-004-014
    title: "Open project manuscripts in tabs"
    concept: ./STORY-004-014-open-manuscript-tabs.md
    resource: https://github.com/ohtia/ohtia/issues/416
  - id: STORY-004-015
    title: "Save manuscript edits and resolve pending close"
    concept: ./STORY-004-015-write-initial-manuscript.md
    resource: https://github.com/ohtia/ohtia/issues/417
  - id: STORY-004-016
    title: "Present the confirmed Onboarding milestone"
    concept: ./STORY-004-016-present-onboarding-findings.md
    resource: https://github.com/ohtia/ohtia/issues/418
  - id: STORY-004-017
    title: "Inspect the managed store location"
    concept: ./STORY-004-017-inspect-managed-storage.md
    resource: https://github.com/ohtia/ohtia/issues/419
  - id: STORY-004-018
    title: "Recover a verified migration checkpoint"
    concept: ./STORY-004-018-recover-migration-checkpoint.md
    resource: https://github.com/ohtia/ohtia/issues/420
  - id: STORY-004-019
    title: "View bounded diagnostic records"
    concept: ./STORY-004-019-view-diagnostics.md
    resource: https://github.com/ohtia/ohtia/issues/421
  - id: STORY-004-020
    title: "Delete retained diagnostic logs"
    concept: ./STORY-004-020-delete-diagnostics.md
    resource: https://github.com/ohtia/ohtia/issues/422
  - id: STORY-004-021
    title: "Save a reviewed diagnostic bundle"
    concept: ./STORY-004-021-save-diagnostic-bundle.md
    resource: https://github.com/ohtia/ohtia/issues/423
  - id: STORY-004-022
    title: "Edit the thesis profile in the workspace"
    concept: ./STORY-004-022-edit-thesis-profile.md
    resource: https://github.com/ohtia/ohtia/issues/424
  - id: STORY-004-023
    title: "Read stage context in Navigator"
    concept: ./STORY-004-023-read-navigator-stage.md
    resource: https://github.com/ohtia/ohtia/issues/425
  - id: STORY-004-024
    title: "Group manuscript autosaves"
    concept: ./STORY-004-024-group-manuscript-autosaves.md
    resource: https://github.com/ohtia/ohtia/issues/426
  - id: STORY-004-025
    title: "Protect pending project work before detach"
    concept: ./STORY-004-025-guard-pending-project-work.md
    resource: https://github.com/ohtia/ohtia/issues/427
  - id: STORY-004-026
    title: "Edit the canonical title and paragraph subset"
    concept: ./STORY-004-026-edit-canonical-manuscript.md
    resource: https://github.com/ohtia/ohtia/issues/428
  - id: STORY-004-027
    title: "Start or reopen a stage from Navigator"
    concept: ./STORY-004-027-start-or-reopen-stage.md
    resource: https://github.com/ohtia/ohtia/issues/429
  - id: STORY-004-028
    title: "Create a manuscript from the project explorer"
    concept: ./STORY-004-028-create-manuscript-from-explorer.md
    resource: https://github.com/ohtia/ohtia/issues/430
---

# EPIC-004 — Thesis onboarding, project workspace, recovery and diagnostics

## Description

Deliver thesis onboarding, initial local writing and workspace controls, with verified recovery and diagnostics. The deliverable applies to thesis projects set up in the EPIC-003 workflow and connects the previously delivered desktop, project and agent capabilities to the first research stage.

## Functional and technical specification

### SPEC-004-001: Thesis entry and scope

This increment implements Onboarding (A) for project type `thesis`. Keep the existing trusted catalog and SQLite constraint. A bachelor-level thesis, dissertation, master's or doctoral thesis remains the researcher's attributed work description within that type. The maintainer scoped paper support out of this delivery. The publication review must include the corresponding roadmap amendment. The thesis-only workflow begins here. Verification of the paper entry route starts with a separately planned and adopted paper capability.[^decision-thesis-only][^roadmap][^data][^tree]

Start with a thesis set up in the real EPIC-003 Virgilio conversation. Project creation requires a connected AI service and the researcher's confirmation of the working title and document language. The setup-confirmed document language remains immutable and governs the thesis text and agents' work and answers. The interface locale, source language and any reported target-language needs are separate. After setup, the researcher can record context, check the profile, choose a focus, take notes and write locally. Viewing or opening a project starts no inference. No model choice, complete questionnaire, date, topic or bibliography is a condition for local work.[^workflow][^epic3][^product]

Support a new thesis with an interest or incomplete material and an advanced thesis returning with work already done. Capture what exists, its attribution and review scope, unresolved access/permissions and supported artifacts. Use the actual point of work without replaying earlier milestones or asserting completion from a researcher statement alone. Record emerging questions for Topic–Problem (B). Initial interests and questions are useful inputs while formal problem formulation remains outside this delivery. A and B refine the same versioned profile. Sources and citation comparisons can start independently when their permissions and actual reader/evidence capabilities are available. The A slice records supplied references or descriptions with actual attribution and offers ordinary local writing. Formal source acquisition, search, evidence anchors and source comparison are outside this EPIC.[^workflow][^roadmap][^framework]

Preserve PRIN-001–003 researcher direction and authorship, PRIN-004–010 provenance, coverage, uncertainty, reasons and correction, PRIN-011–013 language and durable research, and PRIN-014–016 proportionate work, depth and an honest stopping point. The A milestone reviews profile accuracy and first useful focus while keeping identified questions open. Institutional or supervisor approval is a separately evidenced event. Opening a reviewer view or accepting help gives nobody project access.[^product][^workflow][^adr35]

### SPEC-004-002: Transactional research operations

Use the existing main broker, named and bounded application port, restricted preload and utility data service. Extend `packages/contracts/src/port.ts`, the research contract and `packages/utility/src/storage.ts` through their existing authority. Main checks sender, frame, origin, selected scope, payload and operation identity. The utility independently checks domain ownership, permissions and expected versions. Preserve opaque stable UUIDv7 entities, BLOB/foreign-key/uniqueness and same-project pointer constraints.[^architecture][^port][^storage][^data][^adr6][^adr7][^adr8]

Commit each persistent change, its history and atomic receipt in one transaction. Same ID and same canonical payload reconcile to the original confirmed result. ID reuse with a different request is rejected. An uncertain response keeps the original ID and reconciles the receipt before another effect. A failed refresh following a confirmed commit is a separate read failure. Rejected, stale or failed saves preserve previous confirmed state and recoverable input. Every affected reader and subscription scopes responses by origin, version and selection generation, including A→B→A.[^frontend][^port][^adr35]

Append ordered immutable migrations through the existing hashed manifest. Verify the previous initialized schema, fresh schema, exclusive admission, compatible bounds, verified checkpoint and rollback/refusal. The maintainer integrating EPIC-004 owns migration allocation or records one explicitly delegated integration owner. The owner records each migration's story, prerequisites, prior schema revision and next available number in the review evidence. Take the number from the latest base when integrating in producer-before-consumer order. Independent migrations take the next free slot in integration order. Rebuild and verify the manifest together with the migration after any pre-merge collision. Never renumber or rehash migration contents after release. Exercise fresh, latest-base, prior supported schema and combined EPIC upgrade with retained committed data. Use actual file-backed SQLite, IPC and receipt, stale, failure and restart tests, ADR-0000 security evidence and ADR-0016 package coverage, including required behavior inventories and changed executable lines.[^adr7][^adr10][^storage][^verification]

### SPEC-004-003: Scoped graphical interaction

Reuse named commands, EPIC-002 primitives, typed locales, packaged fonts and shared layout and focus rules. Navigation never widens authority. Show applicable empty/loading/filtered-empty, partial, conflict, failure and uncertain states with an actionable explanation and recoverable input. Test the story's changed interactions against the applicable keyboard, accessible naming, focus, reflow, translation, rendering and input cases. The integrated EPIC covers both themes, forced colors, motion preferences, narrow layout and required native platform combinations. Applicable WCAG 2.2 AA, ADR-0023 selected AAA and ATAG Part B evidence uses the actual packaged path. Use catalog cases to verify component layout and messages. Use packaged desktop tests for the native or runtime behavior each story introduces. The EPIC owns the complete integrated environment matrix. A synthetic bidirectional title is a user-data case in the supported interface locales. Record any manual screen-reader exercise and the OS and locale used.[^epic2][^design][^workspace][^adr23][^presentation]

Incoming commands and event text are data through scoped, bounded contracts under packaged CSP. Separate active scope from scoped work preserved elsewhere. Use controlled return/initial focus, complete accessible names and localized feedback without shipping fixture records. Apply ADR-0000 applicability, shared package and native checks to each affected boundary. Record exercised artifact, OS/CPU, locale and omissions.[^frontend][^adr14][^verification]

### SPEC-004-004: Writing and attention boundaries

The manuscript is the working text of the thesis that the researcher writes and revises. The research profile retains the topic, question, objectives and decisions as attributed context. Notes, profile records and manuscript revisions have distinct identities. Recording or revising a profile or note leaves manuscript text intact. Keep renderer buffers, research review and static/dynamic presentation separately owned.[^data][^format][^thesis-entry-clarification] The utility alone persists versioned research through the existing validated port, immutable migrations, verified checkpoint, UUIDv7 scope and expected-version receipts. A late response stays tied to the original resource and generation. A lost result reconciles its original operation ID; confirmed changes and refresh failures have separate outcomes. Corrupt, unsupported or stale data never discards existing state or the recoverable buffer.[^architecture][^port][^storage][^data][^adr7][^adr8][^adr10]

Keep controls keyboard- and screen-reader-operable, with typed locale cases, packaged fonts, forced colors, reduced motion, both themes, zoom/reflow to 320 CSS px, validation of recorded content language, actual native IME/clipboard when used and nonduplicated save announcements. Apply ADR-0000 applicability, packaged CSP and portability checks, ADR-0016 per-package coverage/required inventories, and the relevant V09 cases for manuscript tab or editor work. For other surfaces, exercise their own project ownership and scope switches against stored data. Record the package and native evidence appropriate to the story. The EPIC owns combined platform coverage and reports linguistic and assistive evidence separately. Apply WCAG 2.2 AA, the selected AAA criteria and ATAG Part B in scope.[^roadmap][^workspace][^design][^adr14][^adr23][^verification][^presentation]

### SPEC-004-005: Settings operation boundaries

Extend the shared Settings shell through named broker operations. The broker supplies Settings with admitted location, recovery and diagnostic projections and owns the native save picker. The utility remains the authority for SQLite operation and verification or restoration of the pending checkpoint. Bound reads, queues and writes, use validated closed data shapes, keep renderer resource and filesystem authority confined and differentiate unavailable, busy, stale, uncertain and partial failure. Confirm effects only from their real outcomes. Diagnostic operations remain local and preserve the research store. Checkpoint recovery can restore an earlier committed state, so its confirmation names the verified pending snapshot and the scope of the rollback.[^frontend][^port][^storage][^adr13][^adr36]

Use typed messages, actual keyboard and focus behavior, forced colors, both themes and narrow reflow through 320 CSS px. Qualify native storage/diagnostic permissions and interruption paths on affected OS/CPU targets with packaged calls, ADR-0000 applicability and ADR-0016 coverage. Diagnostic failure is independent of research saves. Report unexecuted scenarios and evidence limits.[^workspace][^design][^adr23][^diagnostics][^verification]

### SPEC-004-006: Integrated acceptance and publication scope

Exercise both topic entry paths against the real profile and Navigator. For an undecided researcher with no bibliography, record their interests and constraints, show a feasible local next step and preserve an optional exploration plan even when search is unavailable. For a researcher who already has a justified question and material, preserve that work, offer the first available task supported by its actual inputs and leave topic comparison optional. In both cases, verify the researcher can write and reopen the working thesis text independently of topic comparison. Opening the project or Navigator starts no search or inference.[^workflow][^roadmap][^thesis-entry-clarification]

Create a new thesis with Virgilio without a topic, reference list or target date. Record partial context, correct and review the exact synthesis, start Onboarding from Navigator and choose a useful focus. Record a pending review question when applicable. Create the manuscript from the explorer and write a title and paragraphs. Reopen the project and verify its decisions, notes and text. Confirm A through the real milestone action and reopen the stage from Navigator with a reason. Disconnect the provider after setup and repeat local actions. During a requested operation, observe interruption or uncertainty and verify that local results remain available.[^workflow][^roadmap][^epic3]

Enter with an advanced thesis. Map relevant existing work with its actual support and select a feasible focus. Exercise reentry with an earlier reviewed A decision, a new reason and the exact historical version. The fixture can record that decision through the supported workflow first. Either journey can use the delivered A capabilities with a partial profile.[^workflow][^roadmap]

Exercise V04–V06 and V09 and affected V08/V13, conversation forms, switching during late reads/saves, failed refresh, rejection/uncertain receipts, held and restored buffers, current findings, verified migration and recovery and diagnostic marker case 15. Verify the needed outputs on real SQLite/IPC and the packaged artifact. Attest the exact planned matrix (Windows x64, macOS ARM64, Linux x64 and Linux ARM64), native input, locale, assistive evidence and provider route within measured bounds. Keep application readiness, hosted CI and any release authorization explicit. Project creation still requires a working authorized connection.[^roadmap][^workspace][^storage][^evaluation][^verification]

The delivery includes window close and rename. Project archive and destructive deletion are outside this EPIC. They require prior active-work, retention and erasure contracts, including managed checkpoints and qualified database/journal sanitization for any erasure guarantee. General relocation, backup, device-loss recovery and durable recovery of unsaved buffers after process loss are outside this delivery. Component names, view grouping, indexes and internal code organization remain implementation choices.[^peer-feedback-publication][^peer-feedback][^roadmap][^frontend][^data][^adr10][^adr36]

Adopt the amended canonical contracts before coding affected storage, manuscript or diagnostics behavior. The affected story records the reviewed change in the owning document alongside the implementation and updates its index entry if the description changes.[^data][^format][^diagnostics]

The documentation publication PR updates `docs/product-roadmap.md` alongside the EPIC. It records thesis-only verification, the rename and window-close scope, and deferred Navigator presentation only for eligible source-contradiction events. Check all three amendments against the reviewed specification before opening the publication PR.[^peer-feedback-publication][^roadmap][^design]

### SPEC-004-007: Research framework context

Onboarding is an activity flow with a sufficiently agreed purpose, known context and a reviewable output. Its A artifact is the initial thesis profile with constraints and a useful next focus. Express discipline-specific returns and multiple active stages as research behavior. The workflow allows Literature to reopen Topic–Problem, Methodology to return to Literature, Investigate to reopen Methodology, and Interpret to return to Describe or Literature. These movements change evidence and decisions in the project. They do not prescribe a seven-chapter manuscript or the issue dependency order. Existing work can enter at its actual point, and planning, notes, writing and reviews continue across stages.[^workflow][^framework]

Formal problem formulation, discovery and source review, the full academic editor, later manuscript review, deliveries, supervisor feedback and complete interchange are outside this EPIC. External approvals and governed sharing require evidence and an explicit user action.[^workflow][^roadmap]

### SPEC-004-008: Browse current project collections

Use the EPIC-003 project selector and scoped selection/receipts (#218), history and actions (#220) and EPIC-002 controlled collections and research surfaces (#51). Extend the explorer and its presentation models in `packages/renderer/src/workspace.tsx`, `workspace-controller.ts` and `project-controller.ts`. Present the selected name, ordered paginated collections, independent group state, status and retry. Validate on loaded project data and the existing Project memory surface. Allow subscribing to the active project's selection and collection events for consumers. An unsupported artifact group has a truthful unavailable state. Each later artifact owner wires its own entries.[^epic2][^epic3][^workspace][^frontend]

Cover V04 with three thesis records, the middle project selected, full 120-character, Hangul and mixed left-to-right/right-to-left names, stable selection through pagination and unrelated group actions. Cover V06 on the delivered collections and existing chat, including disconnected service without fixture data. Maintain EPIC-003 V08/V13 scope protections. V05 New project versus New conversation remains an integrated regression of the already delivered flows, not a new command implementation.[^workspace][^roadmap]

Use named commands, typed messages and packaged keyboard, scope and accessibility tests. Exercise focus return where the action opens or dismisses a surface, long/localized text, both themes and narrow reflow. Record the artifact and locale used.[^workspace][^design][^frontend]

The bidirectional fixture checks researcher-supplied titles, accessible names and isolation in supported interface locales. It does not expand the supported interface locales.[^workspace][^design]

### SPEC-004-009: Rename the working project title

Rename is an explicit action for the researcher in the window's active, setup-confirmed thesis. Reuse project scope and title validation from EPIC-003 (#218). Introduce a positive safe-integer `title_revision`, backfilled to 1, independent of opening order. Expose it on the project projection. Under the existing checked command/receipt transaction compare the submitted expected title revision with the stored one, persist the accepted title and increment the revision exactly once. A submission of the unchanged title records the original outcome without advancing the revision. A conflict preserves the form input. Use the latest successful receipt to refresh the selector without allowing an old result to change active selection.[^data][^frontend][^epic3][^workspace]

This action retains project ID, confirmed document language, setup proposal provenance and manuscript labels. Test wrong thesis, stale revision, title A→B→A, replay after lost acknowledgement and read failure after a successful rename. Record the project title revision and concurrency rule in `docs/data-model.md` in this story's implementation change.[^data][^port][^workspace]

Use named commands, typed messages and packaged keyboard, scope and accessibility tests. Exercise focus return where the action opens or dismisses a surface, long/localized text, both themes and narrow reflow. Record the artifact and locale used.[^workspace][^design][^frontend]

### SPEC-004-010: Close a thesis in the current window

Close in this window detaches the active thesis in the requesting window and returns focus to the selector. It retains the database, last-open order, unsent conversation input and other windows' selections and tasks. New application startup continues to restore the last opened project when its existing restore flag is true. The command describes its window-only scope. An ensuing startup opening is not the undo of a data change.[^epic3][^frontend][^workspace]

Use the read-only project selection lease supplied by STORY-004-025. Its owner uses the private `ProjectController.selectionEpoch`, keeping mutation inside the controller. Detach only after the captured window and project still own the selection and all guards allow it. Ignore obsolete close continuations. An already accepted service effect and its receipt remain scoped to the origin. Test A→B while a guard waits, rejected guards, unchanged last-open order, another window and restart with the existing restore flag. Project archive, deletion and pending input recovery after process loss have separate delivery scope.[^workspace][^port][^adr51]

Use named commands, typed messages and packaged keyboard, scope and accessibility tests. Exercise focus return where the action opens or dismisses a surface, long/localized text, both themes and narrow reflow. Record the artifact and locale used.[^workspace][^design][^frontend]

### SPEC-004-011: Persist the initial thesis profile

Store one immutable profile revision sequence per setup-confirmed thesis and a same-project current pointer. Ship the typed storage and named local read/save/receipt operations independently of the form. Reuse the trusted project title/language provenance from #216. Setup-confirmed document language is read through the project and is immutable. Represent an unset profile explicitly. An initial save may contain partial facts. Saving changes only the submitted keys, checks the expected current revision and appends the attributed revision and receipt atomically. Expose an exact previous-version read and changed field keys for affected plans and focus.[^workflow][^data][^adr35][^storage]

Use a closed schema version and these initial field groups. Research context includes thesis level/modality, institution/program, discipline/approach, interests, goals, working point, target-language needs and existing topic, questions and objectives. Requirements include estimated length, institutional requirements, citation practice, integrity and AI-use conditions, restrictions and academic support. Schedule includes deadline, intermediate milestones and weekly availability. Readiness includes prior experience, autonomy, tools, difficulties and voluntarily supplied adaptations. Prior work includes bibliography, corpus, data, methods, passages and decisions. Represent length and target-language needs as attributed text, date-only values as real ISO calendar dates, weekly availability as whole minutes from 0 to 10,080 and milestones as title plus an optional date. Preserve explicit unknown and inapplicable states, and separate them from the numeric value zero. Use the stable keys `thesis_level`, `modality`, `institution`, `program`, `discipline`, `approach`, `interests`, `goals`, `working_point`, `target_languages`, `topic`, `questions`, `objectives`, `estimated_length`, `institutional_requirements`, `citation_practice`, `integrity_conditions`, `ai_use_conditions`, `restrictions`, `academic_support`, `deadline`, `milestones`, `weekly_availability_minutes`, `experience`, `autonomy`, `tools`, `difficulties`, `adaptations`, `bibliography`, `corpus`, `data`, `methods`, `passages` and `decisions`. Use lists for interests, goals, target languages, questions, objectives, institutional requirements, integrity and AI conditions, restrictions, support, milestones, tools, difficulties, adaptations and prior-work groups. Each known value or known list item is a typed value with an attributed origin. Use researcher statement, described supporting material or an exact allowed artifact version. Preserve a separately stored agent proposal and its producer when the researcher adopts it explicitly. The remaining fields take attributed text, the deadline date or the weekly minutes as defined above. A report about a source can remain unverified. Resolve a linked artifact only through same-project versioned reads.[^workflow][^product][^data]

For this initial schema cap a text fact at 2 KiB UTF-8, each list at 16 items and the canonical encoded revision including provenance at 32 KiB UTF-8. A rejected excess leaves pending input available for correction and the previous revision intact. A verified migration keeps existing theses usable before any profile exists. Document this field inventory, revision/provenance shape and limits in `docs/data-model.md` with the implementation. Verify a former schema, a partial first revision with an unknown date, invalid dates or origins, emoji at the byte boundary, stale update, same-operation replay and process restart.[^storage][^port][^adr35]

### SPEC-004-012: Review an exact profile version

Attach the review controls and version summary to the existing Research profile tab supplied by STORY-004-022. The tab's summary shows whether the saved profile has been reviewed, the exact last reviewed version when known, and whether the current saved version differs. A pending edit is visible as unsaved and never inherits a review. Review uses the selected saved version and the explicit confirmation command. The form and navigation remain usable while review is unavailable.[^profile-document-view][^workspace][^adr35]

Compose an inspectable synthesis of stored facts, applicable constraints, disagreements, coverage and unresolved items from STORY-004-004. Use existing `ProposalCard` and research review controls where suitable. Show for correction the researcher statement, source-backed evidence and Ohtia/agent reformulation with exact actor/version links. Deterministic local synthesis and a locally constructed test proposal establish the review contract without a live provider. Only a separate researcher command can confirm, reject or leave a question unresolved. Correction uses the profile edit authority and makes any prior review of different data historical.[^workflow][^presentation][^product][^adr35]

Commit a human decision for exactly the version and scope presented, with actor, observed time, evidence and remaining conditions. Refuse wrong-project or stale decisions, preserve historical review even if the current profile changes and indicate which planning requirements need renewed review. Expose the resulting typed review receipt for Onboarding closure. Distinguish decisions about profile accuracy from external approvals. The later guidance capability can submit attributable proposals through this established model.[^workflow][^data][^adr35]

Generate the local synthesis with the current interface locale. Keep quoted evidence in its original language and retain the generation locale when a rendered summary is saved with a decision. Document the review reference, actor, scope and unresolved conditions in `docs/data-model.md`.[^data][^workspace][^workflow]

### SPEC-004-013: Record stage entry and reentry

Own the stage entry/reentry command and its project-local read projection. Use the trusted project scope from #218 and profile context from STORY-004-004. Keep stable stage IDs `onboarding`, `topic_problem`, `literature`, `methodology`, `investigate`, `describe`, `interpret` and stored states `not-started`, `in-progress`, `done`. Admit entry only from not-started and reopening only from a done milestone that has an inspectable record. Both successful operations set `in-progress`. Treat a missing stage record as `not-started`. The first entry checks that the row is still absent and creates one transition and receipt in the same transaction. Concurrent first entries cannot record two starts. Leave focus selection, blockers and institutional approvals separately owned. The disposition of a refused or blocked decision preserves earlier records.[^workflow][^adr35][^port]

A decision carries the confirmed project and stage IDs, operation and expected stage revision, preceding state and transition type, actual actor and observed time, reason, supporting profile/artifact versions and remaining conditions. When reopening, require a nonblank researcher reason and reference the exact prior reviewed decision. Record the affected outputs as references from that decision and the condition for the next review. Keep the original completion and its reviewed versions available. Reopening does not change the underlying outputs or copy their approval to new versions. Typed snapshots expose availability and reasons even if the later workflow is not implemented. Record history and receipt atomically. The integrated A closure is owned separately. The producer can verify entry and reopening against a previously recorded reviewed fixture in real SQLite. Document the stage and history invariants in `docs/data-model.md`.[^data][^workflow][^storage]

### SPEC-004-014: Choose the current research focus

Use the entered stage and dated decision history from STORY-004-006 in the Navigator from STORY-004-023 to show the initial latest started/reopened stage when applicable. Let the researcher record one explicit current focus on feasible local work, including a suitable activity for an advanced thesis or clarification of a known gap. Make selected focus, stage state and unresolved blocker distinguishable. Several stages may be active. Honor user-selected focus and keep access/permission decisions independent. A blocked step does not prevent unrelated local writing, note-taking or review.[^workflow][^design][^workspace]

Persist the chosen focus with the actual evidence, expected version and scope. If linked profile conditions change, flag the focus for review. Use the active stage from STORY-004-006, change signals from STORY-004-004 and the researcher selection as the inputs. The later action suggestion list can offer candidates using this same command. The focus story can finish with a real researcher choice from current deliverable work, without algorithmic suggestions or a recorded Onboarding closure. Verify new and advanced thesis scope, recent reentry default, independent blockers, stale focus version, altered profile and restart.[^workflow][^adr35][^data]

When a later-stage activity is unavailable, preserve the stage and its availability reason. Keep a still-feasible explicitly chosen focus. If there is no such focus, offer a feasible local action to capture known context or resolve a prerequisite, or show that no focus is selected. Offer a separate human confirmation before creating or replacing a focus. When no stage has started, allow an independently available local focus and keep all stage states unchanged. Record the focus revision and referenced inputs in `docs/data-model.md`. The selection command can also record an optional Ohtia suggestion origin with stable action identity, the wording and locale actually accepted, and the input revisions. Validate this metadata and the focus inputs in the same transaction. Direct researcher selection remains usable without a suggestion generator.[^workflow][^data][^design]

### SPEC-004-015: Suggest feasible next actions

Use the scoped profile from STORY-004-004, activity and blocker availability from STORY-004-006, and confirmed focus and selection command from STORY-004-007. In the Navigator from STORY-004-023, use the `WeeklyActions` surface and keep its heading available when there are no feasible candidates. Identify the suggestions as Ohtia proposals. Show at most five actions, normally three to five, and highlight one feasible action for this session within the same list. Explain why the list is shorter when recorded context supports fewer actions.[^product][^design][^workflow]

Generate candidates from a fixed catalog of delivered local actions. For the initial delivery include capturing interests, reporting an existing question or constraint and clarifying an unknown deadline. Expose additional actions, such as reviewing a saved profile, only when the capability and real inputs are available. Core suggestions can be verified with local profile and stage records and the delivered focus command. For each candidate give its objective or milestone, relevant artifact when present, reason, required input or connection, prerequisites, observable completion evidence, a grounded effort estimate or explicit uncertainty, and a response to a foreseeable obstacle. Exclude actions whose capability, permissions or required inputs are absent and explain an actionable blocker separately. For the same scoped inputs, order interchangeable feasible candidates consistently. Prefer a still-feasible confirmed focus, then prerequisite work for the current milestone, then clarification that removes a blocker, then schedule-sensitive work when planning facts justify its priority. Break ties by the stable candidate identifier. An unknown date can prompt clarification. An inapplicable date or a failed read carries its own state. This EPIC supplies no pace metric without an agreed plan and availability.[^workflow][^design][^presentation][^adr23]

Recompute the list from current records. Let the researcher change priority by selecting a feasible candidate and confirming it through the existing focus command. Keep the prior focus until the matching receipt. Recheck the proposed action against current scope and input versions on confirmation. A suggestion or a preview does not start a task, complete a stage or create a weekly-plan record. Pass the accepted suggestion's wording, locale, stable action identity and input revisions to the focus command's suggestion origin. Display unchanged historical wording even after an interface locale change. New suggestions use the current locale and preserve quotations in their original languages. Opening the Navigator, seeing a suggestion or choosing a local focus launches no inference.[^workflow][^data][^presentation][^product]

### SPEC-004-016: Confirm the Onboarding milestone

Review the exact profile synthesis decision (STORY-004-005) and exact selected focus (STORY-004-007) in the Onboarding stage whose entry and version authority come from STORY-004-006. Present review and confirmation within the Navigator from STORY-004-023. Record the human decision, versions, supporting representations, scope, reason, observed time and remaining conditions. Use typed messages, the existing review controls and keyboard, localized and packaged assistive checks for the milestone action. Allow the researcher to record specifically unresolved questions and continue work that has its inputs. Only an `in-progress` Onboarding stage can be closed. Use a dedicated human confirmation of the exact review and feasible focus. The trusted stage transaction compares the expected stage revision and state even if the view hid the action. A nonessential open field does not block it. An unresolved condition that prevents a supported focus keeps the stage in progress. This condition applies only to closing A.[^workflow][^adr35][^roadmap]

Use the existing stage read/transition boundary for the explicit A closure. Reopen retains the earlier profile, focus and decision and marks a related later result for review when its actual inputs change. A profile confirmation, a focus choice, an agent response, typing and an external approval cannot independently change stage status. Verify refusal from `not-started` and `done`, conflicting profile/focus changes and replay, and a real partial profile with a feasible move. Verify that a blocker on the reviewed focus keeps A in progress. In this story, start A in the test through the delivered stage command; the real start and reopen UI is exercised in the EPIC integration. The independent stage entry and reentry tests use the stored transition shape.[^workflow][^adr35]

Record the exact profile review, focus revision and stage outcome references in `docs/data-model.md` as part of this story.[^data][^adr35]

### SPEC-004-017: Request bounded Virgilio onboarding guidance

Reuse the effective `direct_guidance` operation policy delivered through #234, including provider eligibility, time, attempt, retry and concurrency limits. Offer Ask Virgilio about Onboarding beside the existing `MessageComposer` in the selected Virgilio conversation of the setup-confirmed thesis. The preview shows the researcher's question, selected profile facts, current stage and any selected review or focus wording. Show the eligible conversation entries to be sent and identify omitted context. Keep ordinary composer input intact. Confirm and send is the sole admission action for this request. Cancelling or switching the project or conversation before confirmation clears the preview authority.[^virgilio][^epic3][^frontend][^adr51][^adr52]

Resolve selected facts from the exact same-project profile revision in STORY-004-004. Read stage and availability from STORY-004-006, the relevant versioned review from STORY-004-005, and current focus from STORY-004-007. Permit zero to eight explicitly selected facts and 16 KiB UTF-8 of added encoded Onboarding context in total. An unset profile permits a scoped clarification request with zero facts. Send only previewed review or focus text. Where that text would expose unselected profile fields, send its scoped revision references and selected facts instead. Include the confirmed document language and the previewed eligible conversation entries within the existing request budget. Do not add other profile fields, private notes, manuscript bodies, other artifacts or Project Memory entries. A reference to an artifact is not permission to read its body. Capture the intent, approved scope and input references with the admitted task. Recheck restrictions and versions at dispatch, including on retries and after restart. If authorization or a relevant version changed, require fresh confirmation before sending replacement context. Preserve existing records and the question.[^virgilio][^collaboration][^workflow][^adr51][^adr52]

Use the persisted intent to gate both input and effect handling in `packages/utility/src/tasks.ts`. Existing ordinary guidance uses operation and instruction versions to assemble memory, expose tools and apply replies. The Onboarding intent takes a closed set of capabilities: a reply and its typed adjustment proposal. Keep Project Memory out of this request's input, tool list and result application. Refuse unsolicited memory, delegation, plan or handoff effects. Existing ordinary guidance uses its current input and tool rules. Saving the profile or selecting the focus does not itself create a Project Memory entry.[^epic3][^collaboration][^port][^adr51]

Virgilio writes in the document language. A successful attempt may yield a question or explanation and at most one typed proposed profile or focus adjustment, with original producer, grounding, versions, known unknowns and omissions. Validate permitted targets and lengths before committing a proposal through the existing operation outcome/receipt boundary. Invalid typed proposals surface a controlled outcome and produce no proposed mutation. Partial, stopped, obsolete or uncertain replies retain their actual state and cannot masquerade as current. A human later uses the existing profile or focus authority to adopt a proposal. Document the approved context shape, budgets, operation version and outcome policy in the Virgilio operation contract linked by `docs/agents/agent-virgilio.md`.[^workflow][^product][^frontend][^adr35][^port]

Use typed messages for scope and outcome, keyboard and screen-reader presentation, and retained original language. Test an over-budget selection, unrelated fields denied, changed permission between preview and dispatch, stale results after profile correction, offline refusal and deterministic partial replies. Include a restart with stale scope, attempted `update_memory` under the Onboarding intent and a regression case for ordinary guidance. Use actual route qualification evidence within its authorized budget before enabling the new intent. Merely viewing the profile, suggestions or conversation sends nothing.[^evaluation][^design][^verification][^adr23]

### SPEC-004-018: Save researcher notes

Create and reopen a short, researcher-authored project note through the workspace collection/scope contract in STORY-004-001. Attach the pending editor guard in STORY-004-025. Use a stable project-owned note, immutable saved revisions and a current pointer. Keep an explicitly attributed title and body and an optional same-project reference that the researcher selected and the current app can resolve. A thesis with no corpus can save one. Keep notes distinct from agent memory, manuscript, reviewed profile facts and other research records. No note is silently sent to an external provider.[^product][^roadmap][^data][^epic3]

Use utility-owned persistence and scoped display. Validate the bounds, IDs, revisions and optional link. Show distinguishable saving, confirmed, failed, conflict and uncertain states, with recoverable input and restarted reads. Verify stale saves across two windows, replay, failed save and independent recoverability. Scope this increment to create, edit and reopen. Define a separate retention contract before adding destructive note actions.[^storage][^frontend][^workflow]

Record project ownership and note and note-revision cardinalities, current pointer, attribution, optional same-project references and expected-version saves in `docs/data-model.md`.[^data][^storage]

### SPEC-004-019: Validate the canonical title and paragraph subset

Use a bounded TypeScript AST/parser/serializer for the first title and paragraph subset of `ohtia-markdown-v1`. The empty document is the required canonical header alone. Accept an optional single level-one title with a `sec_*` ID and text paragraphs in individually addressed `blk_*` wrappers. Omit an empty UI paragraph from serialization. Preserve literals, escaping and Unicode, and distinguish ordinary line breaks from explicit breaks made with two trailing spaces. Initial inline authoring accepts text and explicit line breaks. Emphasis, links, citations and richer structures are outside this initial editor. An unsupported serialized construct yields a typed refusal and leaves its original bytes intact.[^format][^adr30][^adr31][^data]

Cap canonical text at 128 KiB UTF-8, 256 paragraph blocks and 8 KiB UTF-8 per title or paragraph. Parse the fixed-depth subset with a bounded scan over input bytes and block count. Reject overflow, conflicting or reused IDs, invalid version, ambiguous header or unrepresentable input without partial persistence. Test exact bounds and oversize, title-only, header-only, multiple paragraphs and explicit breaks. Record the subset and literal/emphasis examples in the canonical manuscript format specification and exercise it as semantic parse–serialize–parse before release to storage.[^format][^adr31][^verification]

### SPEC-004-020: Save versioned manuscript records

Consume the typed canonical codec from STORY-004-012 and admitted store from STORY-001-005 (#19). Behind named service operations, create the manuscript and first immutable revision atomically, or save a new immutable revision against the expected current predecessor. Use the canonical `drafts` and `draft_revisions` records from the data model. Keep the UUIDv7 ID, owning project, workspace label in `drafts.title` and current revision pointer in `drafts`. Store each revision with the manuscript ID, parent, optional restoration origin, canonical Markdown TEXT, language, observed timestamp, save reason, content hash and author versus recording actor in `draft_revisions`. Validate the workspace label at the trusted create boundary using the same length and Unicode bounds as project setup. The first revision for a new manuscript is header-only. The current pointer must refer to a revision of the same manuscript. Validate AST/headers, exact retained revision, ownership, expected predecessor and parse/serialize/parse equality before writing. Return one durable outcome/receipt per operation identity. The repository handles committed reads and writes as a single revision service.[^data][^format][^storage][^adr8][^adr31][^adr35]

For locally authored text the immutable project document language supplies the language recorded in new revisions. Display and preserve an existing revision's declared language without inferring it from locale. Preserve future supported import/unknown language semantics and decide any new authored variation in the canonical docs. A real restoration, if later exposed, creates a new revision with prior text and language and a separate origin. The workspace label is independent of the text heading and export filename. A text save changes only manuscript content and revision metadata. No revision may be overwritten by a conflicting save or silently dropped by serialization. Exercise file-backed opening, current pointer and migration, cross-project/foreign revision refusal, replay and concurrent save, including rollback with the old version intact. Expose tested list/read/receipt and create/save operations for the workspace and editor without waiting for a new UI.[^product][^data][^frontend][^storage][^verification]

Record the revision persistence contract and limits in `docs/storage.md` and link the manuscript entities in `docs/data-model.md`.[^data][^storage]

### SPEC-004-021: Open project manuscripts in workspace tabs

Use the project collection and scope events from STORY-004-001 and real manuscript list/read output from STORY-004-013. Open the scoped current version in one stable tab per resource key, reveal the document surface and preserve the conversation selection and its unsent text. Use `drafts.title` as the tab and collection name. Show the actual heading and paragraph content using the exact revision language. The heading has no effect on the tab name. Avoid loading a foreign or deleted ID from restoration. The Navigator remains fixed, first and unclosable. Expose the actual committed manuscript visibility from the selected and mounted visible document surface, including the read-only presentation, irrespective of whether an editor is installed. Handle actual loading, empty, failure, unavailable and populated states on these records.[^workspace][^design][^frontend][^data]

For V09 use two real persisted test manuscripts admitted through the service. Verify unique tabs, manual arrow/Home/End focus and Enter/Space activation, sibling close control/Delete, active/inactive close and focus return, long title truncation with full accessible name and overflow within the tab row. Closing a tab changes selection and leaves the document itself intact. The project switches scope using the real current selection; a rejected restore retains other work. Publish a content/close guard extension point so the later editor can handle pending changes and a newer revision. Viewing and tab lifecycle are verifiable over actual persisted records before the typing UI exists.[^workspace][^presentation][^adr23]

### SPEC-004-022: Save manuscript edits and resolve pending close

Mount STORY-004-026's tested private editor in the actual manuscript tab from STORY-004-014. Connect its pending text and diagnostics to the checked save and receipt operations in STORY-004-013. Creation from the explorer is separately owned. This story can start with a manuscript already saved through the actual service. Preserve editing input and diagnostics across the scope and version checks.[^format][^adr32][^frontend][^data]

Ship explicit save with the version guard and operation receipt, controlled conflict and uncertainty, preserved pending text and confirmed revision announcement. An available newer revision leaves the editor buffer distinct. Use tab and project guards from STORY-004-014 and STORY-004-025. When unsaved content requires a decision, apply Save and close, Keep open and Discard and close with initial focus on Keep open. A failed or uncertain save holds the buffer and scope. Use V09 to verify local edits in two tabs and a concurrent revision. Grouped autosave extends this verified manual path in its own story.[^workspace][^frontend][^design][^presentation][^adr23][^data]

### SPEC-004-023: Present the confirmed Onboarding milestone

Bind explicit successful confirmation of milestone A from STORY-004-009 to the documented `Milestone` pose. Use the committed transition identity, original event batch and a localized accessible text notice. Only a current live event is eligible. Ordinary guidance and missing evidence stay in their attributed text surfaces. Source-contradiction presentation is outside this EPIC.[^character][^character-api][^design][^peer-feedback-publication]

Use the committed Navigator surface from STORY-004-023 and read-only manuscript visibility from STORY-004-014. Reuse the character API and cancellation patterns from #50 and #233. A visible manuscript gets the text notice and static compact glasses. A milestone can animate once in an eligible batch when Animated is effective and the manuscript is out of view. Replayed or restored events remain static. Cancel motion immediately for nonanimated modes and reduced motion.[^roadmap][^workspace][^design][^character-api]

Preserve the controller's one-pending-event limit and replay/cancellation tests for the existing eligible deferral behavior. The design system assigns that behavior to a qualified contradiction between sources. Milestone A has no deferred animation. Verify the current milestone's project, revision, batch and actual visibility. Record this product binding in `docs/character-presentation.md`.[^character][^character-api][^design]

### SPEC-004-024: Inspect the managed store location

Provide the fixed, admitted account-native managed store location and controlled availability status in Settings. Extend the existing Settings composition and `packages/main/src/locator.ts` via named broker-approved presentation state. STORY-001-005 (#19) supplies the actual admission boundary. Display safe sensitivity information and truthful unavailable state when no locator is admitted. An invalid or ambiguous location does not select another store. The adopted ADR leaves relocation to a future decision. Verify the displayed native location and absence of fallback or arbitrary path reads with real admission, missing locator, protected permissions and unqualified profile.[^adr36][^frontend][^storage][^roadmap]

### SPEC-004-025: Recover a verified migration checkpoint

Extend the same broker and startup recovery in `packages/renderer/src/application-root.tsx` and Settings as two entries to the same verified recovery capability. STORY-001-005 (#19) delivers the verified checkpoint path. Use the existing Settings navigation and broker recovery projection for the Settings entry. The location display is independent. Expose the verified pending migration checkpoint through the existing `restoreCheckpoint` and compatible Retry path. Show its available facts, sensitive data and rollback implications before confirmation. Preserve the startup action when storage admission prevents reaching Settings. Validate manifest, source/target build, artifact/engine, integrity, foreign keys and inventory before materializing a separate store. Persist restore intent before moves, isolate failed journals, preserve failed copies and clean them only after verified existing admission rules permit. Incompatible builds, missing or corrupt snapshots, denial or interruption preserve research and evidence with actionable controlled outcomes. Never resume external work as a recovery effect.[^adr10][^storage][^frontend][^roadmap]

Exercise the real packaged storage harness (`tooling/storage-acceptance.mjs` and native inventory) on corrupt and missing checkpoints, interrupted path, permission failure, differing builds and actual successful admitted recovery followed by restart. Identify the snapshot linked to the verified pending migration. Explain that it is sensitive managed recovery material. Evaluate an unavailable Settings entry and the still-reachable startup recovery independently. General backups and arbitrary location selection are later scope.[^adr10][^storage][^verification]

### SPEC-004-026: View bounded diagnostic records

Use the broker-owned capped writer and catalog from STORY-001-006 (#20) in `packages/main/src/diagnostic-writer.ts` and `packages/contracts/src/diagnostics.ts`. A named read operation exposes bounded pages from the active managed file and retained archives, rendering only supported version-aware fields as text with UTC time, severity and controlled event name. The existing writer enforces at most five managed files of up to 5 MiB each and scans up to 64 records per page. Its current read input is a managed file slot and byte offset. Use a bounded continuation identifying the current managed file generation and byte offset. Validate both within the writer's serialized read. Keep no per-window cursor registry. Rotation or deletion invalidates that continuation. Refresh starts at the first page of the current file. Show controlled invalid/unsupported or rotated/unavailable conditions instead of raw lines or arbitrary paths. Early bootstrap remains graphical until a validated log root exists. Verify native bounds, rotated cursor/read outcomes and sensitive-marker exclusion in the viewer and broker.[^adr13][^diagnostics][^frontend][^evaluation]

Record the bounded viewer and invalidation behavior in `docs/diagnostics.md`.[^diagnostics][^adr13]

### SPEC-004-027: Delete retained diagnostic logs

Use the same broker writer boundary from STORY-001-006 (#20). A named diagnostic operation requires explicit confirmation and uses the existing `DiagnosticWriter.deleteLogs` serialization to remove only managed active and retained diagnostic files. Use its returned deleted count and controlled result. A later event can recreate the active log. Report controlled partial deletion and subsequent refresh failure independently. An uncertain reply leaves a refresh path for the actual managed state. A new deletion request requires a fresh confirmation so that a repeated click cannot silently remove newly collected logs. Scope the confirmation to locally retained technical diagnostics. Research history, revisions, task/attempt and receipt records remain intact. Prior user-shared copies and forensic erasure are outside the action. The standalone action can verify against the existing broker and Settings feedback. Verify concurrent append/delete, denied I/O, unrelated files and preserved research data with native cases.[^adr13][^diagnostics][^frontend][^verification]

Record destructive confirmation, partial outcome and refresh versus retry semantics in `docs/diagnostics.md`.[^diagnostics][^adr13]

### SPEC-004-028: Save a reviewed diagnostic bundle

Prepare one broker-owned immutable snapshot from version-1 validated records in the selected retained files and UTC observed-time range. Use a UTF-8 JSON object with `schema_version: 1`, the UTC range and `records` in stable observed-time order, breaking ties with managed slot and byte offset retained only internally. Export only observed timestamp, optional event timestamp, severity, event name, service name/version and catalog-validated component, operation, outcome, error code and duration when present. Exclude correlation IDs, paths, raw lines, document or provider content and unsupported schemas. Use the current writer bounds and admission. Cap the input to its five managed files and the encoded snapshot to 1 MiB. Count refused or unsupported records visibly. If the selection exceeds the encoded cap, refuse and ask for a narrower range without saving a partial package.[^adr13][^diagnostics][^frontend]

Keep one prepared preview for the current save flow, within the encoded cap. Replacing or cancelling the preview or disposing its initiating window discards it. Reuse the existing scoped port and native picker. After the picker returns, confirm the approved snapshot is still current for that flow and save exactly the previewed bytes. Rotation or append leaves those bytes unchanged. Use the validated same-directory temporary-file and atomic replacement path, preserving any prior file on failure and clearing uncommitted data. Document the format, limits, allowlist and preview/save behavior in `docs/diagnostics.md`. Verify byte equality after rotation, replacement while the picker is open, cancellation, other-window refusal and sensitive-marker exclusion.[^evaluation][^adr13][^verification]

### SPEC-004-029: Profile and Navigator version contract

The trusted utility reads each project-owned record by opaque identity and revision. A profile revision is an immutable set of attributed values and unresolved conditions. A human review references the exact profile revision and evidence/scope reviewed. The stage record carries the stage's own state and transition history. The selected focus records an explicit researcher choice and the specific profile and stage inputs it relied on. A derived suggestion retains the versions it consulted for presentation. It becomes a chosen focus only through the explicit selection command supplied by the focus story. Missing values retain their actual meaning.[^data][^workflow][^adr35][^port]

Compare the expected record versions and scoped relationship between them inside the transaction that accepts a new research decision. For Onboarding completion, check that the stage is in progress at the expected version, that the named human review covers the current profile, and that the named focus is still confirmed and feasible against its inputs. Commit the new stage state, reason, reviewed references and receipt together. If a relevant version changed before commit, leave the stage and its history unchanged, return a controlled stale result and reread the affected records before seeking a fresh decision. Reopening preserves the earlier decision and its exact reviewed references. Technical deduplication uses the operation receipt and stays independent of a subsequent edit.[^workflow][^adr35][^storage]

Each story verifies stale inputs at the boundary it owns. For milestone closure, STORY-004-009 tests concurrent edits to a reviewed profile or focus before confirmation. The stale command preserves the stage and its history. The researcher can inspect the earlier inputs, confirm the refreshed versions and replay that operation without creating a second transition. The EPIC owns verification across the actual delivered screens.[^workflow][^storage][^verification]

### SPEC-004-030: Edit the profile in the workspace

For a setup-confirmed thesis, add Research profile to the project explorer next to the existing project-level entries. Open or activate its single tab in the Documents panel. Use a stable key scoped to the project and the profile resource so a save, another open action or a jump from Navigator leaves a single tab. Use the scoped collection and selection contract from STORY-004-001. Follow the workspace tab and focus conventions, preserve conversation selection, and cancel or disregard late results whose project selection is obsolete. An empty saved profile opens the progressive form and leaves unknown facts explicit. Opening or editing the tab starts no inference.[^profile-document-view][^workspace][^frontend][^workflow]

The first view shows known and pending facts and identifies the saved version. The review slot shows the exact reviewed version when the review feature is available. Organize the form into five groups covering the versioned profile schema. Research contains `discipline`, `approach`, `interests`, `goals`, `working_point`, `topic`, `questions` and `objectives`. Requirements and support contains `thesis_level`, `modality`, `institution`, `program`, `estimated_length`, `target_languages`, `institutional_requirements`, `citation_practice`, `integrity_conditions`, `ai_use_conditions`, `restrictions` and `academic_support`. Show the confirmed thesis language there as read-only project metadata. Schedule contains `deadline`, `milestones` and `weekly_availability_minutes`. Experience and resources contains `experience`, `autonomy`, `tools`, `difficulties` and `adaptations`. Prior work contains `bibliography`, `corpus`, `data`, `methods`, `passages` and `decisions`. Distinguish unknown, pending and inapplicable values and display their attribution where available.[^profile-document-view][^workflow][^data]

Offer a project-scoped open action with an optional stable section target. A direct open follows the tab's normal focus behavior. A request to open a section activates the same tab, reveals the section and places focus at its heading or primary entry point. This preserves pending input and scope guards. Document the explorer entry, single Documents tab and section target contract in `docs/workspace-layout.md`.[^profile-document-view][^workspace][^frontend]

Render and edit the local profile backed by STORY-004-004, using the real setup and project form from #217 and the window guard from STORY-004-025. Ask about the target date early and allow explicit unknown. Show confirmed document language separately from interface locale. Prompt progressively by field group and let the researcher save partial work, resume it after restart and compare local pending changes with the confirmed profile. Keep reported evidence links, uncertainties and unavailable later capabilities distinguishable. Existing or advanced thesis material can be attributed without inferring a formal milestone.[^workflow][^frontend][^epic3]

Present UI labels and deterministic Ohtia descriptions using the active interface locale. For a persisted app-authored note or action label, retain the language used when it was generated. Do not translate or relabel quoted evidence, researcher statements or agent replies when locale changes. The exact review and focus behavior remain in their respective stories.[^product][^presentation][^design]

### SPEC-004-031: Read stage context in Navigator

Use STORY-004-006's read projection and STORY-004-004's profile fields in the existing fixed Navigator tab and explorer entry. Render the selected thesis's stage, purpose, expected outputs, available prerequisites/material, applicable activity and remaining conditions, with separately displayed blockers, pending decisions and reviewed history. Keep the actual iteration and thesis workflow stage IDs, and show an actionable reason for an unavailable later capability. Opening the surface or refreshing it starts no inference. Expose a scoped committed surface and selection event for the attention consumer.[^workflow][^workspace][^design][^presentation]

Show the one saved thesis deadline directly in Navigator in the interface locale. Treat it as a calendar date without a time-zone shift. A missing or explicitly unknown date shows a pending state. Keep an inapplicable date and an unavailable profile read distinguishable from a pending date. The Schedule section of the Research profile holds the deadline, any separately dated milestones and weekly availability. Offer a scoped link to Schedule when the researcher needs to add or edit the deadline or see the milestones. For other stage issues or next steps, link to the relevant profile section through the same open action from STORY-004-022.[^navigator-deadline-display][^profile-document-view][^workflow][^workspace]

Activate the existing profile tab and reveal the relevant section without duplicating the editor or changing saved data. Directions from a stale project selection are ignored. Verify new and advanced thesis snapshots, read/loading/unavailable states, retained prior review, switching during delayed reads and no implicit start on open. The display can show existing entry decisions through its real read contract. The separate command producer owns persistence and in-progress transition semantics. Document the read projection and committed surface behavior in `docs/workspace-layout.md`.[^workspace][^frontend]

Expose a scoped stage-actions slot that accepts actual eligible controls. The read-only surface can ship while the slot is empty. Verify keyboard navigation and committed focus when a control is available.[^workspace][^frontend]

### SPEC-004-032: Group manuscript autosaves

Add a grouped autosave scheduler to the manual editor in STORY-004-015. Schedule after 1 second without an edit and no sooner than 1 second after IME has committed. A new edit resets the timer. Do not send during IME composition, after the project/tab loses its originating scope, or while a save for that manuscript awaits a response. Capture the buffer and revision at dispatch and use the existing checked save and receipt semantics. On a successful acknowledgement, keep newer local text dirty, advance its save base to the acknowledged revision and re-evaluate the idle timer if the original editor is still active. Dispatch at once if the quiet interval has already elapsed and no IME composition is active. Reconcile the original operation ID on an uncertain outcome. A stale revision stops automatic retries and offers the same manual review or recovery path. A confirmed newer revision must never replace pending text.[^frontend][^adr32][^workspace]

Use a controlled clock for burst grouping, an edit during a pending save with no subsequent keystroke, two windows, lost receipt, conflict and epoch changes. Use packaged IME and V09 to confirm a group produces the expected single revision and no premature or duplicate announcement. Document scheduling and failure behavior at the manuscript revision contract in `docs/storage.md`.[^storage][^presentation][^verification]

### SPEC-004-033: Protect pending work before project detach

Provide a renderer-local pending-work guard registry for the active window and project selection epoch. Registrations return a disposer and resolve to safe to detach, keep open, or pending confirmation. Capture the scope at evaluation and reject stale registration results before detaching. A dirty form can choose safe save, deliberate discard or keep open through its own guard. The mechanism leaves application-level startup ordering and any project command to their owning story. Verify it independently through the existing composer and controlled new editor adapters, including clean, declined, failed save, overlapping decision, disposal and epoch switch.[^workspace][^frontend][^epic3]

Expose a read-only lease from `ProjectController` for the current project selection. The lease exposes a freshness check backed by the private epoch and is revoked when the selection changes. Guard consumers do not mutate the underlying controller. Test A→B→A so equal project identifiers cannot revive an earlier lease.[^port][^workspace][^epic3]

### SPEC-004-034: Thesis entry paths for topic definition

Use the researcher's current situation and the existing attributed profile fields to propose a useful next step. With no topic, record interests, questions, constraints and available material. If there is too little context to suggest a direction, ask one useful clarification. On an explicit guidance request, Virgilio may suggest two plausible angles as a starting point when the actual context supports them. Preserve their tentative status and the researcher's reasons for pursuing or discarding an option. Two is an example and does not set a required number of candidates.[^workflow][^thesis-entry-clarification]

Exploratory search, formal comparison and the Topic–Problem (B) outcome are outside this EPIC. An optional plan can start with a few pertinent articles about each viable angle and compare interest, relevance, access and feasibility. The workflow's baseline of five to ten relevant references applies to each candidate that reaches final comparison. An early rejection retains the reason. Access and coverage limits remain explicit. These articles serve as potential sources for the thesis project. While search is unavailable, offer an achievable local action such as capturing an interest, a tentative question or a reference the researcher already has. Show that search needs a later capability and make no search claim. Opening either view starts no search or inference.[^workflow][^roadmap][^thesis-entry-clarification]

A researcher with a chosen topic can work directly on delimitation and the question when those actions are available. If the question is already bounded and supported by existing work, preserve the reported grounds and advance to the first available task whose inputs and permissions hold. Present only gaps that actually affect that task. A completed comparison and a forced second option are never entry prerequisites. The researcher explicitly selects a focus, and actual reviewed evidence governs stage state. A missing search or later-stage feature does not block profile edits, notes or writing the working thesis text.[^workflow][^roadmap][^thesis-entry-clarification]

### SPEC-004-035: Edit the canonical title and paragraph subset

Build the private ProseMirror adapter for the bounded TypeScript codec from STORY-004-012. Expose structured content and typed validation results at the adapter boundary. Use the supplied working text and document language, and return pending changes to the caller. Use the stable block identity rules on edit, split, merge and paste. Preserve recoverable input when clipboard content cannot be represented in the supported subset.[^format][^adr31][^adr32][^frontend]

Exercise title and paragraph editing, undo/redo, clipboard, keyboard and actual native Korean IME in an isolated packaged editor fixture on the shared platform contract. Include clean disposal and unsupported paste. This story delivers an editor API callable with approved test data. Saving SQLite revisions and tab-close behavior consume the tested editor in a separate story.[^workspace][^design][^verification]

### SPEC-004-036: Start or reopen a stage from Navigator

Use the stage transition and reviewed history contract from STORY-004-006 inside the Navigator surface from STORY-004-023. A setup-confirmed thesis with no Onboarding entry shows A as not started. Show Start Onboarding beside the stage status. Present the current context and remaining conditions and accept an explicit human confirmation. Project creation and opening the view leave the stage unchanged. A missing profile can be represented as pending context and does not prevent starting A.[^workflow][^roadmap][^adr35]

For a supported done stage, show Reopen stage and identify the earlier reviewed decision. Require a reason and an explicit confirmation. Show the affected outputs and next review condition before sending the expected stage revision and known evidence references through the transition command. A successful receipt returns the stage to in-progress and retains the earlier review. Cancel, conflict and uncertain results preserve the prior confirmed view and entered reason for recovery. Reuse the same surface for starting and reopening. Respect actual capability availability and keep independent local work reachable before any stage decision.[^workflow][^workspace][^frontend][^port]

Verify the two controls against the real service using a newly setup-confirmed thesis and a test-only completed milestone fixture installed in the real SQLite record shape from stage entry and reentry. The integrated EPIC fixture confirms A through its real UI before reopening it from Navigator.[^workflow][^verification]

Place initial focus on the stage action's confirmation, then return focus to that action or to the updated stage heading after success. Present dates, reasons and controls through typed localized messages and the existing keyboard-accessible dialog primitives.[^workspace][^design][^presentation]

### SPEC-004-037: Create a manuscript from the project explorer

Add the New manuscript action to the manuscript collection in the active setup-confirmed thesis. Use the real scoped collection and tab contract supplied by STORY-004-014. The action presents a short name field prefilled with the localized string Untitled manuscript. Use this name as the saved workspace label. The user can change it before creation. Trim the submitted label and accept 1 to 200 Unicode scalar values without U+0000. Use the same length and Unicode bounds as project setup. Keep its typed value after an uncertain or rejected save. The action is available whether or not the researcher has chosen a thesis topic.[^workspace][^data][^workflow]

Use STORY-004-013's checked create-and-receipt operation. Create the record and a header-only first revision together, using the confirmed document language. Store the label as `drafts.title`. On the matching success receipt open the one manuscript tab and focus its document surface if the captured project scope is still active. If the scope changed, retain the created manuscript in its original project and keep the new workspace untouched. This story verifies creation through the real explorer and SQLite, with the read-only tab available before text editing. Reconcile a lost acknowledgement using the same operation identity.[^port][^storage][^data][^workspace]

The collection and tab show the saved workspace label. The optional title heading inside the manuscript belongs to its canonical text. Editing that heading leaves the label unchanged. The initial slice lets the user set a label during creation. Rename after creation is outside this EPIC.[^format][^data][^workspace]

Use an accessible name field and return focus to the initiating control after cancellation. Validate the scoped action and bounded label on the trusted service boundary. Record the creation action in `docs/workspace-layout.md` and the workspace label semantics in `docs/data-model.md`.[^workspace][^data][^port]

## Affected components

- **Application.** Current project operations, thesis profile and review, Navigator, notes, manuscript view/editor and Settings.
- **Storage.** Project and research record revisions, receipts, exact review decisions and verified recovery.
- **Desktop.** Trusted broker scope, diagnostics, filesystem and native presentation.
- **Inference.** Explicit onboarding guidance over the existing operation authority.

## Dependencies

| Producer      | Consumer      | Output         | Phase     | Release condition | Projection | Spec         |
| ------------- | ------------- | -------------- | --------- | ----------------- | ---------- | ------------ |
| STORY-004-025 | STORY-004-003 | Close guard    | integrate | Scope checks      | documented | SPEC-004-010 |
| STORY-004-004 | STORY-004-005 | Profile read   | integrate | Revision checks   | documented | SPEC-004-012 |
| STORY-004-022 | STORY-004-005 | Profile tab    | integrate | Tab checks        | documented | SPEC-004-012 |
| STORY-004-004 | STORY-004-006 | Profile read   | integrate | Revision checks   | documented | SPEC-004-013 |
| STORY-004-004 | STORY-004-007 | Profile change | integrate | Version checks    | documented | SPEC-004-014 |
| STORY-004-006 | STORY-004-007 | Stage history  | integrate | Reentry checks    | documented | SPEC-004-014 |
| STORY-004-023 | STORY-004-007 | Navigator      | integrate | Surface checks    | documented | SPEC-004-014 |
| STORY-004-004 | STORY-004-008 | Profile facts  | integrate | Unknowns checks   | documented | SPEC-004-015 |
| STORY-004-006 | STORY-004-008 | Stage status   | integrate | Stage checks      | documented | SPEC-004-015 |
| STORY-004-007 | STORY-004-008 | Focus          | integrate | Focus checks      | documented | SPEC-004-015 |
| STORY-004-023 | STORY-004-008 | Navigator      | integrate | Surface checks    | documented | SPEC-004-015 |
| STORY-004-005 | STORY-004-009 | Profile review | integrate | Review checks     | documented | SPEC-004-016 |
| STORY-004-006 | STORY-004-009 | Stage record   | integrate | Reentry checks    | documented | SPEC-004-016 |
| STORY-004-007 | STORY-004-009 | Chosen focus   | integrate | Focus checks      | documented | SPEC-004-016 |
| STORY-004-023 | STORY-004-009 | Navigator      | integrate | Surface checks    | documented | SPEC-004-016 |
| STORY-004-004 | STORY-004-010 | Profile read   | integrate | Revision checks   | documented | SPEC-004-017 |
| STORY-004-006 | STORY-004-010 | Stage read     | integrate | Scope checks      | documented | SPEC-004-017 |
| STORY-004-005 | STORY-004-010 | Profile review | integrate | Review checks     | documented | SPEC-004-017 |
| STORY-004-007 | STORY-004-010 | Focus          | integrate | Focus checks      | documented | SPEC-004-017 |
| STORY-004-001 | STORY-004-011 | Collections    | integrate | Scope checks      | documented | SPEC-004-018 |
| STORY-004-025 | STORY-004-011 | Close guard    | integrate | Scope checks      | documented | SPEC-004-018 |
| STORY-004-012 | STORY-004-013 | Manuscript AST | integrate | Round-trip checks | documented | SPEC-004-020 |
| STORY-004-001 | STORY-004-014 | Collections    | integrate | Scope checks      | documented | SPEC-004-021 |
| STORY-004-013 | STORY-004-014 | Revision read  | integrate | Revision checks   | documented | SPEC-004-021 |
| STORY-004-013 | STORY-004-015 | Revision save  | integrate | Revision checks   | documented | SPEC-004-022 |
| STORY-004-026 | STORY-004-015 | Editor API     | integrate | Native IME checks | documented | SPEC-004-022 |
| STORY-004-014 | STORY-004-015 | Document tabs  | integrate | Tab checks        | documented | SPEC-004-022 |
| STORY-004-025 | STORY-004-015 | Close guard    | integrate | Scope checks      | documented | SPEC-004-022 |
| STORY-004-009 | STORY-004-016 | A decision     | integrate | Receipt checks    | documented | SPEC-004-023 |
| STORY-004-014 | STORY-004-016 | Visibility     | integrate | Tab checks        | documented | SPEC-004-023 |
| STORY-004-023 | STORY-004-016 | Navigator      | integrate | Surface checks    | documented | SPEC-004-023 |
| STORY-004-001 | STORY-004-022 | Explorer       | integrate | Scope checks      | documented | SPEC-004-030 |
| STORY-004-004 | STORY-004-022 | Profile read   | integrate | Revision checks   | documented | SPEC-004-030 |
| STORY-004-025 | STORY-004-022 | Close guard    | integrate | Scope checks      | documented | SPEC-004-030 |
| STORY-004-004 | STORY-004-023 | Profile facts  | integrate | Revision checks   | documented | SPEC-004-031 |
| STORY-004-022 | STORY-004-023 | Profile link   | integrate | Section checks    | documented | SPEC-004-031 |
| STORY-004-006 | STORY-004-023 | Stage record   | integrate | Reentry checks    | documented | SPEC-004-031 |
| STORY-004-015 | STORY-004-024 | Manual save    | integrate | Native tab checks | documented | SPEC-004-032 |
| STORY-004-012 | STORY-004-026 | Codec          | integrate | Round-trip checks | documented | SPEC-004-035 |
| STORY-004-006 | STORY-004-027 | Stage command  | integrate | Reentry checks    | documented | SPEC-004-036 |
| STORY-004-023 | STORY-004-027 | Navigator      | integrate | Surface checks    | documented | SPEC-004-036 |
| STORY-004-013 | STORY-004-028 | Create receipt | integrate | Revision checks   | documented | SPEC-004-037 |
| STORY-004-014 | STORY-004-028 | Manuscript tab | integrate | Tab checks        | documented | SPEC-004-037 |

The table records integration conditions between the stories in this EPIC. Each consumer can start against the agreed contract and verifies the producer's output at integration. Earlier delivered components are starting points. Their issue references identify existing implementation and evidence for each story's own verification.

## Execution order

- **Project work.** The guard and composer consumer can close before the close command, profile form, notes or editor. No data or UI setter requires the command that detaches the window. The independent profile store and the scoped explorer feed the profile form and tab. Review attaches to the available tab, and Navigator consumes its section links. Form development and verification do not depend on either consumer.
- **Navigator.** Stage decisions feed the read-only Navigator surface alongside profile reads. Review, focus and stage authority feed A completion. None requires the completed milestone to release its own scope. The stage transition controls consume the checked service and Navigator slot. The EPIC verifies explicit start, completion and later reopening together.
- **Writing and attention.** The codec feeds storage and the independent editor adapter. The manuscript tab plus the storage service feed creation from the explorer. Manual save connects the editor to the store and tab, and grouped autosave follows it. Milestone presentation uses the committed A decision and read-only visibility independently of the editor.
- **Settings and diagnostics.** Recovery and location display can integrate independently using existing bootstrap and Settings. Log view, delete and reviewed export each consume the earlier broker writer. Their independently verifiable actions can develop concurrently.
- **Parallel work and evidence.** After coverage approval, independent contract and fixture work can proceed without waiting for its consumers. Coordinate edits to the workspace, port and catalogs. Each story owns its named data-model subsection. The integrating maintainer reconciles shared invariants and indexes against the latest base and allocates the next immutable migration at integration. The maintainer verifies the combined schema upgrade. Native environments, provider budgets and availability of required producer evidence remain constraints. The EPIC owns integrated thesis journeys, V04–V06 and V09. The documented local graph is acyclic.

## Acceptance criteria

- [ ] A researcher creates a thesis using the existing Virgilio setup, ends with the confirmed immutable document language, and can record partial context across sessions without topic, date, bibliography or an ongoing provider connection. Onboarding starts when the researcher explicitly confirms the Navigator action.
- [ ] From the explorer, the researcher can open one profile tab in Documents, see what is defined and pending, and correct or review an exact saved version. Navigator displays the thesis deadline directly or identifies it as pending. An explicit action to update it or consult milestones opens Schedule in that same tab without changing the active conversation. Navigator offers feasible local next actions with reasons from the first opening, and the researcher can choose one as focus. Choosing a focus and confirming the Onboarding milestone remain separate decisions with their own evidence.
- [ ] A thesis with no topic or bibliography can record interests and constraints, select a feasible local step and leave a comparison for Topic–Problem. Search availability is explained and opening the workspace sends no request.
- [ ] A thesis with a justified existing question can reuse its evidence and select the next feasible task without topic comparison. A reviewed milestone can be reopened with an explicit reason and preserved historical record.
- [ ] Create a manuscript from the explorer, display its saved workspace label in the tab and edit its separate text heading. Both thesis journeys reopen with notes, manuscript text and decisions intact. Rejected, uncertain and conflicting actions preserve recoverable input and confirmed versions.
- [ ] The integrated product meets V04–V06 and V09 and affected V08/V13, committed milestone notice and motion rules, real recovery outcomes and content-free diagnostic privacy and sharing oracles.
- [ ] Verify the affected authority, real storage and migration, locale/native input, accessibility, coverage and provider conformance with the applicable packaged artifacts, recording actual limitations and separate release authorization.

## GitHub distribution

| Block        | Class       | Destination                                                                                             |
| ------------ | ----------- | ------------------------------------------------------------------------------------------------------- |
| SPEC-004-001 | operational | EPIC, STORY-004-004, STORY-004-005, STORY-004-006, STORY-004-007, STORY-004-009, STORY-004-022          |
| SPEC-004-002 | operational | STORY-004-002, STORY-004-004, STORY-004-005, STORY-004-006, STORY-004-007, STORY-004-009, STORY-004-010 |
| SPEC-004-003 | operational | STORY-004-005, STORY-004-007, STORY-004-008, STORY-004-009, STORY-004-022, STORY-004-023, STORY-004-025 |
| SPEC-004-004 | operational | EPIC, STORY-004-011, STORY-004-013, STORY-004-014, STORY-004-015, STORY-004-016, STORY-004-024          |
| SPEC-004-005 | operational | EPIC, STORY-004-017, STORY-004-018, STORY-004-019, STORY-004-020, STORY-004-021                         |
| SPEC-004-006 | operational | EPIC                                                                                                    |
| SPEC-004-007 | context     | DOCUMENT                                                                                                |
| SPEC-004-008 | operational | STORY-004-001                                                                                           |
| SPEC-004-009 | operational | STORY-004-002                                                                                           |
| SPEC-004-010 | operational | STORY-004-003                                                                                           |
| SPEC-004-011 | operational | STORY-004-004                                                                                           |
| SPEC-004-012 | operational | STORY-004-005                                                                                           |
| SPEC-004-013 | operational | STORY-004-006                                                                                           |
| SPEC-004-014 | operational | STORY-004-007                                                                                           |
| SPEC-004-015 | operational | STORY-004-008                                                                                           |
| SPEC-004-016 | operational | STORY-004-009                                                                                           |
| SPEC-004-017 | operational | STORY-004-010                                                                                           |
| SPEC-004-018 | operational | STORY-004-011                                                                                           |
| SPEC-004-019 | operational | STORY-004-012                                                                                           |
| SPEC-004-020 | operational | STORY-004-013                                                                                           |
| SPEC-004-021 | operational | STORY-004-014                                                                                           |
| SPEC-004-022 | operational | STORY-004-015                                                                                           |
| SPEC-004-023 | operational | STORY-004-016                                                                                           |
| SPEC-004-024 | operational | STORY-004-017                                                                                           |
| SPEC-004-025 | operational | STORY-004-018                                                                                           |
| SPEC-004-026 | operational | STORY-004-019                                                                                           |
| SPEC-004-027 | operational | STORY-004-020                                                                                           |
| SPEC-004-028 | operational | STORY-004-021                                                                                           |
| SPEC-004-029 | operational | STORY-004-004, STORY-004-005, STORY-004-006, STORY-004-007, STORY-004-008, STORY-004-009, STORY-004-010 |
| SPEC-004-030 | operational | STORY-004-022                                                                                           |
| SPEC-004-031 | operational | STORY-004-023                                                                                           |
| SPEC-004-032 | operational | STORY-004-024                                                                                           |
| SPEC-004-033 | operational | STORY-004-025                                                                                           |
| SPEC-004-034 | operational | EPIC, STORY-004-004, STORY-004-007, STORY-004-008, STORY-004-010, STORY-004-022, STORY-004-023          |
| SPEC-004-035 | operational | STORY-004-026                                                                                           |
| SPEC-004-036 | operational | STORY-004-027                                                                                           |
| SPEC-004-037 | operational | STORY-004-028                                                                                           |

[^roadmap]: [Product roadmap](https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/product-roadmap.md).

[^product]: [Product definition and principles](https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/product-definition.md).

[^workflow]: [Thesis workflow](https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/thesis-workflow.md).

[^framework]: [Exploration–Action Framework](https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/exploration-action-framework.md).

[^architecture]: [System architecture](https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/architecture.md).

[^frontend]: [Frontend architecture](https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/frontend-architecture.md).

[^workspace]: [Workspace layout and acceptance scenarios](https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/workspace-layout.md).

[^presentation]: [Research presentation API](https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/research-presentation.md).

[^character-api]: [Character presentation API](https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/character-presentation.md).

[^design]: [Ohtia design system](https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/design-system.md).

[^data]: [Data model](https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/data-model.md).

[^format]: [Canonical academic manuscript format](https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/draft-format.md).

[^port]: [Bounded application port](https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/application-port.md).

[^storage]: [Storage contracts and native verification](https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/storage.md).

[^diagnostics]: [Content-free broker diagnostics](https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/diagnostics.md).

[^verification]: [Shared verification](https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/shared-verification.md).

[^collaboration]: [Agent collaboration](https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/agents/agent-collaboration.md).

[^virgilio]: [Virgilio operations](https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/agents/agent-virgilio.md).

[^evaluation]: [Agent collaboration evaluation](https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/agents/agent-collaboration-evaluation.md).

[^character]: [Ohtia and agent identity](https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/agents/agent-identity.md).

[^epic2]: [EPIC-002 basic interface outputs](https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/epics/EPIC-002-basic-interface/epic.md).

[^epic3]: [EPIC-003 research agents outputs](https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/epics/EPIC-003-research-agents/epic.md).

[^adr6]: [ADR-0006 Application storage](https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/adr/adr-0006-sqlite-application-storage.md).

[^adr7]: [ADR-0007 SQLite repositories and migrations](https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/adr/adr-0007-sqlite-repositories-and-migrations.md).

[^adr8]: [ADR-0008 UUIDv7 entity identifiers](https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/adr/adr-0008-uuidv7-entity-identifiers.md).

[^adr10]: [ADR-0010 Pre-migration recovery](https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/adr/adr-0010-pre-migration-recovery.md).

[^adr13]: [ADR-0013 Private-content-free structured logging](https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/adr/adr-0013-private-content-free-structured-logging.md).

[^adr14]: [ADR-0014 Restricted rendering and CSP](https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/adr/adr-0014-restricted-rendering-and-csp.md).

[^adr23]: [ADR-0023 Desktop accessibility verification](https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/adr/adr-0023-desktop-accessibility-verification.md).

[^adr30]: [ADR-0030 Canonical academic Markdown boundary](https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/adr/adr-0030-academic-markdown-boundary.md).

[^adr31]: [ADR-0031 Canonical TypeScript manuscript AST](https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/adr/adr-0031-canonical-typescript-draft-ast.md).

[^adr32]: [ADR-0032 ProseMirror editor boundary](https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/adr/adr-0032-prosemirror-editor-boundary.md).

[^adr35]: [ADR-0035 Version-bound research review](https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/adr/adr-0035-version-bound-research-review.md).

[^adr36]: [ADR-0036 Application preferences and bootstrap](https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/adr/adr-0036-application-preferences-and-bootstrap.md).

[^adr51]: [ADR-0051 Research-agent task execution](https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/adr/adr-0051-research-agent-task-execution.md).

[^adr52]: [ADR-0052 Current provider dispatch authorization](https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/docs/adr/adr-0052-current-provider-dispatch-authorization.md).

[^tree]: [Inspected project type catalog in the base checkout](https://github.com/ohtia/ohtia/blob/3eac620d0984b4e1e393407db9b47de53d44a11d/packages/contracts/src/project-types.ts).

[^decision-thesis-only]: Thesis-only delivery scope and atomic story review.

[^peer-feedback]: Peer feedback on publication blockers, contract accuracy and story boundaries.

[^thesis-entry-clarification]: Refinement discussion about starting with uncertainty, using an established topic and identifying the manuscript as the working thesis text.

[^profile-document-view]: Maintainer agreement to place the five-section profile and its reviewed-version summary in a project Documents tab, with section links from Navigator.

[^navigator-deadline-display]: Refinement discussion distinguishing the single thesis deadline from optional intermediate milestone dates and making the deadline readable directly in Navigator.

[^peer-feedback-publication]: Peer review of publication scope, entry and creation UI, profile field coverage, diagnostics and verification.
