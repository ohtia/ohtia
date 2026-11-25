---
type: Story
title: "STORY-004-008 — Suggest feasible next actions"
description: "Derive a feasible session move and a prioritized weekly set from grounded thesis context."
generated: { by: codex/gpt-6.2-sol }
verified:
  by: human:AdrianMastronardi
tags: ["story", "comp:app"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/410
epic: "EPIC-004"
epic_concept: ./epic.md
components: ["comp:app"]
applicable_blocks: ["SPEC-004-003", "SPEC-004-015", "SPEC-004-029", "SPEC-004-034"]
---

# STORY-004-008 — Suggest feasible next actions

## Description

Derive a feasible session move and a prioritized weekly set from grounded thesis context.

## Applicable specification

- [SPEC-004-003: Scoped graphical interaction](./epic.md#spec-004-003-scoped-graphical-interaction)
- [SPEC-004-015: Suggest feasible next actions](./epic.md#spec-004-015-suggest-feasible-next-actions)
- [SPEC-004-029: Profile and Navigator version contract](./epic.md#spec-004-029-profile-and-navigator-version-contract)
- [SPEC-004-034: Thesis entry paths for topic definition](./epic.md#spec-004-034-thesis-entry-paths-for-topic-definition)

## Tasks

- [ ] Build the fixed local action catalog and deterministic ordering from the current profile, stage, permissions, focus and supported capabilities.
- [ ] Before integration, verify STORY-004-004 provides scoped profile conditions, known/unknown deadline and locally available inputs. Isolated work can proceed against this contract after coverage approval.
- [ ] Before integration, verify STORY-004-006 exposes actual available activities, remaining criteria and blockers through the tested Navigator read path. Isolated work can proceed against this contract after coverage approval.
- [ ] Before integration, verify STORY-004-007 provides the current selected focus and optional explicit selection command with scope checks. Isolated work can proceed against this contract after coverage approval.
- [ ] Before integration, verify STORY-004-023 provides the real scoped Navigator surface and its read and selection checks. Isolated work can proceed against this contract after coverage approval.
- [ ] Present the proposals in WeeklyActions. Connect an explicit priority choice to the existing focus confirmation and matching receipt.

## Acceptance criteria

- [ ] When enough grounded candidates exist, show three to five weekly actions and highlight one feasible session move with its reason.
- [ ] An unknown deadline exposes a clarification action. Inapplicable and unavailable dates stay distinct. The empty or short list explains its actual missing inputs or capability.
- [ ] The suggested next step reflects the actual entry point and available capabilities. A pending exploratory plan never appears as executed search, and an established question does not require a second option.

## Quality checklist

- [ ] Check an empty project, deterministic ties, fewer than three actions, an unavailable profile read and a changed-input confirmation. Confirm that previewing and selecting a local focus dispatch no provider work and that a saved focus retains its original wording after a locale change.
