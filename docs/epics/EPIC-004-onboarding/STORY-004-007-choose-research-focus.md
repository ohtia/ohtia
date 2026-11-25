---
type: Story
title: "STORY-004-007 — Choose the current research focus"
description: "Record a researcher-selected useful focus separately from the stage state and blockers."
generated: { by: codex/gpt-6.2-sol }
verified:
  by: human:AdrianMastronardi
tags: ["story", "comp:app", "comp:storage"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/409
epic: "EPIC-004"
epic_concept: ./epic.md
components: ["comp:app", "comp:storage"]
applicable_blocks:
  ["SPEC-004-001", "SPEC-004-002", "SPEC-004-003", "SPEC-004-014", "SPEC-004-029", "SPEC-004-034"]
---

# STORY-004-007 — Choose the current research focus

## Description

Record a researcher-selected useful focus separately from the stage state and blockers.

## Applicable specification

- [SPEC-004-001: Thesis entry and scope](./epic.md#spec-004-001-thesis-entry-and-scope)
- [SPEC-004-002: Transactional research operations](./epic.md#spec-004-002-transactional-research-operations)
- [SPEC-004-003: Scoped graphical interaction](./epic.md#spec-004-003-scoped-graphical-interaction)
- [SPEC-004-014: Choose the current research focus](./epic.md#spec-004-014-choose-the-current-research-focus)
- [SPEC-004-029: Profile and Navigator version contract](./epic.md#spec-004-029-profile-and-navigator-version-contract)
- [SPEC-004-034: Thesis entry paths for topic definition](./epic.md#spec-004-034-thesis-entry-paths-for-topic-definition)

## Tasks

- [ ] Use the most recent applicable stage entry/reentry as initial orientation and show selectable available work.
- [ ] Before integration, verify STORY-004-006 provides exact current stage and most recent entry/reentry order after its transition tests. Isolated work can proceed against this contract after coverage approval.
- [ ] Before integration, verify STORY-004-004 exposes exact profile versions and changed inputs with attribution so dependent focus can need review. Isolated work can proceed against this contract after coverage approval.
- [ ] Before integration, verify STORY-004-023 provides the real scoped Navigator surface and its read and selection checks. Isolated work can proceed against this contract after coverage approval.
- [ ] Persist exact explicit focus with optional accepted suggestion provenance. Retain earlier decisions and surface changes to their inputs.
- [ ] Document the focused-work record, version and evidence references in `docs/data-model.md`.

## Acceptance criteria

- [ ] A thesis can confirm feasible local focus before starting A and independently of closure or automated suggestions. Reentry uses the actual point of work. A focus with a suggestion origin preserves the wording and revisions accepted by the researcher.
- [ ] Changed inputs identify a focus that needs review, and unrelated feasible work remains available.
- [ ] A researcher can choose a local focus with an undecided topic or use an existing question to select the next feasible task without first comparing alternatives.

## Quality checklist

- [ ] Verify late scope changes, concurrent profile edits, default after reentry, explicit override and restart without a provider.
