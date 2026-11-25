---
type: Story
title: "STORY-004-023 — Read stage context in Navigator"
description: "Inspect the current thesis stage, supporting work, blockers and reviewed decisions."
generated: { by: codex/gpt-6.2-sol }
verified:
  by: human:AdrianMastronardi
tags: ["story", "comp:app"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/425
epic: "EPIC-004"
epic_concept: ./epic.md
components: ["comp:app"]
applicable_blocks: ["SPEC-004-003", "SPEC-004-031", "SPEC-004-034"]
---

# STORY-004-023 — Read stage context in Navigator

## Description

Inspect the current thesis stage, supporting work, blockers and reviewed decisions.

## Applicable specification

- [SPEC-004-003: Scoped graphical interaction](./epic.md#spec-004-003-scoped-graphical-interaction)
- [SPEC-004-031: Read stage context in Navigator](./epic.md#spec-004-031-read-stage-context-in-navigator)
- [SPEC-004-034: Thesis entry paths for topic definition](./epic.md#spec-004-034-thesis-entry-paths-for-topic-definition)

## Tasks

- [ ] Render scoped stage and profile data in Navigator, including the saved thesis deadline inline. Link to Schedule for adding or editing the deadline or viewing milestones.
- [ ] Before integration, verify STORY-004-022 provides the project-scoped profile open action and verified section focus behavior. Isolated work can proceed against this contract after coverage approval.
- [ ] Before integration, verify STORY-004-004 provides exact attributed profile reads for stage prerequisites. Isolated work can proceed against this contract after coverage approval.
- [ ] Before integration, verify STORY-004-006 provides the stage and reviewed history projection verified on persisted records. Isolated work can proceed against this contract after coverage approval.
- [ ] Document the read projection in `docs/workspace-layout.md`.

## Acceptance criteria

- [ ] The Navigator shows actual stage conditions, separate blockers and history and never starts work merely by opening.
- [ ] An old reply cannot change the new project selection.
- [ ] The stage view distinguishes an unavailable exploratory search from available local work and supports reentry from a recorded question. Opening the view dispatches nothing.
- [ ] A saved deadline is readable in Navigator without opening another tab. Unknown, inapplicable and unavailable dates are distinguishable. An explicit schedule action opens the existing Research profile tab at Schedule and preserves saved data, pending input and conversation selection.

## Quality checklist

- [ ] Test packaged keyboard, empty/unavailable/loaded states and delayed results after changing thesis.
- [ ] Test a known deadline, an unknown deadline, an inapplicable deadline and an unavailable read. Use two time zones to confirm the same calendar date. Exercise an explicit Schedule link, another profile section and a project switch during a delayed response.
