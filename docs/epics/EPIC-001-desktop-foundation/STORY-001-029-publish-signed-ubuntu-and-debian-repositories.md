---
type: Story
title: "STORY-001-029 — Publish signed Ubuntu and Debian repositories"
description: "Generate signed apt repositories for Ubuntu and Debian on R2, in the test zone at preparation and the stable zone at publication."
generated:
  by: claude-code/claude-fable-5-2
verified:
  by: human:AdrianMastronardi
tags: ["story", "comp:tooling", "comp:docs"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/263
epic: "EPIC-001"
epic_concept: ./epic.md
components: ["comp:tooling", "comp:docs"]
applicable_blocks: ["SPEC-001-038", "SPEC-001-037", "SPEC-001-036", "SPEC-001-039"]
---

# STORY-001-029 — Publish signed Ubuntu and Debian repositories

## Description

Publish the Ubuntu and Debian packages of a version as signed apt repositories.

## Applicable specification

- [SPEC-001-038: Signed Linux package repositories](./epic.md#spec-001-038-signed-linux-package-repositories)
- [SPEC-001-037: Linux signing identity and custody](./epic.md#spec-001-037-linux-signing-identity-and-custody)
- [SPEC-001-036: Prepare-release workflow](./epic.md#spec-001-036-prepare-release-workflow)
- [SPEC-001-039: Publish-release workflow](./epic.md#spec-001-039-publish-release-workflow)

## Tasks

- [ ] Start after STORY-001-027 and STORY-001-028 are merged and their outputs R27, packages that register the repository, and P28, the publish workflow, are on the base branch.
- [ ] Completion gate preparation: give the maintainer the exact R2 bucket, `packages.ohtia.com` binding and bucket-limited write credential to create, and where to store the credential.
- [ ] Add the apt index builder: `Packages` for `amd64` and `arm64`, `Release`, and `InRelease` signed with the subkey, from the exact packages of the unpublished release after digest verification.
- [ ] Add the copy to the `test` zone in `prepare-release.yml` and to the `stable` zone in `publish-release.yml`, uploading packages before the signed index.
- [ ] Document the repository layout and the recovery from an incomplete upload in the custody Playbook.

## Acceptance criteria

- [ ] Completion gate: Release facilities output RF is observed for the bucket and domain: an object written by the workflow is readable at its `packages.ohtia.com` address.
- [ ] `apt update` on Ubuntu 26.04 and on Debian 13 accepts the `test` repository with the committed key and offers the prepared version.
- [ ] An index whose signature is invalid and a package altered after indexing are refused by `apt`.
- [ ] An interrupted upload leaves the previous index served, and the run reports the incomplete state.
- [ ] The repository holds the same package bytes as the unpublished release, by digest.

## Quality checklist

- [ ] `pre-commit run --all-files`, `python3 -m unittest discover -s scripts/tests -v`, the workspace check and `git diff --check` pass, with new files included explicitly.
- [ ] The repository's independent pre-commit code review is complete and the signed commit's tree equals the reviewed candidate.
- [ ] The change is one pull request with one commit, and its `ohtia-note` states the installed-user impact or the reason there is none.
