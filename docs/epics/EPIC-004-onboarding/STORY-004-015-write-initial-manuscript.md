---
type: Story
title: "STORY-004-015 — Save manuscript edits and resolve pending close"
description: "Preview and edit the complete manuscript in the central workspace and save its chapters as one document."
generated:
  by: claude-code/claude-opus-5-5
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

Preview and edit the complete manuscript in the central workspace and save its chapters as one document.

## Applicable specification

- [SPEC-004-004: Writing and attention boundaries](./epic.md#spec-004-004-writing-and-attention-boundaries)
- [SPEC-004-022: Save manuscript edits and resolve pending close](./epic.md#spec-004-022-save-manuscript-edits-and-resolve-pending-close)

## Tasks

- [ ] Mount the private editor in the Manuscript tab. Connect explicit save, receipt reconciliation and pending-work protection.
- [ ] Add the default Preview and explicit Edit action to the document toolbar. Share the scoped working text and restore the reading location across the two modes.
- [ ] Before integration, verify STORY-004-026 supplies the tested private editor API and pending-text behavior. Isolated work can proceed against this contract after coverage approval.
- [ ] Before integration, verify STORY-004-013 provides trusted create, save and receipt identities with stale/replay/file-backed evidence. Isolated work can proceed against this contract after coverage approval.
- [ ] Before integration, verify STORY-004-014 provides actual scoped document tabs and tested mount/close extension points. Isolated work can proceed against this contract after coverage approval.
- [ ] Before integration, verify STORY-004-025 provides the scoped pending-work contract, disposer and stale result tests. Isolated work can proceed against this contract after coverage approval.

## Acceptance criteria

- [ ] A researcher can write title and paragraphs offline and explicitly save. A lost or conflicting save preserves the buffer and the last acknowledged revision.
- [ ] The researcher can type a level-two chapter, see it in the index before saving, and save the working thesis text whether the topic is still open or already established. Profile edits and notes keep their own records.
- [ ] The Manuscript tab opens in Preview. Switching to Edit and back preserves the reading position and pending text. Both modes allow scrolling through the whole document, and a mode switch leaves the last acknowledged revision intact.

## Quality checklist

- [ ] Run packaged V09 pending-edit and close-focus cases with the real editor and store. Verify that stale or denied manual save preserves text and selection.
- [ ] In the packaged V09 fixture, open a manuscript with enough paragraphs to scroll, switch modes midway via keyboard, and verify that adjacent content remains reachable. Edit a paragraph, return to Preview, and verify the pending text is rendered. Return to Edit and verify the buffer and save guards still apply.
