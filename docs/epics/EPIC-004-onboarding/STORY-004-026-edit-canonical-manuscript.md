---
type: Story
title: "STORY-004-026 — Edit the canonical title and paragraph subset"
description: "Provide the private manuscript editor adapter with keyboard, clipboard and native IME behavior."
generated: { by: codex/gpt-6.2-sol }
verified:
  by: human:AdrianMastronardi
tags: ["story", "comp:app"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/428
epic: "EPIC-004"
epic_concept: ./epic.md
components: ["comp:app"]
applicable_blocks: ["SPEC-004-035"]
---

# STORY-004-026 — Edit the canonical title and paragraph subset

## Description

Provide the private manuscript editor adapter with keyboard, clipboard and native IME behavior.

## Applicable specification

- [SPEC-004-035: Edit the canonical title and paragraph subset](./epic.md#spec-004-035-edit-the-canonical-title-and-paragraph-subset)

## Tasks

- [ ] Implement the private ProseMirror adapter on the tested bounded codec and typed editor boundary.
- [ ] Before integration, verify STORY-004-012 supplies the canonical subset and typed diagnostics verified by the codec tests. Isolated work can proceed against this contract after coverage approval.
- [ ] Exercise block identity, supported clipboard input, undo, redo and controlled disposal.

## Acceptance criteria

- [ ] The adapter edits and returns bounded canonical content for a title and paragraphs, including Korean IME input. Unrepresentable clipboard input stays recoverable.

## Quality checklist

- [ ] Use the isolated packaged editor fixture for native keyboard, clipboard and IME, with no dependency on manuscript save UI.
