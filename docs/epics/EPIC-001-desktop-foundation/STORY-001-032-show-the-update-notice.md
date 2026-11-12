---
type: Story
title: "STORY-001-032 — Show the update notice"
description: "Show a quiet title-bar button and a dialog that tells the researcher a newer version exists and how to get it on their system."
generated:
  by: claude-code/claude-fable-5-2
verified:
  by: human:AdrianMastronardi
tags: ["story", "comp:app"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/266
epic: "EPIC-001"
epic_concept: ./epic.md
components: ["comp:app"]
applicable_blocks: ["SPEC-001-040"]
---

# STORY-001-032 — Show the update notice

## Description

Add the title-bar button, the update dialog and the About state for a newer version, in every supported locale.

## Applicable specification

- [SPEC-001-040: Update check and notice in the application](./epic.md#spec-001-040-update-check-and-notice-in-the-application)

## Tasks

- [ ] Start after STORY-001-031 is merged and its output C31, the port event with the check result, is on the base branch.
- [ ] Add the button to `WorkspaceChrome` with a download icon and neutral or primary tokens, shown only when a newer version is available and never changing while the researcher writes.
- [ ] Add the dialog with installed and new versions, notes as inert text and the per-system instructions and controls SPEC-001-040 states.
- [ ] Show the same state in About and add the setting's control to Settings.
- [ ] Add every text to the typed catalogs for all supported locales, and present the exact texts and a capture to the maintainer before integration.

## Acceptance criteria

- [ ] The button is absent with no newer version and present with one, uses no `attention.*` token or `triangle-alert`, and plays no animation or sound.
- [ ] The button does not appear or change while the manuscript editor has focus and input is in progress.
- [ ] On Linux the dialog offers to open the software centre; on Windows and macOS it offers to open the official download page; no control downloads or installs.
- [ ] Release-note text containing markup is shown as literal text.
- [ ] Keyboard, focus, accessible-name and reflow checks pass for the button and the dialog, and all locale catalogs are complete.

## Quality checklist

- [ ] `pre-commit run --all-files`, `python3 -m unittest discover -s scripts/tests -v`, the workspace check and `git diff --check` pass, with new files included explicitly.
- [ ] The repository's independent pre-commit code review is complete and the signed commit's tree equals the reviewed candidate.
- [ ] The change is one pull request with one commit, and its `ohtia-note` states the installed-user impact or the reason there is none.
