---
type: Story
title: "STORY-001-033 — Qualify repository delivery on one Linux cell"
description: "Prove on Ubuntu 26.04 x86-64 GNOME that a prepared version installs and the next arrives through the test repository with data intact."
generated:
  by: claude-code/claude-fable-5-2
verified:
  by: human:AdrianMastronardi
tags: ["story", "comp:tooling", "comp:desktop"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/267
epic: "EPIC-001"
epic_concept: ./epic.md
components: ["comp:tooling", "comp:desktop"]
applicable_blocks: ["SPEC-001-041", "SPEC-001-038"]
---

# STORY-001-033 — Qualify repository delivery on one Linux cell

## Description

Build the reusable qualification harness and run the complete scenario on the first cell, `linux-x64-ubuntu-26-04-gnome`.

## Applicable specification

- [SPEC-001-041: Native qualification of repository delivery](./epic.md#spec-001-041-native-qualification-of-repository-delivery)
- [SPEC-001-038: Signed Linux package repositories](./epic.md#spec-001-038-signed-linux-package-repositories)

## Tasks

- [ ] Start after STORY-001-029 and STORY-001-032 are merged and their outputs A29, the Ubuntu `test` repository, and U32, the update notice, are on the base branch.
- [ ] Prepare one real version B, and make the harness build the earlier package A from the same commit with a lower version as a qualification build registered against the `test` zone, discarding it afterwards.
- [ ] Add the harness that installs A from the package file, checks the registered repository, saves a value, publishes B to `test`, updates through the package manager and checks the value, version and sandbox state.
- [ ] Record the installed package digests, the guest identity and each step's result in the retained report.

## Acceptance criteria

- [ ] Completion gate: Native hosts output NH is observed for the cell: the run executes natively on the admitted Ubuntu 26.04 x86-64 GNOME environment.
- [ ] The cell installs A, receives B through `apt` from the `test` repository, and the saved value, the running version B and the required AppArmor and sandbox state are observed after the update.
- [ ] The recorded digest of B equals the digest in its unpublished release, and A appears in no release, tag or version history.
- [ ] The stable store sentinels of the host are unchanged.

## Quality checklist

- [ ] `pre-commit run --all-files`, `python3 -m unittest discover -s scripts/tests -v`, the workspace check and `git diff --check` pass, with new files included explicitly.
- [ ] The repository's independent pre-commit code review is complete and the signed commit's tree equals the reviewed candidate.
- [ ] The change is one pull request with one commit, and its `ohtia-note` states the installed-user impact or the reason there is none.
