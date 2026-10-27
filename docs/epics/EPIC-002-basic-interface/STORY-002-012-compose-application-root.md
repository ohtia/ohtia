---
type: "Story"
title: "STORY-002-012 — Compose the application root"
description: "Connect the delivered interface components into a real application and freeze one verification candidate."
tags: ["story", "comp:app", "comp:desktop"]
status: "stable"
resource: https://github.com/ohtia/ohtia/issues/54
epic: "EPIC-002"
epic_concept: "./epic.md"
components: ["comp:app", "comp:desktop"]
applicable_blocks:
  [
    "SPEC-002-002",
    "SPEC-002-009",
    "SPEC-002-010",
    "SPEC-002-017",
    "SPEC-002-019",
    "SPEC-002-020",
    "SPEC-002-021",
    "SPEC-002-022",
    "SPEC-002-023",
    "SPEC-002-024",
  ]
---

# STORY-002-012 — Compose the application root

## Description

Connect the delivered interface components into a real application and freeze one verification candidate.

## Applicable specification

- [SPEC-002-002: Application boundaries and progressive integration](./epic.md#spec-002-002-application-boundaries-and-progressive-integration)
- [SPEC-002-009: Workspace composition and incremental scenario coverage](./epic.md#spec-002-009-workspace-composition-and-incremental-scenario-coverage)
- [SPEC-002-010: Extensible Settings with real application preferences](./epic.md#spec-002-010-extensible-settings-with-real-application-preferences)
- [SPEC-002-017: Quality gates, build isolation and implementation discipline](./epic.md#spec-002-017-quality-gates-build-isolation-and-implementation-discipline)
- [SPEC-002-019: Interface zoom and persistence](./epic.md#spec-002-019-interface-zoom-and-persistence)
- [SPEC-002-020: Application composition and a shared verification candidate](./epic.md#spec-002-020-application-composition-and-a-shared-verification-candidate)

- [SPEC-002-021: Presentation receipts and deterministic event ordering](./epic.md#spec-002-021-presentation-receipts-and-deterministic-event-ordering)
- [SPEC-002-022: Integrated title bar and native window state](./epic.md#spec-002-022-integrated-title-bar-and-native-window-state)
- [SPEC-002-023: Workspace bar contents, first-run state and panel details](./epic.md#spec-002-023-workspace-bar-contents-first-run-state-and-panel-details)
- [SPEC-002-024: Command palette, shortcut inventory, local help and native menu limits](./epic.md#spec-002-024-command-palette-shortcut-inventory-local-help-and-native-menu-limits)

## Tasks

- [ ] Integrate gate: E2-O4 from STORY-002-004; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Integrate gate: E2-O6 from STORY-002-006; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Integrate gate: E2-O7 from STORY-002-007; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Integrate gate: E2-O8 from STORY-002-008; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Integrate gate: E2-O9 from STORY-002-009; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Integrate gate: E2-N13 from STORY-002-013; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Integrate gate: E2-K14 from STORY-002-014; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Connect the real workspace, menu registry, Settings triggers and preference/character/zoom handlers through the existing application port.
- [ ] Run an isolated packaged smoke journey with the actual file-backed preference boundary and active CSP.
- [ ] Use the delivered E1-B12 native quality pipeline to build/smoke the integrated source, then freeze source, lock, locale/asset and all required target/profile digests and any included optional target digests plus the separate development-catalog digest for the two verifier stories. A local library ZIP cannot satisfy this artifact gate.
- [ ] Own serialized candidate changes and invalidate affected verification evidence when a correction produces a new candidate.
- [ ] Compose the actual port corpus and feature ordering checks through the real root; verify bounded recovery and disposal, and reconcile original receipts without repeating mutations before freezing the candidate.
- [ ] Connect the New window, open-application-menu, command palette and keyboard-shortcuts handlers, the zoom-indicator input and the Navigator-welcome decoration input, and extend the packaged smoke journey as SPEC-002-020 specifies.

## Acceptance criteria

- [ ] Settings opens from the real workspace and each delivered menu/setting works through its actual handler.
- [ ] The integrated smoke journey preserves buffers, focus, preferences and scope without fixtures or a duplicate root.
- [ ] The candidate manifest is complete and usable by both verifier stories; this producer does not wait for their later reports.
- [ ] Completion gate: E1-Q7 from <https://github.com/ohtia/ohtia/issues/21>; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Completion gate: E1-B12 from <https://github.com/ohtia/ohtia/issues/26>; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] The integrated title bar, application menu, command palette, shortcuts dialog and window-state behaviors pass the packaged smoke journey.

## Quality checklist

- [ ] Apply the [ADR-0016 quality contract](../../adr/adr-0016-shared-quality-and-coverage-gates.md): each product package meets 80% executable lines, 80% branches and 90% changed executable lines, including own unimported code and declared exclusions. Missing reports or incomplete mandatory checks fail; no executable diff makes its diff metric inapplicable.
- [ ] Execute the positive, boundary and failure checks in the applicable specification against the declared real inputs.
- [ ] Run the applicable repository gates and required pre-commit review under [AGENTS.md](../../../AGENTS.md); record exact results and omissions.
- [ ] Record actual inputs, results and omissions, API/usage changes, installed-user impact and a candidate change note or no-note reason; distinguish local, native, CI and human integration evidence.
