---
type: "Story"
title: "STORY-002-013 — Deliver the integrated title bar and native window state"
description: "Each workspace window uses one integrated title-bar row, opens without a white first frame and restores saved bounds onto a connected display."
tags: ["story", "comp:desktop", "comp:app"]
status: "stable"
resource: https://github.com/ohtia/ohtia/issues/55
epic: "EPIC-002"
epic_concept: "./epic.md"
components: ["comp:desktop", "comp:app"]
applicable_blocks:
  [
    "SPEC-002-002",
    "SPEC-002-003",
    "SPEC-002-004",
    "SPEC-002-006",
    "SPEC-002-008",
    "SPEC-002-013",
    "SPEC-002-022",
    "SPEC-002-026",
    "SPEC-002-027",
  ]
generated: { by: claude-code/claude-opus-5-5 }
verified: { by: human:AdrianMastronardi }
---

# STORY-002-013 — Deliver the integrated title bar and native window state

## Description

Each workspace window uses one integrated title-bar row, opens without a white first frame and restores saved bounds onto a connected display. This unit owns the main-process window options and handlers; the bar's DOM belongs to STORY-002-006 and the command entries to STORY-002-004. Detailed implementation decisions and their rationale are held once in the applicable specification below.

## Applicable specification

- [SPEC-002-002: Application boundaries and progressive integration](./epic.md#spec-002-002-application-boundaries-and-progressive-integration)
- [SPEC-002-003: Token layers, bundled typography and static branding](./epic.md#spec-002-003-token-layers-bundled-typography-and-static-branding)
- [SPEC-002-004: One locale service and complete catalogs](./epic.md#spec-002-004-one-locale-service-and-complete-catalogs)
- [SPEC-002-006: Named commands, native menus, Help and About](./epic.md#spec-002-006-named-commands-native-menus-help-and-about)
- [SPEC-002-008: Preference contracts and cross-window failure behavior](./epic.md#spec-002-008-preference-contracts-and-cross-window-failure-behavior)
- [SPEC-002-013: Accessibility requirements for foundational controls](./epic.md#spec-002-013-accessibility-requirements-for-foundational-controls)
- [SPEC-002-022: Integrated title bar and native window state](./epic.md#spec-002-022-integrated-title-bar-and-native-window-state)
- [SPEC-002-026: Canonical documentation amendments for the approved refinements](./epic.md#spec-002-026-canonical-documentation-amendments-for-the-approved-refinements)
- [SPEC-002-027: Reference specimen, captures and measurements](./epic.md#spec-002-027-reference-specimen-captures-and-measurements)

## Tasks

- [ ] Integrate gate: E1-W2 from <https://github.com/ohtia/ohtia/issues/16>; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Integrate gate: E1-R4 from <https://github.com/ohtia/ohtia/issues/18>; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Integrate gate: E1-S5 from <https://github.com/ohtia/ohtia/issues/19>; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Integrate gate: E2-T1 from STORY-002-001; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Integrate gate: E2-C4 from STORY-002-004; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Verify that ADR-0039 and the `window_bounds` preference-key amendment of SPEC-002-026 are merged before implementing the window options or the new key.
- [ ] Inspect the foundation's actual window creation and lifecycle in the delivered main package; extend it rather than creating a second window factory.
- [ ] Apply the per-platform title-bar options of SPEC-002-022 with the 48 CSS px overlay, theme-derived overlay colors and `setTitleBarOverlay` on theme changes; measure the safe-area fallbacks and the macOS traffic-light inset on each qualified target.
- [ ] Apply `show: false`, the theme-derived `backgroundColor`, show on `ready-to-show` and `setBackgroundColor` on confirmed theme changes, including bootstrap and recovery windows.
- [ ] Implement the open-application-menu handler with `Menu.popup` below the menu button, F10 and lone left-Alt activation that respects IME composition and AltGr, Esc focus return, and registry dispatch for any accelerator that does not fire with the hidden title bar.
- [ ] Implement the New window handler through the foundation lifecycle and admission limits, reporting `window_limit` without opening a window.
- [ ] Implement the `window_bounds` named preference with exact validation, save on close and quit, restore only onto a connected display's work area, default and cascade placement, and no announcement on a failed close-time write.
- [ ] Add the catalog messages this story introduces, such as Application menu and the window-limit reason, in all 25 locales.
- [ ] Test the ordering cases of SPEC-002-022 with deterministic schedules, real file-backed preference failure and restart, and overlay qualification on every supported Linux environment.
- [ ] Replace the specimen's placeholder system-controls width and macOS inset with the values measured on each qualified target, and compare the native row with the SPEC-002-027 title-bar capture.

## Acceptance criteria

- [ ] On Windows and Linux the platform draws the system controls inside the 48 px row with theme-matching colors; on macOS the traffic lights sit in the row and the menu stays in the system menu bar.
- [ ] The application menu opens from its button, F10 and lone left Alt, closes with Esc and returns focus; every registered accelerator works with the hidden title bar.
- [ ] Dark-theme windows show no white first frame; confirmed theme changes update the overlay and background without overwriting a newer revision.
- [ ] Saved bounds restore only onto a connected display; invalid, missing or off-screen records open at the default without being rewritten; New window respects the active-window limit.
- [ ] Completion gate: E1-Q7 from <https://github.com/ohtia/ohtia/issues/21>; verify the output and release condition in [Dependencies](./epic.md#dependencies).

## Quality checklist

- [ ] Apply the [ADR-0016 quality contract](../../adr/adr-0016-shared-quality-and-coverage-gates.md): each product package meets 80% executable lines, 80% branches and 90% changed executable lines, including own unimported code and declared exclusions. Missing reports or incomplete mandatory checks fail; no executable diff makes its diff metric inapplicable.
- [ ] Execute the positive, boundary and failure checks in the applicable specification against the declared real inputs.
- [ ] Run the applicable repository gates and required pre-commit review under [AGENTS.md](../../../AGENTS.md); record exact results and omissions.
- [ ] Record actual inputs, results and omissions, API/usage changes, installed-user impact and a candidate change note or no-note reason; distinguish local, native, CI and human integration evidence.
