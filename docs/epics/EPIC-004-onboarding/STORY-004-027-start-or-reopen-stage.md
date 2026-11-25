---
type: Story
title: "STORY-004-027 — Start or reopen a stage from Navigator"
description: "Expose explicit current-scope stage entry and reopening in Navigator."
generated: { by: codex/gpt-6.2-sol }
verified:
  by: human:AdrianMastronardi
tags: ["story", "comp:app"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/429
epic: "EPIC-004"
epic_concept: ./epic.md
components: ["comp:app"]
applicable_blocks: ["SPEC-004-036"]
---

# STORY-004-027 — Start or reopen a stage from Navigator

## Description

Expose explicit current-scope stage entry and reopening in Navigator.

## Applicable specification

- [SPEC-004-036: Start or reopen a stage from Navigator](./epic.md#spec-004-036-start-or-reopen-a-stage-from-navigator)

## Tasks

- [ ] Mount Start Onboarding and Reopen stage in the scoped Navigator slot. Present their evidence and explicit confirmation.
- [ ] Before integration, verify STORY-004-023 supplies the scoped stage view and stage-actions slot. Isolated work can proceed against this contract after coverage approval.
- [ ] Before integration, verify STORY-004-006 supplies checked entry and reopening, exact history and receipts on real SQLite. Isolated work can proceed against this contract after coverage approval.
- [ ] Keep entered reasons and current scope recoverable across refused, stale or uncertain results.

## Acceptance criteria

- [ ] A newly setup-confirmed thesis stays not started until the user confirms Start Onboarding.
- [ ] Reopening a done stage with a reason returns it to in-progress and retains the exact prior review. The new decision records affected outputs and the next review condition.

## Quality checklist

- [ ] Use real SQLite stage records and packaged controls for entry, reopening, cancellation, conflict and lost receipt. The EPIC verifies the real complete-then-reopen sequence.
