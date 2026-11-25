---
type: Story
title: "STORY-004-009 — Confirm the Onboarding milestone"
description: "Record an explicit decision on a reviewed profile and confirmed useful first focus."
generated: { by: codex/gpt-6.2-sol }
verified:
  by: human:AdrianMastronardi
tags: ["story", "comp:app", "comp:storage"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/411
epic: "EPIC-004"
epic_concept: ./epic.md
components: ["comp:app", "comp:storage"]
applicable_blocks: ["SPEC-004-001", "SPEC-004-002", "SPEC-004-003", "SPEC-004-016", "SPEC-004-029"]
---

# STORY-004-009 — Confirm the Onboarding milestone

## Description

Record an explicit decision on a reviewed profile and confirmed useful first focus.

## Applicable specification

- [SPEC-004-001: Thesis entry and scope](./epic.md#spec-004-001-thesis-entry-and-scope)
- [SPEC-004-002: Transactional research operations](./epic.md#spec-004-002-transactional-research-operations)
- [SPEC-004-003: Scoped graphical interaction](./epic.md#spec-004-003-scoped-graphical-interaction)
- [SPEC-004-016: Confirm the Onboarding milestone](./epic.md#spec-004-016-confirm-the-onboarding-milestone)
- [SPEC-004-029: Profile and Navigator version contract](./epic.md#spec-004-029-profile-and-navigator-version-contract)

## Tasks

- [ ] Compose exact reviewed profile, confirmed focus, stage version and remaining conditions.
- [ ] Before integration, verify STORY-004-005 provides exact profile decision, version and residual questions with stale/replay review checks. Isolated work can proceed against this contract after coverage approval.
- [ ] Before integration, verify STORY-004-006 provides tested stable stage/state and transition command/history authority for the A closure. Isolated work can proceed against this contract after coverage approval.
- [ ] Before integration, verify STORY-004-007 provides the exact confirmed focus, actor and version after stale and changed-dependency checks. Isolated work can proceed against this contract after coverage approval.
- [ ] Before integration, verify STORY-004-023 provides the real scoped Navigator surface and its read and selection checks. Isolated work can proceed against this contract after coverage approval.
- [ ] Submit only the dedicated human milestone action through the stage authority.
- [ ] Document the review and focus references retained by stage completion in `docs/data-model.md`.

## Acceptance criteria

- [ ] The researcher can explicitly complete an in-progress A with a reviewed profile and a useful focus while retaining nonblocking unknowns.
- [ ] A stale confirmation, a conflicting focus or review, and confirmation from not-started or done leave stage history unchanged. Nonblocking questions may remain open.

## Quality checklist

- [ ] Start A through the real stage command. Change the profile or focus between displaying and confirming closure. Check stale refusal without a stage transition, then confirm refreshed inputs and verify that replay returns the same receipt and preserves the earlier reviewed history.
