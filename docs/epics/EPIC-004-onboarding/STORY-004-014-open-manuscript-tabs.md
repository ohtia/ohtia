---
type: Story
title: "STORY-004-014 — Open the project manuscript in the workspace"
description: "Open the continuous manuscript in its own tab and navigate its headings from the explorer or toolbar."
generated:
  by: claude-code/claude-opus-5-5
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

# STORY-004-014 — Open the project manuscript in the workspace

## Description

Open the continuous manuscript in its own tab and navigate its headings from the explorer or toolbar.

## Applicable specification

- [SPEC-004-004: Writing and attention boundaries](./epic.md#spec-004-004-writing-and-attention-boundaries)
- [SPEC-004-021: Open the project manuscript in the workspace](./epic.md#spec-004-021-open-the-project-manuscript-in-the-workspace)

## Tasks

- [ ] Bind verified project collection and revision reads to the fixed Manuscript tab.
- [ ] Before integration, verify STORY-004-001 provides the scoped collection and selection events with ownership and disposal checks. Isolated work can proceed against this contract after coverage approval.
- [ ] Before integration, verify STORY-004-013 provides trusted list/read and revision notifications with real SQLite tests for scope and versions. Isolated work can proceed against this contract after coverage approval.
- [ ] Connect the manuscript entry, foldable explorer index and toolbar breadcrumbs to the Manuscript tab. Exercise V09 lifecycle and focus behavior.

## Acceptance criteria

- [ ] Each project opens a single continuous manuscript in its own tab alongside Navigator. Both heading controls reach chapters in place. Disclosure controls preserve the document position and breadcrumbs expose the current heading path and its searchable choices.
- [ ] Scope and exact revision language remain correct. Another project's resource cannot be restored, and conversation state is preserved.

## Quality checklist

- [ ] Verify V09 with two real SQLite projects, legacy extra records, packaged keyboard/reflow, read failure and stale scope.
