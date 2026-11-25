---
type: Story
title: "STORY-004-005 — Review an exact profile version"
description: "Inspect and record a human decision on the exact current thesis profile synthesis."
generated: { by: codex/gpt-6.2-sol }
verified:
  by: human:AdrianMastronardi
tags: ["story", "comp:app", "comp:storage"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/407
epic: "EPIC-004"
epic_concept: ./epic.md
components: ["comp:app", "comp:storage"]
applicable_blocks: ["SPEC-004-001", "SPEC-004-002", "SPEC-004-003", "SPEC-004-012", "SPEC-004-029"]
---

# STORY-004-005 — Review an exact profile version

## Description

Inspect and record a human decision on the exact current thesis profile synthesis.

## Applicable specification

- [SPEC-004-001: Thesis entry and scope](./epic.md#spec-004-001-thesis-entry-and-scope)
- [SPEC-004-002: Transactional research operations](./epic.md#spec-004-002-transactional-research-operations)
- [SPEC-004-003: Scoped graphical interaction](./epic.md#spec-004-003-scoped-graphical-interaction)
- [SPEC-004-012: Review an exact profile version](./epic.md#spec-004-012-review-an-exact-profile-version)
- [SPEC-004-029: Profile and Navigator version contract](./epic.md#spec-004-029-profile-and-navigator-version-contract)

## Tasks

- [ ] Render the exact profile synthesis and review controls in the Research profile tab. Show the reviewed version separately from unsaved changes.
- [ ] Before integration, verify STORY-004-022 provides the scoped profile tab and passive review slot with tab and focus checks. Isolated work can proceed against this contract after coverage approval.
- [ ] Before integration, verify STORY-004-004 exposes exact version, provenance and changed-field reads with SQLite and stale-save checks. Isolated work can proceed against this contract after coverage approval.
- [ ] Connect explicit review commands and expose the human decision receipt and current/stale status.
- [ ] Document the exact profile review and historical references in `docs/data-model.md`.

## Acceptance criteria

- [ ] The researcher can correct the profile or confirm an identified version and scope with named open questions.
- [ ] Researcher statements, agent reformulation and supplied requirements remain distinguishable. Earlier reviews stay historical after an edit.
- [ ] The profile tab distinguishes review unavailable, a saved version with no review, a reviewed version and a newer saved version requiring review.

## Quality checklist

- [ ] Use real receipts for exact and stale review, conflicting provenance, remaining conditions, duplicate actions and restart.
- [ ] Test the summary and explicit review controls on the real profile tab, including a pending edit and a newer saved revision.
