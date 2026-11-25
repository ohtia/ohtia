---
type: Story
title: "STORY-004-022 — Edit the thesis profile in the workspace"
description: "Progressively edit and resume partial thesis context in the real workspace."
generated: { by: codex/gpt-6.2-sol }
verified:
  by: human:AdrianMastronardi
tags: ["story", "comp:app"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/424
epic: "EPIC-004"
epic_concept: ./epic.md
components: ["comp:app"]
applicable_blocks: ["SPEC-004-001", "SPEC-004-003", "SPEC-004-030", "SPEC-004-034"]
---

# STORY-004-022 — Edit the thesis profile in the workspace

## Description

Progressively edit and resume partial thesis context in the real workspace.

## Applicable specification

- [SPEC-004-001: Thesis entry and scope](./epic.md#spec-004-001-thesis-entry-and-scope)
- [SPEC-004-003: Scoped graphical interaction](./epic.md#spec-004-003-scoped-graphical-interaction)
- [SPEC-004-030: Edit the profile in the workspace](./epic.md#spec-004-030-edit-the-profile-in-the-workspace)
- [SPEC-004-034: Thesis entry paths for topic definition](./epic.md#spec-004-034-thesis-entry-paths-for-topic-definition)

## Tasks

- [ ] Build the single Research profile tab in Documents from the scoped explorer, with the known/pending summary, five field groups and checked saves.
- [ ] Before integration, verify STORY-004-001 provides the scoped explorer and collection selection contract with project-switch checks. Isolated work can proceed against this contract after coverage approval.
- [ ] Before integration, verify STORY-004-025 provides the scoped pending-work contract, disposer and stale result tests. Isolated work can proceed against this contract after coverage approval.
- [ ] Before integration, verify STORY-004-004 provides real exact reads and checked profile saves and receipts. Isolated work can proceed against this contract after coverage approval.
- [ ] Wire the existing setup transition and pending-work guard.

## Acceptance criteria

- [ ] New and advanced theses can save partial context without a deadline. The confirmed document language and provenance remain visible.
- [ ] Conflict or failed save keeps pending input and the confirmed revision available.
- [ ] The profile can be saved with a topic still unknown or with an existing bounded question. The form gives neither route a required comparison step.
- [ ] Opening the explorer entry or a section target activates the same scoped tab, preserves the conversation and pending input, and focuses the intended section. The tab works before review is available.

## Quality checklist

- [ ] Use V05/V06, actual read/save paths, restart, native keyboard/IME where applicable and a pending form on project switch.
- [ ] Open from the explorer and twice by different section targets. Test single-tab behavior, keyboard focus, pending edits and A→B→A. Record the tab and supported section target in `docs/workspace-layout.md`.
