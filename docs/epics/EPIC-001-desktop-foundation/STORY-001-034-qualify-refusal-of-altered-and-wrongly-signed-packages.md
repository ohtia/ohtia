---
type: Story
title: "STORY-001-034 — Qualify refusal of altered and wrongly signed packages"
description: "Prove once, locally, that each package manager refuses altered packages and invalid signatures and leaves the installed version in place."
generated:
  by: claude-code/claude-opus-5-5
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

Prove once, on a local machine, that apt on Ubuntu 26.04 and Debian 13 and dnf on Fedora 44 and Fedora 45 refuse altered packages and invalid signatures.

## Applicable specification

- [SPEC-001-041: Native qualification of repository delivery](./epic.md#spec-001-041-native-qualification-of-repository-delivery)

## Tasks

- [ ] Start after STORY-001-033 is merged and its output H33, the qualification harness, is on the base branch.
- [ ] Build the fixtures locally from the signed `test` index and packages: a package altered after indexing, an index with an invalid signature, an index signed with another key and, on Fedora, an RPM signed with another key.
- [ ] Run the update attempt against each fixture through an entry that keeps the packaged key, with a control run against the unchanged index, and record the package manager's refusal and the installed state.

## Acceptance criteria

- [ ] apt on Ubuntu 26.04 and Debian 13 and dnf on Fedora 44 and Fedora 45 refuse the altered package and the invalid index with a signature or digest error, and version A stays installed.
- [ ] dnf on Fedora 44 and Fedora 45 refuses an RPM signed with another key.
- [ ] The control run accepts the unchanged index and downloads the package with the release digest.
- [ ] No fixture is written to the package repositories, and the results are recorded in this issue.

## Quality checklist

- [ ] `pre-commit run --all-files`, `python3 -m unittest discover -s scripts/tests -v`, the workspace check and `git diff --check` pass, with new files included explicitly.
- [ ] The repository's independent pre-commit code review is complete and the signed commit's tree equals the reviewed candidate.
- [ ] The change is one pull request with one commit, and its `ohtia-note` states the installed-user impact or the reason there is none.
