---
type: Story
title: "STORY-004-004 — Persist the initial thesis profile"
description: "Store partial, attributed thesis facts with exact version reads and transactional save receipts."
generated: { by: codex/gpt-6.2-sol }
verified:
  by: human:AdrianMastronardi
tags: ["story", "comp:app", "comp:storage"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/406
epic: "EPIC-004"
epic_concept: ./epic.md
components: ["comp:app", "comp:storage"]
applicable_blocks: ["SPEC-004-001", "SPEC-004-002", "SPEC-004-011", "SPEC-004-029", "SPEC-004-034"]
---

# STORY-004-004 — Persist the initial thesis profile

## Description

Store partial, attributed thesis facts with exact version reads and transactional save receipts.

## Applicable specification

- [SPEC-004-001: Thesis entry and scope](./epic.md#spec-004-001-thesis-entry-and-scope)
- [SPEC-004-002: Transactional research operations](./epic.md#spec-004-002-transactional-research-operations)
- [SPEC-004-011: Persist the initial thesis profile](./epic.md#spec-004-011-persist-the-initial-thesis-profile)
- [SPEC-004-029: Profile and Navigator version contract](./epic.md#spec-004-029-profile-and-navigator-version-contract)
- [SPEC-004-034: Thesis entry paths for topic definition](./epic.md#spec-004-034-thesis-entry-paths-for-topic-definition)

## Tasks

- [ ] Define the named read, save and receipt schemas from the specified field and provenance model.
- [ ] Persist immutable revisions and current pointers. Document constraints and version relationships in `docs/data-model.md`.

## Acceptance criteria

- [ ] An existing confirmed thesis can read no profile, save partial facts and reread the exact revision after restart.
- [ ] Stale updates, invalid dates, invalid origins and over-budget values preserve the previous state. Replay returns the prior receipt.
- [ ] The profile preserves unknown topic and question fields as well as existing attributed questions and source references. Neither entry requires a comparison record.

## Quality checklist

- [ ] Run real SQLite prior-schema and fresh-schema tests, provenance and UTF-8 boundary cases, rollback, process restart and matching operation replay.
