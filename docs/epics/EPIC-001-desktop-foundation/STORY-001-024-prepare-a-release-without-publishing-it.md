---
type: Story
title: "STORY-001-024 — Prepare a release without publishing it"
description: "Add the manual workflow that reserves a version, builds its packages and stores them with attestations in an unpublished GitHub Release."
generated:
  by: claude-code/claude-fable-5-2
verified:
  by: human:AdrianMastronardi
tags: ["story", "comp:tooling", "comp:docs"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/258
epic: "EPIC-001"
epic_concept: ./epic.md
components: ["comp:tooling", "comp:docs"]
applicable_blocks: ["SPEC-001-036"]
---

# STORY-001-024 — Prepare a release without publishing it

## Description

Add `prepare-release.yml` with one job per platform, through the unpublished release with packages for Linux, macOS and Windows, all unsigned at this stage, and build attestations. Signing, notes and repository copies arrive in later stories.

## Applicable specification

- [SPEC-001-036: Prepare-release workflow](./epic.md#spec-001-036-prepare-release-workflow)

## Tasks

- [ ] Start after STORY-001-023 is merged and its output V23, the root-version helper, is on the base branch.
- [ ] Add the workflow with the `hash` input, the `main`-only ref check, single resolution of commit and version, and the atomic creation of `reserved/v<version>`.
- [ ] Build every declared platform with the exact version by reusing the `ci.yml` build entry points, without secrets in the build job.
- [ ] Attest every package, create the unpublished release, attach every platform's packages and the digest file with each asset's signing state, name unsigned assets with `unsigned`, and write the fixed testing-only heading in the release body.
- [ ] Prepare the tag ruleset for `reserved/v*` and `v*` as a reviewable plan, apply it only with the maintainer's authorization and read it back.
- [ ] Update the reviewed action and permission inventory for the actions and token permissions the workflow adds, and validate the workflow with Zizmor and a syntax validator.

## Acceptance criteria

- [ ] A dispatch from a ref other than `main`, a commit outside `main` history and a version whose reserved tag exists are each refused before any build.
- [ ] A successful run leaves the reserved tag on the selected commit and an unpublished release whose Linux assets match the digest file and whose attestations verify against the repository, workflow and commit.
- [ ] Two concurrent runs for one version produce exactly one reservation.
- [ ] The unpublished release is not visible without write access, and every unsigned asset carries `unsigned` in its name, is recorded as unsigned in the digest file and is listed under the testing-only heading.
- [ ] Each platform builds in its own job, and a failure of one platform's job fails the run without publishing a partial release.
- [ ] The ruleset readback shows that reserved and version tags cannot be deleted or moved.

## Quality checklist

- [ ] `pre-commit run --all-files`, `python3 -m unittest discover -s scripts/tests -v`, the workspace check and `git diff --check` pass, with new files included explicitly.
- [ ] The repository's independent pre-commit code review is complete and the signed commit's tree equals the reviewed candidate.
- [ ] The change is one pull request with one commit, and its `ohtia-note` states the installed-user impact or the reason there is none.
