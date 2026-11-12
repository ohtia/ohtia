---
type: Story
title: "STORY-001-034 — Qualify refusal of altered and wrongly signed packages"
description: "Prove that the package manager refuses altered packages and invalid signatures and leaves the installed version working."
generated:
  by: claude-code/claude-fable-5-2
verified:
  by: human:AdrianMastronardi
tags: ["story", "comp:tooling"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/268
epic: "EPIC-001"
epic_concept: ./epic.md
components: ["comp:tooling"]
applicable_blocks: ["SPEC-001-041"]
---

# STORY-001-034 — Qualify refusal of altered and wrongly signed packages

## Description

Add the refusal scenario to the harness and run it on the first cell.

## Applicable specification

- [SPEC-001-041: Native qualification of repository delivery](./epic.md#spec-001-041-native-qualification-of-repository-delivery)

## Tasks

- [ ] Start after STORY-001-033 is merged and its output H33, the qualification harness, is on the base branch.
- [ ] Add fixtures to the `test` zone: a package altered after indexing and an index with an invalid signature.
- [ ] Run the update attempt against each fixture and record the package manager's refusal and the installed state.

## Acceptance criteria

- [ ] `apt` refuses the altered package and the invalid index with a signature or hash error, and version A stays installed.
- [ ] Ohtia starts after each refusal and shows the saved value.
- [ ] The fixtures are removed from the `test` zone after the run and the removal is recorded.

## Quality checklist

- [ ] `pre-commit run --all-files`, `python3 -m unittest discover -s scripts/tests -v`, the workspace check and `git diff --check` pass, with new files included explicitly.
- [ ] The repository's independent pre-commit code review is complete and the signed commit's tree equals the reviewed candidate.
- [ ] The change is one pull request with one commit, and its `ohtia-note` states the installed-user impact or the reason there is none.
