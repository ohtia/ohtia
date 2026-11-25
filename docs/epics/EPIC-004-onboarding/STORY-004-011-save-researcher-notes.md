---
type: Story
title: "STORY-004-011 — Save researcher notes"
description: "Create, edit and reopen a locally authored note in one thesis."
generated: { by: codex/gpt-6.2-sol }
verified:
  by: human:AdrianMastronardi
tags: ["story", "comp:app", "comp:storage"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/413
epic: "EPIC-004"
epic_concept: ./epic.md
components: ["comp:app", "comp:storage"]
applicable_blocks: ["SPEC-004-004", "SPEC-004-018"]
---

# STORY-004-011 — Save researcher notes

## Description

Create, edit and reopen a locally authored note in one thesis.

## Applicable specification

- [SPEC-004-004: Writing and attention boundaries](./epic.md#spec-004-004-writing-and-attention-boundaries)
- [SPEC-004-018: Save researcher notes](./epic.md#spec-004-018-save-researcher-notes)

## Tasks

- [ ] Add note revision and receipt commands with explicit scope and optional same-project reference.
- [ ] Before integration, verify STORY-004-001 provides the tested current-scope collection events and rendering contract. Isolated work can proceed against this contract after coverage approval.
- [ ] Before integration, verify STORY-004-025 provides the scoped pending-work contract, disposer and stale result tests. Isolated work can proceed against this contract after coverage approval.
- [ ] Surface note input, original scope and durable save outcomes in the available project collection.
- [ ] Document the note ownership, revisions and current pointer in `docs/data-model.md`.

## Acceptance criteria

- [ ] The researcher can create and reopen a plain note before any corpus exists and while offline.
- [ ] Stale, failed and uncertain saves preserve recoverable note input and confirmed versions.

## Quality checklist

- [ ] Use the real SQLite and IPC boundaries for cross-project, two-window conflict, restart and lost-response replay.
