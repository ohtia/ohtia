---
type: Story
title: "STORY-004-014 — Open project manuscripts in tabs"
description: "Read the scoped current manuscript in a unique, keyboard-operated workspace tab."
generated: { by: codex/gpt-6.2-sol }
verified:
  by: human:AdrianMastronardi
tags: ["story", "comp:app"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/416
epic: "EPIC-004"
epic_concept: ./epic.md
components: ["comp:app"]
applicable_blocks: ["SPEC-004-004", "SPEC-004-021"]
---

# STORY-004-014 — Open project manuscripts in tabs

## Description

Read the scoped current manuscript in a unique, keyboard-operated workspace tab.

## Applicable specification

- [SPEC-004-004: Writing and attention boundaries](./epic.md#spec-004-004-writing-and-attention-boundaries)
- [SPEC-004-021: Open project manuscripts in workspace tabs](./epic.md#spec-004-021-open-project-manuscripts-in-workspace-tabs)

## Tasks

- [ ] Bind scoped collection reads, the persistent workspace label and actual revision text to the tab contract.
- [ ] Before integration, verify STORY-004-001 provides the scoped collection and selection events with ownership and disposal checks. Isolated work can proceed against this contract after coverage approval.
- [ ] Before integration, verify STORY-004-013 provides trusted list/read and revision notifications with real SQLite tests for scope and versions. Isolated work can proceed against this contract after coverage approval.
- [ ] Apply V09 viewing and lifecycle rules and expose the content and pending-close extension points.

## Acceptance criteria

- [ ] Two real manuscript records produce unique tabs. Navigation, closure, overflow and the fixed Navigator behave correctly.
- [ ] Scope and exact revision language remain correct. Another project's resource cannot be restored, and conversation state is preserved.

## Quality checklist

- [ ] Verify the V09 viewing scenarios with two real SQLite records, packaged keyboard/reflow, read failure and invalid restored identity.
