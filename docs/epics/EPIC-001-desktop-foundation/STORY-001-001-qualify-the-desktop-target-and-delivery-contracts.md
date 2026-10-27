---
type: Story
title: "STORY-001-001 — Qualify the desktop target and delivery contracts"
description: "Define reviewed required/optional target tooling, provisional delivery mechanisms and one numeric resource contract without waiting for native probe execution."
generated:
  by: codex/gpt-6.1-sol
tags: ["story", "comp:tooling", "comp:desktop"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/15
epic: "EPIC-001"
epic_concept: ./epic.md
components: ["comp:tooling", "comp:desktop"]
applicable_blocks: ["SPEC-001-003", "SPEC-001-022"]
---

# STORY-001-001 — Qualify the desktop target and delivery contracts

## Description

Define reviewed required/optional target tooling, provisional delivery mechanisms and one numeric resource contract without waiting for native probe execution. This unit owns its complete result and verifies its delivered inputs; it does not wait for a returning output from its consumers. Detailed implementation decisions and their rationale are held once in the applicable specification below.

## Applicable specification

- [SPEC-001-003: Qualify target, tooling and delivery contracts](./epic.md#spec-001-003-qualify-target-tooling-and-delivery-contracts)
- [SPEC-001-022: Security applicability and acceptance evidence](./epic.md#spec-001-022-security-applicability-and-acceptance-evidence)

## Tasks

- [ ] Read the adopting ADRs and actual repository configuration before reviewing tool patches or target assumptions.
- [ ] Fix the declared native target contracts with explicit required/optional scope, including supported OS versions, filesystems, packages, hardware assumptions and native dependency constraints; exclude 32-bit targets.
- [ ] Inspect primary upstream metadata and published native artifacts for exact candidate patches within adopting version lines; record assumptions and rejected choices.
- [ ] Review provisional installer, signing, notarization and updater choices, bounded retention and retirement rules, preserving empirical proof in story 018 and final signed qualification in 013.
- [ ] Publish one reviewed numeric policy record with units, ranges, encoded-byte measurement and failure outcomes for IPC and runtime resource budgets.
- [ ] Set the initial onboarding budget with explicit measurement assumptions, identifying the native validation to be completed by 018 before newcomer trials.
- [ ] Deliver D1a and its host-independent conformance checks to consumers; assign every remaining empirical question to D1b without claiming native success.

## Acceptance criteria

- [ ] D1a enumerates all required native targets and explicitly excludes 32-bit, emulation and cross-build-only substitutes for native acceptance.
- [ ] Reviewed exact candidate patches respect the adopting ADR version lines and their primary compatibility metadata.
- [ ] The single approved numeric record has owners, units, permitted ranges and controlled failure outcomes.
- [ ] Delivery, retention and initial setup-budget decisions identify their rationale and the empirical validation owned by 018 or 013.
- [ ] Workspace 002 and portable contract 003 can integrate D1a without the complete native host matrix or a finished probe harness.
- [ ] D1a makes no empirical compatibility, final signature, update or public-readiness claim.

## Quality checklist

- [ ] Identify the embedded runtime, SQLite and addon identities that 018 must observe; metadata is not successful native execution.
- [ ] Assign every empirical sandbox and delivery-mechanism question to 018 or final signed qualification 013; neither becomes a return dependency for D1a.
- [ ] Run applicable shared checks and configured repository hooks, committed-history secret scan, existing policy tests where affected and git diff --check; include new files explicitly.
- [ ] Preserve issue-first scope, isolated worktree and unrelated changes; complete the mandated independent read-only code-review gate before any code commit, then verify signed content identity. Documentation-only work keeps its documentation checks.
- [ ] Record real inputs, results, omissions and failures; a later commit, hosted CI result and human integration are separate evidence. State installed-user impact and the proposed change note or the reason none is required.
