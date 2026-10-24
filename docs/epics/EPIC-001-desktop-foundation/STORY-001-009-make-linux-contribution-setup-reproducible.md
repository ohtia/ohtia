---
type: Story
title: "STORY-001-009 — Make Linux contribution setup reproducible"
description: "Enable a new Linux contributor to install, diagnose, run and verify Ohtia from a clean checkout."
tags: ["story", "comp:tooling", "comp:docs", "comp:desktop"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/23
verified: { by: human:AdrianMastronardi }
generated:
  by: codex/gpt-6.1-sol
epic: "EPIC-001"
epic_concept: ./epic.md
components: ["comp:tooling", "comp:docs", "comp:desktop"]
applicable_blocks: ["SPEC-001-006", "SPEC-001-010", "SPEC-001-011", "SPEC-001-012", "SPEC-001-023"]
---

# STORY-001-009 — Make Linux contribution setup reproducible

## Description

Enable a new Linux contributor to install, diagnose, run and verify Ohtia from a clean checkout. This unit owns its complete result and verifies its delivered inputs; it does not wait for a returning output from its consumers. Detailed implementation decisions and their rationale are held once in the applicable specification below.

## Applicable specification

- [SPEC-001-006: Graphical runtime, fixed bootstrap and process supervision](./epic.md#spec-001-006-graphical-runtime-fixed-bootstrap-and-process-supervision)
- [SPEC-001-010: Immutable Linux E2E execution](./epic.md#spec-001-010-immutable-linux-e2e-execution)
- [SPEC-001-011: First-day contributor experience and environment diagnosis](./epic.md#spec-001-011-first-day-contributor-experience-and-environment-diagnosis)
- [SPEC-001-012: Linux native developer environment](./epic.md#spec-001-012-linux-native-developer-environment)
- [SPEC-001-023: Isolation before the first development executable](./epic.md#spec-001-023-isolation-before-the-first-development-executable)

## Tasks

- [ ] Integrate gate: verify STORY-001-002 output W2 and its full release condition in the Dependencies output registry and SPEC-001-012.
- [ ] Integrate gate: verify STORY-001-018 output D1b and its full release condition in the Dependencies output registry and SPEC-001-012.
- [ ] Implement native Linux prerequisite/install/setup/doctor support for D1a and the applicable D1b record's precise distribution/CPU/libc/display matrix.
- [ ] Use the isolated native launch procedure from the first setup/dev run, and prove stable-configuration/store sentinels remain untouched.
- [ ] Write the Linux contributor guide and tested commands, including native addon/display/sandbox remediation and optional E2E reproduction.
- [ ] Walk through setup → launch → representative source change → checks → package natively on both Linux x86-64 and ARM64, observing the agreed measurement conditions.
- [ ] On fresh supported systems run frozen setup, desktop durable round trip, shared checks and unsigned local packaging; fix observed undocumented steps.

## Acceptance criteria

- [ ] Completion gate: verify STORY-001-004 output R4 and its full release condition in the Dependencies output registry and SPEC-001-012.
- [ ] Completion gate: verify STORY-001-005 output S5 and its full release condition in the Dependencies output registry and SPEC-001-012.
- [ ] Completion gate: verify STORY-001-007 output Q7 and its full release condition in the Dependencies output registry and SPEC-001-012.
- [ ] Completion gate: verify STORY-001-008 output L8 and its full release condition in the Dependencies output registry and SPEC-001-012.
- [ ] Completion gate: verify STORY-001-012 output B12 and its full release condition in the Dependencies output registry and SPEC-001-012.
- [ ] Completion gate: verify Native hosts output NH and its full release condition in the Dependencies output registry and SPEC-001-012.
- [ ] The native Linux contribution route cannot launch the development app against a stable or unverified profile.
- [ ] Both required Linux architectures have clean-environment/native-addon/walkthrough evidence; the x86-64 container alone cannot close ARM64 setup.
- [ ] A contributor needs no maintainer secret/provider account or undeclared global tool.
- [ ] U9 includes observed native supported-target setup, doctor failure/remediation/retry, repeat setup, save/restart and package results.
- [ ] The measured first-run conditions/budget and unsupported distro constraints are explicit; Docker-only success cannot close native setup.

## Quality checklist

- [ ] Test missing/wrong tools, inaccessible display, denied data directory, native addon mismatch and non-ASCII/spaced paths.
- [ ] Follow the guide verbatim on clean Linux systems and compare local checks with the shared CI entries.
- [ ] Run applicable shared checks and configured repository hooks, committed-history secret scan, existing policy tests where affected and git diff --check; include new files explicitly.
- [ ] Preserve issue-first scope, isolated worktree and unrelated changes; complete the mandated independent read-only code-review gate before any code commit, then verify signed content identity. Documentation-only work keeps its documentation checks.
- [ ] Record real inputs, results, omissions and failures; a later commit, hosted CI result and human integration are separate evidence. State installed-user impact and the proposed change note or the reason none is required.
