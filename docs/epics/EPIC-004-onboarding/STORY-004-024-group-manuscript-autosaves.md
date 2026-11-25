---
type: Story
title: "STORY-004-024 — Group manuscript autosaves"
description: "Persist editing bursts through the checked manual-save contract without losing pending text."
generated: { by: codex/gpt-6.2-sol }
verified:
  by: human:AdrianMastronardi
tags: ["story", "comp:app", "comp:storage"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/426
epic: "EPIC-004"
epic_concept: ./epic.md
components: ["comp:app", "comp:storage"]
applicable_blocks: ["SPEC-004-004", "SPEC-004-032"]
---

# STORY-004-024 — Group manuscript autosaves

## Description

Persist editing bursts through the checked manual-save contract without losing pending text.

## Applicable specification

- [SPEC-004-004: Writing and attention boundaries](./epic.md#spec-004-004-writing-and-attention-boundaries)
- [SPEC-004-032: Group manuscript autosaves](./epic.md#spec-004-032-group-manuscript-autosaves)

## Tasks

- [ ] Add the idle/IME scheduler and bind it to the originating revision, manuscript and scope.
- [ ] Before integration, verify STORY-004-015 provides checked manual saves, receipt reconciliation and preserved editor buffers. Isolated work can proceed against this contract after coverage approval.
- [ ] Record grouped save and recovery behavior in `docs/storage.md`.

## Acceptance criteria

- [ ] A typing burst makes one commit. In-flight, stale or uncertain saves keep pending input and remain reconcilable.

## Quality checklist

- [ ] Edit once during a pending save and then stop typing. After acknowledgement, the newer buffer saves against the acknowledged revision when the idle interval permits.
- [ ] Exercise a controlled clock, competing revisions, lost receipt, scope switch, and real packaged IME/V09 timing.
