---
type: Story
title: "STORY-004-017 — Inspect the managed store location"
description: "Show the admitted fixed local data location and truthful availability in Settings."
generated: { by: codex/gpt-6.2-sol }
verified:
  by: human:AdrianMastronardi
tags: ["story", "comp:app", "comp:desktop"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/419
epic: "EPIC-004"
epic_concept: ./epic.md
components: ["comp:app", "comp:desktop"]
applicable_blocks: ["SPEC-004-005", "SPEC-004-024"]
---

# STORY-004-017 — Inspect the managed store location

## Description

Show the admitted fixed local data location and truthful availability in Settings.

## Applicable specification

- [SPEC-004-005: Settings operation boundaries](./epic.md#spec-004-005-settings-operation-boundaries)
- [SPEC-004-024: Inspect the managed store location](./epic.md#spec-004-024-inspect-the-managed-store-location)

## Tasks

- [ ] Expose a bounded broker read of the admitted location and its controlled state.
- [ ] Bind the existing Settings presentation with accurate sensitivity and admission explanations.

## Acceptance criteria

- [ ] The app displays the actual admitted path or an actionable unavailable state. It refuses invalid, missing or ambiguous initialized roots without fallback.

## Quality checklist

- [ ] Check fixed-root admission and failure on packaged native paths and test keyboard access independently of recovery.
