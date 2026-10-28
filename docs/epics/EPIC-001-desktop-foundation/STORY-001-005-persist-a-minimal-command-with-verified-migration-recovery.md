---
type: Story
title: "STORY-001-005 — Persist a minimal command with verified migration recovery"
description: "Demonstrate file-backed durability, exclusive migrations and verified checkpoint recovery through the real desktop path."
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
tags: ["story", "comp:storage", "comp:desktop"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/19
epic: "EPIC-001"
epic_concept: ./epic.md
components: ["comp:storage", "comp:desktop"]
applicable_blocks:
  [
    "SPEC-001-005",
    "SPEC-001-006",
    "SPEC-001-007",
    "SPEC-001-022",
    "SPEC-001-023",
    "SPEC-001-024",
    "SPEC-001-027",
  ]
---

# STORY-001-005 — Persist a minimal command with verified migration recovery

## Description

Demonstrate file-backed durability, exclusive migrations and verified checkpoint recovery through the real desktop path. This unit owns its complete result and verifies its delivered inputs; it does not wait for a returning output from its consumers. Detailed implementation decisions and their rationale are held once in the applicable specification below.

## Applicable specification

- [SPEC-001-005: Versioned bounded IPC and minimal operation contract](./epic.md#spec-001-005-versioned-bounded-ipc-and-minimal-operation-contract)
- [SPEC-001-006: Graphical runtime, fixed bootstrap and process supervision](./epic.md#spec-001-006-graphical-runtime-fixed-bootstrap-and-process-supervision)
- [SPEC-001-007: Durable store and pre-migration recovery](./epic.md#spec-001-007-durable-store-and-pre-migration-recovery)
- [SPEC-001-022: Security applicability and acceptance evidence](./epic.md#spec-001-022-security-applicability-and-acceptance-evidence)
- [SPEC-001-023: Isolation before the first development executable](./epic.md#spec-001-023-isolation-before-the-first-development-executable)
- [SPEC-001-024: Minimum localized and accessible foundation surfaces](./epic.md#spec-001-024-minimum-localized-and-accessible-foundation-surfaces)
- [SPEC-001-027: Native feasibility and frozen workspace qualification](./epic.md#spec-001-027-native-feasibility-and-frozen-workspace-qualification)

## Tasks

- [ ] Integrate gate: verify STORY-001-002 output W2 and its full release condition in the Dependencies output registry and SPEC-001-007.
- [ ] Integrate gate: verify STORY-001-003 output P3 and its full release condition in the Dependencies output registry and SPEC-001-007.
- [ ] Integrate gate: verify STORY-001-018 output D1b and its full release condition in the Dependencies output registry and SPEC-001-007.
- [ ] Reject non-isolated locator/store contexts before opening or creating a checkpoint; verify stable-profile sentinels remain unchanged.
- [ ] Load the exact trusted packaged addon and verify engine identity/foreign keys before normal storage admission.
- [ ] Implement the packaged ordered immutable migration registry, compatibility metadata and exclusive checkpoint/migration/recovery lifecycle before creating the first schema.
- [ ] Initialize execution_limits atomically for fresh/applicable migration cases using ADR-0011 defaults, preserve valid saved limits and reject invalid or unexpected missing initialized state.
- [ ] Extend the shared catalogs/accessible controls for real storage, open, create and recovery outcomes and decode saved locale only after store admission.
- [ ] Complete validated default-root store creation/open and locator publication without a startup location question.
- [ ] Implement minimal appearance preference read/change with atomic receipts/expected revisions and durable restart through real IPC.
- [ ] Verify UUIDv7 conformance/physical BLOB constraints for applicable entity identities without changing preference-key or idempotency contracts, and run packaged binding/storage recovery on all required targets.
- [ ] Exercise recovery before/after/uncertain commit and preserve prior state, failed journals and controlled graphical actions.

## Acceptance criteria

- [ ] Completion gate: verify STORY-001-004 output R4 and its full release condition in the Dependencies output registry and SPEC-001-007.
- [ ] Completion gate: verify Native hosts output NH and its full release condition in the Dependencies output registry and SPEC-001-007.
- [ ] Both concurrency defaults initialize to 1 in the initialization transaction; nondefault valid values survive reopening and migration.
- [ ] Invalid/unsupported/unreadable or unexpectedly absent initialized policy never reports admission readiness; write/interruption/recovery tests preserve consistent confirmed values.
- [ ] Localized real recovery, open and create journeys preserve input, keyboard and focus behavior under automated packaged checks, without a second resolver or stable-store access; 017 owns manual assistive acceptance.
- [ ] All required native storage records identify loaded addon/runtime ABI/SQLite bytes and verify real file-backed persistence/recovery; identifier constraints preserve valid identities and reject malformed fixtures.
- [ ] A saved declared preference survives restart; stale/conflicting replay and failed saves preserve the previous confirmed state.
- [ ] Fresh/current/populated databases enforce compatible user_version/history/artifact identities and reject mismatches before migration.
- [ ] Every schema transition has a verified pre-migration checkpoint and one exclusive complete transaction; returned migrator success alone is not treated as a commit.
- [ ] Recovery restores a verified whole database and consistent metadata without reattaching failed journals or pretending database downgrade/erasure.

## Quality checklist

- [ ] Run actual packaged file-backed tests for disk-full/denied I/O, concurrent launch/writes, FK failure, corrupt snapshots and edited historical modules.
- [ ] Inject interruptions before and after commit and an uncertain acknowledgement; inspect domain/schema/history/artifact state and no resumed external work.
- [ ] Run applicable shared checks and configured repository hooks, committed-history secret scan, existing policy tests where affected and git diff --check; include new files explicitly.
- [ ] Preserve issue-first scope, isolated worktree and unrelated changes; complete the mandated independent read-only code-review gate before any code commit, then verify signed content identity. Documentation-only work keeps its documentation checks.
- [ ] Record real inputs, results, omissions and failures; a later commit, hosted CI result and human integration are separate evidence. State installed-user impact and the proposed change note or the reason none is required.
