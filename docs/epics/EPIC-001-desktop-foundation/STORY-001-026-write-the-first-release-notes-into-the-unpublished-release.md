---
type: Story
title: "STORY-001-026 — Write the first release notes into the unpublished release"
description: "Assemble the first release-notes text from the included pull requests' ohtia-note blocks and write it as the unpublished release body."
generated:
  by: claude-code/claude-fable-5-2
verified:
  by: human:AdrianMastronardi
tags: ["story", "comp:tooling"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/260
epic: "EPIC-001"
epic_concept: ./epic.md
components: ["comp:tooling"]
applicable_blocks: ["SPEC-001-036"]
---

# STORY-001-026 — Write the first release notes into the unpublished release

## Description

Give the maintainer a first notes text in the unpublished release, built from the notes each pull request already carries.

## Applicable specification

- [SPEC-001-036: Prepare-release workflow](./epic.md#spec-001-036-prepare-release-workflow)

## Tasks

- [ ] Start after STORY-001-024 is merged and its output D24, the prepare workflow with an unpublished release, is on the base branch.
- [ ] Collect the pull requests between the previous `v*` tag and the selected commit, or the whole history when no such tag exists, and their `ohtia-note` blocks through the existing `collect` operation of `scripts/change_notes.py`.
- [ ] Render user-impact notes grouped by `change_id` and kind, omit `impact: none` records, and write the text as the unpublished release body.
- [ ] Treat every note as inert data: no shell interpolation, no markup taken from the note, and no field that selects behavior.

## Acceptance criteria

- [ ] A prepared unpublished release's body lists each user-impact change once, with its task and result, and names no `impact: none` change.
- [ ] A pull request without a valid `ohtia-note` is reported by number in the run summary and does not stop preparation.
- [ ] A note containing shell, Markdown link and mention syntax appears as literal text in the body.
- [ ] With no previous `v*` tag the text covers the whole history up to the selected commit.

## Quality checklist

- [ ] `pre-commit run --all-files`, `python3 -m unittest discover -s scripts/tests -v`, the workspace check and `git diff --check` pass, with new files included explicitly.
- [ ] The repository's independent pre-commit code review is complete and the signed commit's tree equals the reviewed candidate.
- [ ] The change is one pull request with one commit, and its `ohtia-note` states the installed-user impact or the reason there is none.
