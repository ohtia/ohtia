---
type: Story
title: "STORY-004-006 — Record stage entry and reentry"
description: "Commit scoped stage entry and reentry decisions and expose their exact versioned history."
generated: { by: codex/gpt-6.2-sol }
verified:
  by: human:AdrianMastronardi
tags: ["story", "comp:app", "comp:storage"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/408
epic: "EPIC-004"
epic_concept: ./epic.md
components: ["comp:app", "comp:storage"]
applicable_blocks: ["SPEC-004-001", "SPEC-004-002", "SPEC-004-013", "SPEC-004-029"]
---

# STORY-004-006 — Record stage entry and reentry

## Description

Commit scoped stage entry and reentry decisions and expose their exact versioned history.

## Applicable specification

- [SPEC-004-001: Thesis entry and scope](./epic.md#spec-004-001-thesis-entry-and-scope)
- [SPEC-004-002: Transactional research operations](./epic.md#spec-004-002-transactional-research-operations)
- [SPEC-004-013: Record stage entry and reentry](./epic.md#spec-004-013-record-stage-entry-and-reentry)
- [SPEC-004-029: Profile and Navigator version contract](./epic.md#spec-004-029-profile-and-navigator-version-contract)

## Tasks

- [ ] Implement the stage registry, reviewed-transition command, revision predicate and history projection.
- [ ] Before integration, verify STORY-004-004 supplies the exact thesis profile and available recorded context after its scope/version checks. Isolated work can proceed against this contract after coverage approval.
- [ ] Record stage state, exact evidence links and history in `docs/data-model.md`.

## Acceptance criteria

- [ ] A supported stage enters or reopens to in-progress through an explicit human command with the exact evidence, reason and observed actor.
- [ ] Unavailable later capabilities remain unavailable with their actual conditions. Reopening retains prior completion and its reviewed references, records the affected outputs and the condition for the next review.

## Quality checklist

- [ ] Verify actual SQLite, project isolation, a persisted prior reviewed fixture, concurrent first entry, stale transition rejection and operation replay without completing A through this story.
