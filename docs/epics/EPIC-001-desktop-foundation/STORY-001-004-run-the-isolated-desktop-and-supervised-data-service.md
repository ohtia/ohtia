---
type: Story
title: "STORY-001-004 — Run the isolated desktop and supervised data service"
description: "Launch a minimal graphical Electron application with a single broker, safe bootstrap and a supervised utility process."
generated:
  by: codex/gpt-6.1-sol
tags: ["story", "comp:desktop", "comp:app"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/18
epic: "EPIC-001"
epic_concept: ./epic.md
components: ["comp:desktop", "comp:app"]
applicable_blocks:
  [
    "SPEC-001-004",
    "SPEC-001-005",
    "SPEC-001-006",
    "SPEC-001-022",
    "SPEC-001-023",
    "SPEC-001-024",
    "SPEC-001-027",
  ]
---

# STORY-001-004 — Run the isolated desktop and supervised data service

## Description

Launch a minimal graphical Electron application with a single broker, safe bootstrap and a supervised utility process. This unit owns its complete result and verifies its delivered inputs; it does not wait for a returning output from its consumers. Detailed implementation decisions and their rationale are held once in the applicable specification below.

## Applicable specification

- [SPEC-001-004: Workspace and isolated tooling](./epic.md#spec-001-004-workspace-and-isolated-tooling)
- [SPEC-001-005: Versioned bounded IPC and minimal operation contract](./epic.md#spec-001-005-versioned-bounded-ipc-and-minimal-operation-contract)
- [SPEC-001-006: Graphical runtime, fixed bootstrap and process supervision](./epic.md#spec-001-006-graphical-runtime-fixed-bootstrap-and-process-supervision)
- [SPEC-001-022: Security applicability and acceptance evidence](./epic.md#spec-001-022-security-applicability-and-acceptance-evidence)
- [SPEC-001-023: Isolation before the first development executable](./epic.md#spec-001-023-isolation-before-the-first-development-executable)
- [SPEC-001-024: Minimum localized and accessible foundation surfaces](./epic.md#spec-001-024-minimum-localized-and-accessible-foundation-surfaces)
- [SPEC-001-027: Native feasibility and frozen workspace qualification](./epic.md#spec-001-027-native-feasibility-and-frozen-workspace-qualification)

## Tasks

- [ ] Integrate gate: verify STORY-001-001 output D1a and its full release condition in the Dependencies output registry and SPEC-001-006.
- [ ] Integrate gate: verify STORY-001-002 output W2 and its full release condition in the Dependencies output registry and SPEC-001-006.
- [ ] Integrate gate: verify STORY-001-003 output P3 and its full release condition in the Dependencies output registry and SPEC-001-006.
- [ ] Implement verified independent-profile/VM launch admission and stable-locator/store exclusion before any development executable starts.
- [ ] Build separate main/preload/utility and local React/Vite renderer outputs with active sandbox/CSP and forbidden-import checks.
- [ ] Deliver the minimum common locale service, complete first-surface catalogs and keyboard and assistive bootstrap/status/error controls under SPEC-001-024.
- [ ] Implement a single broker, bounded utility handshake/status port, window lifecycle and controlled service-death handling.
- [ ] Implement fixed locator parsing, graphical selection and validated-path/atomic-publication primitives; leave storage activation gated until the data service validates it.
- [ ] Verify startup, second-instance behavior, one broker and utility supervision, stale generations, locator publication and failure, responsive errors and bounded shutdown against real native artifacts on all required targets.

## Acceptance criteria

- [ ] Completion gate: verify STORY-001-018 output D1b and its full release condition in the Dependencies output registry and SPEC-001-006.
- [ ] Completion gate: verify Native hosts output NH and its full release condition in the Dependencies output registry and SPEC-001-006.
- [ ] Stable or unverified profile launch is refused without reading/migrating stable sentinels on all required native targets.
- [ ] All delivered status/bootstrap/error messages and accessible labels use complete product-locale catalogs and the one resolver; automated packaged keyboard, focus and accessibility-tree checks pass. Manual assistive acceptance belongs to 017.
- [ ] All required native runtime/bootstrap records identify the actual host, executable and utility architecture.
- [ ] The built graphical window exchanges real status messages through all process boundaries without provider access.
- [ ] Active CSP/sandbox and a narrow bridge reject privileged imports, invalid senders/resources and development fixture inclusion.
- [ ] Missing/corrupt/unsupported locators preserve existing data and show graphical guidance; no silent data default or fallback logging is introduced.
- [ ] Service death remains bounded/responsive and one OS user cannot accidentally run independent broker writers.

## Quality checklist

- [ ] Launch two instances/windows, kill the utility, inject invalid IPC and assert the actual applied CSP.
- [ ] Inject bootstrap permission/alias/overlap/replace interruption failures; verify graceful shutdown and no orphaned child.
- [ ] Run applicable shared checks and configured repository hooks, committed-history secret scan, existing policy tests where affected and git diff --check; include new files explicitly.
- [ ] Preserve issue-first scope, isolated worktree and unrelated changes; complete the mandated independent read-only code-review gate before any code commit, then verify signed content identity. Documentation-only work keeps its documentation checks.
- [ ] Record real inputs, results, omissions and failures; a later commit, hosted CI result and human integration are separate evidence. State installed-user impact and the proposed change note or the reason none is required.
