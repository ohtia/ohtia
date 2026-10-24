---
type: DecisionRecord
title: "ADR-0011 — Persisted local task intent with bounded execution"
description: "Define durable task and attempt states, local scheduling limits, cancellation, application exit and recovery."
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
---

# ADR-0011 — Persisted local task intent with bounded execution

## Context

Source analysis and document processing can outlive an interface interaction, encounter a crash or lose contact with an external provider. Repeating a request after losing its response can duplicate work and cost. An in-memory-only queue loses intent and reconciliation evidence on restart. Platform schedulers can launch processes but would still require Ohtia to preserve input scope, domain receipts, cancellation authority and provider uncertainty; separate OS job definitions would also duplicate lifecycle policy. Persisted intent with one local broker keeps those decisions inside the same transaction and authority boundary as the research operation. Ohtia therefore needs persistent work intent and explicit completion evidence; a process exit, timeout or closed window alone cannot establish a research outcome.

## Decision

### Task identity and accepted work

A **task** is one accepted request for an operation on an immutable input manifest under a versioned policy. An **attempt** is one execution of that task. Only one attempt of a task can hold execution authority at a time. The task retains its ID across allowed automatic attempts; a human request to repeat terminal or unresolved work creates a new task linked to the earlier one.

Persist the task, command receipt and domain changes that schedule it in one SQLite transaction. A repeated command ID with the same payload returns the prior receipt/task; a different payload with that ID fails. Creating a task does not start a process or contact a provider before commit. A rejected admission creates no accepted task.

Retain task ID, operation/policy version, project scope, immutable input manifest, command identity, state and blocking reasons, cancellation intent, current attempt/generation and cumulative retry consumption. Each attempt records its task, generation, admission, process identity, dispatch evidence, timing/limits, scoped capability, progress, outcome and terminal receipts. [ADR-0012](adr-0012-attempt-bound-process-capabilities.md) owns the capability; research results and task state commit through the trusted data service.

### Task states and transitions

Task states have the following meanings:

- `queued`: accepted and eligible for admission, waiting for capacity; no execution authority is held.
- `blocked`: accepted but not eligible to start. Persist explicit blocking codes, such as `connection_disabled`, `permission_required`, `input_changed`, `configuration_unavailable`, `restart_paused` or `shutdown_paused`. Waiting for capacity alone is not a block.
- `running`: one attempt owns the reserved capacity and is preparing, executing or waiting for a scoped human answer.
- `cancelling`: cancellation has won the state transition; new research effects are denied while termination is requested and checked.
- `uncertain`: dispatch, result delivery or cessation cannot be established. Research-effect authority is revoked; unresolved work is not presumed stopped.
- `completed`: a valid result and completion receipt were accepted and committed for the current attempt.
- `failed`: execution ended without an accepted successful result, with a controlled reason and no retry remaining/allowed.
- `cancelled`: cancellation was requested and no execution began, or the required local/provider cessation evidence is confirmed.

`completed`, `failed` and `cancelled` are terminal for that task. Their records are not reopened by pressing Retry. Preserve immutable attempt outcomes, input identities and transition receipts.

Allowed transitions are:

1. Acceptance creates `queued`, or `blocked` when a declared prerequisite prevents start. Clearing a block revalidates the original authorization, current restrictions, input versions and policy before `blocked → queued`; it does not silently select new inputs, another provider or a larger budget. Changed input needs a new explicitly accepted request.
2. Admission performs `queued → running`, creates the next `prepared` attempt and reserves its capacity in one transaction. Cancellation while still `queued` or `blocked` goes directly to `cancelled`, without spawning anything.
3. Valid finalization performs `running → completed`. A proven ended failure becomes `failed`, or returns to `queued` for an allowed automatic attempt within the same cumulative budget. A prerequisite that disappeared before dispatch produces `blocked` with its reason.
4. Cancellation of `running` produces `cancelling`. Unknown dispatch/result or unproven cessation produces `uncertain`, not an assumed failure/cancellation. `cancelling → cancelled` requires the cessation evidence below; lack of that evidence produces `uncertain`.
5. Reconciliation of `uncertain` accepts only scoped evidence. A result, task outcome and completion receipt already committed together are read back as `completed`; that is receipt recovery, not permission to overwrite a persisted `uncertain` state. An uncertain attempt cannot publish a late result merely because the provider reports completion. Proven termination without a recoverable accepted result becomes `failed`, or `cancelled` if cancellation was requested. Otherwise the task remains `uncertain`.

Completion and cancellation race through the same expected-version transition. If completion commits first, a later Cancel returns that terminal receipt. If cancellation commits first, a late result cannot publish research effects. Previously committed partial observations retain their actual input/coverage; cancellation does not erase them or turn them into a complete result.

