---
type: Story
title: "STORY-001-002 — Establish the locked workspace and developer toolchain"
description: "Provide working package boundaries and isolated, frozen JavaScript and Python tooling."
tags: ["story", "comp:tooling"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/16
verified: { by: human:AdrianMastronardi }
generated:
  by: codex/gpt-6.1-sol
epic: "EPIC-001"
epic_concept: ./epic.md
components: ["comp:tooling"]
applicable_blocks: ["SPEC-001-003", "SPEC-001-004"]
---

# STORY-001-002 — Establish the locked workspace and developer toolchain

## Description

Provide working package boundaries and isolated, frozen JavaScript and Python tooling. This unit owns its complete result and verifies its delivered inputs; it does not wait for a returning output from its consumers. Detailed implementation decisions and their rationale are held once in the applicable specification below.

## Applicable specification

- [SPEC-001-003: Qualify target, tooling and delivery contracts](./epic.md#spec-001-003-qualify-target-tooling-and-delivery-contracts)
- [SPEC-001-004: Workspace and isolated tooling](./epic.md#spec-001-004-workspace-and-isolated-tooling)

## Tasks

- [ ] Integrate gate: verify STORY-001-001 output D1a and its full release condition in the Dependencies output registry and SPEC-001-004.
- [ ] Introduce actual package manifests, public boundaries and acyclic dependency/import checks for the implementation targets.
- [ ] Pin package tools and commit frozen JavaScript/Python resolutions; isolate worktree environments and preserve standalone script compatibility.
- [ ] Configure all six target cells, including optional native dependencies, architecture selection and controlled frozen-resolution failures; never drop a missing cell.
- [ ] Verify clean-cache frozen installation and actual package builds on the initial development host without lock changes or undeclared globals.
- [ ] Provide and document real setup, diagnosis, development, check and build entries, coordinating compiler, formatter, lint and hook pins.
- [ ] Supply 018 with the exact locks and common commands for six-target native acceptance; recheck Windows paths, line endings and architecture fixtures without making those hosts a return dependency.

## Acceptance criteria

- [ ] Frozen clean installation and builds on the initial development host preserve locks and use only declared tools.
- [ ] The workspace declares all six target cells and 018 owns their actual native frozen-install evidence; metadata or initial-host success cannot certify another cell.
- [ ] Renderer/domain import violations and dependency cycles fail; each actual package declares public interfaces and outputs.
- [ ] Python tooling remains isolated maintenance tooling and no additional end-user runtime is introduced.

## Quality checklist

- [ ] Run a cold dependency-cache install and repeat it in a second isolated worktree.
- [ ] Verify type/lint/format separation and negative import/cycle checks; retain existing script/policy tests.
- [ ] Run applicable shared checks and configured repository hooks, committed-history secret scan, existing policy tests where affected and git diff --check; include new files explicitly.
- [ ] Preserve issue-first scope, isolated worktree and unrelated changes; complete the mandated independent read-only code-review gate before any code commit, then verify signed content identity. Documentation-only work keeps its documentation checks.
- [ ] Record real inputs, results, omissions and failures; a later commit, hosted CI result and human integration are separate evidence. State installed-user impact and the proposed change note or the reason none is required.
