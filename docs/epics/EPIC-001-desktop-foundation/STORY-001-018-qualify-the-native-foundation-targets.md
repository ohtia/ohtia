---
type: Story
title: "STORY-001-018 — Qualify the native foundation targets"
description: "Prove frozen workspace installation and native runtime, addon, filesystem and delivery-mechanism feasibility on all required targets."
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
tags: ["story", "comp:tooling", "comp:desktop"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/32
epic: "EPIC-001"
epic_concept: ./epic.md
components: ["comp:tooling", "comp:desktop"]
applicable_blocks: ["SPEC-001-022", "SPEC-001-027"]
---

# STORY-001-018 — Qualify the native foundation targets

## Description

Prove frozen workspace installation and native runtime, addon, filesystem and delivery-mechanism feasibility on all required targets. Use the actual workspace and approved D1a contracts without waiting for the product runtime or final signed delivery pipeline. This is the empirical D1b owner.

The [target manifest](../../../config/desktop/targets.json) requires Linux x86-64/ARM64, Windows x86-64 and Apple Silicon on macOS 26/27. Apple Intel and Windows ARM64 are optional and do not block closure. Optional targets need complete native evidence before any delivered capability can claim them. The [native foundation report](../../native-foundation-report.md) records observed facilities, source identities, coverage and limits.

## Applicable specification

- [SPEC-001-022: Security applicability and acceptance evidence](./epic.md#spec-001-022-security-applicability-and-acceptance-evidence)
- [SPEC-001-027: Native feasibility and frozen workspace qualification](./epic.md#spec-001-027-native-feasibility-and-frozen-workspace-qualification)

## Tasks

- [ ] Integrate gate: verify STORY-001-001 output D1a and its full release condition in the Dependencies output registry and SPEC-001-027.
- [ ] Integrate gate: verify STORY-001-002 output W2 and its full release condition in the Dependencies output registry and SPEC-001-027.
- [ ] Confirm the issue-first scope, D1a inputs and real workspace commands before introducing probe code.
- [ ] Add the non-shipping tools/desktop-probes/ workspace package, using the single lock and common tooling; follow all applicable code-review and signed-commit requirements.
- [ ] Provision isolated native profiles or VMs and verify refusal of stable or unverified contexts before any executable runs.
- [ ] Perform clean-cache frozen installation and builds on all required native targets; retain locks, effective tool versions and actionable native dependency failures.
- [ ] Probe actual Electron utility and addon loading, effective Node and SQLite identities, sandbox, filesystem publication and installer or updater mechanism feasibility.
- [ ] Verify native host, executable and addon architectures for each cell, including both macOS slices independently if a universal package is used.
- [ ] Run incompatible ABI, wrong architecture, failed sandbox, denied I/O, altered-lock and stable-sentinel negative fixtures.
- [ ] Validate the initial setup budget against native measurements before newcomer trials; obtain review of material contract corrections and update affected conformance inputs.
- [ ] Extend the ADR-0000 inventory with actual probe isolation, runtime and filesystem control evidence, including failed admission and native negative cases.
- [ ] Publish each complete passing target record and its input digests; keep incomplete targets unqualified and reconcile every required profile for full D1b acceptance.

## Acceptance criteria

- [ ] Completion gate: verify Native hosts output NH and its full release condition in the Dependencies output registry and SPEC-001-027.
- [ ] D1b has successful complete native probe and unchanged-lock frozen-install records for all required targets.
- [ ] Every probe runs in an admitted independent profile or VM and preserves stable configuration, store and recovery sentinels.
- [ ] Actual packaged runtime, addon, engine and sandbox evidence matches the qualified locked inputs on every target.
- [ ] Failed or missing native inputs cannot be replaced by metadata, emulation or cross-build success.
- [ ] A subset consumer can use only its complete passing target records; full story acceptance never treats a partial matrix as complete.
- [ ] Mechanism feasibility is distinguished from final signed installation and authenticated update evidence owned by 013.
- [ ] Probe packages and fixtures cannot enter shipped product artifacts or become an undocumented second lock or tool authority.
- [ ] The measured setup budget states hardware, network and cache assumptions and separates downloads from active setup.
- [ ] This story closes without waiting for runtime 004, storage 005, final installer 013 or contributor trial 017.

## Quality checklist

- [ ] Verify real file-backed and packaged native boundaries and retain concrete positive and negative results with actual input identities.
- [ ] Follow issue-first implementation, the two independent code reviews, configured checks and signed-commit content identity for future probe code.
- [ ] Record actual results, omissions and external facilities honestly; this specification is not native implementation evidence.
