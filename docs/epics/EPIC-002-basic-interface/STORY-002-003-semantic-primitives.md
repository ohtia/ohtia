---
type: "Story"
title: "STORY-002-003 — Deliver semantic primitives and the separate catalog"
description: "All delivered variants/states expose the required semantics and preserve input/focus through failure."
tags: ["story", "comp:app", "accessibility"]
status: "stable"
resource: https://github.com/ohtia/ohtia/issues/45
epic: "EPIC-002"
epic_concept: "./epic.md"
components: ["comp:app"]
applicable_blocks: ["SPEC-002-003", "SPEC-002-005", "SPEC-002-013"]
generated: { by: codex/gpt-6.1-sol, at: "2026-10-25T10:21:26Z" }
verified: { by: human:AdrianMastronardi, at: "2026-10-25T10:21:26Z" }
---

# STORY-002-003 — Deliver semantic primitives and the separate catalog

## Description

All delivered variants/states expose the required semantics and preserve input/focus through failure.

## Applicable specification

- [SPEC-002-003: Token layers, bundled typography and static branding](./epic.md#spec-002-003-token-layers-bundled-typography-and-static-branding)
- [SPEC-002-005: Semantic primitives and isolated development catalog](./epic.md#spec-002-005-semantic-primitives-and-isolated-development-catalog)
- [SPEC-002-013: Accessibility requirements for foundational controls](./epic.md#spec-002-013-accessibility-requirements-for-foundational-controls)

## Tasks

- [ ] Integrate gate: E1-W2 from <https://github.com/ohtia/ohtia/issues/16>; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Integrate gate: E2-T1 from STORY-002-001; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Integrate gate: E2-L2 from STORY-002-002; verify the output and release condition in [Dependencies](./epic.md#dependencies).
- [ ] Define component APIs from the concrete consuming tasks and approved semantic patterns.
- [ ] Implement controls, fields, tabs, menus, layers, notices and panels against translated inputs/tokens.
- [ ] Create separate synthetic catalog/build and component API/usage documentation.
- [ ] Verify keyboard/focus/IME-safe fields, errors, themes and negative product artifact exclusion.
- [ ] Verify controlled status/field callbacks under repeated snapshots, disposal and late acknowledgement; preserve newer input and announce only current accepted outcomes.

## Acceptance criteria

- [ ] All delivered variants/states expose the required semantics and preserve input/focus through failure.
- [ ] Catalog fixtures and test entry points are absent from shipped application/worker graphs.
- [ ] Completion gate: E1-Q7 from <https://github.com/ohtia/ohtia/issues/21>; verify the output and release condition in [Dependencies](./epic.md#dependencies).

## Quality checklist

- [ ] Apply the [ADR-0016 quality contract](../../adr/adr-0016-shared-quality-and-coverage-gates.md): each product package meets 80% executable lines, 80% branches and 90% changed executable lines, including own unimported code and declared exclusions. Missing reports or incomplete mandatory checks fail; no executable diff makes its diff metric inapplicable.
- [ ] Execute the positive, boundary and failure checks in the applicable specification against the declared real inputs.
- [ ] Run the applicable repository gates and required pre-commit review under [AGENTS.md](../../../AGENTS.md); record exact results and omissions.
- [ ] Record actual inputs, results and omissions, API/usage changes, installed-user impact and a candidate change note or no-note reason; distinguish local, native, CI and human integration evidence.
