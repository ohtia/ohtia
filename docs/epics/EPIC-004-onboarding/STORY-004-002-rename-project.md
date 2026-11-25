---
type: Story
title: "STORY-004-002 — Rename the working project title"
description: "Change the selected thesis project's working title through an explicit version-checked form."
generated: { by: codex/gpt-6.2-sol }
verified:
  by: human:AdrianMastronardi
tags: ["story", "comp:app", "comp:storage"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/404
epic: "EPIC-004"
epic_concept: ./epic.md
components: ["comp:app", "comp:storage"]
applicable_blocks: ["SPEC-004-002", "SPEC-004-009"]
---

# STORY-004-002 — Rename the working project title

## Description

Change the selected thesis project's working title through an explicit version-checked form.

## Applicable specification

- [SPEC-004-002: Transactional research operations](./epic.md#spec-004-002-transactional-research-operations)
- [SPEC-004-009: Rename the working project title](./epic.md#spec-004-009-rename-the-working-project-title)

## Tasks

- [ ] Implement the named active-thesis rename and checked title revision and receipt. Record the concurrency rule in `docs/data-model.md`.
- [ ] Connect the form and selector refresh with controlled conflict, failure and uncertainty feedback.

## Acceptance criteria

- [ ] Renaming persists only the title. The original setup history, project identity, confirmed language and manuscript titles remain intact.
- [ ] Duplicate, stale and late results preserve the pending title and current window scope.

## Quality checklist

- [ ] Run V05 keyboard and IME cases with two competing sessions, replay after acknowledgement loss and read failure after a committed rename.
