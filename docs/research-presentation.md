---
type: Reference
title: Research presentation API
description: Compose controlled research and action proposals, accessible task notices and restricted conversation Markdown without storage or provider authority.
generated:
  by: codex/gpt-6.1-sol
---

# Research presentation API

## Ownership and inputs

The renderer exports `EvidenceHighlight`, `TutorComment`, `ProposalCard`, `ActionProposalCard`, `ContrastResult`, `CritiqueLevel`, `ObservationCard`, `ReviewRequired`, `CoverageStatement`, `SourceRow`, `ProcessingStatus`, `RestrictionBadge`, `WeeklyActions`, `StageStatus`, `PaceIndicator`, `SaveStatus`, `VersionConflict` and the supporting `MetricValue`. `VoiceLabel` remains part of the [character presentation API](character-presentation.md#static-attribution). The [design system](design-system.md#domain-components) owns their meaning, tokens and shapes; [STORY-002-009](epics/EPIC-002-basic-interface/STORY-002-009-research-component-specimens.md) defines this presentation increment. The components preserve evidence, inference and human attribution under PRIN-002, PRIN-004, PRIN-006 and PRIN-007.

Every component is controlled. The consumer supplies typed state, translated labels, recorded content and callbacks; no component reads storage, calls the application port, requests inference, applies prose to a manuscript or dispatches an agent. Consumers add their own catalog keys when they first bind a component to a screen, following [localization](localization.md). Callbacks report a researcher's request; they do not confirm research, persist a decision or certify an effect.

Supplied research content uses `RecordedText`: its text and the language recorded with it. The component renders it with that `lang` and `dir="auto"`; an unknown language renders `lang=""` rather than inheriting the interface locale. Text is always rendered as text. Markup, approval-like wording or instructions in content never change the typed state, the offered actions or any other component property.

## Voice and provenance

`EvidenceHighlight` marks an anchored source passage. Its accessible group name states source, location and state. A confirmed anchor has the `evidence.surface` fill and a solid 2 px `evidence.line` rule; a proposed anchor has only a dashed 2 px rule.

`TutorComment` quotes the original supervisor comment in the human voice with the declared author, the origin of that declaration and the submitted version. An optional interpretation is nested below with the actual contributor's `VoiceLabel`. `ProposalCard`, `ObservationCard` and the interpretation reject a supervisor identity at runtime as well as in their types, so neither the product character nor a named agent inherits the supervisor's authority. Researcher text keeps the ordinary unlabelled treatment.

## Trust, comparison and review

`ActionProposalCard` presents a proposed agent action with `open`, `accepted`, `declined` or `replaced` state. The consumer supplies its title, state label, language-preserving labelled sections, note, disabled reason and callbacks. Open cards offer one primary and one or two secondary actions; decided cards retain their content without decision actions. Optional progress rows keep their own labels and callbacks. `showVoice` suppresses the proposer’s `VoiceLabel` only when the card directly follows that contributor’s message. Accepting records a human decision without certifying the proposed content (PRIN-002 and PRIN-010).

`ProposalCard` takes a discriminated review state. Proposed and pending content offer confirmation, correction and rejection; proposed content also offers leaving it pending. A confirmed card requires the exact reviewed version and scope and shows the consumer's statement that confirmation is not a correctness certificate. A rejected card retains its reason. A card requiring review states what changed and offers only the consumer's review-again action. The shapes follow the [trust policy](design-system.md#trust-policy). A proposal, observation or supervisor-comment interpretation from an unknown producer keeps its dashed 2 px shape in `border.control` and ordinary text; it does not take the `voice.ohtia.*` colors reserved for system and AI origin. `CritiqueLevel` marks keep Ohtia's voice as the design system specifies.

`ContrastResult` requires a reason and a `CoverageStatement` element. Supported and not-verified outcomes are neutral; the other outcomes use `attention`. A not-verified outcome requires its cause: access, processing, restriction or scope. Inaccessible content is therefore not verified, never contradicted or absent. No outcome uses danger or success colors.

`CritiqueLevel` shows three, two or one decorative marks with its level label; it is not a grade. `ObservationCard` adds the producer, level, draft version, block, examined passage, grounds, optional outcome and required coverage element. `ReviewRequired` explains the change and renders the previous observation unchanged as history at its original anchor.

`CoverageStatement` lists examined records, complete texts, inaccessible sources and uncovered material types. `MetricValue` renders a known count, Unknown, or a visible "—" with an accessible not-applicable explanation; unknown or not-applicable values are never displayed as zero or as a percentage.

## Sources, Navigator and saving

`SourceRow` presents title, authorship, year, kind with its fixed icon, publication, origin, processing state, restrictions and confirmed and proposed claim counts. `ProcessingStatus` distinguishes received, processing with its phase and optional determinate progress, complete text, partial reading with omitted parts and unprocessable content with its cause; received is never presented as read. `RestrictionBadge` pairs the `lock` icon with text and optional inheritance.

`WeeklyActions` labels the week's actions as Ohtia proposals and rejects more than five. Each action states what, why now and done when as recorded text in the language it was generated in, and an estimate or Unknown. `StageStatus` keeps stage name, stage state, the single current focus and a pending proposal as separate facts; more than one focus is rejected. `PaceIndicator` shows explanatory text without an agreed plan, and otherwise the plan's pace, deadline and completion.

`SaveStatus` distinguishes saving, saved with its version, unsaved changes with the pending local count, failure with text-safety guidance and retry, and conflict. Provider-offline text is a separate indication and does not change local saving. A newly saved version and each new conflict are announced as status, and each new failure as alert. Saving is announced through its outcome; the first snapshot, repeated identical snapshots, the saving phase and typing-driven unsaved counts are silent. Announcements never move focus. `VersionConflict` preserves the researcher's local text and offers only the consumer's comparison and recovery callbacks.

## Conversation Markdown

`MessageMarkdown` receives the original `text`, optional recorded `language`, interface `locale` and `openExternalLink(url)` callback. An omitted language stays unknown. Source content keeps that recorded language, while scroll-region names and the external-link icon use the interface locale. It renders a closed syntax-tree mapping through React elements and text, with the parser choice owned by [ADR-0054](adr/adr-0054-restricted-message-markdown.md). Paragraphs, emphasis, strong text, code, quotations, lists, thematic breaks, tables and resolved links are supported; headings become bold paragraphs. Images and HTML remain literal text, and formulas, footnotes and strikethrough retain their notation. This conversation profile does not interpret or serialize the [manuscript format](draft-format.md).

Conversation widths follow the [design system’s workspace rule](design-system.md#workspace): agent prose, code and tables share the selected chat width, while researcher messages remain bounded at the timeline’s end. Code and tables have named, focusable scroll regions. Links retain their full address in the shared hover/focus tooltip and call only the supplied broker action. Conversation message actions send the saved identifier through `CommandBridge.copyMessage`; success is shown only after main confirms the clipboard readback. The neutral “Copied” confirmation disappears after five seconds; another copy restarts the interval after confirmation. Starting another copy or leaving the message cancels the previous interval. A failure remains visible for manual selection until another copy attempt, without moving focus. Streaming messages reuse the conversation controller’s bounded redraw schedule and have no copy action until saved. Recorded content language stays on the enclosing message; controls and notices use the interface locale. These boundaries preserve authorship and provenance (PRIN-002 and PRIN-004) while keeping the external action explicit (PRIN-011).

## Task notices

The conversation’s `TaskNotice` consumer renders the [task-notice specification](epics/EPIC-003-research-agents/epic.md#spec-003-018-task-notices) at the task’s timeline position. It selects localized text, icon and announcement role from the task projection and connection kind. It keeps the answering agent’s `VoiceLabel` above a standalone notice, omits it below that agent’s partial text and places every action below the notice box. Status surfaces use `surface.emphasis` and a decorative `border.subtle`; attention and failure surfaces keep their existing semantic tones. Counts use the global pause read, while durations come from the accepted task policy and use locale minute units.

A pending action preserves its notice. A failed or unconfirmed action keeps its operation identifier for the same button’s next request; newer-reply and pending-limit rejections have distinct attention notices. Starting an uncertain reply again opens the existing confirmation dialog with initial focus on Close dialog. The catalog’s task-notice screen supplies synthetic states for both connection kinds, long translations and unknown action results, without provider or storage authority (PRIN-004 and PRIN-006).

## Color and accessibility

Styles use semantic tokens only. Every colored selector is registered in the checked [renderer color usage](../packages/renderer/color-usage.json) against the closed pair inventory in the [design system](design-system.md#verified-contrast-pairs). Attention notices contain only attention text on their surface; their actions and focus indicators sit on the surrounding page surface. Voice labels appear only on page, panel and emphasis surfaces. In forced colors, borders, strokes and labels remain; the evidence fill and notice surfaces use system colors.

Every state has text and an icon or shape. Decorative icons and marks are hidden from assistive technology. Components add no headings, timers, focus movement or keyboard shortcuts; the consuming screen owns its heading order, focus management and notice placement.

## Catalog and verification

Build the catalog with `python3 scripts/workspace.py run catalog:build` and serve it through the [isolated catalog](semantic-primitives.md#isolated-catalog-and-verification). Open `?screen=research` to inspect every component, voice and state with visibly synthetic content and a callback log. The page exercises approval-like prose beside an unavailable manuscript action, untrusted markup, long unbroken text, German, Korean, Arabic and unrecorded-language content, unknown usage and cost, partial coverage and the distinctions among stop requested, cessation unknown, execution completed, result unavailable and result delivered without review. It uses the shared tokens, local fonts and restrictive CSP and stays outside product entry graphs.

Registered Vitest contracts cover typed action sets, inert prose, supervisor authority, comparison causes, metrics, processing states, weekly and stage bounds, pace, save announcements and conflict preservation. The color-usage check rejects an unlisted research pair or unregistered selector, and the renderer library build exports the components without catalog specimens. The Chromium catalog journey checks component presence, shapes, labels, inert content, language tags, save and conflict announcements, keyboard focus, 320/600/1024/1280 widths in both themes, 40% expansion with text spacing, forced colors and coarse targets. This portable evidence does not establish packaged native zoom, assistive-technology journeys, linguistic review or WCAG conformance.

Historical task notices remain readable without inserting populated live regions. The window announces observed notice transitions, tasks introduced by its confirmed recovery actions and new tasks recovered after a gap in an established subscription, once per transition; initial history and earlier-page reads remain silent. It retains the current signature across navigation; a locale change alone is not a new notice. Announcement copies carry their own language and clear after one second or a locale change, while the visible notice persists. During that interval the text-only notice box is hidden from the accessibility tree to avoid duplicate reading; its actions remain available. When an action disappears while focused, the conversation’s persistent reading region receives focus.
