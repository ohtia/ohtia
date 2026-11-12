---
type: Story
title: "STORY-001-031 — Check for a newer version on startup"
description: "Check GitHub for a newer published version on startup behind a default-enabled setting, without downloading anything."
generated:
  by: claude-code/claude-fable-5-2
verified:
  by: human:AdrianMastronardi
tags: ["story", "comp:app", "comp:desktop"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/265
epic: "EPIC-001"
epic_concept: ./epic.md
components: ["comp:app", "comp:desktop"]
applicable_blocks: ["SPEC-001-040"]
---

# STORY-001-031 — Check for a newer version on startup

## Description

Add the bounded latest-version check in the main process, its setting and the port surface that reports the result.

## Applicable specification

- [SPEC-001-040: Update check and notice in the application](./epic.md#spec-001-040-update-check-and-notice-in-the-application)

## Tasks

- [ ] Start after STORY-001-023 is merged and its output V23, the real packaged version, is on the base branch.
- [ ] Add the request in the trusted main process with the response size and timeout bounds added to the numeric policy record through review.
- [ ] Add the default-enabled setting through the existing settings boundary and the manual check command.
- [ ] Add the port method and event exposing the result, with the SemVer comparison SPEC-001-040 states.
- [ ] Disable the check in development and qualification builds, and add the local-server tests SPEC-001-040 lists.

## Acceptance criteria

- [ ] Against a local server, a newer final version yields "newer version available" and an equal, older or prerelease version does not.
- [ ] A malformed body, an oversized body and a timeout produce no notice on startup and a controlled error for the manual command.
- [ ] With the setting disabled the application makes no request on startup; the manual command still works.
- [ ] The request carries no research content or identifier, the renderer makes no network request, and a development build makes none.
- [ ] The setting persists across restart through the existing settings store.

## Quality checklist

- [ ] `pre-commit run --all-files`, `python3 -m unittest discover -s scripts/tests -v`, the workspace check and `git diff --check` pass, with new files included explicitly.
- [ ] The repository's independent pre-commit code review is complete and the signed commit's tree equals the reviewed candidate.
- [ ] The change is one pull request with one commit, and its `ohtia-note` states the installed-user impact or the reason there is none.
