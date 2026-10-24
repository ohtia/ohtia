---
type: Story
title: "STORY-001-013 — Qualify signed installation and update mechanisms"
description: "Verify final signed installers and authentic compatible updates on the complete declared desktop matrix."
tags: ["story", "comp:desktop", "comp:tooling"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/27
verified: { by: human:AdrianMastronardi }
generated:
  by: codex/gpt-6.1-sol
epic: "EPIC-001"
epic_concept: ./epic.md
components: ["comp:desktop", "comp:tooling"]
applicable_blocks:
  ["SPEC-001-003", "SPEC-001-007", "SPEC-001-015", "SPEC-001-016", "SPEC-001-026", "SPEC-001-027"]
---

# STORY-001-013 — Qualify signed installation and update mechanisms

## Description

Verify final signed installers and authentic compatible updates on the complete declared desktop matrix. This unit owns its complete result and verifies its delivered inputs; it does not wait for a returning output from its consumers. Detailed implementation decisions and their rationale are held once in the applicable specification below.

## Applicable specification

- [SPEC-001-003: Qualify target, tooling and delivery contracts](./epic.md#spec-001-003-qualify-target-tooling-and-delivery-contracts)
- [SPEC-001-007: Durable store and pre-migration recovery](./epic.md#spec-001-007-durable-store-and-pre-migration-recovery)
- [SPEC-001-015: Quality builds and native packaged smoke tests](./epic.md#spec-001-015-quality-builds-and-native-packaged-smoke-tests)
- [SPEC-001-016: Final signatures, installation and authenticated updates](./epic.md#spec-001-016-final-signatures-installation-and-authenticated-updates)
- [SPEC-001-026: Delivery security applicability and evidence](./epic.md#spec-001-026-delivery-security-applicability-and-evidence)
- [SPEC-001-027: Native feasibility and frozen workspace qualification](./epic.md#spec-001-027-native-feasibility-and-frozen-workspace-qualification)

## Tasks

- [ ] Integrate gate: verify STORY-001-012 output B12 and its full release condition in the Dependencies output registry and SPEC-001-016.
- [ ] Integrate gate: verify STORY-001-018 output D1b and its full release condition in the Dependencies output registry and SPEC-001-016.
- [ ] Integrate gate: verify Policy authority output PA and its full release condition in the Dependencies output registry and SPEC-001-016.
- [ ] Implement the approved per-target installer/signature/notarization/updater selections and license/notice packaging.
- [ ] Obtain separately authorized platform/signing facilities and verify all transformations before recording final digests.
- [ ] Qualify isolated native profiles/VMs, external channel eligibility and version ordering without altering bootstrap or stable data.
- [ ] Use controlled qualification artifacts/endpoints to exercise actual installation, upgrade, interruption, refusal and compatible rollback on every native target.
- [ ] Qualify signed installation/authentic updates on all six native x86-64/ARM64 targets and reject cross-architecture packages; verify each macOS slice independently when universal packaging is chosen.
- [ ] Produce installer/signature/notarization/updater ADR-0000 applicability and actual native evidence under SPEC-001-026.

## Acceptance criteria

- [ ] Completion gate: verify Native facilities output NF and its full release condition in the Dependencies output registry and SPEC-001-016.
- [ ] Completion gate: verify Native hosts output NH and its full release condition in the Dependencies output registry and SPEC-001-016.
- [ ] The installer/update owner delivers its security inventory with final native qualification rather than leaving it to integrated acceptance.
- [ ] Required native signed-install/update evidence covers all six core desktop targets independently of optional provider-runtime availability.
- [ ] I13 contains actual signed/notarized native installation/update evidence and final transformed digests for every declared target.
- [ ] Bad signatures/digests/targets/schema and interrupted operations refuse or recover safely with previous stable data preserved.
- [ ] Development packages use no public feeds; preview opt-in and stable/prerelease ordering are verified without assuming an Ohtia account.
- [ ] Native facilities NF provides real required certificate/platform evidence; missing facilities cannot be replaced by mocks.

## Quality checklist

- [ ] Run native first install, supported upgrade and interrupted download/install/activation with synthetic file-backed stores.
- [ ] Verify license/source obligations, wrong-target/authenticity rejection and schema recovery without data-downgrade claims.
- [ ] Run applicable shared checks and configured repository hooks, committed-history secret scan, existing policy tests where affected and git diff --check; include new files explicitly.
- [ ] Preserve issue-first scope, isolated worktree and unrelated changes; complete the mandated independent read-only code-review gate before any code commit, then verify signed content identity. Documentation-only work keeps its documentation checks.
- [ ] Record real inputs, results, omissions and failures; a later commit, hosted CI result and human integration are separate evidence. State installed-user impact and the proposed change note or the reason none is required.
