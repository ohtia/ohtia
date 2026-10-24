---
type: Story
title: "STORY-001-012 — Build and smoke-test native quality artifacts"
description: "Produce isolated, identifiable quality packages and complete native smoke evidence for PRs and integrated source."
tags: ["story", "comp:tooling", "comp:desktop"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/26
verified: { by: human:AdrianMastronardi }
generated:
  by: codex/gpt-6.1-sol
epic: "EPIC-001"
epic_concept: ./epic.md
components: ["comp:tooling", "comp:desktop"]
applicable_blocks:
  [
    "SPEC-001-003",
    "SPEC-001-007",
    "SPEC-001-008",
    "SPEC-001-009",
    "SPEC-001-010",
    "SPEC-001-015",
    "SPEC-001-026",
    "SPEC-001-027",
  ]
---

# STORY-001-012 — Build and smoke-test native quality artifacts

## Description

Produce isolated, identifiable quality packages and complete native smoke evidence for PRs and integrated source. This unit owns its complete result and verifies its delivered inputs; it does not wait for a returning output from its consumers. Detailed implementation decisions and their rationale are held once in the applicable specification below.

## Applicable specification

- [SPEC-001-003: Qualify target, tooling and delivery contracts](./epic.md#spec-001-003-qualify-target-tooling-and-delivery-contracts)
- [SPEC-001-007: Durable store and pre-migration recovery](./epic.md#spec-001-007-durable-store-and-pre-migration-recovery)
- [SPEC-001-008: Content-free diagnostics at the broker boundary](./epic.md#spec-001-008-content-free-diagnostics-at-the-broker-boundary)
- [SPEC-001-009: Shared checks and complete result accounting](./epic.md#spec-001-009-shared-checks-and-complete-result-accounting)
- [SPEC-001-010: Immutable Linux E2E execution](./epic.md#spec-001-010-immutable-linux-e2e-execution)
- [SPEC-001-015: Quality builds and native packaged smoke tests](./epic.md#spec-001-015-quality-builds-and-native-packaged-smoke-tests)
- [SPEC-001-026: Delivery security applicability and evidence](./epic.md#spec-001-026-delivery-security-applicability-and-evidence)
- [SPEC-001-027: Native feasibility and frozen workspace qualification](./epic.md#spec-001-027-native-feasibility-and-frozen-workspace-qualification)

## Tasks

- [ ] Integrate gate: verify STORY-001-002 output W2 and its full release condition in the Dependencies output registry and SPEC-001-015.
- [ ] Integrate gate: verify STORY-001-007 output Q7 and its full release condition in the Dependencies output registry and SPEC-001-015.
- [ ] Integrate gate: verify STORY-001-018 output D1b and its full release condition in the Dependencies output registry and SPEC-001-015.
- [ ] Integrate gate: verify Policy authority output PA and its full release condition in the Dependencies output registry and SPEC-001-015.
- [ ] Extend reviewed workflows, dependency pins and mandatory job/step inventories through repository policy.
- [ ] Implement strict aggregate accounting, artifact digests/run/tree identity, bounded retention and conservative affected-scope rules.
- [ ] Own compatibility of expanded native jobs with the actual PR verifier, policy tooling and tests; preserve strict pull_request admission and separate main-source evidence.
- [ ] Build identifiable unsigned development packages for the declared native target matrix on PR and actual integrated-main events.
- [ ] Run required packaged boundary/durability/privacy/shutdown smoke suites in isolated native data profiles/VMs.
- [ ] Produce and natively smoke-test required packages for Linux, Windows and macOS on x86-64 and ARM64, retaining actual architecture and per-cell result accounting.
- [ ] Produce applicable delivery security requirement-ID/applicability/evidence records under SPEC-001-026.

## Acceptance criteria

- [ ] Completion gate: verify STORY-001-004 output R4 and its full release condition in the Dependencies output registry and SPEC-001-015.
- [ ] Completion gate: verify STORY-001-005 output S5 and its full release condition in the Dependencies output registry and SPEC-001-015.
- [ ] Completion gate: verify STORY-001-006 output G6 and its full release condition in the Dependencies output registry and SPEC-001-015.
- [ ] Completion gate: verify STORY-001-008 output L8 and its full release condition in the Dependencies output registry and SPEC-001-015.
- [ ] Completion gate: verify Native hosts output NH and its full release condition in the Dependencies output registry and SPEC-001-015.
- [ ] Native job/result/provenance changes pass current-verifier compatibility and negative tests; no push run is accepted as pre-merge PR evidence.
- [ ] Applicable CI security evidence and required live policy authorization/readback are complete before the changed authority is used.
- [ ] All six required native targets pass; missing ARM64 or emulated-only evidence fails ci rather than silently narrowing scope.
- [ ] PR and actual integrated source have distinct complete native quality evidence; a synthetic merge result cannot replace a different main revision.
- [ ] Documentation-only exclusions are justified; uncertain/shared/native/build-input changes get the full relevant matrix.
- [ ] Incomplete or unreadable required targets fail ci; PR artifacts receive no signing/publication credentials or public update feeds.

## Quality checklist

- [ ] Exercise docs-only, renderer, native-dependency, lock/tooling and unknown-impact selection fixtures plus failed/missing/cancelled targets.
- [ ] Inspect final package contents/CSP/imports and actual utility/binding/engine/save/restart/second-instance/shutdown behavior.
- [ ] Run applicable shared checks and configured repository hooks, committed-history secret scan, existing policy tests where affected and git diff --check; include new files explicitly.
- [ ] Preserve issue-first scope, isolated worktree and unrelated changes; complete the mandated independent read-only code-review gate before any code commit, then verify signed content identity. Documentation-only work keeps its documentation checks.
- [ ] Record real inputs, results, omissions and failures; a later commit, hosted CI result and human integration are separate evidence. State installed-user impact and the proposed change note or the reason none is required.
