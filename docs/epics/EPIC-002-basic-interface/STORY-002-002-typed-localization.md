---
type: "Story"
title: "STORY-002-002 — Extend typed localization and global language selection"
description: "Deliver the shared locale service, complete own-scope JSON catalogs for all 25 locales and durable language selection."
tags: ["story", "comp:app", "comp:desktop", "translation"]
status: "stable"
resource: https://github.com/ohtia/ohtia/issues/44
epic: "EPIC-002"
epic_concept: "./epic.md"
components: ["comp:app", "comp:desktop"]
applicable_blocks:
  ["SPEC-002-002", "SPEC-002-004", "SPEC-002-008", "SPEC-002-013", "SPEC-002-021", "SPEC-002-025"]
generated: { by: claude-code/claude-opus-5-5 }
verified: { by: human:AdrianMastronardi }
---

# STORY-002-002 — Extend typed localization and global language selection

## Description

Deliver the shared locale service, complete own-scope JSON catalogs for all 25 locales and durable language selection.

## Applicable specification

- [SPEC-002-002: Application boundaries and progressive integration](./epic.md#spec-002-002-application-boundaries-and-progressive-integration)
- [SPEC-002-004: One locale service and complete catalogs](./epic.md#spec-002-004-one-locale-service-and-complete-catalogs)
- [SPEC-002-008: Preference contracts and cross-window failure behavior](./epic.md#spec-002-008-preference-contracts-and-cross-window-failure-behavior)
- [SPEC-002-013: Accessibility requirements for foundational controls](./epic.md#spec-002-013-accessibility-requirements-for-foundational-controls)

- [SPEC-002-021: Presentation receipts and deterministic event ordering](./epic.md#spec-002-021-presentation-receipts-and-deterministic-event-ordering)
- [SPEC-002-025: Settings presentation and preference save states](./epic.md#spec-002-025-settings-presentation-and-preference-save-states)

## Tasks

- [ ] Integrate gate: E1-W2 from <https://github.com/ohtia/ohtia/issues/16>; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Integrate gate: E1-R4 from <https://github.com/ohtia/ohtia/issues/18>; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Integrate gate: E1-S5 from <https://github.com/ohtia/ohtia/issues/19>; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Read the foundation locale/port implementation and preserve its single authority.
- [ ] Create or extend all 25 UTF-8 locale JSON files with stable English semantic keys, the en-US authoring/reference catalog and locale-correct parameter/plural/select contracts for this producer’s own messages; verify every resolver example. Each consuming story supplies its own new keys in all 25 locales without keeping this producer open.
- [ ] Implement the language feature controller and named preference admission including cross-window/restart/error handling.
- [ ] Verify real preference port behavior separately from deterministic resolver/component tests.
- [ ] Exercise late locale responses and receipt/subscription recovery with preserved newer input; use applicable O1–O3/O6 ordering checks without claiming durable/native delivery from the port corpus.
- [ ] Deliver the controlled, checked 25-entry autonym table of SPEC-002-025 in the shared localization module, with each entry's `lang`, and test it against the supported locale inventory.

## Acceptance criteria

- [ ] All 25 catalogs satisfy the exact message/interpolation/plural contract without per-key fallback.
- [ ] Explicit/system/stale/invalid choices and ordered locale examples behave as specified without losing input or relabeling research.
- [ ] Completion gate: E1-Q7 from <https://github.com/ohtia/ohtia/issues/21>; verify the output and release condition in [Dependencies](./epic.md#dependencies).

## Quality checklist

- [ ] Apply the [ADR-0016 quality contract](../../adr/adr-0016-shared-quality-and-coverage-gates.md): each product package meets 80% executable lines, 80% branches and 90% changed executable lines, including own unimported code and declared exclusions. Missing reports or incomplete mandatory checks fail; no executable diff makes its diff metric inapplicable.
- [ ] Execute the positive, boundary and failure checks in the applicable specification against the declared real inputs.
- [ ] Run the applicable repository gates and required pre-commit review under [AGENTS.md](../../../AGENTS.md); record exact results and omissions.
- [ ] Record actual inputs, results and omissions, API/usage changes, installed-user impact and a candidate change note or no-note reason; distinguish local, native, CI and human integration evidence.
