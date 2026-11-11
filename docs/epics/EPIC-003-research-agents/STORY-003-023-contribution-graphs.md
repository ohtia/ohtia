---
type: Story
title: "STORY-003-023 — Contribution graphs"
description: "Store plans of several contributions with dependencies, validate them and advance them without holding slots while waiting."
generated:
  by: claude-code/claude-opus-5-5
verified:
  by: human:AdrianMastronardi
tags: [story, "comp:storage", "comp:llm", "comp:app", "comp:docs"]
status: stable
resource: https://github.com/ohtia/ohtia/issues/225
epic: "EPIC-003"
epic_concept: ./epic.md
components: ["comp:storage", "comp:llm", "comp:app", "comp:docs"]
applicable_blocks: ["SPEC-003-028"]
---

# STORY-003-023 — Contribution graphs

## Description

Extend interventions and contributions into versioned contribution graphs with dependencies, required and optional contributions, validation, activation in the result transaction, blocking on failure and the plan outcome.

## Applicable specification

- [SPEC-003-028: Contribution graphs](./epic.md#spec-003-028-contribution-graphs)

## Tasks

- [ ] Start after STORY-003-022 is merged and its output is on the base branch: Interventions and contributions.
- [ ] Start from the `interventions` and `contributions` records of STORY-003-022, and extend these existing boundaries rather than create parallel ones.
- [ ] Write the migration for the new `interventions` columns (`kind` value `plan`; `purpose`, 1 to 2,000 code points, and `shared_context`, 0 to 32,768 bytes, required for a plan and empty for a consultation; `graph_version`, 0 for a consultation; `outcome` and `finished_at`, empty until the plan ends; `finished_by_operation_id`, set only by `plan.finish` and later `plan.cancel`; a test or development plan created already accepted records its own operation identifier as `decided_by_operation_id`), the new `contributions` columns (`plan_key`, required and unique within a plan and empty for a consultation; `required`; `state`; `blocked_by_contribution_id` only while blocked; `failure_reason` only while the contribution is `failed` without any task, cleared when a "Try again" creates its first task; `result_message_id` only when completed; `dedupe_key`; `added_in_graph_version`, 0 for a consultation's), `contribution_dependencies` (`id`, `intervention_id`, `contribution_id`, `prerequisite_id`, `added_in_graph_version` and `removed_in_graph_version`, with both contributions in the same intervention, no edge to itself and one holding edge per pair) and `graph_changes` (`id`, `intervention_id`, `graph_version` unique within the plan, `kind` `accepted` or `contributions_added`, `applied_by_operation_id`, `proposed_by_attempt_id`, an identifiers-only `summary` of at most 16 KiB and `created_at`); never delete their rows.
- [ ] Migrate the consultations stored by STORY-003-022: empty `plan_key`, `required` true, `added_in_graph_version` 0, their `dedupe_key`, and the state of their current task (`completed` with its message as `result_message_id`, `failed`, `uncertain`, `cancelled`, or `active` for a queued, blocked, running or cancelling task), or `waiting` when never accepted.
- [ ] Implement the data-service command `plan.addContributions`, which only tests and the development command call and the application port never carries, with the expected plan version, all-or-nothing validation with the rejection codes `graph_version_conflict`, `unknown_prerequisite`, `self_dependency`, `cycle`, `duplicate_contribution`, `agent_unavailable`, `plan_key_invalid`, `plan_key_duplicate`, `empty_plan`, `request_empty` and `request_too_large` for a request over 8 KiB, and receipts; reject a plan with `purpose_empty`, `purpose_too_long` or `shared_context_too_large` wherever it is created; compute `dedupe_key` as the SHA-256 of the RFC 8785 canonical JSON of `{ agent, operation, policyVersion, request, prerequisites }`, with the sorted prerequisite plan keys, unique within the intervention.
- [ ] Activate contributions in the transaction that stores a prerequisite result, passing the shared context, request, project data and prerequisite texts as the English items "This request comes from a plan by Virgilio, the research guide. The researcher approved it and cannot answer questions in this reply.", "Context for every contribution of the plan:" with the shared context (left out when empty), "Your contribution ({plan_key}):" with the request, and one "Result of contribution {plan_key} by {agent_name}, {agent_role}:" item per prerequisite in plan order; fail the contribution with `input_too_large` before any task exists when they do not fit, without offering "Try again".
- [ ] Give the tasks of a plan's contributions the `tasks.kind` value `contribution`, an empty `input_through_position` and the receipt of the command that accepted the plan, or of the retry that created them, as `accepted_by_operation_id`; keep them outside the per-conversation rules of STORY-003-005 and STORY-003-022, never waiting for the conversation's `reply` and `consultation` tasks and never coalesced or replaced, while respecting the general and connection limits; consultation tasks keep STORY-003-022's conversation queue.
- [ ] Make `conversation.stop`, the composer's Stop state, the notice "Waiting for {running_agent} to finish the current reply." and the history row status consider only the conversation's `reply` and `consultation` tasks; reject `task.stop` of a task of kind `contribution` with the new error `task_not_stoppable`, next action `check_request`, changing nothing, and add it to the port's closed `errorActions` and to `task.stop`'s `operationErrorCodes`; show no notice in the conversation for a task of kind `contribution`; a task of kind `consultation` keeps its notice and still stops with `conversation.stop` and `task.stop`.
- [ ] When a contribution's result is saved while a `reply` task of the conversation has not started, replace that task in the same transaction by one with the same `accepted_by_operation_id` whose `input_through_position` is the higher of its own and the result's position.
- [ ] Block dependents in chain on a failed, uncertain or cancelled prerequisite, with `blocked_by_contribution_id` naming the root, unblock them on "Try again", offered after any failure except `not_eligible` and `input_too_large`, or "Start reply again", which STORY-003-022's `contribution.tryAgain` and `contribution.startAgain` now run for plan contributions too, with `replaces_task_id` the contribution's latest task or empty when it had none, accepted only while the plan's `outcome` is empty and otherwise rejected with `task_not_retryable`; offer neither for a cancelled contribution; and compute `complete`, the state "Needs your attention", `partial` and `failed`; a plan is `complete` only when every required contribution is completed and none is `waiting` or `active`, listing optional ones that failed, were blocked or cancelled, or ended uncertain.
- [ ] Implement the command `plan.finish`, recorded in `command_receipts`, accepted only while the plan is in "Needs your attention" with no contribution waiting, queued or running: it keeps every contribution's state, blocked ones staying blocked with the contribution that blocked them, records `outcome` (`partial` with at least one result, `failed` with none), `finished_at` and `finished_by_operation_id`, and on a finished plan returns the recorded outcome; reject it, changing nothing, with the new error `plan_state_changed`, next action `refresh_record`, on an accepted, unfinished plan that is not in "Needs your attention", and with `record_not_found` on a plan never accepted (`proposed`, `declined`, `replaced` or `invalid`).
- [ ] Expose `plan.finish` on the application port, add `plan_state_changed`, next action `refresh_record`, to the port's closed `errorActions`, and list in `operationErrorCodes` that `plan.finish` returns `plan_state_changed` and `record_not_found`.
- [ ] Build varied test agents with different limits, dependencies and one that fails.
- [ ] Apply the documentation amendment to `docs/agents/agent-collaboration.md`, "Completion, cancellation and recovery": "An intervention reports complete requested coverage only when every required contribution has an accepted terminal result, all required coordination has finished and no delegated execution remains unresolved." becomes "An intervention reports complete requested coverage only when every required contribution has an accepted terminal result, all required coordination has finished and no delegated execution is still waiting, queued or running; an optional contribution whose execution ended uncertain is reported as uncertain and does not reduce the required coverage."; and, in "Intervention and contribution records", "Reject duplicate equivalent contribution requests using a policy-versioned key containing purpose, role, input versions and output contract; an explicitly authorized independent review has a distinct declared purpose." becomes "Reject duplicate equivalent contribution requests using a policy-versioned key, scoped to the intervention, over agent, operation, request and prerequisites; an explicitly authorized independent review has a distinct request."

## Acceptance criteria

- [ ] Every rejection of `plan.addContributions`, including a request over 8 KiB, and every rejected purpose or shared context saves nothing.
- [ ] Each new column holds only the values its rule allows, and stored consultations migrate to their task's state.
- [ ] A dependent contribution receives its request and its prerequisites' results in the specified English layout.
- [ ] A plan is not complete while an optional contribution is waiting or active, and completes listing a failed or uncertain optional one.
- [ ] Two equal requests at once create one contribution (scenario 3).
- [ ] Contributions run in parallel at limit 3 and one at a time at limit 1, and waiting ones never hold a slot.
- [ ] Failures block in chain, optional failures still block dependents, and "Try again" unblocks (scenario 20); a contribution that failed with `not_eligible` offers no "Try again".
- [ ] Plans end `complete`, wait in "Needs your attention", and finish `partial` or `failed` as specified; `plan.finish` reaches the port and is rejected with `plan_state_changed` for a running plan and `record_not_found` for a plan never accepted, changing nothing.
- [ ] `docs/agents/agent-collaboration.md` scopes the duplicate-request key to the intervention, over agent, operation, request and prerequisites.
- [ ] A researcher message or a saved reply never coalesces or replaces a contribution task.
- [ ] Contribution tasks run beside the conversation's reply and consultation tasks without waiting for them, while consultation tasks keep the conversation queue; `conversation.stop` leaves tasks of kind `contribution` running, and `task.stop` rejects a task of kind `contribution` with `task_not_stoppable` and still stops a task of kind `consultation`.
- [ ] A contribution result saved while a reply task waits replaces that task, whose input then reaches the result.
- [ ] A cancelled prerequisite blocks its dependents, and "Try again" is rejected with `task_not_retryable` once the plan has ended.
- [ ] `plan.addContributions` is not on the application port.
- [ ] Scenario 4 of `agent-collaboration-evaluation.md` passes for the graph: a cycle and an unsupported specialist are rejected before any work is accepted.

## Quality checklist

- [ ] Automated tests pass in all 12 CI cells: Ubuntu 26.04 GNOME and KDE on x86-64 and ARM64, Fedora 44 GNOME and KDE on x86-64, Debian 13 GNOME and KDE on x86-64, Windows on x86-64 and ARM64, and macOS 26 and 27 on ARM64.
- [ ] No real-account check is needed, because nothing new talks to a provider; the first real plan runs in STORY-003-026 and STORY-003-027.
- [ ] The story's operations emit `ohtia-log-v1` catalog events with a privacy review, and no prompt, response, tool argument, title, memory text, credential or provider error message reaches diagnostics.
- [ ] Its migration runs through the existing ADR-0010 checkpoint and recovery path; if a story that runs at the same time merges its migration first, this story renumbers its own to the next free number and updates `manifest.json` and the storage revision list before it merges.
- [ ] Every document under `docs/` that this story amends gets this story's `generated.by` and loses its `verified` declaration, which the researcher adds again after reviewing it, as `AGENTS.md` requires.
- [ ] The change passes `pre-commit run --all-files`, the two-reviewer code review gate in `AGENTS.md` and the required `ci` check.
