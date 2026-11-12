---
type: Story
title: "STORY-001-023 — Take the application version from the root manifest"
description: "Derive every package version, About and the data store release from the root package.json version."
generated:
  by: claude-code/claude-fable-5-2
verified:
  by: human:AdrianMastronardi
tags: ["story", "comp:tooling", "comp:desktop"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/257
epic: "EPIC-001"
epic_concept: ./epic.md
components: ["comp:tooling", "comp:desktop"]
applicable_blocks: ["SPEC-001-035"]
---

# STORY-001-023 — Take the application version from the root manifest

## Description

Make the root `package.json` the single source of the application version for continuous-integration packages, About, diagnostics and the data store.

## Applicable specification

- [SPEC-001-035: Application version held in source](./epic.md#spec-001-035-application-version-held-in-source)

## Tasks

- [ ] Add one helper that reads and validates the root version, and use it in `scripts/quality_native.py`, `scripts/quality_delivery.py`, `scripts/scaleway_build.py` and the contributor scripts in place of the `0.0.0-dev` literal.
- [ ] Relax `tooling/quality-package.mjs` to accept `<major.minor.patch>-dev.<run>.<attempt>` and an exact final version, and nothing else.
- [ ] Pass the packaged version to the data service in `packages/utility/src/entry.ts` in place of the fixed `release: "0.0.0"`.
- [ ] Add the tests SPEC-001-035 names and register them in the quality inventory.

## Acceptance criteria

- [ ] With the root version set to `0.3.0` in a test, the development package version is `0.3.0-dev.<run>.<attempt>` and a release build version is exactly `0.3.0`.
- [ ] A malformed root version, a version with a leading zero and a prerelease root version each fail with a controlled error before packaging.
- [ ] About and the diagnostic record show the packaged version, and the data store receives the same value.
- [ ] The six workspace packages still declare `0.0.0` and the recurring `ci` passes on all cells.

## Quality checklist

- [ ] `pre-commit run --all-files`, `python3 -m unittest discover -s scripts/tests -v`, the workspace check and `git diff --check` pass, with new files included explicitly.
- [ ] The repository's independent pre-commit code review is complete and the signed commit's tree equals the reviewed candidate.
- [ ] The change is one pull request with one commit, and its `ohtia-note` states the installed-user impact or the reason there is none.
