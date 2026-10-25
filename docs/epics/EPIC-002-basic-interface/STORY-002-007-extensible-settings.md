---
type: "Story"
title: "STORY-002-007 — Provide extensible Settings and durable presentation choices"
description: "Provide compact Settings and validated appearance, character and zoom controls with durable receipts."
tags: ["story", "comp:app", "comp:desktop"]
status: "stable"
resource: https://github.com/ohtia/ohtia/issues/49
epic: "EPIC-002"
epic_concept: "./epic.md"
components: ["comp:app", "comp:desktop"]
applicable_blocks:
  [
    "SPEC-002-002",
    "SPEC-002-004",
    "SPEC-002-005",
    "SPEC-002-006",
    "SPEC-002-007",
    "SPEC-002-008",
    "SPEC-002-010",
    "SPEC-002-014",
    "SPEC-002-018",
    "SPEC-002-019",
    "SPEC-002-021",
    "SPEC-002-025",
    "SPEC-002-026",
    "SPEC-002-027",
  ]
generated: { by: claude-code/claude-opus-5-5 }
verified: { by: human:AdrianMastronardi }
---

# STORY-002-007 — Provide extensible Settings and durable presentation choices

## Description

Provide compact Settings and validated appearance, character and zoom controls with durable receipts.

## Applicable specification

- [SPEC-002-002: Application boundaries and progressive integration](./epic.md#spec-002-002-application-boundaries-and-progressive-integration)
- [SPEC-002-004: One locale service and complete catalogs](./epic.md#spec-002-004-one-locale-service-and-complete-catalogs)
- [SPEC-002-005: Semantic primitives and isolated development catalog](./epic.md#spec-002-005-semantic-primitives-and-isolated-development-catalog)
- [SPEC-002-006: Named commands, native menus, Help and About](./epic.md#spec-002-006-named-commands-native-menus-help-and-about)
- [SPEC-002-007: One deterministic layout controller](./epic.md#spec-002-007-one-deterministic-layout-controller)
- [SPEC-002-008: Preference contracts and cross-window failure behavior](./epic.md#spec-002-008-preference-contracts-and-cross-window-failure-behavior)
- [SPEC-002-010: Extensible Settings with real application preferences](./epic.md#spec-002-010-extensible-settings-with-real-application-preferences)
- [SPEC-002-014: Complete-page accessibility, attention and content language](./epic.md#spec-002-014-complete-page-accessibility-attention-and-content-language)
- [SPEC-002-018: Exclusions and later obligations](./epic.md#spec-002-018-exclusions-and-later-obligations)
- [SPEC-002-019: Interface zoom and persistence](./epic.md#spec-002-019-interface-zoom-and-persistence)

- [SPEC-002-021: Presentation receipts and deterministic event ordering](./epic.md#spec-002-021-presentation-receipts-and-deterministic-event-ordering)
- [SPEC-002-025: Settings presentation and preference save states](./epic.md#spec-002-025-settings-presentation-and-preference-save-states)
- [SPEC-002-026: Canonical documentation amendments for the approved refinements](./epic.md#spec-002-026-canonical-documentation-amendments-for-the-approved-refinements)
- [SPEC-002-027: Reference specimen, captures and measurements](./epic.md#spec-002-027-reference-specimen-captures-and-measurements)

## Tasks

- [ ] Integrate gate: E1-W2 from <https://github.com/ohtia/ohtia/issues/16>; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Integrate gate: E1-R4 from <https://github.com/ohtia/ohtia/issues/18>; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Integrate gate: E1-S5 from <https://github.com/ohtia/ohtia/issues/19>; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Integrate gate: E2-L2 from STORY-002-002; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Integrate gate: E2-P3 from STORY-002-003; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Integrate gate: E2-C4 from STORY-002-004; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Integrate gate: E2-G5 from STORY-002-005; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Compose one compact Settings screen with an Accessibility and appearance section, Language/Appearance/Workspace layout groups, Characters under Appearance and visible zoom controls; no initial sidebar or language-only page.
- [ ] Verify the merged canonical preference-key amendment, then bind the named preference controller/receipt and native/chrome zoom and Settings entry points.
- [ ] Implement confirmed/pending/unsaved/conflict/uncertain/failure presentation with cross-window rules.
- [ ] Verify real file-backed preference failure/restart and focus/IME/input preservation; document the future section extension seam.
- [ ] Bind controller state to admitted operations and view lifetimes, and recover bounded streams; test O1–O3/O6 with dialog close/reopen, service replacement and real preference integration.
- [ ] Verify that the SPEC-002-026 design-system amendment is merged, then implement the Settings presentation of SPEC-002-025: the saved-immediately line, the autonym language list with the resolved system locale, appearance cards with the effective System value, zoom limit reasons, the character preview and reduced-motion note, the workspace layout group and per-group save states.
- [ ] Build Settings and its save states to the SPEC-002-027 measurements and compare them with the Settings and save-state captures in both themes; the text prevails over a capture.

## Acceptance criteria

- [ ] Every setting owned by this producer works through the real application port and survives restart after confirmed commit; controlled consumers verify notification contracts without waiting for workspace/decoration rendering.
- [ ] Locale/appearance/characters/zoom confirmed revisions publish monotonically across windows while layout preserves each window’s live state; a successful stored choice is distinguished from a consuming window’s application/refresh failure.
- [ ] Failed or uncertain writes never claim saved success or overwrite unrelated records/input.
- [ ] Completion gate: E1-Q7 from <https://github.com/ohtia/ohtia/issues/21>; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Every save state of SPEC-002-025 is distinguishable by text and icon in both themes, and no failure or uncertainty is presented as saved.

## Quality checklist

- [ ] Apply the [ADR-0016 quality contract](../../adr/adr-0016-shared-quality-and-coverage-gates.md): each product package meets 80% executable lines, 80% branches and 90% changed executable lines, including own unimported code and declared exclusions. Missing reports or incomplete mandatory checks fail; no executable diff makes its diff metric inapplicable.
- [ ] Execute the positive, boundary and failure checks in the applicable specification against the declared real inputs.
- [ ] Run the applicable repository gates and required pre-commit review under [AGENTS.md](../../../AGENTS.md); record exact results and omissions.
- [ ] Record actual inputs, results and omissions, API/usage changes, installed-user impact and a candidate change note or no-note reason; distinguish local, native, CI and human integration evidence.
