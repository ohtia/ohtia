---
type: Story
title: "STORY-001-013 — Qualify signed installation and update mechanisms"
description: "Deliver common Actions signing/update foundations and complete Linux signed qualification, retaining native macOS/Windows builds and verified provenance."
tags: ["story", "comp:desktop", "comp:tooling"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/27
epic: "EPIC-001"
epic_concept: ./epic.md
components: ["comp:desktop", "comp:tooling"]
applicable_blocks:
  [
    "SPEC-001-003",
    "SPEC-001-007",
    "SPEC-001-015",
    "SPEC-001-016",
    "SPEC-001-026",
    "SPEC-001-027",
    "SPEC-001-028",
  ]
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
---

# STORY-001-013 — Qualify signed installation and update mechanisms

## Description

Deliver common Actions signing/update foundations and complete Linux signed qualification, retaining native macOS/Windows builds and verified provenance. This unit owns its complete result and verifies its delivered inputs; it does not wait for a returning output from its consumers. Detailed implementation decisions and their rationale are held once in the applicable specification below.

## Applicable specification

- [SPEC-001-003: Qualify target, tooling and delivery contracts](./epic.md#spec-001-003-qualify-target-tooling-and-delivery-contracts)
- [SPEC-001-007: Durable store and pre-migration recovery](./epic.md#spec-001-007-durable-store-and-pre-migration-recovery)
- [SPEC-001-015: Quality builds and native packaged smoke tests](./epic.md#spec-001-015-quality-builds-and-native-packaged-smoke-tests)
- [SPEC-001-016: Final signatures, installation and authenticated updates](./epic.md#spec-001-016-final-signatures-installation-and-authenticated-updates)
- [SPEC-001-026: Delivery security applicability and evidence](./epic.md#spec-001-026-delivery-security-applicability-and-evidence)
- [SPEC-001-027: Native feasibility and frozen workspace qualification](./epic.md#spec-001-027-native-feasibility-and-frozen-workspace-qualification)

- [SPEC-001-028: Linux-first delivery and platform capability admission](./epic.md#spec-001-028-linux-first-delivery-and-platform-capability-admission)

## Tasks

- [ ] Integrate gate: verify STORY-001-012 output B12 and its full release condition in the Dependencies output registry and SPEC-001-016.
- [ ] Integrate gate: verify STORY-001-018 output D1b and its full release condition in the Dependencies output registry and SPEC-001-016.
- [ ] Integrate gate: verify Policy authority output PA and its full release condition in the Dependencies output registry and SPEC-001-016.
- [ ] Implement the common capability contract, independently qualified Linux signing authority, Linux installer/updater selections and license/notice packaging without depending on candidate/publication consumers.
- [ ] Obtain separately authorized Linux signing/testing facilities and verify every applicable transformation before final digests; define testable macOS/Windows callback interfaces without requiring their publisher credentials.
- [ ] Qualify isolated native profiles/VMs, external channel eligibility and version ordering without altering bootstrap or stable data.
- [ ] Use controlled qualification artifacts/endpoints to exercise actual installation, upgrade, interruption, refusal and compatible rollback on all ten Linux native cells; preserve native foundation build/smoke coverage on Windows and macOS.
- [ ] Qualify signed installation/authentic updates on every required Linux target/profile and included optional distribution target, reject cross-architecture packages, and retain native macOS/Windows builds/smoke plus verified GitHub attestations with explicit distribution-ineligible capabilities.
- [ ] Produce common authority and Linux installer/signature/updater ADR-0000 applicability and actual native/external evidence; transfer real macOS/Windows signed user-route qualification to 019/020 under SPEC-001-028.

- [ ] Implement the real user-invoked installed updater and independently authenticated graphical Linux first-install route; verify catalog/key lifecycle, automatic refresh/expiry monitoring, true A/B run identities and isolated migration-fixture limits.
- [ ] Exercise one Linux cell end-to-end before expanding and use the shared reusable core, private real-signed artifacts and separate qualification trust root.

## Acceptance criteria

- [ ] Completion gate: verify Native facilities output NF and its full release condition in the Dependencies output registry and SPEC-001-016.
- [ ] Completion gate: verify Native hosts output NH and its full release condition in the Dependencies output registry and SPEC-001-016.
- [ ] The installer/update owner delivers its security inventory with final native qualification rather than leaving it to integrated acceptance.
- [ ] Required Linux signed-install/update evidence covers all ten native cells and any admitted optional distribution target; native macOS/Windows build/smoke/provenance remains complete without falsely claiming their deferred publisher guarantees.
- [ ] I13 binds common capability/authority contracts, real Linux signed native installation/update evidence and final transformed digests, and all-platform native build/attestation records; 019/020 own real macOS/Windows publisher signing and signed-route evidence.
- [ ] Bad signatures/digests/targets/schema and interrupted operations refuse or recover safely with previous stable data preserved.
- [ ] Development packages use no public feeds; preview opt-in and stable/prerelease ordering are verified without assuming an Ohtia account.
- [ ] Native facilities NF supplies actual Linux RPM/catalog authority and native verification. Absent macOS/Windows publisher facilities remain explicit ineligible capabilities owned by 019/020, never mock successes or blockers for this Linux/common scope.

## Quality checklist

- [ ] Run native first install, supported upgrade and interrupted download/install/activation with synthetic file-backed stores.
- [ ] Verify license/source obligations, wrong-target/authenticity rejection and schema recovery without data-downgrade claims.
- [ ] Run applicable shared checks and configured repository hooks, committed-history secret scan, existing policy tests where affected and git diff --check; include new files explicitly.
- [ ] Preserve issue-first scope, isolated worktree and unrelated changes; complete the mandated independent read-only code-review gate before any code commit, then verify signed content identity. Documentation-only work keeps its documentation checks.
- [ ] Record real inputs, results, omissions and failures; a later commit, hosted CI result and human integration are separate evidence. State installed-user impact and the proposed change note or the reason none is required.
