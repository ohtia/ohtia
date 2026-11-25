---
type: Story
title: "STORY-004-013 — Save versioned manuscript records"
description: "Persist canonical manuscript revisions with exact ownership, attribution and receipts."
generated: { by: codex/gpt-6.2-sol }
verified:
  by: human:AdrianMastronardi
tags: ["story", "comp:storage"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/415
epic: "EPIC-004"
epic_concept: ./epic.md
components: ["comp:storage"]
applicable_blocks: ["SPEC-004-004", "SPEC-004-020"]
---

# STORY-004-013 — Save versioned manuscript records

## Description

Persist canonical manuscript revisions with exact ownership, attribution and receipts.

## Applicable specification

- [SPEC-004-004: Writing and attention boundaries](./epic.md#spec-004-004-writing-and-attention-boundaries)
- [SPEC-004-020: Save versioned manuscript records](./epic.md#spec-004-020-save-versioned-manuscript-records)

## Tasks

- [ ] Use the canonical manuscript and revision tables with the trusted codec for checked create/save and exact revision reads.
- [ ] Before integration, verify STORY-004-012 delivers the bounded canonical codec, identities and error contract with fidelity/bounds tests. Isolated work can proceed against this contract after coverage approval.
- [ ] Migrate the file-backed store and commit first/current pointer and immutable revision with their receipts atomically.
- [ ] Document the canonical revision persistence and receipt behavior in `docs/storage.md`.

## Acceptance criteria

- [ ] Each created manuscript has a valid first revision, and a save with the expected predecessor appends exactly one canonical revision and advances its same-manuscript pointer.
- [ ] Stored writing languages and historical revisions survive restart, replay, concurrent saves and failed commit.

## Quality checklist

- [ ] Use real file-backed conforming/stale/conflicting requests, prior schema upgrade, scope refusal and rollback with the previous pointer intact.
