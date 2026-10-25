---
type: "Story"
title: "STORY-002-009 — Build attributed research component specimens"
description: "Specimens preserve evidence/inference/human attribution and never make confirmation or scientific correctness claims."
tags: ["story", "comp:app"]
status: "stable"
resource: https://github.com/ohtia/ohtia/issues/51
epic: "EPIC-002"
epic_concept: "./epic.md"
components: ["comp:app"]
applicable_blocks:
  ["SPEC-002-003", "SPEC-002-005", "SPEC-002-011", "SPEC-002-012", "SPEC-002-014", "SPEC-002-018"]
generated: { by: codex/gpt-6.1-sol, at: "2026-10-25T10:21:26Z" }
verified: { by: human:AdrianMastronardi, at: "2026-10-25T10:21:26Z" }
---

# STORY-002-009 — Build attributed research component specimens

## Description

Specimens preserve evidence/inference/human attribution and never make confirmation or scientific correctness claims.

## Applicable specification

- [SPEC-002-003: Token layers, bundled typography and static branding](./epic.md#spec-002-003-token-layers-bundled-typography-and-static-branding)
- [SPEC-002-005: Semantic primitives and isolated development catalog](./epic.md#spec-002-005-semantic-primitives-and-isolated-development-catalog)
- [SPEC-002-011: Character presentation and attributed static identities](./epic.md#spec-002-011-character-presentation-and-attributed-static-identities)
- [SPEC-002-012: Research visual specimens without domain authority](./epic.md#spec-002-012-research-visual-specimens-without-domain-authority)
- [SPEC-002-014: Complete-page accessibility, attention and content language](./epic.md#spec-002-014-complete-page-accessibility-attention-and-content-language)
- [SPEC-002-018: Exclusions and later obligations](./epic.md#spec-002-018-exclusions-and-later-obligations)

## Tasks

- [ ] Integrate gate: E1-W2 from <https://github.com/ohtia/ohtia/issues/16>; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Integrate gate: E2-T1 from STORY-002-001; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Integrate gate: E2-L2 from STORY-002-002; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Integrate gate: E2-P3 from STORY-002-003; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Integrate gate: E2-I8 from STORY-002-008; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Start from this repository’s existing design-system/character/pose reference assets and implement controlled visual specimens for the specified voice/trust/coverage/source/review/Navigator/save states without copying stale protocol or remote-font behavior.
- [ ] Exercise explicit source/version/scope and unavailable/error/unknown/not-applicable states with permitted synthetic content.
- [ ] Wire callbacks only inside the development catalog and verify product exclusion.
- [ ] Verify contrast/shape/labels, mixed-script language, compact layout, long messages and untrusted text.
- [ ] Add controlled state specimens distinguishing cancellation request, cessation uncertainty, completion, result delivery, coverage, unknown usage and human review; approval-like prose enables no callback.

## Acceptance criteria

- [ ] Specimens preserve evidence/inference/human attribution and never make confirmation or scientific correctness claims.
- [ ] No domain persistence, inference, manuscript mutation or synthetic research enters the product build.
- [ ] Completion gate: E1-Q7 from <https://github.com/ohtia/ohtia/issues/21>; verify the output and release condition in [Dependencies](./epic.md#dependencies).

## Quality checklist

- [ ] Apply the [ADR-0016 quality contract](../../adr/adr-0016-shared-quality-and-coverage-gates.md): each product package meets 80% executable lines, 80% branches and 90% changed executable lines, including own unimported code and declared exclusions. Missing reports or incomplete mandatory checks fail; no executable diff makes its diff metric inapplicable.
- [ ] Execute the positive, boundary and failure checks in the applicable specification against the declared real inputs.
- [ ] Run the applicable repository gates and required pre-commit review under [AGENTS.md](../../../AGENTS.md); record exact results and omissions.
- [ ] Record actual inputs, results and omissions, API/usage changes, installed-user impact and a candidate change note or no-note reason; distinguish local, native, CI and human integration evidence.
