---
type: Story
title: "STORY-001-006 — Implement bounded diagnostics without private content"
description: "Emit validated content-free diagnostics through one bounded broker-owned writer."
tags: ["story", "comp:desktop", "comp:tooling"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/20
verified: { by: human:AdrianMastronardi }
generated:
  by: codex/gpt-6.1-sol
epic: "EPIC-001"
epic_concept: ./epic.md
components: ["comp:desktop", "comp:tooling"]
applicable_blocks: ["SPEC-001-005", "SPEC-001-008", "SPEC-001-023", "SPEC-001-025"]
---

# STORY-001-006 — Implement bounded diagnostics without private content

## Description

Emit validated content-free diagnostics through one bounded broker-owned writer. This unit owns its complete result and verifies its delivered inputs; it does not wait for a returning output from its consumers. Detailed implementation decisions and their rationale are held once in the applicable specification below.

## Applicable specification

- [SPEC-001-005: Versioned bounded IPC and minimal operation contract](./epic.md#spec-001-005-versioned-bounded-ipc-and-minimal-operation-contract)
- [SPEC-001-008: Content-free diagnostics at the broker boundary](./epic.md#spec-001-008-content-free-diagnostics-at-the-broker-boundary)
- [SPEC-001-023: Isolation before the first development executable](./epic.md#spec-001-023-isolation-before-the-first-development-executable)
- [SPEC-001-025: Diagnostics security applicability and evidence](./epic.md#spec-001-025-diagnostics-security-applicability-and-evidence)

## Tasks

- [ ] Integrate gate: verify STORY-001-003 output P3 and its full release condition in the Dependencies output registry and SPEC-001-008.
- [ ] Integrate gate: verify STORY-001-004 output R4 and its full release condition in the Dependencies output registry and SPEC-001-008.
- [ ] Integrate gate: verify STORY-001-005 output S5 and its full release condition in the Dependencies output registry and SPEC-001-008.
- [ ] Implement the complete typed event schema/catalog, controlled error mapping and version-aware decoder/OpenTelemetry mapping.
- [ ] Route worker events through a single validated broker writer after the data-root boundary; enforce account permissions and exact rotation bounds.
- [ ] Implement serialized managed log cleanup interfaces and failure status without requiring the future Settings viewer.
- [ ] Disable/contain automatic SDK/runtime capture and verify marker exclusion across file and stdout/stderr paths.
- [ ] Produce the diagnostics ADR-0000 requirement-ID/applicability/implementation/evidence inventory under SPEC-001-025 with the completed writer.

## Acceptance criteria

- [ ] Completion gate: verify Native hosts output NH and its full release condition in the Dependencies output registry and SPEC-001-008.
- [ ] The diagnostic owner supplies its security evidence before integration 017; leak tests alone do not replace the applicability record.
- [ ] Only catalog-valid content-free records are written with correct fields, severity, timestamps and artifact identity.
- [ ] Five 5-MiB files bound retention and incomplete records/rotation failures cannot produce unbounded fallback output.
- [ ] Logging or deletion failure does not corrupt durable application records or claim a failed cleanup succeeded.

## Quality checklist

- [ ] Inject secrets into every rejected field and error representation; inspect all diagnostic sinks for markers.
- [ ] Test multibyte/exact-boundary rotation, interrupted writes, concurrent append/delete, unknown schema and denied filesystem operations.
- [ ] Run applicable shared checks and configured repository hooks, committed-history secret scan, existing policy tests where affected and git diff --check; include new files explicitly.
- [ ] Preserve issue-first scope, isolated worktree and unrelated changes; complete the mandated independent read-only code-review gate before any code commit, then verify signed content identity. Documentation-only work keeps its documentation checks.
- [ ] Record real inputs, results, omissions and failures; a later commit, hosted CI result and human integration are separate evidence. State installed-user impact and the proposed change note or the reason none is required.
