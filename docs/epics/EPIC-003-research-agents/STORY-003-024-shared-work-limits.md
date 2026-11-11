---
type: Story
title: "STORY-003-024 — Shared work limits"
description: "Bound every consultation and plan with a total work budget enforced by reservations and settlements."
generated:
  by: claude-code/claude-opus-5-5
verified:
  by: human:AdrianMastronardi
tags: [story, "comp:storage", "comp:llm", "comp:docs"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/226
epic: "EPIC-003"
epic_concept: ./epic.md
components: ["comp:storage", "comp:llm", "comp:docs"]
applicable_blocks: ["SPEC-003-029"]
---

# STORY-003-024 — Shared work limits

## Description

Add plan and consultation limits copied at acceptance, the authorized operation set, per-task reservations covering both attempts, settlement of real use and rejection when no room remains.

## Applicable specification

- [SPEC-003-029: Shared work limits](./epic.md#spec-003-029-shared-work-limits)

## Tasks

- [ ] Start after STORY-003-023 is merged and its output is on the base branch: Contribution graph and activation.
- [ ] Start from the contribution graph of STORY-003-023, and extend these existing boundaries rather than create parallel ones.
- [ ] Write the migration for `intervention_limits` (`intervention_id`, `policy` `plan` or `consultation`, `policy_version`, `max_contributions`, `max_dependencies`, `max_levels`, `max_coordinator_turns`, `max_requests`, `max_input_bytes`, `max_output_bytes`, `max_work_ms` and `created_at`, never changed), `intervention_operations` (`intervention_id`, `agent_id`, `operation` and the `connection` fixed at acceptance, never changed) and `work_allocations` (one row per attempt share: `id`, `intervention_id`, `contribution_id` empty for the synthesis, `share` `contribution` or `synthesis`, `task_id`, `attempt_number` 1 or 2, `reserved_requests`, `reserved_input_bytes`, `reserved_output_bytes`, `reserved_work_ms`, `state` `held`, `settled` or `released`, `attempt_id`, `used_requests`, `used_input_bytes`, `used_output_bytes`, `used_work_ms`, `created_at` and `settled_at`); never delete their rows.
- [ ] Migrate the consultations stored before this story: each accepted one gets its consultation limits, its `intervention_operations` row with the connection of its first task and two `work_allocations` rows per task, a dispatched attempt settled at its reserved maximum, never-dispatched and unused attempt numbers of finished tasks released, and the shares of an unfinished task held.
- [ ] Copy the plan or consultation limits at acceptance, with the consultation limits of policy version 1 set to one contribution (`max_contributions` 1), 0 dependencies (`max_dependencies` 0), 1 level (`max_levels` 1), 0 Virgilio turns (`max_coordinator_turns` 0), 4 requests, 1 MiB of input, 256 KiB of output and 40 minutes, and record the authorized operations with the connection each agent's tasks resolve to at that moment; reject `plan.addContributions` with an agent or operation outside the authorized set with `agent_not_authorized`, saving nothing.
- [ ] Reserve two `work_allocations` rows, one per possible attempt, for each contribution when the plan is accepted or `plan.addContributions` adds it, and for the synthesis at acceptance, each linked to its task once it exists, with two new rows for each "Try again" or "Start reply again", serializing parallel reservations; the synthesis share uses the test synthesis operation until STORY-003-026. Make `consultation.accept` create the consultation's `intervention_limits` and `intervention_operations` rows and the two `work_allocations` rows of its first task in the acceptance transaction.
- [ ] Keep the plan and consultation totals tied to the operation limits they reserve: take into this story's version 1 totals any raise of `search_strategy_planning` or `contribution_synthesis` applied before it merges; a later version that raises such a limit also adds the next plan or consultation limits policy version (SPEC-003-002), whose totals keep 8 contributions with two attempts each and the synthesis, or two of Josefa's task reservations; interventions accepted earlier keep their copied limits.
- [ ] Recheck every activation of a contribution, of a plan or a consultation, in the transaction that would create the task: the agent's tasks still resolve to the recorded connection and, for a plan contribution, every prerequisite is still `completed`, not superseded, with the `result_message_id` it had when the contribution became ready. When an activation that no command requested fails, create no task, send nothing and fail the plan contribution with `destination_changed` or `input_changed`, blocking its dependents, offering "Try again" only after `destination_changed`. When the activation is the task of a "Try again" or "Start reply again", of a plan contribution or a consultation, reject the command instead with `destination_changed` or the new error `input_changed`, changing nothing.
- [ ] Settle completed, failed and stopped attempts by measured use, release never-dispatched attempts and unused second attempts, and count uncertain attempts at their maximum, without counting tokens or money.
- [ ] Reject plans that do not fit with `plan_too_large` or `limit_reached`, and reject a "Try again" or "Start reply again" of a contribution, a consultation or the synthesis without room with the new error `limit_reached`, changing nothing; add `limit_reached` and `input_changed`, both with next action `check_request`, to the port's closed `errorActions` and to the `operationErrorCodes` of `contribution.tryAgain` and `contribution.startAgain`.
- [ ] Add to the timeline item of a consultation task's notice whether another attempt of its consultation fits its limits.
- [ ] Apply the documentation amendment of SPEC-003-029 to `docs/agents/agent-collaboration.md`, "Shared work envelope": "Before enabling an intervention policy, supply positive finite limits for total contribution tasks, coordinator turns, delegation depth, graph nodes/edges, aggregate input/output/work units and total active execution duration." becomes "Before enabling an intervention policy, supply finite limits for total contribution tasks, coordinator turns, delegation depth, graph nodes/edges, aggregate input/output/work units and total active execution duration; each is positive, except that a policy may set zero coordinator turns or zero dependencies when its interventions never use them, as a single consultation does."

## Acceptance criteria

- [ ] A plan too large or over the totals is rejected without saving anything.
- [ ] Two parallel tasks cannot take the same last share.
- [ ] Unused and never-dispatched shares are released and uncertain attempts count their maximum.
- [ ] A stopped attempt counts what it used and releases the rest, a lost connection counts the maximum, and neither resets totals (part of scenario 16).
- [ ] Scenario 4 of `agent-collaboration-evaluation.md` passes for limits: an exhausted budget, an allocation over the remaining envelope, a changed input and a disallowed destination are rejected before any work is accepted, the last two failing the contribution with `input_changed` or `destination_changed` without sending anything.
- [ ] Consultations use their own limits, stored with 0 dependencies, 1 level and 0 Virgilio turns, and one "Try again" or "Start reply again" fits after a dispatched attempt, while one that does not fit is rejected with `limit_reached` and the consultation task's notice item says that no attempt fits.
- [ ] A "Try again" or "Start reply again" of a plan contribution or a consultation whose agent now resolves to another connection is rejected with `destination_changed` and changes nothing.
- [ ] Limits are copied at acceptance and never change afterwards, and an operation outside the authorized set is rejected with `agent_not_authorized`.
- [ ] Stored consultations migrate with their limits, connection and settled shares, and a consultation accepted after this story gets its limits, authorized-set and first-task allocation rows in the acceptance transaction.
- [ ] `docs/agents/agent-collaboration.md` allows zero coordinator turns or dependencies for a policy whose interventions never use them.

## Quality checklist

- [ ] Automated tests pass in all 12 CI cells: Ubuntu 26.04 GNOME and KDE on x86-64 and ARM64, Fedora 44 GNOME and KDE on x86-64, Debian 13 GNOME and KDE on x86-64, Windows on x86-64 and ARM64, and macOS 26 and 27 on ARM64.
- [ ] No real-account check is needed, because nothing new talks to a provider; the first real plan runs in STORY-003-026 and STORY-003-027.
- [ ] The story's operations emit `ohtia-log-v1` catalog events with a privacy review, and no prompt, response, tool argument, title, memory text, credential or provider error message reaches diagnostics.
- [ ] Its migration runs through the existing ADR-0010 checkpoint and recovery path; if a story that runs at the same time merges its migration first, this story renumbers its own to the next free number and updates `manifest.json` and the storage revision list before it merges.
- [ ] Every document under `docs/` that this story amends gets this story's `generated.by` and loses its `verified` declaration, which the researcher adds again after reviewing it, as `AGENTS.md` requires.
- [ ] The change passes `pre-commit run --all-files`, the two-reviewer code review gate in `AGENTS.md` and the required `ci` check.
