---
type: Story
title: "STORY-003-006 — Blocked work and plan-limit pause"
description: "Block work while ChatGPT is unavailable or its plan is exhausted, and resume it in order."
generated:
  by: claude-code/claude-opus-5-5
verified:
  by: human:AdrianMastronardi
tags: [story, "comp:storage", "comp:llm"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/208
epic: "EPIC-003"
epic_concept: ./epic.md
components: ["comp:storage", "comp:llm"]
applicable_blocks: ["SPEC-003-011"]
---

# STORY-003-006 — Blocked work and plan-limit pause

## Description

Block queued and new tasks while ChatGPT is disconnected, connecting, expired or errored, open a connection pause on plan exhaustion, and resume through revalidation or the `usagePause.resume` command. The visible notice and its "Resume {service} requests ({n})" button, with `{n}` the number of tasks the pause holds, belong to STORY-003-013.

## Applicable specification

- [SPEC-003-011: Blocked work and plan-limit pause](./epic.md#spec-003-011-blocked-work-and-plan-limit-pause)

## Tasks

- [ ] Start after STORY-003-005 is merged and its output is on the base branch: Tasks, attempts and the multitask queue.
- [ ] Start from the task engine of STORY-003-005, and extend these existing boundaries rather than create parallel ones.
- [ ] Block queued and new tasks with `connection_disabled` when the connection becomes unavailable, that is, in every state but `connected`, `connecting` included, and revalidate and requeue them in order on reconnection.
- [ ] When OpenAI rejects the renewal before dispatch, or main finds the connection no longer connected at its dispatch check (STORY-003-003), end the attempt `cancelled` with `connection_expired`, clearing its `dispatch_permitted_at` in the same transaction, block its task with `connection_disabled`, or cancel it when its conversation already has a not-started task (STORY-003-005), and run its second attempt when reconnection requeues it.
- [ ] When that renewal fails temporarily (no network or a 5xx response), keep the connection `connected`, fail the attempt with `provider_unavailable`, clearing its `dispatch_permitted_at` in the same transaction, fail its task with that reason, whose notice offers "Try again" (STORY-003-013), and block no other task.
- [ ] Write the migration for `usage_limit_pauses` with the one-open-pause rule; the `usage_limit_reached` blocking reason already exists from STORY-003-005.
- [ ] Open the pause in the transaction that records `usage_limit_reached`, block waiting and new tasks, and never retry.
- [ ] Implement `usagePause.resume`, with the connection and its operation identifier, as a command recorded in `command_receipts` that closes that connection's open pause and requeues in order every task it blocked, in every project, and that, with no open pause for that connection, as when another window resumed it first, succeeds without change and records its receipt; add the development command's `resume-requests` action, with `--ohtia-dev-connection=chatgpt`, which runs it until the button exists.
- [ ] Handle a disconnection during a pause and apply coalescing to blocked tasks.
- [ ] Implement the blocking reason and the `queued` to `blocked` transition as the ADR written in STORY-003-005 records them; this story amends no document.

## Acceptance criteria

- [ ] With the fake provider, plan exhaustion opens the pause and blocks the queue and new messages.
- [ ] `usagePause.resume` requeues the blocked tasks in their original order, including those of other projects, and a repeated command returns its first result; with a new operation identifier after the pause was closed, it succeeds without change and records its receipt.
- [ ] `usagePause.resume` with the plan still exhausted opens a new pause on the first failure, and tasks already dispatched fail with the same code without a retry.
- [ ] A disconnection during a pause leaves tasks blocked by the plan after reconnection.
- [ ] Coalescing replaces a blocked task, and the new task keeps its blocking reason.
- [ ] A rejected renewal before dispatch sends nothing, cancels the attempt with `connection_expired`, blocks the task with `connection_disabled`, and reconnection runs the task's second attempt.
- [ ] A temporary renewal failure before dispatch sends nothing, keeps the connection `connected` and fails the task with `provider_unavailable`.
- [ ] While a sign-in is `connecting`, queued and new tasks are blocked with `connection_disabled`.
- [ ] With the researcher's account, signing out with queued tasks blocks them and signing in again resumes them.
- [ ] A connection never has two open pauses.

## Quality checklist

- [ ] Automated tests pass in all 12 CI cells: Ubuntu 26.04 GNOME and KDE on x86-64 and ARM64, Fedora 44 GNOME and KDE on x86-64, Debian 13 GNOME and KDE on x86-64, Windows on x86-64 and ARM64, and macOS 26 and 27 on ARM64.
- [ ] Real-account checks run on the x86-64 virtual machines (Windows, Ubuntu 26.04, Fedora 44 and Debian 13) with the researcher's stored session. Each reply's duration and longest silence between provider events are recorded; a reply that uses more than half of its attempt duration, or a silence longer than half of `max_inactivity_ms`, raises that limit: in this story's own block before it merges when this story introduces that version; otherwise, recorded in this story's pull request, in that operation's next planned version that has not merged, whose story applies it before it closes; or, when none is planned, in a new policy-only version that this story adds before it closes. Each operation version this story introduces also takes, before the story closes, every raise that earlier stories recorded for it.
- [ ] The story's operations emit `ohtia-log-v1` catalog events with a privacy review, and no prompt, response, tool argument, title, memory text, credential or provider error message reaches diagnostics.
- [ ] Its migration for `usage_limit_pauses` runs through the existing ADR-0010 checkpoint and recovery path; if a story that runs at the same time merges its migration first, as STORY-003-007 can, this story renumbers its own to the next free number and updates `manifest.json` and the storage revision list before it merges.
- [ ] The change passes `pre-commit run --all-files`, the two-reviewer code review gate in `AGENTS.md` and the required `ci` check.