### Attempt lifecycle and completion evidence

An attempt progresses from `prepared` to `running`, optionally `waiting_user`, and then `completed`, `failed`, `cancelled` or `uncertain`. Cancellation/deadline handling uses `stopping` while termination is requested. The task stays `running` while its attempt waits for a scoped tool approval; that wait retains capacity and counts against its deadline. A human answer cannot revive a revoked, expired or replaced attempt.

The supervisor records launch intent before spawning and the OS process identity/receipt afterward. A `prepared` record without a launch receipt is not proof that a process never started: a crash can occur between spawn and receipt persistence. PID alone is insufficient; bind it to the process start identity and the application's supervised process group/job/container or equivalent verified containment identity. Reused PIDs and unrelated provider/OS processes must not be signalled.

A result is complete only when the current attempt returns a valid terminal operation result, its manifest/structure passes validation and the data service commits the result with its outcome receipt. A zero process exit or end of stream without that receipt is not success. Once research authority is revoked, only bounded exit/reconciliation/usage receipts remain admissible; do not restore write authority merely because an old child was found alive.

For local execution cessation, obtain the supervisor's exit/wait receipt and verify no owned descendants remain executing, or obtain a conclusive OS containment-termination receipt. Zombies are not executing children but must be reaped. If the identity/containment cannot be verified, cessation remains unproven. For an external turn, require an adapter-supported terminal result/cancellation/inspection bound to that exact provider operation. Local process death alone cannot prove external generation or billing stopped. An adapter unable to establish that fact reports it as unknown.

### Scheduling and required limits

Settings exposes two independent application-wide concurrency limits, persisted as application preferences: `max_concurrent_inference` and `max_concurrent_local_processing`. Both default to **1** and accept positive integers. These are user-configurable limits, not fixed maxima of one; the two classes may overlap. Direct UI/database commands and progress/event delivery do not consume these long-work slots, so reading and saving remain available.

The broker enforces the saved limits when reserving capacity. A settings update and admission must be serialized so a concurrent claim cannot use a superseded limit. Lowering a limit does not cancel or interrupt admitted work: start no further attempts in that class until its occupied slots fall below the new limit. Raising a limit permits eligible queued work to start through the normal admission checks; it does not resume paused tasks, clear uncertainty or grant provider permission. Persisted quarantines count toward occupied capacity after restart and after a settings change.

A connection remains limited to one inference attempt unless its adapter explicitly declares and verifies a higher concurrency limit. Admission must satisfy both the application limit and the connection's supported limit; changing Settings cannot override adapter safety constraints, operation budgets or provider permissions.

Within each class, eligible tasks use committed enqueue order, with a stable task-ID tie-break. Skip blocked tasks; do not silently reorder priorities or increase the configured concurrency. Reserve/release slots transactionally with their attempt transitions. Preparation, execution, waiting for human input and stopping all hold their slot. An uncertain attempt quarantines its slot until reconciliation or the explicit unresolved-work procedure below; lease expiry does not free it.

Every enabled operation policy supplies these explicit fields:

- `max_pending_tasks`: positive integer cap on this operation's queued plus blocked tasks; an active/quarantined attempt uses its execution slot instead.
- `max_input_bytes`, `max_input_items`, `max_output_bytes` and `max_work_units`: positive integer limits, with the operation defining how work units are counted.
- `max_attempt_duration_ms` and `stop_grace_ms`: positive finite integer durations. The attempt deadline includes human-approval waits and elapsed suspension time; inability to establish elapsed time requires reconciliation, never an extended deadline by assumption.
- `max_attempts`: 1 or 2 allocated attempts for this accepted task, counted cumulatively from preparation, including interrupted/spawn-failed attempts. A continuation cannot reset the count; exhaustion requires a new explicitly accepted task.
- `max_auto_retries`: 0 or 1, further bounded by remaining attempts/work budget.
- `retry_backoff_ms`: nonnegative finite integer delay before an otherwise admissible automatic retry.

A producer with a missing/invalid required field is unavailable. Reject a request that would exceed its admission cap before accepting the task; never silently drop older work. A batch declares a finite input list and total work budget before acceptance. Values specific to extraction, analysis or export belong in their operation contracts, not guessed universal limits here.

Permit at most **one automatic retry** per task, with a policy allowed to require zero. The budget includes all layers and survives restart; SDK, adapter and scheduler cannot each add retries. Automatic retry requires proven local cessation, no accepted prior result/effect and either conclusive zero external dispatch or the provider's verified idempotency/reconciliation contract for the same operation. Headers or body state alone must not be interpreted as proof of zero request transmission. Partial output or uncertain dispatch is not automatically retried.

