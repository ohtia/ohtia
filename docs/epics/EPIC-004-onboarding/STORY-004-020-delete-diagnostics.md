---
type: Story
title: "STORY-004-020 — Delete retained diagnostic logs"
description: "Remove the locally retained technical diagnostic files after explicit confirmation."
generated: { by: codex/gpt-6.2-sol }
verified:
  by: human:AdrianMastronardi
tags: ["story", "comp:app", "comp:desktop"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/422
epic: "EPIC-004"
epic_concept: ./epic.md
components: ["comp:app", "comp:desktop"]
applicable_blocks: ["SPEC-004-005", "SPEC-004-027"]
---

# STORY-004-020 — Delete retained diagnostic logs

## Description

Remove the locally retained technical diagnostic files after explicit confirmation.

## Applicable specification

- [SPEC-004-005: Settings operation boundaries](./epic.md#spec-004-005-settings-operation-boundaries)
- [SPEC-004-027: Delete retained diagnostic logs](./epic.md#spec-004-027-delete-retained-diagnostic-logs)

## Tasks

- [ ] Wire a named confirmed action to the existing broker serialized writer deletion path.
- [ ] Present scoped, actual outcome and allow a separate refresh without repeating the deletion.
- [ ] Document the deletion scope, confirmation and recovery results in `docs/diagnostics.md`.

## Acceptance criteria

- [ ] Deletion affects only managed diagnostic files. Concurrent new logging and partial failure are represented accurately and research receipts/history stay intact.

## Quality checklist

- [ ] Compare managed and unrelated files and research state after native deletion. Lose the reply, append new events and verify a refresh does not repeat the deletion.
