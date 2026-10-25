---
type: "Story"
title: "STORY-002-005 — Implement deterministic workspace geometry and preferences"
description: "Numerical geometry examples and all seven nonempty visibility combinations preserve minima and sum."
tags: ["story", "comp:app", "comp:desktop"]
status: "stable"
resource: https://github.com/ohtia/ohtia/issues/47
epic: "EPIC-002"
epic_concept: "./epic.md"
components: ["comp:app", "comp:desktop"]
applicable_blocks:
  [
    "SPEC-002-002",
    "SPEC-002-007",
    "SPEC-002-008",
    "SPEC-002-013",
    "SPEC-002-019",
    "SPEC-002-021",
    "SPEC-002-023",
    "SPEC-002-026",
  ]
generated: { by: claude-code/claude-opus-5-5 }
verified: { by: human:AdrianMastronardi }
---

# STORY-002-005 — Implement deterministic workspace geometry and preferences

## Description

Numerical geometry examples and all seven nonempty visibility combinations preserve minima and sum.

## Applicable specification

- [SPEC-002-002: Application boundaries and progressive integration](./epic.md#spec-002-002-application-boundaries-and-progressive-integration)
- [SPEC-002-007: One deterministic layout controller](./epic.md#spec-002-007-one-deterministic-layout-controller)
- [SPEC-002-008: Preference contracts and cross-window failure behavior](./epic.md#spec-002-008-preference-contracts-and-cross-window-failure-behavior)
- [SPEC-002-013: Accessibility requirements for foundational controls](./epic.md#spec-002-013-accessibility-requirements-for-foundational-controls)
- [SPEC-002-019: Interface zoom and persistence](./epic.md#spec-002-019-interface-zoom-and-persistence)

- [SPEC-002-021: Presentation receipts and deterministic event ordering](./epic.md#spec-002-021-presentation-receipts-and-deterministic-event-ordering)
- [SPEC-002-023: Workspace bar contents, first-run state and panel details](./epic.md#spec-002-023-workspace-bar-contents-first-run-state-and-panel-details)
- [SPEC-002-026: Canonical documentation amendments for the approved refinements](./epic.md#spec-002-026-canonical-documentation-amendments-for-the-approved-refinements)

## Tasks

- [ ] Integrate gate: E1-W2 from <https://github.com/ohtia/ohtia/issues/16>; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Integrate gate: E1-R4 from <https://github.com/ohtia/ohtia/issues/18>; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Integrate gate: E1-S5 from <https://github.com/ohtia/ohtia/issues/19>; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Integrate gate: E2-T1 from STORY-002-001; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Implement pure allocations/reopen/default/reset calculations and canonical numerical oracles; treat zoom as a passive CSS viewport change without persisting effective widths.
- [ ] Implement per-window resize/cancellation/visibility/focus/narrow controller using typed metrics.
- [ ] Bind exact layout record validation and confirmed writes to the named foundation port.
- [ ] Verify all visibility combinations, rounding, every cancellation route, corrupt/failing storage and independent windows.
- [ ] Exercise controller replacement and late layout responses with deterministic schedules; disposal preserves accepted-write reconciliation and cannot overwrite a newer live controller.
- [ ] Verify that the SPEC-002-026 workspace-layout amendment is merged, then implement the SPEC-002-023 separator pair reset as a committed controller action with its three oracles.

## Acceptance criteria

- [ ] Numerical geometry examples and all seven nonempty visibility combinations preserve minima and sum.
- [ ] Canceled/passive/narrow/focus actions never persist; completed actions serialize with exact private-data-free records.
- [ ] Completion gate: E1-Q7 from <https://github.com/ohtia/ohtia/issues/21>; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Pair reset meets its oracles, preserves the pair's combined width and any third panel and commits once.

## Quality checklist

- [ ] Apply the [ADR-0016 quality contract](../../adr/adr-0016-shared-quality-and-coverage-gates.md): each product package meets 80% executable lines, 80% branches and 90% changed executable lines, including own unimported code and declared exclusions. Missing reports or incomplete mandatory checks fail; no executable diff makes its diff metric inapplicable.
- [ ] Execute the positive, boundary and failure checks in the applicable specification against the declared real inputs.
- [ ] Run the applicable repository gates and required pre-commit review under [AGENTS.md](../../../AGENTS.md); record exact results and omissions.
- [ ] Record actual inputs, results and omissions, API/usage changes, installed-user impact and a candidate change note or no-note reason; distinguish local, native, CI and human integration evidence.
