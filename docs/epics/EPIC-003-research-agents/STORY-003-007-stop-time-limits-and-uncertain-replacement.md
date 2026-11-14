---
type: Story
title: "STORY-003-007 — Stop, time limits and uncertain replacement"
description: "Let the researcher stop tasks, enforce attempt and inactivity limits, keep partial text and replace uncertain tasks."
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
tags: [story, "comp:storage", "comp:llm", "comp:docs"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/209
epic: "EPIC-003"
epic_concept: ./epic.md
components: ["comp:storage", "comp:llm", "comp:docs"]
applicable_blocks: ["SPEC-003-012", "SPEC-003-013"]
---

# STORY-003-007 — Stop, time limits and uncertain replacement

## Description

Implement Stop with its race rule, the closed-connection cessation rule, the attempt and inactivity limits, partial replies marked in `messages.ending` with their notes to the model, and "Start reply again" for the latest uncertain reply task, and amend the documents that still keep every uncertain attempt's slot. Visible buttons and notices belong to STORY-003-012 and STORY-003-013.

## Applicable specification

- [SPEC-003-012: Stop, time limits and uncertain replacement](./epic.md#spec-003-012-stop-time-limits-and-uncertain-replacement)

- [SPEC-003-013: Restart and suspension](./epic.md#spec-003-013-restart-and-suspension), recovery-only delivery, classification, handoff, explicit continuation and verification; complete non-recovery restart and suspension remain STORY-003-008.

## Tasks

- [ ] Start after STORY-003-005 is merged and its output is on the base branch: Tasks, attempts and the multitask queue.
- [ ] Start from the task engine of STORY-003-005 and the request lifecycle of STORY-003-003, and extend these existing boundaries rather than create parallel ones.
- [ ] Implement Stop as the command `task.stop` for queued, blocked and running tasks with `state_revision` deciding races; a running task's Stop sends `provider_interrupt` and main closes the connection.
- [ ] Add the development command's `stop` and `start-again` actions, with `--ohtia-dev-task=<id>`, which run Stop and "Start reply again" until their buttons exist.
- [ ] Apply the closed-connection rule: free the slot once the connection closes and record usage as unknown.
- [ ] Enforce `max_attempt_duration_ms` and `max_inactivity_ms` with `deadline_exceeded` and `inactivity_timeout`.
- [ ] Write the migration for `messages.ending` (`complete` or `partial` for agent messages, empty for researcher messages, enforced by the database), setting it for the agent messages saved since STORY-003-005 to `complete` when the message's task is `completed` and to `partial` otherwise, and for `tasks.charge_warning_accepted_at` (a UTC time with milliseconds, set only on a task that a "Start reply again" command created, here `task.startAgain` and from STORY-003-022 and STORY-003-026 on also `contribution.startAgain` and `synthesis.tryAgain`, empty on every other task).
- [ ] Save partial text and keep the cut's reason on the attempt (stopped, attempt deadline, inactivity, output limit, an error in the stream, an event Ohtia cannot parse (`invalid_output`) or lost connection).
- [ ] Give every later task whose input includes a partial message, as the input item right after it, an English note with the `user` role, `{agent}` being the agent that wrote it: "Note from Ohtia: {agent}'s reply above is incomplete." followed by "The researcher stopped it before it finished." (`cancelled_by_researcher`), "It was cut off because it took longer than Ohtia allows for one reply." (`deadline_exceeded`), "It was cut off because the service sent nothing for too long." (`inactivity_timeout`), "It was cut off because it was longer than Ohtia allows for one reply." (`output_limit_exceeded`), "It was cut off because the service reported an error." (`provider_error` and `provider_unavailable`), "It was cut off because Ohtia couldn't read the rest of the service's reply." (`invalid_output`) or "It was cut off because the connection to the service was lost." (`connection_lost`); a reason that a later story adds keeps the first sentence alone unless its block gives its own.
- [ ] Implement "Start reply again" for uncertain tasks as the command `task.startAgain`, recording the accepted double-charge warning in `tasks.charge_warning_accepted_at`; accept it only for the conversation's latest reply task, the one no other reply task of the conversation was accepted after, and otherwise reject it with `newer_task_exists`, changing nothing; reject a task that is not `uncertain` with `task_not_retryable`, and reject it with `pending_limit_reached` at its operation's pending limit, as every command that creates a task; add `newer_task_exists`, next action `refresh_record`, and `task_not_retryable`, next action `check_request`, to the port's closed `errorActions`; the new task takes the uncertain task's `input_through_position`, so a partial reply that the uncertain task saved stays out of its input, which ends with a researcher message or another agent's message in the `user` role. Add `task.stop` and `task.startAgain` to the commands accepted in `command_receipts`.
- [ ] Implement `max_inactivity_ms` and the closed-connection rule as ADR-0051 records them.
- [ ] Apply the documentation amendments of SPEC-003-012, with "ADR-NNNN" linked to the new ADR in each document: in `docs/architecture.md`, "Uncertain attempts retain quarantined capacity and cannot publish research effects." becomes "Uncertain attempts cannot publish research effects. They retain quarantined capacity, except that an attempt of an adapter without background execution or a cancellation endpoint frees its slot once its connection closes, as ADR-NNNN records."; in `docs/agents/agent-collaboration.md`, "It cannot move an in-flight attempt, give the recipient the sender's capability or bypass an uncertain attempt's quarantine." becomes "It cannot move an in-flight attempt, give the recipient the sender's capability or bypass the quarantine that an uncertain attempt keeps; under ADR-NNNN, an uncertain attempt of an adapter without background execution or a cancellation endpoint keeps none once its connection closes." and "An uncertain attempt retains its quarantine." becomes "An uncertain attempt retains its quarantine, except that an adapter without background execution or a cancellation endpoint frees the slot once its connection closes (ADR-NNNN)."; in `docs/product-roadmap.md`, "lower limits preserve admitted work and uncertainty quarantines persist" becomes "lower limits preserve admitted work and uncertainty quarantines persist, except where ADR-NNNN frees the slot of an adapter without background execution or a cancellation endpoint once its connection closes"; and in `docs/agents/agent-collaboration-evaluation.md`, scenario 7's "unresolved cessation remains uncertain and quarantined" becomes "unresolved cessation remains uncertain, and quarantined unless its adapter has no background execution or cancellation endpoint, whose closed connection frees the slot (ADR-NNNN)" and scenario 10's "including quarantined slots" becomes "including quarantined slots and the slots that closed connections free under ADR-NNNN".

- [ ] Deliver or reuse SPEC-003-013’s recovery-only boundary before enabling this story’s migration, including development stores with accepted tasks. The first of STORY-003-006/007 to integrate supplies the shared gate-to-pause handoff, unfinished-attempt recovery, `task.continueAll`, development `continue-all` action and synthetic tests; later stories update their base and reuse the same boundary, command and tests. Whichever integrates second extends the same revalidation with its newly introduced prerequisites and preserves the earlier checks. Do not wait for STORY-003-008 or add a second continuation path.

## Acceptance criteria

- [ ] Stopping a real reply midway cancels the task, frees the slot and saves the partial text, which the next message sees.
- [ ] With the fake provider, the attempt deadline, the inactivity limit and the output limit each leave their code.
- [ ] A lost connection leaves the task uncertain and frees its slot.
- [ ] "Start reply again" creates the linked task and records the accepted warning in `tasks.charge_warning_accepted_at`, and the new task's input leaves out a partial reply of the uncertain task.
- [ ] `task.startAgain` is rejected and changes nothing: with `newer_task_exists` for an uncertain task that is no longer the conversation's latest reply task, with `task_not_retryable` for a task that is not uncertain and with `pending_limit_reached` at its operation's pending limit.
- [ ] Each cut reason gives the next task its note right after the partial message.
- [ ] The migration marks existing agent messages `complete` or `partial` by their task's state and leaves researcher messages empty.
- [ ] The six passages of `docs/architecture.md`, `docs/agents/agent-collaboration.md`, `docs/product-roadmap.md` and `docs/agents/agent-collaboration-evaluation.md` read as SPEC-003-012 states.
- [ ] Stop racing completion leaves exactly one result.

- [ ] The shared recovery suite passes against this story’s migration from a synthetic source with queued and unfinished tasks: rollback retry and checkpoint restoration hold pending work, even across another startup or reconnection, until `task.continueAll`; a proven undispatched attempt is cancelled and held rather than automatically requeued, dispatched work stays uncertain, crash windows preserve the gate or committed holds, and a healthy upgrade’s fresh gate alone adds no recovery pause.

## Quality checklist

- [ ] Automated tests pass in all 12 CI cells: Ubuntu 26.04 GNOME and KDE on x86-64 and ARM64, Fedora 44 GNOME and KDE on x86-64, Debian 13 GNOME and KDE on x86-64, Windows on x86-64 and ARM64, and macOS 26 and 27 on ARM64.
- [ ] Real-account checks run on the x86-64 virtual machines (Windows, Ubuntu 26.04, Fedora 44 and Debian 13) with the researcher's stored session. Each reply's duration and longest silence between provider events are recorded; a reply that uses more than half of its attempt duration, or a silence longer than half of `max_inactivity_ms`, raises that limit: in this story's own block before it merges when this story introduces that version; otherwise, recorded in this story's pull request, in that operation's next planned version that has not merged, whose story applies it before it closes; or, when none is planned, in a new policy-only version that this story adds before it closes. Each operation version this story introduces also takes, before the story closes, every raise that earlier stories recorded for it.
- [ ] The story's operations emit `ohtia-log-v1` catalog events with a privacy review, and no prompt, response, tool argument, title, memory text, credential or provider error message reaches diagnostics.
- [ ] Its migration runs through the existing ADR-0010 checkpoint and recovery path; if a story that runs at the same time merges its migration first, this story renumbers its own to the next free number and updates `manifest.json` and the storage revision list before it merges.
- [ ] Every document under `docs/` that this story amends gets this story's `generated.by` and loses its `verified` declaration, which the researcher adds again after reviewing it, as `AGENTS.md` requires.
- [ ] The change passes `pre-commit run --all-files`, the two-reviewer code review gate in `AGENTS.md` and the required `ci` check.
