---
type: "Story"
title: "STORY-002-014 — Deliver the command palette and keyboard shortcuts help"
description: "A registry-generated command palette and keyboard-shortcuts dialog list only real commands with their shortcuts and truthful availability."
tags: ["story", "comp:app", "accessibility"]
status: "stable"
resource: https://github.com/ohtia/ohtia/issues/56
epic: "EPIC-002"
epic_concept: "./epic.md"
components: ["comp:app"]
applicable_blocks:
  [
    "SPEC-002-004",
    "SPEC-002-005",
    "SPEC-002-006",
    "SPEC-002-014",
    "SPEC-002-018",
    "SPEC-002-024",
    "SPEC-002-026",
    "SPEC-002-027",
  ]
generated: { by: claude-code/claude-opus-5-5 }
verified: { by: human:AdrianMastronardi }
---

# STORY-002-014 — Deliver the command palette and keyboard shortcuts help

## Description

A registry-generated command palette and keyboard-shortcuts dialog list only real commands with their shortcuts and truthful availability. This unit consumes the command registry without delaying it; the registry, menus and accelerators belong to STORY-002-004. Detailed implementation decisions and their rationale are held once in the applicable specification below.

## Applicable specification

- [SPEC-002-004: One locale service and complete catalogs](./epic.md#spec-002-004-one-locale-service-and-complete-catalogs)
- [SPEC-002-005: Semantic primitives and isolated development catalog](./epic.md#spec-002-005-semantic-primitives-and-isolated-development-catalog)
- [SPEC-002-006: Named commands, native menus, Help and About](./epic.md#spec-002-006-named-commands-native-menus-help-and-about)
- [SPEC-002-014: Complete-page accessibility, attention and content language](./epic.md#spec-002-014-complete-page-accessibility-attention-and-content-language)
- [SPEC-002-018: Exclusions and later obligations](./epic.md#spec-002-018-exclusions-and-later-obligations)
- [SPEC-002-024: Command palette, shortcut inventory, local help and native menu limits](./epic.md#spec-002-024-command-palette-shortcut-inventory-local-help-and-native-menu-limits)
- [SPEC-002-026: Canonical documentation amendments for the approved refinements](./epic.md#spec-002-026-canonical-documentation-amendments-for-the-approved-refinements)
- [SPEC-002-027: Reference specimen, captures and measurements](./epic.md#spec-002-027-reference-specimen-captures-and-measurements)

## Tasks

- [ ] Integrate gate: E1-W2 from <https://github.com/ohtia/ohtia/issues/16>; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Integrate gate: E2-L2 from STORY-002-002; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Integrate gate: E2-P3 from STORY-002-003; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Integrate gate: E2-C4 from STORY-002-004; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Verify that the SPEC-002-026 design-system icon amendment (`search`, `keyboard`) is merged before implementing the visuals.
- [ ] Read the delivered registry contract and its command, context, availability and shortcut data; build both surfaces from it without a second command list.
- [ ] Implement the palette of SPEC-002-024 on the shared dialog primitive with the ARIA combobox and grouped listbox, diacritic- and case-insensitive substring filtering, unavailable reasons, IME-safe Enter, Esc focus restoration and close-then-invoke execution in the origin window context.
- [ ] Implement the keyboard-shortcuts dialog as a registry-generated table showing only the running platform's bindings, implemented and tested for Windows, Linux and macOS, including the declared separator keys, and register both handlers with the registry.
- [ ] Add every new message, group name, empty result and accessible label in all 25 locales.
- [ ] Test filtering with accented and Korean labels, empty results, unavailable commands, modal conflicts, duplicate activation, disposal during invocation and late availability updates.
- [ ] Build the palette and shortcuts dialog to the SPEC-002-027 measurements and compare them with their captures; the text prevails over a capture.

## Acceptance criteria

- [ ] The palette lists exactly the registered commands for its origin window with correct shortcuts and reasons; unavailable commands never execute, and focus returns correctly after Esc or execution.
- [ ] The shortcuts dialog matches the registry and the native menus on each platform without hand-written shortcut strings.
- [ ] Neither surface stores queries or history, lists research actions or registers a system-wide accelerator.
- [ ] Completion gate: E1-Q7 from <https://github.com/ohtia/ohtia/issues/21>; verify the output and release condition in [Dependencies](./epic.md#dependencies).

## Quality checklist

- [ ] Apply the [ADR-0016 quality contract](../../adr/adr-0016-shared-quality-and-coverage-gates.md): each product package meets 80% executable lines, 80% branches and 90% changed executable lines, including own unimported code and declared exclusions. Missing reports or incomplete mandatory checks fail; no executable diff makes its diff metric inapplicable.
- [ ] Execute the positive, boundary and failure checks in the applicable specification against the declared real inputs.
- [ ] Run the applicable repository gates and required pre-commit review under [AGENTS.md](../../../AGENTS.md); record exact results and omissions.
- [ ] Record actual inputs, results and omissions, API/usage changes, installed-user impact and a candidate change note or no-note reason; distinguish local, native, CI and human integration evidence.
