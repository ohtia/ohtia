---
type: Story
title: "STORY-001-010 — Make Windows contribution setup reproducible"
description: "Enable a new Windows contributor to install, diagnose, run and verify Ohtia through a native supported path."
tags: ["story", "comp:tooling", "comp:docs", "comp:desktop"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/24
generated:
  by: codex/gpt-6.1-sol
epic: "EPIC-001"
epic_concept: ./epic.md
components: ["comp:tooling", "comp:docs", "comp:desktop"]
applicable_blocks: ["SPEC-001-006", "SPEC-001-011", "SPEC-001-013", "SPEC-001-023"]
---

# STORY-001-010 — Make Windows contribution setup reproducible

## Description

Enable a new Windows contributor to install, diagnose, run and verify Ohtia through a native supported path. This unit owns its complete result and verifies its delivered inputs; it does not wait for a returning output from its consumers. Detailed implementation decisions and their rationale are held once in the applicable specification below.

## Applicable specification

- [SPEC-001-006: Graphical runtime, fixed bootstrap and process supervision](./epic.md#spec-001-006-graphical-runtime-fixed-bootstrap-and-process-supervision)
- [SPEC-001-011: First-day contributor experience and environment diagnosis](./epic.md#spec-001-011-first-day-contributor-experience-and-environment-diagnosis)
- [SPEC-001-013: Windows native developer environment](./epic.md#spec-001-013-windows-native-developer-environment)
- [SPEC-001-023: Isolation before the first development executable](./epic.md#spec-001-023-isolation-before-the-first-development-executable)

## Tasks

- [ ] Integrate gate: verify STORY-001-002 output W2 and its full release condition in the Dependencies output registry and SPEC-001-013.
- [ ] Integrate gate: verify STORY-001-018 output D1b and its full release condition in the Dependencies output registry and SPEC-001-013.
- [ ] Implement the selected native Windows shell/prerequisite/toolchain/setup/doctor route without requiring WSL.
- [ ] Use the isolated native launch procedure from the first setup/dev run, and prove stable-configuration/store sentinels remain untouched.
- [ ] Write copyable Windows commands and actual troubleshooting for quoting, path lengths, locks, line endings and architecture/addon mismatch.
- [ ] Walk through setup → launch → representative source change → checks → package natively on required Windows x86-64, and on Windows ARM64 if included, and test the documented separate POSIX maintainer-verifier route.
- [ ] Follow only the guide on clean supported Windows targets to run the durable desktop, shared checks and local unsigned package.

## Acceptance criteria

- [ ] Completion gate: verify STORY-001-004 output R4 and its full release condition in the Dependencies output registry and SPEC-001-013.
- [ ] Completion gate: verify STORY-001-005 output S5 and its full release condition in the Dependencies output registry and SPEC-001-013.
- [ ] Completion gate: verify STORY-001-007 output Q7 and its full release condition in the Dependencies output registry and SPEC-001-013.
- [ ] Completion gate: verify STORY-001-012 output B12 and its full release condition in the Dependencies output registry and SPEC-001-013.
- [ ] Completion gate: verify Native hosts output NH and its full release condition in the Dependencies output registry and SPEC-001-013.
- [ ] The native Windows contribution route cannot launch the development app against a stable or unverified profile.
- [ ] Windows x86-64 has complete native evidence, and optional Windows ARM64 requires its own evidence before inclusion; x86 emulation or WSL does not establish Windows ARM64 support and ordinary contribution requires no maintainer credentials.
- [ ] U10 demonstrates native supported Windows contribution without maintainer credentials, global security weakening or routine administrator execution.
- [ ] Setup/diagnosis/retry, space/non-ASCII paths, durable restart and locked-file/process cleanup have observed results.
- [ ] WSL remains optional narrower evidence and is not presented as native Windows verification.

## Quality checklist

- [ ] Exercise missing SDK/compiler, wrong architecture, denied files and interrupted repeat setup in the native shell.
- [ ] Verify clean-machine commands and optional editor debug settings with actual shared checks and no leaked private paths/secrets.
- [ ] Run applicable shared checks and configured repository hooks, committed-history secret scan, existing policy tests where affected and git diff --check; include new files explicitly.
- [ ] Preserve issue-first scope, isolated worktree and unrelated changes; complete the mandated independent read-only code-review gate before any code commit, then verify signed content identity. Documentation-only work keeps its documentation checks.
- [ ] Record real inputs, results, omissions and failures; a later commit, hosted CI result and human integration are separate evidence. State installed-user impact and the proposed change note or the reason none is required.
