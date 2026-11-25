---
type: Story
title: "STORY-004-003 — Close a thesis in the current window"
description: "Detach a project safely from one window while preserving other scopes and pending work."
generated: { by: codex/gpt-6.2-sol }
verified:
  by: human:AdrianMastronardi
tags: ["story", "comp:app"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/405
epic: "EPIC-004"
epic_concept: ./epic.md
components: ["comp:app"]
applicable_blocks: ["SPEC-004-010"]
---

# STORY-004-003 — Close a thesis in the current window

## Description

Detach a project safely from one window while preserving other scopes and pending work.

## Applicable specification

- [SPEC-004-010: Close a thesis in the current window](./epic.md#spec-004-010-close-a-thesis-in-the-current-window)

## Tasks

- [ ] Expose the window-only close command on the scoped pending-work guard. Preserve the current startup restore policy.
- [ ] Before integration, verify STORY-004-025 provides a scoped guard and proves a delayed result cannot detach a new selection. Isolated work can proceed against this contract after coverage approval.
- [ ] Wire current-window disposal, recoverable pending input and return focus via the existing project/composer path.

## Acceptance criteria

- [ ] Closing detaches only the selected window scope, keeps ongoing tasks and other windows intact and returns focus to the selector.
- [ ] Refused close preserves pending work, and late results cannot attach to a new scope.

## Quality checklist

- [ ] Verify two windows, unsent composer input, a rejected guard, and switching to another thesis while a close guard awaits a reply. Release the old guard and verify the new selection stays open.
