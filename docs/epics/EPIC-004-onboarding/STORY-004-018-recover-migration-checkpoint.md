---
type: Story
title: "STORY-004-018 — Recover a verified migration checkpoint"
description: "Restore an admissible managed checkpoint through explicit compatible recovery and Retry."
generated: { by: codex/gpt-6.2-sol }
verified:
  by: human:AdrianMastronardi
tags: ["story", "comp:app", "comp:storage", "comp:desktop"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/420
epic: "EPIC-004"
epic_concept: ./epic.md
components: ["comp:app", "comp:storage", "comp:desktop"]
applicable_blocks: ["SPEC-004-005", "SPEC-004-025"]
---

# STORY-004-018 — Recover a verified migration checkpoint

## Description

Restore an admissible managed checkpoint through explicit compatible recovery and Retry.

## Applicable specification

- [SPEC-004-005: Settings operation boundaries](./epic.md#spec-004-005-settings-operation-boundaries)
- [SPEC-004-025: Recover a verified migration checkpoint](./epic.md#spec-004-025-recover-a-verified-migration-checkpoint)

## Tasks

- [ ] Reuse the real broker checkpoint verification and expose its controlled state through startup/Settings.
- [ ] Connect explicit recovery, separate Retry and focus/failure feedback without alternate storage authority.

## Acceptance criteria

- [ ] A verified checkpoint can be restored and explicitly retried. Corrupt, interrupted or incompatible recovery keeps ordinary admission gated and existing data safe.

## Quality checklist

- [ ] Run packaged native storage recovery cases for interruption, invalid or missing pending checkpoint, incompatible builds, journals, denial and restart. Verify startup recovery remains reachable while Settings is unavailable.
