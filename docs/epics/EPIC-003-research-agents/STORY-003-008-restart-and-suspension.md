---
type: Story
title: "STORY-003-008 — Restart and suspension"
description: "Recover tasks after a restart: they continue by themselves after an orderly stop and wait for the researcher after a crash."
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
tags: [story, "comp:storage", "comp:desktop", "comp:docs"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/210
epic: "EPIC-003"
epic_concept: ./epic.md
components: ["comp:storage", "comp:desktop", "comp:docs"]
applicable_blocks: ["SPEC-003-013"]
---

# STORY-003-008 — Restart and suspension

## Description

Record each data-service start in `service_runs`, review tasks before any dispatch, continue the queue after an ordinary orderly stop without a pre-existing recovery gate, pause not-started tasks after a crash or migration-recovery retry until "Continue all ({n})", and recheck attempts after suspension.

## Applicable specification

- [SPEC-003-013: Restart and suspension](./epic.md#spec-003-013-restart-and-suspension)

## Tasks

- [ ] Start after STORY-003-006 is merged and its output is on the base branch: Connection and plan blocking reasons.
- [ ] Start after STORY-003-007 is merged and its output is on the base branch: Cessation rule and uncertain handling.
- [ ] Start from `packages/main/src/entry.ts` (`before-quit` and `generation`), `packages/main/src/shutdown.ts` (`stopBrokerServices`), the `shutdown` message handler in `packages/utility/src/entry.ts` and `packages/utility/src/storage-lifecycle.ts`, and extend these existing boundaries rather than create parallel ones.
- [ ] Write the migration for `service_runs` and write `clean_stop_at` in the existing orderly shutdown, as its last write before it closes the store. Give the shutdown message that main sends the data service, today exactly `{"kind":"shutdown","generation":…}` in `packages/utility/src/entry.ts`, the required boolean `orderly`: the data service accepts only `{"kind":"shutdown","generation":…,"orderly":true}` and the same message with `false`, drains and closes the store for both, and writes `clean_stop_at` only for `true`; in this story main always sends `true`, and STORY-003-009 sends `false` for an operating-system shutdown or logout.
- [ ] Hold dispatch on every data-service start until the review of the previous run finishes; rely on main having closed every provider request of the ended generation before that start (STORY-003-003), and test it with a data-service crash while a reply streams.
- [ ] Reuse the recovery-only boundary, `task.continueAll` and development `continue-all` action delivered by the first of STORY-003-006/007 to integrate; extend that same boundary to the complete restart review, introducing no duplicate command. Use the storage-validated pre-existing `migration-pending.json` (existing version-1 `version`/`operation`/`source`/`target` format) as the durable recovery fact, for both rollback retry and checkpoint restoration. Integrate the reserved restart-review transaction into both retry branches in `packages/utility/src/storage.ts` after byte-exact activation/target validation and before gate deletion or task readiness, persisting pauses and later coordination holds first. Preserve the gate until that transaction commits and synchronize its removal afterward, so app exit before Retry and crashes on either side of the commit cannot lose the hold. No new marker format is introduced; a gate created by a healthy upgrade in the current admission is not a pre-existing recovery gate. Classify the previous run as unclean for every review rule when recovery preceded admission, even with a recorded `clean_stop_at`, including unfinished attempts; never apply the orderly-stop requeue branch in that case.
- [ ] After an unclean stop, set `restart_paused` on not-started tasks, cancel undispatched attempts with `service_restarted`, pausing their tasks too or cancelling one whose conversation already has a not-started task (STORY-003-005), and mark dispatched attempts uncertain, counting as dispatched every unfinished attempt with `dispatch_permitted_at` set, even when main never sent it (STORY-003-005).
- [ ] Extend the existing recovery command `task.continueAll` ("Continue all ({n})"), recorded in `command_receipts`, which resumes the restart-paused tasks of every project in order, with revalidation, the second attempt for tasks cut before dispatch and failure when no attempt remains, and which, with no restart-paused task, as when another window continued them first, succeeds without change and records its receipt; a second attempt runs only for a task whose first attempt ended before dispatch: after "Continue all ({n})", after an orderly stop without migration recovery, after a refused dispatch permit (STORY-003-005) or after reconnection following a rejected renewal (STORY-003-006). Extend the same development `continue-all` action until its button exists.
- [ ] Detect sleep and wake in main with Electron's `powerMonitor` `suspend` and `resume` events, and on `resume` send the data service the new versioned, runtime-validated message `service_wake`, defined in `packages/contracts` beside the provider messages: its `generation`, `suspendedAt` and `resumedAt` (UTC with milliseconds, from the wall clock at each event) and `asleepMs`, the wall-clock time between them, or 0 when the wall clock went backwards. On that message the data service rechecks each running attempt, counting `asleepMs` against its `max_attempt_duration_ms` and `max_inactivity_ms`, and discards a `service_wake` of another generation; main refuses dispatch permits issued before `resumedAt` with `permit_expired`, which requeues the task for its second attempt (STORY-003-005).
- [ ] Handle the edge cases: a `cancelling` task becomes `cancelled`; after an orderly stop without migration recovery an undispatched attempt is cancelled with `service_restarted` and its task requeued, or cancelled when its conversation already has a not-started task (STORY-003-005); coalescing keeps `restart_paused`.
- [ ] Apply the documentation amendments of SPEC-003-013 to `docs/frontend-architecture.md` ("On restart, show paused accepted tasks and offer explicit continuation after revalidation; restoring tabs or enabling a connection does not start them." becomes the orderly-exit and crash rule), `docs/agents/agent-collaboration.md`, scenario 9 of `docs/agents/agent-collaboration-evaluation.md` and `docs/product-roadmap.md`, including, in the EPIC-003 "Done when", "Verify all 20 deterministic collaboration scenarios at the shared module boundary" becoming "Verify deterministic collaboration scenarios 1 to 12 and 15 to 20 at the shared module boundary; scenarios 13 and 14 need the manuscript editor", the rest of that sentence unchanged; ADR-0051 owns the complete restart rule.

## Acceptance criteria

- [ ] Killing Ohtia mid-reply leaves the task uncertain with its slot free on reopening.
- [ ] Killing Ohtia with queued tasks pauses them, and "Continue all ({n})" runs them in order.
- [ ] An ordinary orderly close and reopen without a pre-existing recovery gate runs eligible queued tasks by themselves; a healthy upgrade’s freshly created intent does not itself add a recovery pause.
- [ ] Recovery through a rolled-back source or an already committed target leaves pending tasks restart-paused until "Continue all ({n})". Test restoration with an old orderly-stop marker followed by app exit before Retry, a crash before the hold commit and one after it but before gate removal, and another ordinary startup after gate removal; none dispatches pending work before that command. Include a run marked orderly with an unfinished proven-undispatched attempt: the attempt becomes cancelled and its task restart-paused (or cancelled under the returning-reply rule), never automatically requeued.
- [ ] With the fake provider, a cut before dispatch pauses the task and "Continue all ({n})" launches attempt 2; a second cut fails it; `task.continueAll` with no restart-paused task succeeds without change and records its receipt.
- [ ] A data-service crash with Ohtia open is treated as a crash, with no request of the old generation still streaming when the review starts, and simulated `suspend` and `resume` events make main send `service_wake` with the time asleep, which a running attempt counts against its limits, while main refuses earlier dispatch permits with `permit_expired`, after which the task's second attempt runs; a `service_wake` of an ended generation is discarded.
- [ ] A crash between the commit of a dispatch permit and the send leaves the task `uncertain` with its slot free and runs no second attempt.
- [ ] The data service writes `clean_stop_at` only for a shutdown message with `orderly` `true`, and rejects one without `orderly`.
- [ ] After an orderly stop, blocked tasks keep their reason.
- [ ] "Continue all ({n})" leaves a task blocked with `connection_disabled` when the connection is missing and with `usage_limit_reached` when a plan pause is open.
- [ ] Each edge case (cancelling at a crash, undispatched attempt after an orderly stop, coalescing a paused task) has its own test.
- [ ] The EPIC-003 "Done when" of `docs/product-roadmap.md` names restart continuation as automatic after an orderly exit and explicit after a crash, and asks for scenarios 1 to 12 and 15 to 20.

## Quality checklist

- [ ] Automated tests pass in all 12 CI cells: Ubuntu 26.04 GNOME and KDE on x86-64 and ARM64, Fedora 44 GNOME and KDE on x86-64, Debian 13 GNOME and KDE on x86-64, Windows on x86-64 and ARM64, and macOS 26 and 27 on ARM64.
- [ ] Real-account checks run on the x86-64 virtual machines (Windows, Ubuntu 26.04, Fedora 44 and Debian 13) with the researcher's stored session. Each reply's duration and longest silence between provider events are recorded; a reply that uses more than half of its attempt duration, or a silence longer than half of `max_inactivity_ms`, raises that limit: in this story's own block before it merges when this story introduces that version; otherwise, recorded in this story's pull request, in that operation's next planned version that has not merged, whose story applies it before it closes; or, when none is planned, in a new policy-only version that this story adds before it closes. Each operation version this story introduces also takes, before the story closes, every raise that earlier stories recorded for it.
- [ ] The story's operations emit `ohtia-log-v1` catalog events with a privacy review, and no prompt, response, tool argument, title, memory text, credential or provider error message reaches diagnostics.
- [ ] Its migration runs through the existing ADR-0010 checkpoint and recovery path; if a story that runs at the same time merges its migration first, this story renumbers its own to the next free number and updates `manifest.json` and the storage revision list before it merges.
- [ ] Every document under `docs/` that this story amends gets this story's `generated.by` and loses its `verified` declaration, which the researcher adds again after reviewing it, as `AGENTS.md` requires.
- [ ] The change passes `pre-commit run --all-files`, the two-reviewer code review gate in `AGENTS.md` and the required `ci` check.
