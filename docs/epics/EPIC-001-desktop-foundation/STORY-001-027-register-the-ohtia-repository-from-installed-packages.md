---
type: Story
title: "STORY-001-027 — Register the Ohtia repository from installed packages"
description: "Make each DEB and RPM install the Ohtia repository entry and public key so the system delivers later updates."
generated:
  by: claude-code/claude-fable-5-2
verified:
  by: human:AdrianMastronardi
tags: ["story", "comp:desktop", "comp:tooling"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/261
epic: "EPIC-001"
epic_concept: ./epic.md
components: ["comp:desktop", "comp:tooling"]
applicable_blocks: ["SPEC-001-038", "SPEC-001-037"]
---

# STORY-001-027 — Register the Ohtia repository from installed packages

## Description

Make the first installation from a package file enable later updates through the operating system.

## Applicable specification

- [SPEC-001-038: Signed Linux package repositories](./epic.md#spec-001-038-signed-linux-package-repositories)
- [SPEC-001-037: Linux signing identity and custody](./epic.md#spec-001-037-linux-signing-identity-and-custody)

## Tasks

- [ ] Start after STORY-001-025 is merged and its output K25, the committed public key and fingerprint record, is on the base branch.
- [ ] Add to the Ubuntu and Debian packages the key ring file and the source entry with `signed-by` and the `stable` address of each distribution.
- [ ] Add to the Fedora package the repository file with `gpgcheck=1`, `repo_gpgcheck=1` and the key file.
- [ ] Add the build input that points a qualification build at the `test` zone and make a release build refuse it.
- [ ] Extend the packaged-content checks in `scripts/quality_native.py` and its tests for the new files, their owners and modes.

## Acceptance criteria

- [ ] After installing each package on its native cell, the repository entry and key exist at the specified root-owned paths with mode 0644, and the package manager lists the Ohtia repository.
- [ ] Removing the package removes the entry and the key.
- [ ] The Ubuntu package names the Ubuntu address and the Debian package the Debian address; neither installs the other's entry.
- [ ] A release build with the `test` zone input fails before packaging.
- [ ] The recurring `ci` passes on all Linux cells with the new packaged files.

## Quality checklist

- [ ] `pre-commit run --all-files`, `python3 -m unittest discover -s scripts/tests -v`, the workspace check and `git diff --check` pass, with new files included explicitly.
- [ ] The repository's independent pre-commit code review is complete and the signed commit's tree equals the reviewed candidate.
- [ ] The change is one pull request with one commit, and its `ohtia-note` states the installed-user impact or the reason there is none.
