---
type: Playbook
title: "Agent collaboration evaluation"
description: "Evaluate research usefulness, evidence fidelity, human review, and bounded execution against a single-agent baseline."
verified:
  by: human:AdrianMastronardi
---

# Agent collaboration evaluation

## Purpose and evaluation unit

Evaluate whether [agent collaboration](agent-collaboration.md) improves research work enough to justify its coordination cost. The unit is a versioned intervention policy on a declared operation, language, source representation and provider/runtime configuration. A protocol-conformant adapter is not evidence that a specialist produces adequate academic work.

Use synthetic or permitted public material with recorded versions, anchors, restrictions and an examinable assessment rubric. Keep private research and credentials out of fixtures, logs and external evaluation. This playbook defines verification work; it records no completed experiment or release approval.

## Baselines and comparison

Compare a capable single agent with the specialist configuration on the same research questions, authorized evidence, tool capabilities and comparable total work budgets. Include planning, context preparation, reviewer calls and synthesis in the collaboration cost. Keep any additional evidence retrieval visible. Do not give the specialist team an unreported larger budget or score missing usage as zero.

Use a fixed preregistered set of representative cases and repeated trials sufficient for the declared evaluation question. Record requested and observed model settings, runtime/adapter versions, instruction/output schema versions, supplied context, trial order and any unavailable controls. Where identifiers are mutable or unknown, disclose the reproducibility limit. Vary presentation order for human assessments and conceal the producing configuration where practical.

Assess each role separately before relying on the combined output. Compare coordinator consultation and direct specialist use where both fit. Run an ablation without the critical review contribution to test whether useful objections justify its extra cost. A test set used for prompt tuning is not an independent final evaluation set.

Before running a chargeable evaluation, the owner authorizes the bounded calls and destination. Record quality thresholds, severity categories, evaluation languages, maximum cost/latency and allowed omissions before inspecting the results. Do not invent universal precision targets or claim language coverage from catalog completeness.

## Research-quality cases

### Reference discovery

Provide a question, enabled discovery fixtures and known metadata collisions, abstract-only results, missing pages and inaccessible full text. Check proposed strategy separately from recorded execution. Require preserved queries/provider identity, honest coverage and useful candidate-selection reasoning. A larger bibliography is not inherently better.

### Reading and attribution

Supply sources with qualified results, negative findings, an unreadable table, competing interpretations and exact anchor references. Check whether the reader locates the author's claim, preserves qualification and distinguishes source text from interpretation. Score unsupported attributions and falsely claimed full-text coverage as defects even when the summary sounds plausible.

### Critical comparison

Include both real tension and superficially contradictory results explained by different definitions, populations or methods. Include several papers using the same underlying data and a citation that provides context rather than specific support. Assess useful criticism, missed objections, false objections, comparability reasoning and whether unresolved evidence remains unresolved.

For independent review, begin with original evidence and the question while withholding the earlier verdict. Record subsequent disclosure. Check whether aggregation preserves justified disagreement and whether the coordinator adds unsupported conclusions. Agent agreement is not an assessment rubric.

### Writing and methodological guidance

Include grammar errors, valid locale variants, quoted material, formulae, citations and suggested edits that would accidentally change meaning. Require anchored changes, correct classification of preference versus error and explicit substantive-change labels. Evaluate academic editing separately from proofreading even when they share an interface.

Use quantitative, qualitative, documentary and theoretical questions with both adequate and inadequate designs. Check whether guidance distinguishes a proposed analysis from execution, identifies limitations without inventing institutional requirements and recognizes when the available specialist is insufficient.

## Deterministic operational scenarios

Use synthetic provider/process implementations and controlled transaction orderings to verify the following contracts. Add real runtime/platform conformance for the guarantees used by enabled adapters; mocks do not establish native cessation or network containment.

1. A directly selected specialist completes and responds without a mandatory Virgilio turn. The stored result retains role, input versions and coverage.
2. With inference concurrency set to one, a coordinator commits delegation intent and ends its turn; a specialist then runs and a separately budgeted synthesis turn follows. No waiting parent retains the specialist's slot.
3. Two equivalent delegation requests race. Exactly one accepted contribution is created; replay returns its receipt and conflicting payload reuse fails.
4. Reject a cycle, exhausted graph/turn budget, unsupported specialist, changed input, disallowed destination and allocation exceeding the aggregate remaining envelope before child work is accepted.
5. Deliver a completion event repeatedly, out of order and after a stream gap. One ready state produces at most one continuation; scoped requery recovers missing state without repeated inference.
6. Crash after artifact commit but before notification. Durable recovery discovers the receipt. Crash near dispatch follows ADR-0011's uncertainty rules and does not silently rerun the provider call.
7. Cancel before activation, during execution and concurrently with completion. The winning transaction determines effects; unresolved cessation remains uncertain and quarantined. No child starts from a late coordination event.
8. Finish a parent while a delegated operation remains active or uncertain. Intervention completion cannot hide the unresolved child. Disable an untracked runtime delegation route.
9. Restart with queued tasks and unactivated intent. Neither project opening nor provider reconnection resumes work without the required human continuation.
10. Change concurrency during competing admissions. Respect both configured application capacity and effective adapter/connection limits, including quarantined slots.
11. Attempt a cross-project read, restricted derived-content transfer, human confirmation through an agent tool and stale-capability write. Reject each at the trusted boundary.
12. Edit or withdraw retained memory and source content. Preserve earlier attribution and identify dependent findings; old results cannot acquire new coverage or confirmation.
13. Approve a versioned editorial proposal, repeat the command and simulate saving failure. Exactly one accepted application produces its revision/approval receipt; failure preserves the previous manuscript.
14. Change the manuscript or proposal while approval is pending. Reject stale application, require a new reviewed proposal and retain provenance for an explicitly accepted subset.
15. Feed sensitive markers through success, exceptions, stderr, runtime traces and diagnostic export. Research records may retain permitted content; operational diagnostics obey ADR-0013 and do not capture it.
16. Stop or disconnect during delegated work, then receive late cost data. Preserve unknown usage until supported settlement without restoring research effects or resetting the intervention budget.

