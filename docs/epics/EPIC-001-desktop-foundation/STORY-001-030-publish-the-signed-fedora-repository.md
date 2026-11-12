---
type: Story
title: "STORY-001-030 — Publish the signed Fedora repository"
description: "Generate the signed dnf repository for Fedora on R2, in the test zone at preparation and the stable zone at publication."
generated:
  by: claude-code/claude-fable-5-2
verified:
  by: human:AdrianMastronardi
tags: ["story", "comp:tooling"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/264
epic: "EPIC-001"
epic_concept: ./epic.md
components: ["comp:tooling"]
applicable_blocks: ["SPEC-001-038", "SPEC-001-037", "SPEC-001-036", "SPEC-001-039"]
---

# STORY-001-030 — Publish the signed Fedora repository

## Description

Publish the Fedora packages of a version as a signed dnf repository, reusing the upload path of the apt repositories.

## Applicable specification

- [SPEC-001-038: Signed Linux package repositories](./epic.md#spec-001-038-signed-linux-package-repositories)
- [SPEC-001-037: Linux signing identity and custody](./epic.md#spec-001-037-linux-signing-identity-and-custody)
- [SPEC-001-036: Prepare-release workflow](./epic.md#spec-001-036-prepare-release-workflow)
- [SPEC-001-039: Publish-release workflow](./epic.md#spec-001-039-publish-release-workflow)

## Tasks

- [ ] Start after STORY-001-029 is merged and its output A29, the repository upload path and R2 access, is on the base branch.
- [ ] Add the dnf metadata builder for `x86_64` and `aarch64` with a detached signature on `repomd.xml`, from the exact packages of the unpublished release after digest verification.
- [ ] Add the Fedora copy to the `test` zone in `prepare-release.yml` and to the `stable` zone in `publish-release.yml`, uploading packages before the signed metadata.

## Acceptance criteria

- [ ] `dnf` on Fedora 44 accepts the `test` repository with `gpgcheck=1` and `repo_gpgcheck=1` and offers the prepared version.
- [ ] Metadata with an invalid signature, an RPM altered after indexing and an RPM signed with another key are refused by `dnf`.
- [ ] The repository holds the same package bytes as the unpublished release, by digest.

## Quality checklist

- [ ] `pre-commit run --all-files`, `python3 -m unittest discover -s scripts/tests -v`, the workspace check and `git diff --check` pass, with new files included explicitly.
- [ ] The repository's independent pre-commit code review is complete and the signed commit's tree equals the reviewed candidate.
- [ ] The change is one pull request with one commit, and its `ohtia-note` states the installed-user impact or the reason there is none.
