---
type: Story
title: "STORY-004-015 — Save manuscript edits and resolve pending close"
description: "Persist edits with checked manual saves and preserve pending work at tab or project close."
generated: { by: codex/gpt-6.2-sol }
verified:
  by: human:AdrianMastronardi
tags: ["story", "comp:app", "comp:desktop"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/417
epic: "EPIC-004"
epic_concept: ./epic.md
components: ["comp:app", "comp:desktop"]
applicable_blocks: ["SPEC-004-004", "SPEC-004-022"]
---

# STORY-004-015 — Save manuscript edits and resolve pending close

## Description

Persist edits with checked manual saves and preserve pending work at tab or project close.

## Applicable specification

- [SPEC-004-004: Writing and attention boundaries](./epic.md#spec-004-004-writing-and-attention-boundaries)
- [SPEC-004-022: Save manuscript edits and resolve pending close](./epic.md#spec-004-022-save-manuscript-edits-and-resolve-pending-close)

## Tasks

- [ ] Mount the tested editor in the actual manuscript tab. Implement explicit save and pending-work disposition at tab and window scope.
- [ ] Before integration, verify STORY-004-026 supplies the tested private editor API and pending-text behavior. Isolated work can proceed against this contract after coverage approval.
- [ ] Before integration, verify STORY-004-013 provides trusted create, save and receipt identities with stale/replay/file-backed evidence. Isolated work can proceed against this contract after coverage approval.
- [ ] Before integration, verify STORY-004-014 provides actual scoped document tabs and tested mount/close extension points. Isolated work can proceed against this contract after coverage approval.
- [ ] Before integration, verify STORY-004-025 provides the scoped pending-work contract, disposer and stale result tests. Isolated work can proceed against this contract after coverage approval.

## Acceptance criteria

- [ ] A researcher can write title and paragraphs offline and explicitly save. A lost or conflicting save preserves the buffer and the last acknowledged revision.
- [ ] The researcher can write and save the working thesis text whether the topic is still open or already established. Profile edits and notes keep their own records.

## Quality checklist

- [ ] Run packaged V09 pending-edit and close-focus cases with the real editor and store. Verify that stale or denied manual save preserves text and selection.
