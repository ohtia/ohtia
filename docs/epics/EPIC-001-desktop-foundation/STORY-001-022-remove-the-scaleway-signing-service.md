---
type: Story
title: "STORY-001-022 — Remove the Scaleway signing service"
description: "Delete the complete Scaleway signing service, its tooling, tests and documentation, keeping the ARM qualification facilities."
generated:
  by: claude-code/claude-fable-5-2
verified:
  by: human:AdrianMastronardi
tags: ["story", "comp:tooling", "comp:docs"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/256
epic: "EPIC-001"
epic_concept: ./epic.md
components: ["comp:tooling", "comp:docs"]
applicable_blocks: ["SPEC-001-033"]
---

# STORY-001-022 — Remove the Scaleway signing service

## Description

Delete the signing service that was never deployed, so later stories start from a repository without unused signing code. The Scaleway ARM qualification, recovery and preflight facilities stay.

## Applicable specification

- [SPEC-001-033: Removal of the Scaleway signing service](./epic.md#spec-001-033-removal-of-the-scaleway-signing-service)

## Tasks

- [ ] Confirm by search every path SPEC-001-033 lists and every remaining consumer of each module before deleting it; report any module that retained code still imports instead of deleting it.
- [ ] Delete the composite actions, tooling modules, scripts, container recipe, configuration records, fixtures and tests of the signing service.
- [ ] Delete `docs/linux-signing-administration.md`, remove links to deleted files from the remaining documents and update `docs/index.md`.
- [ ] Regenerate or correct `config/quality/cases.json` and `config/quality/inventory.json` so the accounted inventory equals fresh discovery.
- [ ] List in the pull request the provider resources and disposable secrets the maintainer may retire; do not touch them.

## Acceptance criteria

- [ ] A repository search finds no reference to `installation-signing`, `installation-signer`, `signing-worker`, `signing-build` or `installation-attestor` outside the ADR register, the EPIC-001 concepts and retained evidence records.
- [ ] The ARM qualification, cleanup, Scaleway preflight, Linux E2E image and `ci` workflow files are byte-identical to the base.
- [ ] The accounted Python and JavaScript test inventories match fresh discovery and both suites pass.
- [ ] No workflow, script or document links to a deleted file.

## Quality checklist

- [ ] `pre-commit run --all-files`, `python3 -m unittest discover -s scripts/tests -v`, the workspace check and `git diff --check` pass, with new files included explicitly.
- [ ] The repository's independent pre-commit code review is complete and the signed commit's tree equals the reviewed candidate.
- [ ] The change is one pull request with one commit, and its `ohtia-note` states the installed-user impact or the reason there is none.
