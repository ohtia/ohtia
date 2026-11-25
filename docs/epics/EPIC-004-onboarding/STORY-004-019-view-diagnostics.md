---
type: Story
title: "STORY-004-019 — View bounded diagnostic records"
description: "Read validated technical log records through the bounded version-aware Settings viewer."
generated: { by: codex/gpt-6.2-sol }
verified:
  by: human:AdrianMastronardi
tags: ["story", "comp:app", "comp:desktop"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/421
epic: "EPIC-004"
epic_concept: ./epic.md
components: ["comp:app", "comp:desktop"]
applicable_blocks: ["SPEC-004-005", "SPEC-004-026"]
---

# STORY-004-019 — View bounded diagnostic records

## Description

Read validated technical log records through the bounded version-aware Settings viewer.

## Applicable specification

- [SPEC-004-005: Settings operation boundaries](./epic.md#spec-004-005-settings-operation-boundaries)
- [SPEC-004-026: View bounded diagnostic records](./epic.md#spec-004-026-view-bounded-diagnostic-records)

## Tasks

- [ ] Expose named bounded pages over the managed diagnostic files and decode only supported fields.
- [ ] Render controlled read, unsupported-data and availability results as text.
- [ ] Document the viewer limits and continuation invalidation in `docs/diagnostics.md`.

## Acceptance criteria

- [ ] View logs safely shows active/archive event data, UTC, severity and event name with no private markers, raw unsupported payload or arbitrary path.

## Quality checklist

- [ ] Rotate or delete the file between page requests and verify the stale continuation offers Refresh, which returns to the first page. Exercise invalid schema, oversized records, access refusal and native account paths.
