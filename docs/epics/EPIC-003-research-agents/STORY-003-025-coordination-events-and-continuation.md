---
type: Story
title: "STORY-003-025 — Coordination events and continuation"
description: "Make plan events durable and deduplicated, create one synthesis per ready state, cancel plans and recover them after a crash."
generated:
  by: claude-code/claude-opus-5-5
verified:
  by: human:AdrianMastronardi
tags: [story, "comp:storage", "comp:llm", "comp:docs", "comp:app"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/227
epic: "EPIC-003"
epic_concept: ./epic.md
components: ["comp:storage", "comp:llm", "comp:docs", "comp:app"]
applicable_blocks: ["SPEC-003-030"]
---

# STORY-003-025 — Coordination events and continuation

## Description

Add numbered intervention events written with each change, window synchronization with gap rereads, continuations keyed by ready state, plan cancellation and crash recovery for plans.

## Applicable specification

- [SPEC-003-030: Coordination events and continuation](./epic.md#spec-003-030-coordination-events-and-continuation)

## Tasks

- [ ] Start after STORY-003-024 is merged and its output is on the base branch: Reservations for coordinator turns.
- [ ] Start from the contribution graph of STORY-003-023 and the reservations of STORY-003-024, and extend these existing boundaries rather than create parallel ones.
- [ ] Write the migration for `intervention_events` (`id`, `intervention_id`, `sequence` unique within the plan, `kind`, `contribution_id` and `task_id` for contribution kinds, a payload of at most 2 KiB with identifiers and codes only, its 32-byte SHA-256 over the RFC 8785 canonical form, and `created_at`) and `continuations` (`id`, `intervention_id`, `graph_version`, `through_sequence`, `reason` `required_set_complete` or `finished_partial`, `policy_version`, `admission` `waiting`, `admitted` or `withdrawn`, the boolean `restart_held`, `false` when the continuation is created, `task_id` of the latest synthesis task, empty while `admission` is `waiting` or `withdrawn`, `ready_key` and `created_at`), never deleting their rows, and add the `cancelled` outcome; add no events or continuations for the consultations already stored, which have none.
- [ ] Write each plan change's event in the same transaction, with the kinds `contribution_started`, `contribution_completed`, `contribution_failed`, `contribution_uncertain`, `contribution_blocked`, `contribution_waiting`, `contribution_cancelled`, `graph_changed`, `continuation_created` and `plan_ended`, sequence, payload limits and the 512-event cap: changes that store a result, cancel contributions or end the plan always write their events, even past 512; any other change past it is rejected without changing anything, a command with the new error `event_limit_reached` (next action `check_request`), added to the port's closed `errorActions` and to the `operationErrorCodes` of `contribution.tryAgain` and `contribution.startAgain`; a result whose activations would pass the cap is still stored and leaves those contributions `waiting`; a plan at the cap with no contribution task queued, blocked or running is in "Needs your attention", and `plan.finish` of such a plan also accepts waiting contributions and cancels them, each with its event, before recording the outcome.
- [ ] Notify the window with "plan X changed, up to event N" over `research.subscribe`, serve missing events with the new read `planEvent.list` and the whole plan with the new read `plan.read`, and build the port-client module that ignores an event it already has, rereads the plan on a gap or on the same sequence with a different hash, and is tested without a window.
- [ ] Create the continuation, with continuation policy version 1, in the transaction that makes the plan ready, when the last contribution that was `waiting` or `active` ends or is blocked while every required one is `completed`, keyed by the SHA-256 `ready_key`, creating a task of the test synthesis operation, including the partial-finish case; check for missed continuations on start.
- [ ] Store the result or command that makes the plan ready, its events and the continuation together whatever the synthesis operation's pending limit, so no result or `plan.finish` fails at it; create the synthesis task in that transaction, with `admission` `admitted`, only while the synthesis operation's queued and blocked tasks, in every project, are fewer than its `max_pending_tasks`, and otherwise store the continuation with `admission` `waiting` and no task; in every transaction that takes a task of the synthesis operation out of `queued` or `blocked`, and at start after the restart review, admit waiting continuations by `created_at`, then `id`, creating each one's synthesis task and setting it `admitted` while that count stays below `max_pending_tasks`, a continuation admitted while `restart_held` is `true`, at start or in any later transaction, getting its synthesis task created blocked with `restart_paused`; and treat a waiting continuation as a queued synthesis task for every rule about an unfinished plan or a not-started synthesis. Give the synthesis task the new `tasks.kind` value `synthesis`, an empty `input_through_position` and, as `accepted_by_operation_id`, the receipt of the command that accepted the plan (`required_set_complete`) or of `plan.finish` (`finished_partial`); keep it outside the per-conversation rules, unstopped by `conversation.stop` and rejected by `task.stop` with `task_not_stoppable`; never replace a waiting reply task when its message is saved; show no notice for it in the conversation before it first runs; and advance the intervention's `revision` with every change of the continuation or synthesis task.
- [ ] Hold waiting continuations after a crash: in the restart review's transaction that pauses the not-started tasks after a crash, power loss or forced quit, set `restart_held` to `true` on every continuation whose `admission` is `waiting`; in the transaction that admits a held continuation, create its synthesis task blocked with `restart_paused` and set `restart_held` to `false`; extend `task.continueAll` so that, in the transaction that resumes the restart-paused tasks and after resuming them, it sets `restart_held` to `false` on every waiting continuation and then admits waiting continuations as queued tasks while there is room, and let no other command clear a hold that has not passed to a task; count the waiting continuations with `restart_held` `true` with the restart-paused tasks in the number paused by a restart that `pause.read` returns, and so in `{n}` of "Continue all ({n})", keeping the crash-pause notice while only held continuations remain; make a `task.continueAll` that finds neither succeed without change and record its receipt; advance the pause counts' revision and send the pause-count event of STORY-003-013 in every transaction that sets or clears `restart_held`; and drop a held continuation from that count when it is withdrawn.
- [ ] Extend `task.cancelAll` ("Cancel work and quit", STORY-003-009): in the transaction that cancels the queued and blocked tasks and before it cancels them, set `admission` to `withdrawn` on every continuation of every project whose `admission` is `waiting`, held or not; from that transaction until the data service stops, kept in memory, admit no continuation, running no admission in the transactions that cancel those tasks or store the ends of the running tasks it stops, and store the continuation of a plan that becomes ready in them with `admission` `withdrawn` and no synthesis task; keep every result, outcome and event already recorded, and never create or dispatch a synthesis task for a withdrawn continuation.
- [ ] Keep a plan from being `complete` while any contribution is waiting or active or a required one is uncertain, and list an optional contribution that ended uncertain as uncertain.
- [ ] Implement the command `plan.cancel`, recorded in `command_receipts`, which cancels waiting and blocked contributions, cancels queued and blocked tasks, whatever their blocking reason (`connection_disabled`, `usage_limit_reached`, `restart_paused` or any other), without dispatch, and stops running ones, with its race rule and no synthesis afterward; on a plan whose `outcome` is `complete` or `partial` while its latest synthesis task is queued, blocked or running, it stops that task as STORY-003-007's Stop does, keeping its partial text, keeps the recorded outcome and returns it, and the stopped synthesis offers no "Try again"; on such a plan whose continuation still waits for admission it sets the continuation's `admission` to `withdrawn`, creating no synthesis task, keeps the recorded outcome and returns it; on any other finished plan it returns the outcome; on a plan never accepted (`proposed`, `declined`, `replaced` or `invalid`) it is rejected with `record_not_found` and changes nothing.
- [ ] Expose `plan.cancel`, `plan.read` and `planEvent.list` on the application port and list in `operationErrorCodes` that each returns `record_not_found`.
- [ ] Extend restart handling to plans, holding waiting contributions and the continuations waiting for admission after a crash until "Continue all ({n})", and never send `multi_agent`.
- [ ] Apply the documentation amendment of SPEC-003-030 to `docs/agents/agent-collaboration.md`, "Completion, cancellation and recovery": "unactivated contribution intents are also held for explicit continuation" becomes "unactivated contribution intents follow the same rule as accepted not-started tasks".

## Acceptance criteria

- [ ] Repeated, reordered or gapped events produce one continuation (scenario 5).
- [ ] A crash between storing a result and notifying leaves one continuation (scenario 6).
- [ ] Cancellation before start, during execution and racing completion behaves as specified (scenario 7).
- [ ] A plan with an active or a required uncertain contribution is never complete, an optional uncertain one is listed as uncertain, and `multi_agent` is never sent (scenario 8).
- [ ] Each event kind is stored with its contribution and task, or without them for plan-level kinds, and each continuation records its policy version.
- [ ] After a crash plans wait for "Continue all ({n})"; after an orderly exit they continue (scenario 9).
- [ ] A change that would pass 512 events is rejected with `event_limit_reached` and changes nothing, a result whose activations would pass the cap is stored with its dependents left waiting, the plan enters "Needs your attention" and `plan.finish` cancels the waiting contributions.
- [ ] On start, a plan made ready without a continuation, a state the test creates directly, gets exactly one.
- [ ] With the synthesis operation's 20 pending tasks queued or blocked, a plan that becomes ready through a result or `plan.finish` keeps its result and stores its continuation `waiting` with no task, the pending count never passes 20, and when a pending synthesis task starts or ends the oldest waiting continuation gets its task in that transaction; waiting continuations survive an orderly restart and a crash and are admitted at start when there is room, after a crash blocked with `restart_paused`; and `plan.cancel` of a plan whose continuation waits sets it `withdrawn`, so no synthesis is created.
- [ ] After a crash with 20 restart-paused synthesis tasks and one held waiting continuation, `pause.read` counts 21, `plan.cancel` of one paused plan admits the held continuation with its synthesis task blocked with `restart_paused`, and nothing is dispatched until `task.continueAll`; a held continuation still waiting when `task.continueAll` runs loses its hold and is admitted as a queued task once there is room.
- [ ] With 20 pending synthesis tasks, a waiting continuation and a running optional contribution whose stop makes its plan ready, `task.cancelAll` cancels the tasks, withdraws the waiting continuation, stores the newly ready plan's continuation `withdrawn` and keeps every result and outcome, and after Ohtia opens again no synthesis task is created or dispatched for either.
- [ ] `plan.cancel` while only the synthesis runs stops it and keeps the recorded outcome; it cancels queued tasks and tasks blocked by each blocking reason without dispatch, and is rejected with `record_not_found` for a plan never accepted.
- [ ] `plan.cancel`, `plan.read` and `planEvent.list` reach the data service through the application port.
- [ ] A synthesis task has kind `synthesis`, its accepting receipt and no `input_through_position`, keeps running after `conversation.stop` and is rejected by `task.stop` with `task_not_stoppable`.

## Quality checklist

- [ ] Automated tests pass in all 12 CI cells: Ubuntu 26.04 GNOME and KDE on x86-64 and ARM64, Fedora 44 GNOME and KDE on x86-64, Debian 13 GNOME and KDE on x86-64, Windows on x86-64 and ARM64, and macOS 26 and 27 on ARM64.
- [ ] No real-account check is needed, because nothing new talks to a provider; the first real plan runs in STORY-003-026 and STORY-003-027.
- [ ] The story's operations emit `ohtia-log-v1` catalog events with a privacy review, and no prompt, response, tool argument, title, memory text, credential or provider error message reaches diagnostics.
- [ ] Its migration runs through the existing ADR-0010 checkpoint and recovery path; if a story that runs at the same time merges its migration first, this story renumbers its own to the next free number and updates `manifest.json` and the storage revision list before it merges.
- [ ] Every document under `docs/` that this story amends gets this story's `generated.by` and loses its `verified` declaration, which the researcher adds again after reviewing it, as `AGENTS.md` requires.
- [ ] The change passes `pre-commit run --all-files`, the two-reviewer code review gate in `AGENTS.md` and the required `ci` check.
