---
type: Story
title: "STORY-001-038 — Withdraw a published release"
description: "Add the manual workflow that stops offering a published version without reusing its number or downgrading installed systems."
generated:
  by: claude-code/claude-fable-5-2
verified:
  by: human:AdrianMastronardi
tags: ["story", "comp:tooling", "comp:docs"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/272
epic: "EPIC-001"
epic_concept: ./epic.md
components: ["comp:tooling", "comp:docs"]
applicable_blocks: ["SPEC-001-043", "SPEC-001-038", "SPEC-001-040"]
---

# STORY-001-038 — Withdraw a published release

## Description

Add `withdraw-release.yml`, so a version with a serious defect stops being offered to new installations and by the update notice.

## Applicable specification

- [SPEC-001-043: Withdrawal of a published release](./epic.md#spec-001-043-withdrawal-of-a-published-release)
- [SPEC-001-038: Signed Linux package repositories](./epic.md#spec-001-038-signed-linux-package-repositories)
- [SPEC-001-040: Update check and notice in the application](./epic.md#spec-001-040-update-check-and-notice-in-the-application)

## Tasks

- [ ] Start after STORY-001-030 is merged and its output F30, the signed repositories of the three distributions and their upload path, is on the base branch.
- [ ] Add the workflow with the version and reason inputs, the `main`-only ref check and approval in the `release-signing` environment.
- [ ] Regenerate and publish the signed `stable` indexes without the withdrawn version, uploading the signed index last.
- [ ] Mark the GitHub Release as a prerelease and prepend the fixed heading with the reason; keep its tags and assets.
- [ ] Implement reconciliation for a resumed run, document the procedure in the release Playbook, update the reviewed action and permission inventory and validate the workflow with Zizmor and a syntax validator.

## Acceptance criteria

- [ ] A version that is not public is refused before any change.
- [ ] After a fixture withdrawal the `stable` indexes offer the previous version, GitHub's latest release is the previous version and the withdrawn release shows the heading with the reason.
- [ ] The tags `v<version>` and `reserved/v<version>` and the release assets still exist, and preparing the same version again is refused.
- [ ] Withdrawing the only published version leaves empty signed indexes and no latest release, and the update check reports no newer version.
- [ ] A run interrupted after the indexes changed and then resumed completes without publishing an index that names the withdrawn version.

## Quality checklist

- [ ] `pre-commit run --all-files`, `python3 -m unittest discover -s scripts/tests -v`, the workspace check and `git diff --check` pass, with new files included explicitly.
- [ ] The repository's independent pre-commit code review is complete and the signed commit's tree equals the reviewed candidate.
- [ ] The change is one pull request with one commit, and its `ohtia-note` states the installed-user impact or the reason there is none.
