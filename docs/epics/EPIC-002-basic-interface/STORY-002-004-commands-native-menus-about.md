---
type: "Story"
title: "STORY-002-004 — Unify named commands, native menus and About"
description: "Deliver the shared command registry, native menus and a functioning local Help/About surface."
tags: ["story", "comp:app", "comp:desktop"]
status: "stable"
resource: https://github.com/ohtia/ohtia/issues/46
epic: "EPIC-002"
epic_concept: "./epic.md"
components: ["comp:app", "comp:desktop"]
applicable_blocks:
  [
    "SPEC-002-002",
    "SPEC-002-004",
    "SPEC-002-006",
    "SPEC-002-008",
    "SPEC-002-013",
    "SPEC-002-018",
    "SPEC-002-019",
    "SPEC-002-021",
    "SPEC-002-022",
    "SPEC-002-024",
    "SPEC-002-025",
    "SPEC-002-027",
  ]
generated: { by: claude-code/claude-opus-5-5 }
verified: { by: human:AdrianMastronardi }
---

# STORY-002-004 — Unify named commands, native menus and About

## Description

Deliver the shared command registry, native menus and a functioning local Help/About surface.

## Applicable specification

- [SPEC-002-002: Application boundaries and progressive integration](./epic.md#spec-002-002-application-boundaries-and-progressive-integration)
- [SPEC-002-004: One locale service and complete catalogs](./epic.md#spec-002-004-one-locale-service-and-complete-catalogs)
- [SPEC-002-006: Named commands, native menus, Help and About](./epic.md#spec-002-006-named-commands-native-menus-help-and-about)
- [SPEC-002-008: Preference contracts and cross-window failure behavior](./epic.md#spec-002-008-preference-contracts-and-cross-window-failure-behavior)
- [SPEC-002-013: Accessibility requirements for foundational controls](./epic.md#spec-002-013-accessibility-requirements-for-foundational-controls)
- [SPEC-002-018: Exclusions and later obligations](./epic.md#spec-002-018-exclusions-and-later-obligations)
- [SPEC-002-019: Interface zoom and persistence](./epic.md#spec-002-019-interface-zoom-and-persistence)

- [SPEC-002-021: Presentation receipts and deterministic event ordering](./epic.md#spec-002-021-presentation-receipts-and-deterministic-event-ordering)
- [SPEC-002-022: Integrated title bar and native window state](./epic.md#spec-002-022-integrated-title-bar-and-native-window-state)
- [SPEC-002-024: Command palette, shortcut inventory, local help and native menu limits](./epic.md#spec-002-024-command-palette-shortcut-inventory-local-help-and-native-menu-limits)
- [SPEC-002-025: Settings presentation and preference save states](./epic.md#spec-002-025-settings-presentation-and-preference-save-states)
- [SPEC-002-027: Reference specimen, captures and measurements](./epic.md#spec-002-027-reference-specimen-captures-and-measurements)

## Tasks

- [ ] Integrate gate: E1-W2 from <https://github.com/ohtia/ohtia/issues/16>; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Integrate gate: E1-R4 from <https://github.com/ohtia/ohtia/issues/18>; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Integrate gate: E2-L2 from STORY-002-002; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Integrate gate: E2-P3 from STORY-002-003; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Define registry identity/context/availability/result and disposal contracts before producers/consumers.
- [ ] Wire File/Edit/View/Help and native platform adaptations through one command dispatch.
- [ ] Implement the agreed About contents and original character PNG, trusted version/build metadata, confirmed Copy version information, bundled notices and explicit project/help/report links; define Settings/workspace/zoom registration and unavailable/dispatch contracts, testing future handlers with deterministic doubles without waiting for the consumer implementations.
- [ ] Verify focused-window routing, native editing/IME, stale/unknown command rejection and consistent availability.
- [ ] Test one named command intent across duplicate delivery, revoked/disposed handlers and late callbacks; About opening and inspection must never trigger inference.
- [ ] Register the SPEC-002-024 menu structure, command additions and shortcut inventory; native items mirror only the enabled state, and unavailable reasons are exposed to Ohtia-rendered surfaces. Register New window, open-application-menu, command palette and keyboard-shortcuts entries with truthful availability until STORY-002-013 and STORY-002-014 supply their handlers.
- [ ] Deliver the offline Ohtia help dialog of SPEC-002-024 and the agreed About layout, System line and copy states of SPEC-002-006 and SPEC-002-025.
- [ ] Verify the shortcuts on the Spanish, US English, French AZERTY, German QWERTZ and Korean layouts, and that View zoom items never use Electron's zoom roles.
- [ ] Build About and the local help dialog to the SPEC-002-027 measurements and compare them with the About capture; report any disagreement between capture and text as a reference defect, with the text prevailing.

## Acceptance criteria

- [ ] Menu, shortcut and contextual invocation share behavior/availability and preserve focused editor composition.
- [ ] Help/About, the controlled character image and version/build copy work in the actual packaged native surface; future Settings/workspace/zoom handlers have truthful availability and their exact registration contracts pass. Full persisted-handler composition belongs to STORY-002-012; STORY-002-010 verifies that integrated result.
- [ ] Completion gate: E1-Q7 from <https://github.com/ohtia/ohtia/issues/21>; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Menus, accelerators and command entries match the SPEC-002-024 inventory on each platform; About shows and copies exactly the displayed product name, version, build, OS family and architecture.

## Quality checklist

- [ ] Apply the [ADR-0016 quality contract](../../adr/adr-0016-shared-quality-and-coverage-gates.md): each product package meets 80% executable lines, 80% branches and 90% changed executable lines, including own unimported code and declared exclusions. Missing reports or incomplete mandatory checks fail; no executable diff makes its diff metric inapplicable.
- [ ] Execute the positive, boundary and failure checks in the applicable specification against the declared real inputs.
- [ ] Run the applicable repository gates and required pre-commit review under [AGENTS.md](../../../AGENTS.md); record exact results and omissions.
- [ ] Record actual inputs, results and omissions, API/usage changes, installed-user impact and a candidate change note or no-note reason; distinguish local, native, CI and human integration evidence.
