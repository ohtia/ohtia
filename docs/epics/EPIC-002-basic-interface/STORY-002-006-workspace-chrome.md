---
type: "Story"
title: "STORY-002-006 — Compose accessible, responsive workspace chrome"
description: "Context controls, geometry, keyboard/pointer resizing, hiding/restoration and narrow reflow preserve in-session state."
tags: ["story", "comp:app"]
status: "stable"
resource: https://github.com/ohtia/ohtia/issues/48
epic: "EPIC-002"
epic_concept: "./epic.md"
components: ["comp:app"]
applicable_blocks:
  [
    "SPEC-002-003",
    "SPEC-002-005",
    "SPEC-002-006",
    "SPEC-002-007",
    "SPEC-002-009",
    "SPEC-002-014",
    "SPEC-002-018",
    "SPEC-002-019",
    "SPEC-002-022",
    "SPEC-002-023",
    "SPEC-002-025",
    "SPEC-002-026",
    "SPEC-002-027",
  ]
generated: { by: claude-code/claude-opus-5-5 }
verified: { by: human:AdrianMastronardi }
---

# STORY-002-006 — Compose accessible, responsive workspace chrome

## Description

Context controls, geometry, keyboard/pointer resizing, hiding/restoration and narrow reflow preserve in-session state.

## Applicable specification

- [SPEC-002-003: Token layers, bundled typography and static branding](./epic.md#spec-002-003-token-layers-bundled-typography-and-static-branding)
- [SPEC-002-005: Semantic primitives and isolated development catalog](./epic.md#spec-002-005-semantic-primitives-and-isolated-development-catalog)
- [SPEC-002-006: Named commands, native menus, Help and About](./epic.md#spec-002-006-named-commands-native-menus-help-and-about)
- [SPEC-002-007: One deterministic layout controller](./epic.md#spec-002-007-one-deterministic-layout-controller)
- [SPEC-002-009: Workspace composition and incremental scenario coverage](./epic.md#spec-002-009-workspace-composition-and-incremental-scenario-coverage)
- [SPEC-002-014: Complete-page accessibility, attention and content language](./epic.md#spec-002-014-complete-page-accessibility-attention-and-content-language)
- [SPEC-002-018: Exclusions and later obligations](./epic.md#spec-002-018-exclusions-and-later-obligations)
- [SPEC-002-019: Interface zoom and persistence](./epic.md#spec-002-019-interface-zoom-and-persistence)
- [SPEC-002-022: Integrated title bar and native window state](./epic.md#spec-002-022-integrated-title-bar-and-native-window-state)
- [SPEC-002-023: Workspace bar contents, first-run state and panel details](./epic.md#spec-002-023-workspace-bar-contents-first-run-state-and-panel-details)
- [SPEC-002-025: Settings presentation and preference save states](./epic.md#spec-002-025-settings-presentation-and-preference-save-states)
- [SPEC-002-026: Canonical documentation amendments for the approved refinements](./epic.md#spec-002-026-canonical-documentation-amendments-for-the-approved-refinements)
- [SPEC-002-027: Reference specimen, captures and measurements](./epic.md#spec-002-027-reference-specimen-captures-and-measurements)

## Tasks

- [ ] Integrate gate: E1-W2 from <https://github.com/ohtia/ohtia/issues/16>; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Integrate gate: E1-R4 from <https://github.com/ohtia/ohtia/issues/18>; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Integrate gate: E2-T1 from STORY-002-001; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Integrate gate: E2-L2 from STORY-002-002; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Integrate gate: E2-P3 from STORY-002-003; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Integrate gate: E2-C4 from STORY-002-004; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Integrate gate: E2-G5 from STORY-002-005; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Compose context bar, explorer, fixed Navigator tab and document/chat regions with the one controller.
- [ ] Bind named command callbacks, focus/visibility and accurate empty/unavailable capability states.
- [ ] Build scoped presentation harnesses for tabs/fields/selection without inventing real domain actions.
- [ ] Verify V01–V03,V10–V12 delivered subcases and enumerate deferred project/chat/document integration cases.
- [ ] Test A → B → A synthetic view lifetimes, delayed selections and disposal; preserve newer buffers, reading focus and current scope without claiming project-switch delivery.
- [ ] Verify that ADR-0039 and the SPEC-002-026 workspace-layout and design-system amendments are merged before implementing the bar layout.
- [ ] Build the integrated row of SPEC-002-022 and SPEC-002-023: menu button on Windows/Linux, traffic-light inset on macOS, drag and no-drag regions, Window Controls Overlay safe areas, brand, No project open text, zoom indicator from a controlled zoom-state input, the joined Panels group and the focus-mode text button, with Reset layout absent from the bar.
- [ ] Build the first-run Navigator welcome with a controlled decoration input, the one-sentence explorer and chat states without a composer, explorer footer shortcut hints, shortcut tooltips with `aria-keyshortcuts`, the narrow segmented selector, and the separator presentation states, double-click and Enter gestures.
- [ ] Implement the workspace-owned notices of SPEC-002-025: layout not remembered once per session and last visible panel.
- [ ] Build the integrated row, panels, welcome, narrow selector, separator and workspace notices to the SPEC-002-027 measurements and compare them with the title-bar, workspace, focus, narrow, separator and save-state captures in both themes; the text prevails over a capture.

## Acceptance criteria

- [ ] Context controls, geometry, keyboard/pointer resizing, hiding/restoration and narrow reflow preserve in-session state.
- [ ] No production fixture material or invented project/chat/editor action is exposed; deferred scenario portions are explicit.
- [ ] Completion gate: E1-Q7 from <https://github.com/ohtia/ohtia/issues/21>; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] No Ohtia control renders beneath system controls or inside a drag region; the bar, welcome, narrow selector and separator states match SPEC-002-023 in both themes and at every tested width.

## Quality checklist

- [ ] Apply the [ADR-0016 quality contract](../../adr/adr-0016-shared-quality-and-coverage-gates.md): each product package meets 80% executable lines, 80% branches and 90% changed executable lines, including own unimported code and declared exclusions. Missing reports or incomplete mandatory checks fail; no executable diff makes its diff metric inapplicable.
- [ ] Execute the positive, boundary and failure checks in the applicable specification against the declared real inputs.
- [ ] Run the applicable repository gates and required pre-commit review under [AGENTS.md](../../../AGENTS.md); record exact results and omissions.
- [ ] Record actual inputs, results and omissions, API/usage changes, installed-user impact and a candidate change note or no-note reason; distinguish local, native, CI and human integration evidence.
