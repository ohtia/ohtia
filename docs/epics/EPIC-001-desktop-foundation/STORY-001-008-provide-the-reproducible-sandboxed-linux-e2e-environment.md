---
type: Story
title: "STORY-001-008 — Provide the reproducible sandboxed Linux E2E environment"
description: "Reproduce real Electron tests in an immutable Linux environment with active sandboxes."
tags: ["story", "comp:tooling", "comp:desktop"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/22
verified: { by: human:AdrianMastronardi }
generated:
  by: codex/gpt-6.1-sol
epic: "EPIC-001"
epic_concept: ./epic.md
components: ["comp:tooling", "comp:desktop"]
applicable_blocks: ["SPEC-001-009", "SPEC-001-010", "SPEC-001-027"]
---

# STORY-001-008 — Provide the reproducible sandboxed Linux E2E environment

## Description

Reproduce real Electron tests in an immutable Linux environment with active sandboxes. This unit owns its complete result and verifies its delivered inputs; it does not wait for a returning output from its consumers. Detailed implementation decisions and their rationale are held once in the applicable specification below.

## Applicable specification

- [SPEC-001-009: Shared checks and complete result accounting](./epic.md#spec-001-009-shared-checks-and-complete-result-accounting)
- [SPEC-001-010: Immutable Linux E2E execution](./epic.md#spec-001-010-immutable-linux-e2e-execution)
- [SPEC-001-027: Native feasibility and frozen workspace qualification](./epic.md#spec-001-027-native-feasibility-and-frozen-workspace-qualification)

## Tasks

- [ ] Integrate gate: verify STORY-001-002 output W2 and its full release condition in the Dependencies output registry and SPEC-001-010.
- [ ] Integrate gate: verify STORY-001-007 output Q7 and its full release condition in the Dependencies output registry and SPEC-001-010.
- [ ] Integrate gate: verify STORY-001-018 output D1b and its full release condition in the Dependencies output registry and SPEC-001-010.
- [ ] Integrate gate: verify Policy authority output PA and its full release condition in the Dependencies output registry and SPEC-001-010.
- [ ] Build the reviewed digest-pinned Linux image and frozen package/browser/runtime parity checks.
- [ ] Provide local and CI launchers for non-root Electron with active sandbox, private display and bounded resources.
- [ ] Add real packaged startup/CSP/IPC smoke inventory and fail-closed environment preparation.
- [ ] Document and verify that this image covers Linux x86-64 only; the quality-build story supplements it with native ARM64 evidence.
- [ ] Document reproducible commands and measured cold/warm timing with known evidence limits.

## Acceptance criteria

- [ ] Completion gate: verify STORY-001-004 output R4 and its full release condition in the Dependencies output registry and SPEC-001-010.
- [ ] Completion gate: verify Native hosts output NH and its full release condition in the Dependencies output registry and SPEC-001-010.
- [ ] No Linux ARM64 or Windows/macOS conformance is inferred from the pinned x86-64 E2E image.
- [ ] Package/image/browser mismatch, missing native dependency or sandbox failure fails rather than downloading a fallback or disabling controls.
- [ ] The same image/entries reproduce the required Electron inventory locally and in CI without host desktop/credentials.
- [ ] Image pinning does not claim Windows/macOS, hostile-process confinement or native assistive conformance.

## Quality checklist

- [ ] Run successful and deliberately mismatched parity/sandbox cases, root denial and missing-shard failure.
- [ ] Inspect actual Electron launch/CSP under the pinned runner policy and record package/image digests.
- [ ] Run applicable shared checks and configured repository hooks, committed-history secret scan, existing policy tests where affected and git diff --check; include new files explicitly.
- [ ] Preserve issue-first scope, isolated worktree and unrelated changes; complete the mandated independent read-only code-review gate before any code commit, then verify signed content identity. Documentation-only work keeps its documentation checks.
- [ ] Record real inputs, results, omissions and failures; a later commit, hosted CI result and human integration are separate evidence. State installed-user impact and the proposed change note or the reason none is required.
