---
type: Story
title: "STORY-004-028 — Create a manuscript from the project explorer"
description: "Create one named manuscript with a durable first revision and open its scoped tab."
generated: { by: codex/gpt-6.2-sol }
verified:
  by: human:AdrianMastronardi
tags: ["story", "comp:app", "comp:storage"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/430
epic: "EPIC-004"
epic_concept: ./epic.md
components: ["comp:app", "comp:storage"]
applicable_blocks: ["SPEC-004-037"]
---

# STORY-004-028 — Create a manuscript from the project explorer

## Description

Create one named manuscript with a durable first revision and open its scoped tab.

## Applicable specification

- [SPEC-004-037: Create a manuscript from the project explorer](./epic.md#spec-004-037-create-a-manuscript-from-the-project-explorer)

## Tasks

- [ ] Expose New manuscript in the manuscript collection with the localized default name.
- [ ] Before integration, verify STORY-004-014 supplies the actual collection and read-only open contract with scope tests. Isolated work can proceed against this contract after coverage approval.
- [ ] Before integration, verify STORY-004-013 supplies atomic named creation and replay with verified first-revision invariants. Isolated work can proceed against this contract after coverage approval.
- [ ] Issue the checked create command and open the tab only for a matching receipt. Document the action and the workspace label.

## Acceptance criteria

- [ ] The default or entered workspace label is saved with one header-only first revision. The open tab shows the saved label.
- [ ] An uncertain replay creates at most one manuscript. A late successful result does not change the selection of a newer project.

## Quality checklist

- [ ] Verify the real explorer, label versus heading, read-only open, SQLite, stale scope, cancelled creation and receipt replay.
