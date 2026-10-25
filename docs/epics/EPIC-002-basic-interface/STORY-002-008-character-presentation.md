---
type: "Story"
title: "STORY-002-008 — Deliver character modes and distinct contributor identities"
description: "Static/Hidden/reduced-motion changes cancel motion/deferred events immediately without replay on re-enable."
tags: ["story", "comp:app"]
status: "stable"
resource: https://github.com/ohtia/ohtia/issues/50
epic: "EPIC-002"
epic_concept: "./epic.md"
components: ["comp:app"]
applicable_blocks: ["SPEC-002-005", "SPEC-002-008", "SPEC-002-011", "SPEC-002-014", "SPEC-002-018"]
generated: { by: codex/gpt-6.1-sol, at: "2026-10-25T10:21:26Z" }
verified: { by: human:AdrianMastronardi, at: "2026-10-25T10:21:26Z" }
---

# STORY-002-008 — Deliver character modes and distinct contributor identities

## Description

Static/Hidden/reduced-motion changes cancel motion/deferred events immediately without replay on re-enable.

## Applicable specification

- [SPEC-002-005: Semantic primitives and isolated development catalog](./epic.md#spec-002-005-semantic-primitives-and-isolated-development-catalog)
- [SPEC-002-008: Preference contracts and cross-window failure behavior](./epic.md#spec-002-008-preference-contracts-and-cross-window-failure-behavior)
- [SPEC-002-011: Character presentation and attributed static identities](./epic.md#spec-002-011-character-presentation-and-attributed-static-identities)
- [SPEC-002-014: Complete-page accessibility, attention and content language](./epic.md#spec-002-014-complete-page-accessibility-attention-and-content-language)
- [SPEC-002-018: Exclusions and later obligations](./epic.md#spec-002-018-exclusions-and-later-obligations)

## Tasks

- [ ] Integrate gate: E1-W2 from <https://github.com/ohtia/ohtia/issues/16>; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Integrate gate: E1-R4 from <https://github.com/ohtia/ohtia/issues/18>; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Integrate gate: E1-S5 from <https://github.com/ohtia/ohtia/issues/19>; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Integrate gate: E2-L2 from STORY-002-002; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Integrate gate: E2-P3 from STORY-002-003; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Integrate gate: E2-S7 from STORY-002-007; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Implement controlled static brand/contributor identities preserving canonical geometry and attribution.
- [ ] Bind effective Animated/Static/Hidden presentation to confirmed preferences and OS reduced motion.
- [ ] Create only separate synthetic event previews exercising batch/deferred/cancel rules; leave product event bindings unavailable.
- [ ] Verify mode/override/restart/manuscript-safe behavior, geometry/key poses and full text with decoration hidden.
- [ ] Test duplicate, reordered and canceled synthetic event batches with disposed renderers; no late callback revives motion or rewrites historical contributor attribution.

## Acceptance criteria

- [ ] Static/Hidden/reduced-motion changes cancel motion/deferred events immediately without replay on re-enable.
- [ ] Ohtia, Virgilio, specialists and original human feedback remain distinguishable without decoration/color.
- [ ] Completion gate: E1-Q7 from <https://github.com/ohtia/ohtia/issues/21>; verify the output and release condition in [Dependencies](./epic.md#dependencies).

## Quality checklist

- [ ] Apply the [ADR-0016 quality contract](../../adr/adr-0016-shared-quality-and-coverage-gates.md): each product package meets 80% executable lines, 80% branches and 90% changed executable lines, including own unimported code and declared exclusions. Missing reports or incomplete mandatory checks fail; no executable diff makes its diff metric inapplicable.
- [ ] Execute the positive, boundary and failure checks in the applicable specification against the declared real inputs.
- [ ] Run the applicable repository gates and required pre-commit review under [AGENTS.md](../../../AGENTS.md); record exact results and omissions.
- [ ] Record actual inputs, results and omissions, API/usage changes, installed-user impact and a candidate change note or no-note reason; distinguish local, native, CI and human integration evidence.
