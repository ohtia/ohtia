---
type: Story
title: "STORY-001-036 — Extend repository qualification to the ARM64 cells"
description: "Run the repository qualification on the six ARM64 Linux cells, with Fedora and Debian on authorized ephemeral guests."
generated:
  by: claude-code/claude-fable-5-2
verified:
  by: human:AdrianMastronardi
tags: ["story", "comp:tooling"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/270
epic: "EPIC-001"
epic_concept: ./epic.md
components: ["comp:tooling"]
applicable_blocks: ["SPEC-001-041"]
---

# STORY-001-036 — Extend repository qualification to the ARM64 cells

## Description

Run the same scenarios on the ARM64 cells and complete the twelve-cell record.

## Applicable specification

- [SPEC-001-041: Native qualification of repository delivery](./epic.md#spec-001-041-native-qualification-of-repository-delivery)

## Tasks

- [ ] Start after STORY-001-035 is merged and its output X35, the harness for all three distributions, is on the base branch.
- [ ] Run the complete and refusal scenarios on `linux-arm64-ubuntu-26-04-gnome`, `linux-arm64-debian-13-gnome` and `linux-arm64-fedora-44-gnome`.
- [ ] Run the short scenario on the three ARM64 KDE cells with the same package bytes as each GNOME counterpart.
- [ ] Request the maintainer's authorization for each paid ephemeral Scaleway guest before allocating it, and record cleanup, duration and cost.

## Acceptance criteria

- [ ] Completion gate: Native hosts output NH is observed for the six cells: each run executes natively on ARM64, never under emulation.
- [ ] The three ARM64 GNOME cells pass the complete and refusal scenarios and the three KDE cells pass the short scenario with matching digests.
- [ ] Cleanup confirms that no Scaleway resource remains after each guest run.
- [ ] The combined record covers all twelve Linux cells with the package digest each one installed.

## Quality checklist

- [ ] `pre-commit run --all-files`, `python3 -m unittest discover -s scripts/tests -v`, the workspace check and `git diff --check` pass, with new files included explicitly.
- [ ] The repository's independent pre-commit code review is complete and the signed commit's tree equals the reviewed candidate.
- [ ] The change is one pull request with one commit, and its `ohtia-note` states the installed-user impact or the reason there is none.
