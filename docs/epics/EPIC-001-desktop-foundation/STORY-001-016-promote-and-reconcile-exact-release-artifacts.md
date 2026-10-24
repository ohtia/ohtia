---
type: Story
title: "STORY-001-016 — Promote and reconcile exact release artifacts"
description: "Publish authorized candidate bytes with serialized promotion, failure reconciliation, retention and withdrawal."
tags: ["story", "comp:tooling", "comp:desktop"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/30
verified: { by: human:AdrianMastronardi }
generated:
  by: codex/gpt-6.1-sol
epic: "EPIC-001"
epic_concept: ./epic.md
components: ["comp:tooling", "comp:desktop"]
applicable_blocks: ["SPEC-001-016", "SPEC-001-017", "SPEC-001-018", "SPEC-001-019", "SPEC-001-026"]
---

# STORY-001-016 — Promote and reconcile exact release artifacts

## Description

Publish authorized candidate bytes with serialized promotion, failure reconciliation, retention and withdrawal. This unit owns its complete result and verifies its delivered inputs; it does not wait for a returning output from its consumers. Detailed implementation decisions and their rationale are held once in the applicable specification below.

## Applicable specification

- [SPEC-001-016: Final signatures, installation and authenticated updates](./epic.md#spec-001-016-final-signatures-installation-and-authenticated-updates)
- [SPEC-001-017: Safe note capture and editorial assembly](./epic.md#spec-001-017-safe-note-capture-and-editorial-assembly)
- [SPEC-001-018: Trusted candidate preparation and permanent version identity](./epic.md#spec-001-018-trusted-candidate-preparation-and-permanent-version-identity)
- [SPEC-001-019: Authorized publication, reconciliation and lifecycle](./epic.md#spec-001-019-authorized-publication-reconciliation-and-lifecycle)
- [SPEC-001-026: Delivery security applicability and evidence](./epic.md#spec-001-026-delivery-security-applicability-and-evidence)

## Tasks

- [ ] Integrate gate: verify STORY-001-013 output I13 and its full release condition in the Dependencies output registry and SPEC-001-019.
- [ ] Integrate gate: verify STORY-001-014 output N14 and its full release condition in the Dependencies output registry and SPEC-001-019.
- [ ] Integrate gate: verify STORY-001-015 output C15 and its full release condition in the Dependencies output registry and SPEC-001-019.
- [ ] Integrate gate: verify Policy authority output PA and its full release condition in the Dependencies output registry and SPEC-001-019.
- [ ] Implement separate manual publication input/identity authorization and pre-publication readiness/digest/note rechecks.
- [ ] Implement durable application-wide serialization and upload-before-exposure across tags/releases/downloads/update metadata.
- [ ] Implement idempotent reconciliation, visible-surface failure records, explicit uncertain-activation handling and maintainer recovery.
- [ ] Implement retention/retirement/withdrawal and cadence/urgent-fix procedures; exercise them only on approved controlled surfaces.
- [ ] Verify complete six-target candidate/native evidence before promotion, retaining per-target digests even when one universal package covers two verified slices.
- [ ] Produce publication authorization/serialization/reconciliation/retention security evidence under SPEC-001-026.

## Acceptance criteria

- [ ] Completion gate: verify Release authority output RA and its full release condition in the Dependencies output registry and SPEC-001-019.
- [ ] The publication owner supplies its applicable security inventory and actual control evidence before reporting promotion success.
- [ ] Promotion never hides a missing required CPU target or treats optional provider support as permission to narrow core desktop scope.
- [ ] F16 promotes exact retained final bytes without rebuilding/resigning/renaming an embedded prerelease.
- [ ] Concurrent preview/stable operations cannot race shared state; preview cannot advance stable latest.
- [ ] Partial upload/feed/activation never reports success; retry preserves candidate/version/digests and conflicts fail closed.
- [ ] Withdrawn versions retain identity and safe guidance; supported evidence remains recoverable and rollback never implies database downgrade.
- [ ] Release authority RA and approved controlled surfaces have actual effective admission/readback evidence; public readiness/authorization remains separately mandatory.

## Quality checklist

- [ ] Inject failure/cancellation at each publication surface; retry and inspect actual assets/digests/tags/feed/latest and previous stable.
- [ ] Rehearse notes corrections, preview/stable same-byte promotion, withdrawal after schema migration and supported-baseline retention without a public scaffold release.
- [ ] Run applicable shared checks and configured repository hooks, committed-history secret scan, existing policy tests where affected and git diff --check; include new files explicitly.
- [ ] Preserve issue-first scope, isolated worktree and unrelated changes; complete the mandated independent read-only code-review gate before any code commit, then verify signed content identity. Documentation-only work keeps its documentation checks.
- [ ] Record real inputs, results, omissions and failures; a later commit, hosted CI result and human integration are separate evidence. State installed-user impact and the proposed change note or the reason none is required.
