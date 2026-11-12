---
type: Story
title: "STORY-001-028 — Publish a prepared release"
description: "Add the manual workflow that publishes a prepared unpublished release without rebuilding, creates the version tag and records the notes digest."
generated:
  by: claude-code/claude-fable-5-2
verified:
  by: human:AdrianMastronardi
tags: ["story", "comp:tooling", "comp:docs"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/262
epic: "EPIC-001"
epic_concept: ./epic.md
components: ["comp:tooling", "comp:docs"]
applicable_blocks: ["SPEC-001-039"]
---

# STORY-001-028 — Publish a prepared release

## Description

Add `publish-release.yml` without the repository steps: it verifies the unpublished release, waits for approval, makes the release public and creates the version tag.

## Applicable specification

- [SPEC-001-039: Publish-release workflow](./epic.md#spec-001-039-publish-release-workflow)

## Tasks

- [ ] Start after STORY-001-025 and STORY-001-026 are merged and their outputs S25, signed packages in the unpublished release, and N26, the notes text in the unpublished release, are on the base branch.
- [ ] Add the workflow with the version input, the `main`-only ref check and the refusals SPEC-001-039 lists.
- [ ] Verify every asset against the unpublished release's digest file, then wait for approval in the `release-signing` environment with the version, commit and digests shown.
- [ ] Remove every asset recorded as unsigned and the testing-only heading from the release, leaving the digest file unchanged.
- [ ] Record the SHA-256 of the exact release body as a release asset, remove the unpublished state and create `v<version>` on the reserved commit.
- [ ] Implement reconciliation for a resumed run and the report of which surfaces are public after a partial failure.
- [ ] Update the reviewed action and permission inventory and validate the workflow with Zizmor and a syntax validator.

## Acceptance criteria

- [ ] A missing unpublished release, a missing reserved tag, an already public release and an asset that differs from the digest file are each refused before any public change.
- [ ] A fixture run makes the release public with byte-identical assets, creates `v<version>` on the reserved commit and attaches the notes digest.
- [ ] A run interrupted after the release became public and then resumed creates the tag once and replaces no asset.
- [ ] The public release holds no asset recorded as unsigned and no testing-only heading, and the digest file is byte-identical to the prepared one.
- [ ] The workflow contains no build or signing step for packages.

## Quality checklist

- [ ] `pre-commit run --all-files`, `python3 -m unittest discover -s scripts/tests -v`, the workspace check and `git diff --check` pass, with new files included explicitly.
- [ ] The repository's independent pre-commit code review is complete and the signed commit's tree equals the reviewed candidate.
- [ ] The change is one pull request with one commit, and its `ohtia-note` states the installed-user impact or the reason there is none.
