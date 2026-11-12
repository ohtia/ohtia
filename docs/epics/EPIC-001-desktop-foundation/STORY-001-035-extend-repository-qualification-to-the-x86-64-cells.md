---
type: Story
title: "STORY-001-035 — Extend repository qualification to the x86-64 cells"
description: "Run the repository qualification on the remaining x86-64 Linux cells, complete on GNOME and short on KDE."
generated:
  by: claude-code/claude-fable-5-2
verified:
  by: human:AdrianMastronardi
tags: ["story", "comp:tooling"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/269
epic: "EPIC-001"
epic_concept: ./epic.md
components: ["comp:tooling"]
applicable_blocks: ["SPEC-001-041"]
---

# STORY-001-035 — Extend repository qualification to the x86-64 cells

## Description

Extend the harness to Debian and Fedora and run the remaining five x86-64 cells.

## Applicable specification

- [SPEC-001-041: Native qualification of repository delivery](./epic.md#spec-001-041-native-qualification-of-repository-delivery)

## Tasks

- [ ] Start after STORY-001-034 and STORY-001-030 are merged and their outputs F34, the refusal scenario, and F30, the Fedora `test` repository, are on the base branch.
- [ ] Extend the harness to `apt` on Debian 13 and `dnf` on Fedora 44, including the wrong-key RPM refusal on Fedora.
- [ ] Run the complete and refusal scenarios on `linux-x64-debian-13-gnome` and `linux-x64-fedora-44-gnome`.
- [ ] Run the short scenario on `linux-x64-ubuntu-26-04-kde`, `linux-x64-debian-13-kde` and `linux-x64-fedora-44-kde` with the same package bytes as each GNOME counterpart.

## Acceptance criteria

- [ ] Completion gate: Native hosts output NH is observed for the five cells: each run executes natively on its admitted environment.
- [ ] The Debian and Fedora GNOME cells pass the complete and refusal scenarios, with Debian's namespace policy and Fedora's enforcing SELinux observed after the update.
- [ ] Fedora refuses an RPM signed with another key.
- [ ] Each KDE cell installs the package, starts Ohtia and shows the update button, and records the same digest as its GNOME counterpart.

## Quality checklist

- [ ] `pre-commit run --all-files`, `python3 -m unittest discover -s scripts/tests -v`, the workspace check and `git diff --check` pass, with new files included explicitly.
- [ ] The repository's independent pre-commit code review is complete and the signed commit's tree equals the reviewed candidate.
- [ ] The change is one pull request with one commit, and its `ohtia-note` states the installed-user impact or the reason there is none.
