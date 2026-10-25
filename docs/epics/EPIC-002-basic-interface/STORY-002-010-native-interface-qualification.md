---
type: "Story"
title: "STORY-002-010 — Qualify integrated pages and native assistive journeys"
description: "Verify the frozen integrated candidate through native, keyboard and assistive journeys on all six required targets."
tags: ["story", "comp:app", "comp:desktop", "comp:tooling", "accessibility"]
status: "stable"
resource: https://github.com/ohtia/ohtia/issues/52
epic: "EPIC-002"
epic_concept: "./epic.md"
components: ["comp:app", "comp:desktop", "comp:tooling"]
applicable_blocks:
  [
    "SPEC-002-014",
    "SPEC-002-015",
    "SPEC-002-017",
    "SPEC-002-019",
    "SPEC-002-020",
    "SPEC-002-021",
    "SPEC-002-022",
    "SPEC-002-023",
    "SPEC-002-024",
    "SPEC-002-025",
    "SPEC-002-027",
  ]
generated: { by: claude-code/claude-opus-5-5 }
verified: { by: human:AdrianMastronardi }
---

# STORY-002-010 — Qualify integrated pages and native assistive journeys

## Description

Verify the frozen integrated candidate through native, keyboard and assistive journeys on all six required targets.

## Applicable specification

- [SPEC-002-014: Complete-page accessibility, attention and content language](./epic.md#spec-002-014-complete-page-accessibility-attention-and-content-language)
- [SPEC-002-015: Packaged native and assistive verification](./epic.md#spec-002-015-packaged-native-and-assistive-verification)
- [SPEC-002-017: Quality gates, build isolation and implementation discipline](./epic.md#spec-002-017-quality-gates-build-isolation-and-implementation-discipline)
- [SPEC-002-019: Interface zoom and persistence](./epic.md#spec-002-019-interface-zoom-and-persistence)
- [SPEC-002-020: Application composition and a shared verification candidate](./epic.md#spec-002-020-application-composition-and-a-shared-verification-candidate)

- [SPEC-002-021: Presentation receipts and deterministic event ordering](./epic.md#spec-002-021-presentation-receipts-and-deterministic-event-ordering)
- [SPEC-002-022: Integrated title bar and native window state](./epic.md#spec-002-022-integrated-title-bar-and-native-window-state)
- [SPEC-002-023: Workspace bar contents, first-run state and panel details](./epic.md#spec-002-023-workspace-bar-contents-first-run-state-and-panel-details)
- [SPEC-002-024: Command palette, shortcut inventory, local help and native menu limits](./epic.md#spec-002-024-command-palette-shortcut-inventory-local-help-and-native-menu-limits)
- [SPEC-002-025: Settings presentation and preference save states](./epic.md#spec-002-025-settings-presentation-and-preference-save-states)
- [SPEC-002-027: Reference specimen, captures and measurements](./epic.md#spec-002-027-reference-specimen-captures-and-measurements)

## Tasks

- [ ] Verify the composed application and freeze identifier supplied by STORY-002-012; do not create a second root or silently change the candidate.
- [ ] Define and execute the complete criterion, journey and native target inventory against real SQLite, IPC, CSP and packaged assets.
- [ ] Run all six required native targets with actual assistive/input tools, including integrated Settings, menus, About, zoom and restart.
- [ ] Record findings for the shared integrating owner, then rerun affected checks on any new frozen candidate.
- [ ] Bind the final native report to the candidate ID and exact target artifact digests.
- [ ] Qualify the applicable integrated ordering cases against real native boundaries on the frozen candidate, distinguishing portable corpus evidence from durable writes and renderer application.
- [ ] Include the integrated title bar, menu button, command palette, shortcuts dialog, keyboard-layout, separator pair-reset, first-show and window-bounds journeys of SPEC-002-015 on every required target.
- [ ] Compare each integrated surface on every target with the SPEC-002-027 captures and record visual deviations as findings; the captures are references, not acceptance oracles, and the EPIC text prevails.

## Acceptance criteria

- [ ] Required integrated automated and actual native/assistive/input journeys pass on all six OS/CPU targets with complete evidence.
- [ ] Every applicable mandatory criterion is accounted for; failed/unexecuted cells cannot be marked passing.
- [ ] Full-page findings are corrected/rechecked; browser/catalog results remain distinct from native assistive evidence and optional human linguistic review.
- [ ] Completion gate: E2-O4 from STORY-002-004; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Completion gate: E2-O6 from STORY-002-006; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Completion gate: E2-O7 from STORY-002-007; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Completion gate: E2-O8 from STORY-002-008; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Completion gate: E2-O9 from STORY-002-009; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Completion gate: E1-Q7 from <https://github.com/ohtia/ohtia/issues/21>; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Completion gate: E1-L8 from <https://github.com/ohtia/ohtia/issues/22>; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Completion gate: E1-B12 from <https://github.com/ohtia/ohtia/issues/26>; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Completion gate: E1-D1b from <https://github.com/ohtia/ohtia/issues/32>; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Completion gate: EXT-NATIVE from Native review facilities; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Completion gate: E2-A12 from STORY-002-012; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Completion gate: E2-N13 from STORY-002-013; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Completion gate: E2-K14 from STORY-002-014; verify the output and release condition in [Dependencies](./epic.md#dependencies).

## Quality checklist

- [ ] Apply the [ADR-0016 quality contract](../../adr/adr-0016-shared-quality-and-coverage-gates.md): each product package meets 80% executable lines, 80% branches and 90% changed executable lines, including own unimported code and declared exclusions. Missing reports or incomplete mandatory checks fail; no executable diff makes its diff metric inapplicable.
- [ ] Execute the positive, boundary and failure checks in the applicable specification against the declared real inputs.
- [ ] Run the applicable repository gates and required pre-commit review under [AGENTS.md](../../../AGENTS.md); record exact results and omissions.
- [ ] Bind this story’s own complete report to the current candidate and rerun its affected checks after changes; no peer report is required for closure. The EPIC audit compares the two independent reports.
- [ ] Record actual inputs, results and omissions, API/usage changes, installed-user impact and a candidate change note or no-note reason; distinguish local, native, CI and human integration evidence.
