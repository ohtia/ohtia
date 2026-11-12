---
type: Story
title: "STORY-001-025 — Sign RPM packages in the protected environment"
description: "Sign and verify RPM packages with the maintainer's OpenPGP subkey in the protected release-signing environment and document its custody."
generated:
  by: claude-code/claude-fable-5-2
verified:
  by: human:AdrianMastronardi
tags: ["story", "comp:tooling", "comp:docs"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/259
epic: "EPIC-001"
epic_concept: ./epic.md
components: ["comp:tooling", "comp:docs"]
applicable_blocks: ["SPEC-001-036", "SPEC-001-037"]
---

# STORY-001-025 — Sign RPM packages in the protected environment

## Description

Add the signing job to `prepare-release.yml` and the custody procedure for the existing OpenPGP identity.

## Applicable specification

- [SPEC-001-036: Prepare-release workflow](./epic.md#spec-001-036-prepare-release-workflow)
- [SPEC-001-037: Linux signing identity and custody](./epic.md#spec-001-037-linux-signing-identity-and-custody)

## Tasks

- [ ] Start after STORY-001-024 is merged and its output D24, the prepare workflow with an unpublished release, is on the base branch.
- [ ] Completion gate preparation: give the maintainer the exact steps to export the signing-only subkey and create the `release-signing` environment with its `main`-only rule, required approval and secrets.
- [ ] Commit the public key file and the configuration record holding the primary fingerprint.
- [ ] Add the signing job: digest check, fingerprint check, `rpmsign`, verification against a key ring with only the committed key, and digests computed after signing.
- [ ] Write the custody Playbook under `docs/` with export, renewal, revocation and recovery, and add it to `docs/index.md`.
- [ ] Test the job logic with a disposable key; never open the maintainer's private key material.

## Acceptance criteria

- [ ] Completion gate: Release facilities output RF is observed for the environment: readback shows the `main`-only rule and required reviewer, and a run from another ref is refused.
- [ ] A prepared unpublished release holds RPM packages that `rpm --checksig` accepts with the committed key and rejects when the package is altered.
- [ ] The job refuses an unsigned result, a NOKEY result, a subkey that does not belong to the recorded fingerprint and a package whose digest differs from the build job's.
- [ ] The build job's logs and environment contain no secret, and the signing job installs no project dependency.
- [ ] The Playbook lets the maintainer renew and revoke the subkey without changing the primary identity.

## Quality checklist

- [ ] `pre-commit run --all-files`, `python3 -m unittest discover -s scripts/tests -v`, the workspace check and `git diff --check` pass, with new files included explicitly.
- [ ] The repository's independent pre-commit code review is complete and the signed commit's tree equals the reviewed candidate.
- [ ] The change is one pull request with one commit, and its `ohtia-note` states the installed-user impact or the reason there is none.
