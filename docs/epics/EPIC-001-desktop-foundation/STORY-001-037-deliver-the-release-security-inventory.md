---
type: Story
title: "STORY-001-037 — Deliver the release security inventory"
description: "Deliver the security inventory for the release boundary and release output R37 to the remaining EPIC stories."
generated:
  by: claude-code/claude-fable-5-2
verified:
  by: human:AdrianMastronardi
tags: ["story", "comp:docs", "comp:tooling"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/271
epic: "EPIC-001"
epic_concept: ./epic.md
components: ["comp:docs", "comp:tooling"]
applicable_blocks: ["SPEC-001-042", "SPEC-001-037"]
---

# STORY-001-037 — Deliver the release security inventory

## Description

Record the applicability and evidence of the security controls of the release flow and release R37.

## Applicable specification

- [SPEC-001-042: Release security inventory and output R37](./epic.md#spec-001-042-release-security-inventory-and-output-r37)
- [SPEC-001-037: Linux signing identity and custody](./epic.md#spec-001-037-linux-signing-identity-and-custody)

## Tasks

- [ ] Start after STORY-001-036 is merged and its output Q36, the twelve-cell qualification record, is on the base branch.
- [ ] Write the inventory under ADR-0000 and SPEC-001-026 for the protected environment, reserved tags, workflow ref admission, signing job, repositories and update check.
- [ ] Read back the live environment protection rules and the tag ruleset and attach the readback, distinguishing it from synthetic tests.
- [ ] State in the report that R37 replaces I13, C15 and F16 for STORY-001-017, STORY-001-019 and STORY-001-020.

## Acceptance criteria

- [ ] Every control in the inventory names its requirement identifier, applicability or exclusion reason, enforcing implementation and positive and negative evidence.
- [ ] Live readback shows the `main`-only rule and required reviewer on `release-signing` and the protection of `reserved/v*` and `v*` tags.
- [ ] The report links the qualification record of each of the twelve Linux cells and states that macOS and Windows remain ineligible for distribution.
- [ ] STORY-001-022 to STORY-001-036 are integrated and their checks pass on the base branch.

## Quality checklist

- [ ] `pre-commit run --all-files`, `python3 -m unittest discover -s scripts/tests -v`, the workspace check and `git diff --check` pass, with new files included explicitly.
- [ ] The repository's independent pre-commit code review is complete and the signed commit's tree equals the reviewed candidate.
- [ ] The change is one pull request with one commit, and its `ohtia-note` states the installed-user impact or the reason there is none.
