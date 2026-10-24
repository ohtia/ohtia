---
type: Story
title: "STORY-001-003 — Define and verify the bounded application port"
description: "Provide versioned runtime-validated IPC operations and error contracts for the foundation."
tags: ["story", "comp:desktop", "comp:app"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/17
verified: { by: human:AdrianMastronardi }
generated:
  by: codex/gpt-6.1-sol
epic: "EPIC-001"
epic_concept: ./epic.md
components: ["comp:desktop", "comp:app"]
applicable_blocks: ["SPEC-001-003", "SPEC-001-004", "SPEC-001-005", "SPEC-001-022", "SPEC-001-024"]
---

# STORY-001-003 — Define and verify the bounded application port

## Description

Provide versioned runtime-validated IPC operations and error contracts for the foundation. This unit owns its complete result and verifies its delivered inputs; it does not wait for a returning output from its consumers. Detailed implementation decisions and their rationale are held once in the applicable specification below.

## Applicable specification

- [SPEC-001-003: Qualify target, tooling and delivery contracts](./epic.md#spec-001-003-qualify-target-tooling-and-delivery-contracts)
- [SPEC-001-004: Workspace and isolated tooling](./epic.md#spec-001-004-workspace-and-isolated-tooling)
- [SPEC-001-005: Versioned bounded IPC and minimal operation contract](./epic.md#spec-001-005-versioned-bounded-ipc-and-minimal-operation-contract)
- [SPEC-001-022: Security applicability and acceptance evidence](./epic.md#spec-001-022-security-applicability-and-acceptance-evidence)
- [SPEC-001-024: Minimum localized and accessible foundation surfaces](./epic.md#spec-001-024-minimum-localized-and-accessible-foundation-surfaces)

## Tasks

- [ ] Integrate gate: verify STORY-001-001 output D1a and its full release condition in the Dependencies output registry and SPEC-001-005.
- [ ] Integrate gate: verify STORY-001-002 output W2 and its full release condition in the Dependencies output registry and SPEC-001-005.
- [ ] Define exact status and appearance read/change request/result/event contracts using the approved D1a numeric message/time/pending limits.
- [ ] Implement runtime decoders, controlled errors, version/idempotency/cancellation semantics and a shared conformance corpus.
- [ ] Implement the approved D1a numeric limits in the bounded wire schemas/decoders and minimum locale/message-code port; verify mismatch fails before consumer integration.
- [ ] Expose named port types while preventing Electron/SQL/paths/SDK objects from leaking into renderer/domain contracts.

## Acceptance criteria

- [ ] One numeric qualification record governs all encoded-byte/count/time/pending limits; this story cannot choose a competing set.
- [ ] Valid messages decode and invalid/wrong-version/oversized/stale messages return controlled outcomes.
- [ ] Replays distinguish identical operations from conflicting payloads and lost acknowledgements do not authorize duplicate mutations.
- [ ] Conformance corpus and complete wire/error schemas can be consumed without the preparation conversation.

## Quality checklist

- [ ] Exercise spoofed/unknown/prototype fields, multibyte bounds, stale versions, invalid child responses and queue saturation.
- [ ] Test timeout/cancellation/uncertain outcomes and subscription disposal; distinguish deterministic peers from real IPC evidence.
- [ ] Run applicable shared checks and configured repository hooks, committed-history secret scan, existing policy tests where affected and git diff --check; include new files explicitly.
- [ ] Preserve issue-first scope, isolated worktree and unrelated changes; complete the mandated independent read-only code-review gate before any code commit, then verify signed content identity. Documentation-only work keeps its documentation checks.
- [ ] Record real inputs, results, omissions and failures; a later commit, hosted CI result and human integration are separate evidence. State installed-user impact and the proposed change note or the reason none is required.