17. Select an explicit role and an ambiguous unassigned request. Preserve the explicit selection or explain its unavailability; otherwise use the smallest suitable evaluated role set and request clarification before speculative delegation. Neither an avatar nor a model's confidence can authorize substitution.
18. Accept, reject and pause a handoff; replay it and race it with a branch-owner change. Only an accepted expected-version command changes ownership. Pending/rejected transfers preserve the prior owner, historical messages retain their producers and the recipient cannot reuse an active sender's capability or capacity.
19. Redirect work before and after child-task acceptance. Update only eligible intent, keep accepted immutable inputs, cancel superseded execution explicitly and retain the original question on late results. Broader scope requires fresh authorization and cannot reset accumulated work.
20. Fail or omit required and optional contributions, including an optional-labelled prerequisite of a required descendant. Block dependent activation without invented artifacts, allow only independent authorized work, disclose omissions and keep unresolved execution uncertain. A completed task with insufficient required coverage cannot yield a complete research intervention.

## Measurements and human assessment

Report source-attribution accuracy with the examined denominator, unsupported or fabricated claims, anchor correctness, qualified coverage, useful and false objections, preservation of disagreements and later corrections. Assess whether the next proposed action helps the researcher proceed or stop honestly. A polished answer, number of agents or number of findings is not a success metric.

Measure total elapsed time, active inference, context-preparation work, reported/estimated/unknown consumption and researcher time spent examining evidence or resolving redundant output. Separate enforced work limits from provider billing estimates. Record failures and cases that stopped with insufficient evidence rather than excluding them from the comparison.

Human assessors use an explicit rubric and have adequate disciplinary and language competence for the case. Preserve disagreements and adjudication grounds; do not substitute a model majority for review. Researcher acceptance measures usefulness or preference, not factual precision. Editorial approval and evidence confirmation are separate observations.

Check complete keyboard journeys for selecting a specialist, inspecting source anchors, reviewing a change, rejecting it and stopping an intervention. Verify focus, status announcements and readable partial/uncertain states without turning the interface into a task-management obligation.

## Identity, attention and source recognition

Use the [identity contract](agent-identity.md) to compare recognition in welcome/return, Navigator findings, Virgilio dialogue, direct specialist work, composed responses and imported human supervisor feedback. Evaluate actual contributor recognition separately from recognizing the product mascot. Test whether a named guide is understood as AI, whether an avatar is mistaken for a supervisor and whether a character reaction is mistaken for scientific approval.

Repeat in central-only, chat-only and narrow layouts, with a manuscript visible, in grayscale, by keyboard and with reduced motion or full characters hidden. The same evidence, contributor labels and actions remain usable. Measure whether characters help identify work or add interruption/review burden before expanding the illustrated roster. A preferred character or attractive portrait is not evidence of specialist quality.

Verify the `character_presentation` preference's accepted values, invalid/unavailable fallback, failed-write behavior, cross-window application and restart persistence. Activate reduced motion mid-animation and cancel all pending motion without replay after re-enabling it. Deliver coincident, repeated and restored event notices: at most one relevant animation plays per batch, existing notices restore statically and no animation changes inference, access or review state. For a manuscript-visible event, verify that only the first explicit Navigator opening can consume the one deferred presentation, using the original unused batch allowance; passive restoration, restart, resolution and nonanimated modes cannot replay it. Queued work cannot appear to be actively reading, and completion art cannot imply that citations or conclusions were verified.

## Evidence and enablement

Keep actual trial records, actor identities, input manifests, rubric versions, decisions and verification limits in the task's ignored review evidence. Keep supported product guarantees in canonical specifications. Automated checks and model assessments do not populate human document verification fields.

Enable only the evaluated operation/language/runtime scope after its operational guarantees and owner-defined quality thresholds are satisfied. A failure may justify revised context, a narrower role, a simpler single-agent route or leaving the operation unavailable. Reevaluate after consequential changes to prompts, models, tools, delegation controls, formats or provider permissions. Transport compatibility alone does not carry forward research-quality evidence.
