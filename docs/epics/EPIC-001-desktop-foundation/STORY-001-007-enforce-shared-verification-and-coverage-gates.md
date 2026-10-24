---
type: Story
title: "STORY-001-007 — Enforce shared verification and coverage gates"
description: "Run the same meaningful types, lint, format, test, coverage and build checks locally and in CI."
tags: ["story", "comp:tooling"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/21
verified: { by: human:AdrianMastronardi }
generated:
  by: codex/gpt-6.1-sol
epic: "EPIC-001"
epic_concept: ./epic.md
components: ["comp:tooling"]
applicable_blocks: ["SPEC-001-004", "SPEC-001-009", "SPEC-001-024"]
---

# STORY-001-007 — Enforce shared verification and coverage gates

## Description

Run the same meaningful types, lint, format, test, coverage and build checks locally and in CI. This unit owns its complete result and verifies its delivered inputs; it does not wait for a returning output from its consumers. Detailed implementation decisions and their rationale are held once in the applicable specification below.

## Applicable specification

- [SPEC-001-004: Workspace and isolated tooling](./epic.md#spec-001-004-workspace-and-isolated-tooling)
- [SPEC-001-009: Shared checks and complete result accounting](./epic.md#spec-001-009-shared-checks-and-complete-result-accounting)
- [SPEC-001-024: Minimum localized and accessible foundation surfaces](./epic.md#spec-001-024-minimum-localized-and-accessible-foundation-surfaces)

## Tasks

- [ ] Integrate gate: verify STORY-001-002 output W2 and its full release condition in the Dependencies output registry and SPEC-001-009.
- [ ] Integrate gate: verify Policy authority output PA and its full release condition in the Dependencies output registry and SPEC-001-009.
- [ ] Provide common package/repository check entries and explicit product-versus-tooling coverage scope.
- [ ] Implement independent line/branch/diff gates with own unimported-code accounting and strict report validation.
- [ ] Add complete-catalog/parameter/plural/locale-inventory failure gates and deterministic fixtures without waiting for production UI.
- [ ] Introduce Vitest/Playwright inventories and deterministic shard union/mandatory-result accounting.
- [ ] Declare six native OS/CPU result partitions and add negative accounting fixtures for missing ARM64, emulated-only or one-slice universal evidence.
- [ ] Preserve existing ci/policy/history-scan contracts and document exact local/CI execution and diff-base semantics.

## Acceptance criteria

- [ ] A diff containing changed executable lines is never reported inapplicable; no changed executable lines yields an inapplicable metric rather than a fabricated percentage.
- [ ] The inventory rejects a five-target or emulated-only result while keeping browser and Linux-image coverage separate.
- [ ] Per-product-package 80/80/90 floors fail independently under the canonical denominator and exclusion rules.
- [ ] All mandatory results are accounted for; missing/skipped/cancelled/failed inventory or preparation prevents aggregate success.
- [ ] Local/CI run identical entries and tooling scripts keep meaningful behavior tests without fictitious product percentages.

## Quality checklist

- [ ] Use seeded coverage and unimported-code cases plus missing/invalid report and incomplete-shard fixtures.
- [ ] Run existing policy tests and verify actual runtime inventories distinguish browser, Electron, native and manual evidence.
- [ ] Run applicable shared checks and configured repository hooks, committed-history secret scan, existing policy tests where affected and git diff --check; include new files explicitly.
- [ ] Preserve issue-first scope, isolated worktree and unrelated changes; complete the mandated independent read-only code-review gate before any code commit, then verify signed content identity. Documentation-only work keeps its documentation checks.
- [ ] Record real inputs, results, omissions and failures; a later commit, hosted CI result and human integration are separate evidence. State installed-user impact and the proposed change note or the reason none is required.