A deadline requests interruption, then waits the operation's declared stop-grace interval for receipts. The supervised runtime must provide tested bounded termination/escalation for that platform; sending a signal is not the receipt. Expiry without proven cessation becomes `uncertain`, with no automatic retry or slot release.

### Application exit

Closing a window while another Ohtia window remains open only detaches that window's subscriptions. Closing the last window, the menu Quit command and supported OS quit requests use the same application-exit flow; Ohtia does not silently become a hidden background service. Editor save/discard handling remains governed by [frontend architecture](../frontend-architecture.md#manuscript-editor-boundary).

Pause new task admission while the exit decision is presented. With active work, offer these explicit actions:

- **Keep working:** dismiss exit and revalidate eligible dispatch; no task is cancelled.
- **Wait for active work, then quit:** start no further queued tasks. Let the admitted attempts finish under their existing deadlines; preserve not-started tasks as `blocked` with `shutdown_paused`. Keep the interface open for any required approval. Exit only after active outcomes, final research writes and owned local termination are recorded.
- **Cancel work and quit:** cancel queued/blocked tasks without executing them, move active tasks to `cancelling`, deny new research effects and request bounded termination. Quit normally after cancellation and cessation receipts are durable.

With no active/uncertain work, persist `shutdown_paused` for accepted not-started tasks, complete editor/DB shutdown and exit without a work-cancellation prompt. Unresolved work is handled explicitly: after all owned local processes are proven stopped and their research authority is revoked, the user may choose **Quit with unresolved remote work**. Persist `uncertain`, keep its quarantine and explain that remote completion/usage is unknown. If local cessation is unproven, do not report a clean quit or silently abandon the child; retain the recovery explanation. An OS crash/forced exit uses the restart procedure instead of pretending orderly cancellation.

### Restart, suspension and unresolved work

On startup, hold dispatch and reconcile persisted task/attempt receipts before scheduling. Terminal tasks stay terminal. Accepted not-started tasks acquire `restart_paused`; the user explicitly continues them after their prerequisites/policy are revalidated. Opening a project, enabling a connection or opening the activity panel does not by itself clear that pause.

For an unfinished admitted attempt, revoke stale research authority and inspect the recorded process identity, containment and provider operation. Stop identifiable surviving local execution through the supervisor. Do not infer absence from a missing PID receipt, expired lease, elapsed deadline, lost stream or the end of the previous broker process. Record exactly which local/external facts are confirmed.

If zero dispatch and local cessation are proved, record the interrupted attempt and leave its task blocked for explicit continuation within the remaining original attempt/work limits. If that budget is exhausted, mark it `failed`; fresh work requires a new accepted task. If external work/result/cessation is unresolved, retain `uncertain` and quarantine. Inspect/retrieve known provider state only through a declared bounded reconciliation route, without starting another generation. A verified ended provider turn with lost/uncommitted output is a failure with that reason, not an invented successful result or zero consumption.

Suspension is not a new attempt. On resume, recheck deadlines, authorization and process/provider state before accepting effects or dispatching further work. Use a verified suspend-aware clock or treat a detected suspend/resume interval as requiring this reconciliation; sleep must not silently extend permission or retry budgets.

A user can request fresh work despite unresolved remote completion only after local cessation is proved. The trusted human command records the unresolved task reference and explicit acknowledgement of possible duplicate external work/usage, releases that quarantine for the named replacement and creates a new linked task with newly checked inputs, policy and budget. The old task remains `uncertain`; this action neither declares it stopped nor gives its attempt new research authority. Model tools cannot issue that command. Late usage follows [ADR-0029](adr-0029-operation-profiles-and-usage-reports.md), independently of research-state finalization.

## Consequences

The work lifecycle survives interface/process loss while retaining explicit execution and cost uncertainty. The defaults limit local load, while explicit concurrency settings let the researcher choose greater parallelism within supported adapter constraints. SQLite stores intent and receipts; this decision does not require a hosted queue or a separate server application.

Required verification covers duplicate acceptance, both completion/cancellation orders, simultaneous slot claims and settings updates, persisted defaults/overrides, invalid concurrency values, lowering limits below occupied capacity, adapter-specific limits, quarantines across settings changes, missing policy limits, waiting-for-approval deadlines, one retry across layers/restart, spawn-before-receipt crashes, reused PIDs, descendant cessation, late results/usage, suspend/resume, all exit choices, interrupted migration quiescence and human-authorized unresolved replacements. Test every transition with deterministic processes/providers, plus real platform/runtime conformance for the cessation guarantees actually used. The operation contract must supply its numeric bounds before that producer can be enabled.
