---
type: "Story"
title: "STORY-002-001 — Build canonical tokens, bundled fonts and static branding"
description: "Every delivered token matches its canonical definition; missing aliases, unlisted pairs and altered font bytes fail."
tags: ["story", "comp:app"]
status: "stable"
resource: https://github.com/ohtia/ohtia/issues/43
epic: "EPIC-002"
epic_concept: "./epic.md"
components: ["comp:app"]
applicable_blocks: ["SPEC-002-003", "SPEC-002-013"]
generated: { by: codex/gpt-6.1-sol, at: "2026-10-25T10:21:26Z" }
verified: { by: human:AdrianMastronardi, at: "2026-10-25T10:21:26Z" }
---

# STORY-002-001 — Build canonical tokens, bundled fonts and static branding

## Description

Every delivered token matches its canonical definition; missing aliases, unlisted pairs and altered font bytes fail.

## Applicable specification

- [SPEC-002-003: Token layers, bundled typography and static branding](./epic.md#spec-002-003-token-layers-bundled-typography-and-static-branding)
- [SPEC-002-013: Accessibility requirements for foundational controls](./epic.md#spec-002-013-accessibility-requirements-for-foundational-controls)

## Tasks

- [ ] Integrate gate: E1-W2 from <https://github.com/ohtia/ohtia/issues/16>; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Integrate gate: E1-R4 from <https://github.com/ohtia/ohtia/issues/18>; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Inspect canonical design/workspace tokens and the foundation workspace; establish a complete token/alias inventory.
- [ ] Implement checked CSS/typed metrics, theme/motion/forced-color outputs and closed contrast validation.
- [ ] Bundle verified local font/icon/brand files, including the unchanged About character PNG with its recorded hash, and role specimens.
- [ ] Run drift mutation, contrast, glyph/offline/CSP and type-role checks.

## Acceptance criteria

- [ ] Every delivered token matches its canonical definition; missing aliases, unlisted pairs and altered font bytes fail.
- [ ] All declared font roles and Korean/mixed-script specimens render locally in both themes with no synthesized faces.
- [ ] Completion gate: E1-Q7 from <https://github.com/ohtia/ohtia/issues/21>; verify the output and release condition in [Dependencies](./epic.md#dependencies).

## Quality checklist

- [ ] Apply the [ADR-0016 quality contract](../../adr/adr-0016-shared-quality-and-coverage-gates.md): each product package meets 80% executable lines, 80% branches and 90% changed executable lines, including own unimported code and declared exclusions. Missing reports or incomplete mandatory checks fail; no executable diff makes its diff metric inapplicable.
- [ ] Execute the positive, boundary and failure checks in the applicable specification against the declared real inputs.
- [ ] Run the applicable repository gates and required pre-commit review under [AGENTS.md](../../../AGENTS.md); record exact results and omissions.
- [ ] Record actual inputs, results and omissions, API/usage changes, installed-user impact and a candidate change note or no-note reason; distinguish local, native, CI and human integration evidence.
