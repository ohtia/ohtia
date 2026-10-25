---
type: "Story"
title: "STORY-002-011 — Validate localized catalogs and contributor identity"
description: "Validate all 25 integrated catalogs, model-generation provenance and contributor identity without requiring human linguistic review."
tags: ["story", "comp:app", "comp:docs", "translation", "accessibility"]
status: "stable"
resource: https://github.com/ohtia/ohtia/issues/53
epic: "EPIC-002"
epic_concept: "./epic.md"
components: ["comp:app", "comp:docs"]
applicable_blocks:
  [
    "SPEC-002-004",
    "SPEC-002-006",
    "SPEC-002-010",
    "SPEC-002-011",
    "SPEC-002-012",
    "SPEC-002-014",
    "SPEC-002-016",
    "SPEC-002-020",
    "SPEC-002-023",
    "SPEC-002-024",
    "SPEC-002-025",
    "SPEC-002-027",
  ]
generated: { by: claude-code/claude-opus-5-5 }
verified: { by: human:AdrianMastronardi }
---

# STORY-002-011 — Validate localized catalogs and contributor identity

## Description

Validate all 25 integrated catalogs, model-generation provenance and contributor identity without requiring human linguistic review.

## Applicable specification

- [SPEC-002-004: One locale service and complete catalogs](./epic.md#spec-002-004-one-locale-service-and-complete-catalogs)
- [SPEC-002-006: Named commands, native menus, Help and About](./epic.md#spec-002-006-named-commands-native-menus-help-and-about)
- [SPEC-002-010: Extensible Settings with real application preferences](./epic.md#spec-002-010-extensible-settings-with-real-application-preferences)
- [SPEC-002-011: Character presentation and attributed static identities](./epic.md#spec-002-011-character-presentation-and-attributed-static-identities)
- [SPEC-002-012: Research visual specimens without domain authority](./epic.md#spec-002-012-research-visual-specimens-without-domain-authority)
- [SPEC-002-014: Complete-page accessibility, attention and content language](./epic.md#spec-002-014-complete-page-accessibility-attention-and-content-language)
- [SPEC-002-016: Catalog quality, translation provenance and contributor identity](./epic.md#spec-002-016-catalog-quality-translation-provenance-and-contributor-identity)
- [SPEC-002-020: Application composition and a shared verification candidate](./epic.md#spec-002-020-application-composition-and-a-shared-verification-candidate)
- [SPEC-002-023: Workspace bar contents, first-run state and panel details](./epic.md#spec-002-023-workspace-bar-contents-first-run-state-and-panel-details)
- [SPEC-002-024: Command palette, shortcut inventory, local help and native menu limits](./epic.md#spec-002-024-command-palette-shortcut-inventory-local-help-and-native-menu-limits)
- [SPEC-002-025: Settings presentation and preference save states](./epic.md#spec-002-025-settings-presentation-and-preference-save-states)
- [SPEC-002-027: Reference specimen, captures and measurements](./epic.md#spec-002-027-reference-specimen-captures-and-measurements)

## Tasks

- [ ] Take the composed candidate from STORY-002-012, including actual menus and Help/About, and record its source, artifact and catalog hashes.
- [ ] Validate all 25 locale JSON files, typed English message keys, parameters, plural/select forms and resolved language behavior.
- [ ] Exercise contextual rendering, Korean and mixed-script typography, long translations and accessible contributor identity across the required arrangements.
- [ ] Record actual LLM generation provenance and the absence of human linguistic review; do not recruit reviewers as a completion prerequisite.
- [ ] Coordinate findings through the shared candidate owner and bind the final catalog report to the same final candidate as native verification.
- [ ] Verify localized labels and accessible text preserve unknown, partial, uncertain, delivered and human-unreviewed meanings; no model text or role icon implies confirmation.
- [ ] Validate the new strings and contextual rendering of the bar, welcome, palette, shortcuts dialog, local help, About System line, autonym list and save states in all 25 catalogs, including long translations and Korean.
- [ ] Check that localized strings in all 25 catalogs fit the SPEC-002-027 layouts without clipping or overlap, including long translations and Korean.

## Acceptance criteria

- [ ] All 25 required catalogs and the integrated text/identity cases pass their declared structural and presentation checks.
- [ ] Catalog provenance identifies the actual model when known and states that human linguistic review has not occurred; the EPIC verifier is not inherited.
- [ ] No human translation, name-connotation or native Korean linguistic review is required to close this story or the EPIC.
- [ ] The final report identifies the current shared candidate; it makes no unsupported fluency, human-usability or conformance claim.
- [ ] Completion gate: E2-O2 from STORY-002-002; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Completion gate: E2-O6 from STORY-002-006; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Completion gate: E2-O7 from STORY-002-007; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Completion gate: E2-O8 from STORY-002-008; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Completion gate: E2-O9 from STORY-002-009; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Completion gate: E2-A12 from STORY-002-012; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Completion gate: E2-O4 from STORY-002-004; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Completion gate: E1-Q7 from <https://github.com/ohtia/ohtia/issues/21>; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Completion gate: E2-N13 from STORY-002-013; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Completion gate: E2-K14 from STORY-002-014; verify the output and release condition in [Dependencies](./epic.md#dependencies).

## Quality checklist

- [ ] Apply the [ADR-0016 quality contract](../../adr/adr-0016-shared-quality-and-coverage-gates.md): each product package meets 80% executable lines, 80% branches and 90% changed executable lines, including own unimported code and declared exclusions. Missing reports or incomplete mandatory checks fail; no executable diff makes its diff metric inapplicable.
- [ ] Execute the positive, boundary and failure checks in the applicable specification against the declared real inputs.
- [ ] Run the applicable repository gates and required pre-commit review under [AGENTS.md](../../../AGENTS.md); record exact results and omissions.
- [ ] Bind this story’s own complete report to the current candidate and rerun its affected checks after changes; no peer report is required for closure. The EPIC audit compares the two independent reports.
- [ ] Record actual inputs, results and omissions, API/usage changes, installed-user impact and a candidate change note or no-note reason; distinguish local, native, CI and human integration evidence.
