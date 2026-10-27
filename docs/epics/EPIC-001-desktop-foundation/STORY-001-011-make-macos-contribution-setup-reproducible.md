---
type: Story
title: "STORY-001-011 — Make macOS contribution setup reproducible"
description: "Enable a new macOS contributor to install, diagnose, run and verify Ohtia on required Apple Silicon, with independently qualified optional Intel support."
generated:
  by: codex/gpt-6.1-sol
tags: ["story", "comp:tooling", "comp:docs", "comp:desktop"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/25
epic: "EPIC-001"
epic_concept: ./epic.md
components: ["comp:tooling", "comp:docs", "comp:desktop"]
applicable_blocks: ["SPEC-001-006", "SPEC-001-011", "SPEC-001-014", "SPEC-001-023"]
---

# STORY-001-011 — Make macOS contribution setup reproducible

## Description

Enable a new macOS contributor to install, diagnose, run and verify Ohtia on required Apple Silicon, with independently qualified optional Intel support. This unit owns its complete result and verifies its delivered inputs; it does not wait for a returning output from its consumers. Detailed implementation decisions and their rationale are held once in the applicable specification below.

## Applicable specification

- [SPEC-001-006: Graphical runtime, fixed bootstrap and process supervision](./epic.md#spec-001-006-graphical-runtime-fixed-bootstrap-and-process-supervision)
- [SPEC-001-011: First-day contributor experience and environment diagnosis](./epic.md#spec-001-011-first-day-contributor-experience-and-environment-diagnosis)
- [SPEC-001-014: macOS native developer environment](./epic.md#spec-001-014-macos-native-developer-environment)
- [SPEC-001-023: Isolation before the first development executable](./epic.md#spec-001-023-isolation-before-the-first-development-executable)

## Tasks

- [ ] Integrate gate: verify STORY-001-002 output W2 and its full release condition in the Dependencies output registry and SPEC-001-014.
- [ ] Integrate gate: verify STORY-001-018 output D1b and its full release condition in the Dependencies output registry and SPEC-001-014.
- [ ] Implement the reviewed macOS version/CPU/developer-tool/setup/doctor routes with explicit architecture verification.
- [ ] Use the isolated native launch procedure from the first setup/dev run, and prove stable-configuration/store sentinels remain untouched.
- [ ] Write tested shell commands and scoped quarantine/local-build/toolchain troubleshooting without global platform-control changes.
- [ ] Walk through setup → launch → representative source change → checks → package on required Apple Silicon ARM64 macOS 26 and 27 environments, and independently on Intel x86-64 if included.
- [ ] Follow only the guide on clean supported CPU targets to run the durable desktop, shared checks and unsigned local package.

## Acceptance criteria

- [ ] Completion gate: verify STORY-001-004 output R4 and its full release condition in the Dependencies output registry and SPEC-001-014.
- [ ] Completion gate: verify STORY-001-005 output S5 and its full release condition in the Dependencies output registry and SPEC-001-014.
- [ ] Completion gate: verify STORY-001-007 output Q7 and its full release condition in the Dependencies output registry and SPEC-001-014.
- [ ] Completion gate: verify STORY-001-012 output B12 and its full release condition in the Dependencies output registry and SPEC-001-014.
- [ ] Completion gate: verify Native hosts output NH and its full release condition in the Dependencies output registry and SPEC-001-014.
- [ ] Every included native macOS contribution route refuses stable or unverified development launch contexts.
- [ ] Required Apple Silicon routes on macOS 26 and 27 pass independently. Optional Intel inclusion requires its own native evidence; Rosetta or a universal package tested on one slice cannot qualify another.
- [ ] U11 identifies actual native macOS/CPU evidence and does not infer universal or translated-architecture equivalence.
- [ ] Ordinary contribution requires no paid signing identity and no global Gatekeeper disablement.
- [ ] Missing tools/native mismatch/denied storage/retry have actionable verified diagnosis; process shutdown and restart persistence pass.

## Quality checklist

- [ ] Test every required macOS family and any optional native CPU route actually included under D1a and the applicable D1b record or keep a missing required target unverified/open.
- [ ] Run space/non-ASCII paths and cold/repeated setup, and validate optional editor commands against the same shared entries.
- [ ] Run applicable shared checks and configured repository hooks, committed-history secret scan, existing policy tests where affected and git diff --check; include new files explicitly.
- [ ] Preserve issue-first scope, isolated worktree and unrelated changes; complete the mandated independent read-only code-review gate before any code commit, then verify signed content identity. Documentation-only work keeps its documentation checks.
- [ ] Record real inputs, results, omissions and failures; a later commit, hosted CI result and human integration are separate evidence. State installed-user impact and the proposed change note or the reason none is required.
