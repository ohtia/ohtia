---
type: Story
title: "STORY-004-001 — Browse current project collections"
description: "Inspect real, scoped project collections and their availability in the workspace."
generated: { by: codex/gpt-6.2-sol }
verified:
  by: human:AdrianMastronardi
tags: ["story", "comp:app"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/403
epic: "EPIC-004"
epic_concept: ./epic.md
components: ["comp:app"]
applicable_blocks: ["SPEC-004-008"]
---

# STORY-004-001 — Browse current project collections

## Description

Inspect real, scoped project collections and their availability in the workspace.

## Applicable specification

- [SPEC-004-008: Browse current project collections](./epic.md#spec-004-008-browse-current-project-collections)

## Tasks

- [ ] Reuse the selected project scope and controlled explorer patterns for ordered, paginated project collections.
- [ ] Wire the existing Project memory and conversation surfaces and expose scoped selection and collection events.

## Acceptance criteria

- [ ] V04 preserves accessible full names, stable selection and independent groups across three confirmed thesis projects.
- [ ] V06 shows accurate empty, loading, unavailable, error and populated state. Provider loss leaves available local reads usable.

## Quality checklist

- [ ] Run packaged V04/V06 and affected V08/V13 with real existing project records and late A→B→A reads.
