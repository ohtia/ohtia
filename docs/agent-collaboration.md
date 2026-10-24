---
type: Specification
title: "Agent collaboration"
description: "Virgilio, research specialists, bounded collaboration, inspectable memory, and human-approved editorial proposals."
verified:
  by: human:AdrianMastronardi
sources:
  - id: openai-orchestration
    resource: "https://developers.openai.com/api/docs/guides/agents/orchestration"
    title: "OpenAI — Orchestration and handoffs"
  - id: codex-app-server
    resource: "https://learn.chatgpt.com/docs/app-server"
    title: "OpenAI — Codex App Server"
  - id: anthropic-subagents
    resource: "https://code.claude.com/docs/en/agent-sdk/subagents"
    title: "Anthropic — Subagents in the SDK"
  - id: anthropic-permissions
    resource: "https://code.claude.com/docs/en/agent-sdk/permissions"
    title: "Anthropic — Configure permissions"
  - id: anthropic-access
    resource: "https://code.claude.com/docs/en/agent-sdk/overview"
    title: "Anthropic — Agent SDK overview"
---

# Agent collaboration

## Purpose and authority

Virgilio is Ohtia's AI research guide, with a tutoring function distinct from a human supervisor. It helps the researcher understand the current investigation, examine alternatives and request bounded contributions from specialists. The researcher chooses direction, reviews proposals and decides what enters the manuscript. [Product principles](product-definition.md#product-principles) govern the collaboration: guidance under PRIN-001 and PRIN-003, authorship under PRIN-002, provenance and uncertainty under PRIN-004 through PRIN-010, and bounded useful work under PRIN-015 and PRIN-016.

Use coordinator-mediated collaboration among loosely coupled specialist agents as the architectural description. A specialist has a defined research responsibility, receives selected context and returns examinable artifacts through application-owned contracts. Virgilio can coordinate a particular intervention without becoming a permanent manager of the specialists. A specialist can question an assignment and disagree with another contribution. Neither role nor agreement grants authority to confirm knowledge, approve transfers or impersonate the researcher.

This document owns collaboration behavior, logical records and editorial proposals. [System architecture](architecture.md) owns execution and storage boundaries; [ADR-0011](adr/adr-0011-bounded-durable-local-tasks.md) owns task/attempt states, concurrency and recovery; [ADR-0012](adr/adr-0012-attempt-bound-process-capabilities.md) owns attempt authority; [ADR-0013](adr/adr-0013-private-content-free-structured-logging.md) owns diagnostics. [ADR-0037](adr/adr-0037-application-mediated-agent-collaboration.md) records the coordination choice. The [evaluation playbook](agent-collaboration-evaluation.md) defines the evidence required before enabling a collaboration policy.

## Entry points and research experience

Virgilio is the usual conversational entry point. The Navigator remains the project surface for stage, focus, artifacts and pending reviews; it can show stored guidance without running a model. Opening a project, restoring a conversation, browsing findings, changing a selection or viewing the Navigator does not authorize inference.

The researcher can start with a question, a source, selected sources or a manuscript passage. The action identifies its purpose, analysis language, input versions, destination and bounded work. Virgilio can answer directly when a specialist would add no useful capability, policy separation or critical perspective. Delegation is justified by the requested contribution, not by a need to activate the whole roster.

Specialists are directly accessible from the relevant source, manuscript or conversation. Show the active contributor and the requested review mode. Returning to Virgilio uses permitted project artifacts and selected conversation context; it does not automatically forward the entire specialist history or authorize another model call. The researcher can stop or redirect an intervention without managing a task board.

Progress describes research work: examining selected sources, checking an attribution, awaiting a researcher answer or comparing findings. Completed, partial, blocked, cancelled and uncertain work remain distinguishable through the canonical execution state. Show what was examined and the useful next action; opening details must not resume work. No agent schedules recurring research or starts unrequested corpus-wide processing.

## Identity and specialist contracts

[Ohtia and agent identity](agent-identity.md) distinguishes the female product character, Virgilio, specialist contributors and human supervisors. Its labels and visual presentation follow the actual contribution across layouts; Ohtia's mascot is not an additional inference agent.

A specialist definition identifies a stable role, versioned instructions, capabilities, permitted tools, supported operations and evaluation policy. A provider binding supplies an enabled adapter, access mode and effective model/runtime configuration. Definitions and bindings are distinct from an invocation, its durable task, an execution attempt and a provider-owned session. A role does not require its own process, subscription or model.

Changing a definition or binding does not rewrite earlier contributions. Preserve the producer actually observed, instruction/policy versions, input manifest and coverage. Unknown model identity or consumption remains unknown. A display name and claimed expertise do not demonstrate competence.

Every specialist receives the research question, requested contribution, relevant profile facts with attribution, approved immutable material and explicit limits. It returns findings with evidence anchors, examined scope, omissions, uncertainty, assumptions and suggested next questions. Additional material, another specialist or broader authority is a structured request to the application, never an instruction that grants itself permission.

### Reference librarian

Inputs include the question, current vocabulary, selected references and an agreed search purpose. Tools can query enabled search adapters and inspect permitted metadata/content. Outputs include proposed search strategies, actual queries and filters, candidate references, duplicate/version ambiguities, reasoned inclusion/exclusion suggestions and access limitations.

Separate a planned search from an executed search and metadata from examined text. Preserve per-provider provenance and coverage. The librarian cannot infer full-text access from a citation, merge records solely by title/DOI, silently change provider or describe an exploratory search as exhaustive. Readiness requires attributable discovery records and useful selection reasoning under the evaluation policy.

### Analytical reader

Inputs identify exact source contents and the question motivating the reading. Tools inspect permitted representations and locations. Outputs include attributed reading records covering the source's question, concepts, methods, results, limitations and relevant claims, with a concise summary when useful.

Distinguish the author's statements from extraction and agent interpretation. Report abstract-only work, unreadable passages and unsupported figures, tables or mathematics. A summary cannot stand in for examination of the underlying evidence. Readiness requires locatable attributions, faithful qualification and honest coverage.

### Critical evidence reviewer

Inputs identify the proposition, citation function or argument to examine and the original supporting material. Tools inspect approved evidence and compare versioned contributions. Outputs identify support, partial support, ambiguity, incompatibility under stated comparison conditions, unsupported inference and useful alternative explanations.

Missing access is not evidence of absence. Check populations, definitions, methods, dependencies and shared underlying data before treating results as comparable or independent. When independent criticism is requested, first examine the evidence without the earlier agent's verdict; any later exposure to that verdict is recorded. A different persona or model does not establish independence. Readiness requires justified objections and accurate recognition of adequate support, without a quota of criticisms.

### Academic editor

Inputs include an exact manuscript revision, selected passages, intended audience, research purpose and supplied institutional requirements. Tools inspect permitted text, structure and linked findings. Outputs are anchored observations, structural alternatives and concrete wording proposals when requested. Proposed text retains its producer and any evidence dependencies.

Explain how a proposal affects clarity, coherence or argument. Do not add unsupported evidence, strengthen conclusions beyond their grounds or invent institutional rules. Apply the [editorial review contract](#editorial-proposals-and-approval) for every proposed manuscript change. Readiness requires useful editorial reasoning, preservation of meaning where requested and explicit disclosure of substantive changes.

### Proofreader

Inputs identify an exact revision, passage, manuscript language and applicable supplied style requirements. Tools inspect that text and permitted terminology references. Outputs identify spelling, grammar, punctuation, terminology and formal-consistency problems with proposed corrections and reasons where needed.

Distinguish an error from a permissible language variant or stylistic preference. Preserve quotations, formulae, citations and disciplinary meaning. A correction that changes a claim is escalated as a substantive editorial proposal. Academic editing and proofreading may share a writing-review entry point while retaining distinct role definitions, output labels and evaluation criteria.

### Methodological guidance and analysis extension

Virgilio and the reader/reviewer provide bounded methodological guidance from the first useful experience. Distinguish established project requirements, researcher choices and suggestions. Examine whether the question, material, design and claimed conclusion fit, across quantitative, qualitative, documentary and theoretical work where capabilities permit.

Route a request needing sustained methodological specialization to a separately evaluated methodologist definition, or explain that the required capability is unavailable. Do not relabel a general agent as a qualified specialist without its operation contract and quality evidence. Guidance cannot certify ethics approval, institutional compliance or the validity of unexamined data.

A statistical/data-analysis specialist extends these contracts only after reproducible execution is separately defined: immutable data inputs, restrictions, transformations, analysis code and environment, parameters/seeds where relevant, output identities and actual execution coverage. The present collaboration boundary grants no arbitrary shell, SQL or code-execution tool. A proposed method is distinguishable from an executed analysis and from a validated interpretation.

## Consultation, delegation and handoff

A **consultation** obtains one bounded specialist contribution while the requesting contributor retains responsibility for its response. A **delegation** assigns an identified contribution with dependencies and an expected artifact. Both are application-mediated and may execute as separate turns. A **handoff** changes the active conversational contributor for an identified branch; the receiving specialist can ask the researcher questions and respond directly. It does not transfer unrestricted memory, credentials or the previous attempt's authority.

These distinctions are informed by OpenAI's documented separation between specialists called as bounded tools and handoffs that transfer conversational ownership. They describe Ohtia behavior without selecting the Agents SDK or assuming its semantics are available in every adapter.[^openai-orchestration]

The initial interface offers Virgilio, the reference librarian, analytical reader, critical reviewer and writing review. The latter exposes editorial and proofreading modes. A directly selected specialist can complete a request without routing its response through Virgilio. A specialist needing another contribution proposes its purpose and required material to the application; the application validates it against the intervention's approved envelope before creating work. Human authorization is needed when the request exceeds that envelope.

### Specialist selection and routing

Honor an explicit specialist or writing-review mode selected by the researcher. Validate that its operation is enabled for the requested language, inputs, destination and required controls before accepting execution. If it is unavailable or unsuitable, explain the reason and offer a named alternative; do not silently substitute another role, provider or model.

For an unassigned request, select the smallest role set needed for the requested output. A search strategy or reference-discovery request maps to the reference librarian; examination of source content maps to the analytical reader; checking an attribution or inferential step maps to the critical evidence reviewer; structure, coherence or proposed wording maps to the academic editor; spelling, grammar and formal consistency map to the proofreader. Virgilio retains guidance, clarification and synthesis. Methodological specialization follows the capability boundary above. A composite request can justify a contribution graph, but none of these mappings requires activating every specialist or adding a review round to a simple action.

Record the selection grounds, required capabilities and permitted definition/policy versions with the contribution. When purpose or requested output is ambiguous, ask a bounded clarification rather than selecting the most elaborate plan. If several enabled bindings are equally suitable, use the researcher's configured binding within the evaluated policy; an agent name, avatar or claimed confidence is not a quality ranking. A required unavailable role/capability is a stated limitation, not permission to broaden authority or pass the work to an unevaluated generic agent.

### Handoff ownership and redirection

A proposed handoff identifies its conversation branch, current and proposed response owner, target definition/operation, reason, selected context manifest and expected intervention/branch versions. It passes the same role, restriction, capability and aggregate-budget checks as other work. The application commits the owner change and its receipt atomically with accepted continuation intent. A rejection or an unresolved authorization request leaves the current response owner unchanged; show the proposed transfer as pending rather than claiming that the target already took over. Repeated or conflicting requests follow the graph's idempotency and version rules.

A handoff schedules a separate bounded contribution after any active sending turn has ended and released capacity safely. It cannot move an in-flight attempt, give the recipient the sender's capability or bypass an uncertain attempt's quarantine. Show the owner whose contribution is actually producing each response; a selector preview or unsatisfied handoff does not relabel existing messages. Returning to Virgilio changes the selected conversational owner through the same checks and starts inference only when a research action is authorized.

A researcher redirection records a new version of the intended question/plan. It may alter only unactivated intent within the accepted envelope. Already accepted tasks keep their immutable input manifests; superseded work is explicitly cancelled through ADR-0011 before its result can be represented as addressing the new request. New material, destinations, capabilities or work beyond the envelope require a newly authorized intervention linked to the previous one. A late result retains its original question and versions, even when it remains useful as historical material.

## Intervention and contribution records

An **intervention** is one researcher-authorized research action that can include several contributions. It is a durable coordination record, not a running task or an extra process. A single-agent action uses the same concept. Its logical identity is project-scoped and independent of provider threads. Physical tables and IPC encodings must preserve these contracts without exposing a generic database or message bus to agents.

The intervention retains:

- Identity, project, research purpose, analysis language and originating human command receipt.
- Immutable input/version manifest, selected context and current restriction references.
- Authorized role/operation set, destinations, policy versions and enforceable work envelope.
- A versioned contribution graph, current response owner, cancellation intent and expected coordination version.
- Contribution receipts, artifact dependencies, unresolved reasons and outcome coverage.
- Cumulative allocation/consumption records, remaining limits and the provenance of estimates or unknown values.

A **contribution** identifies a bounded question and expected output, target role/definition version, prerequisites, immutable input manifest and allocated work. It declares whether it is required for the requested coverage or optional; omission of that classification defaults to required. Every prerequisite names the committed artifact/output contract needed before activation. It links to its task/attempt receipts and accepted artifact versions. A later contribution uses earlier committed artifacts by identity; it does not read another agent's mutable working context. A completed contribution means its operation returned an accepted result, not that a researcher confirmed its meaning.

Graph changes use expected-version, idempotent application commands. A repeated command with identical payload returns its receipt; a conflicting reuse fails. Reject missing prerequisites, self-dependencies, cycles, destinations outside the envelope, unsupported capabilities and allocations beyond remaining limits before creating accepted child work. Reject duplicate equivalent contribution requests using a policy-versioned key containing purpose, role, input versions and output contract; an explicitly authorized independent review has a distinct declared purpose. Preserve historical graphs and the grounds for changed plans.

## Execution, events and bounds

### Releasing the coordinator turn

A Virgilio planning turn runs as an ordinary bounded inference task. Its terminal output can propose a graph change or a question for the researcher. The data service validates and commits that result and its coordination effects atomically. Eligible child tasks are accepted only when their immutable inputs and allocations are known; dependencies on future artifacts remain contribution intent until those artifacts exist. Activation rechecks current authorization and restrictions in the same transaction that accepts the child task. No provider or process starts before commit.

Once the coordinator task has validly completed and its local/provider execution has ended under ADR-0011, its capacity is released. Waiting for contributions is represented by the intervention and graph, not by an inference attempt holding a slot. The application later accepts a new, budgeted coordinator task with the exact completed artifact manifest when synthesis is useful and authorized. This is a new contribution turn, not a retry that resets the old task's attempt allowance.

This sequence must work with the application and connection concurrency limits set to one. Higher configured limits can admit independent eligible contributions through the same broker; the graph does not override saved limits, adapter limits or FIFO admission. An uncertain attempt retains its quarantine. Asking a researcher a tool-approval question during an active attempt continues to hold capacity under ADR-0011; before-dispatch research questions can instead wait as intervention intent without an active attempt.

```mermaid
flowchart LR
    A[Researcher-authorized intervention] --> B[Bounded Virgilio planning task]
    B --> C[Commit plan and finish execution]
    C --> D[Durable dependency wait without inference capacity]
    D --> E[Eligible specialist task]
    E --> F[Commit artifact and completion receipt]
    F --> G[Budgeted Virgilio synthesis task when useful]
    G --> H[Attributed results and human review]
```

### Durable delivery and continuation

Commit each accepted artifact, task completion receipt and resulting coordination event together in the trusted data service. Events carry project/intervention/contribution identity, a stable event ID, payload hash and monotonically increasing intervention sequence. Handle delivery at least once: the same event and payload returns the prior processing receipt; conflicting reuse fails. A late event cannot restore cancelled or replaced authority.

A continuation records the exact event set and graph version it consumes. The transaction claims that ready state, applies any new intent and stores its receipt, so repeated notifications cannot create duplicate synthesis or wake loops. With independent contributions still pending, use the declared policy to await the required set or provide a bounded partial response; do not create one synthesis turn for every progress message. Recover missed notifications by reading durable receipts and pending intent. Sequence gaps cause a scoped requery, never inference from an incomplete stream.

### Shared work envelope

Before enabling an intervention policy, supply positive finite limits for total contribution tasks, coordinator turns, delegation depth, graph nodes/edges, aggregate input/output/work units and total active execution duration. The policy also bounds pending contributions, event count/payload and retained context size. It supplies every per-operation field required by ADR-0011. Missing or invalid bounds leave that operation unavailable. Exact values are operation/language evaluation inputs, not universal research quotas.

Reserve an allocation transactionally before accepting each task, counting parallel reservations and all layers' retries. Actual usage and proven unused capacity settle against the same intervention ledger; interrupted or uncertain dispatch does not return a guessed unused allocation. Bound coordinator planning, specialists, independent review and synthesis together. A new task, provider session, restart or handoff cannot reset cumulative limits. Exhaustion returns the available artifacts and a clear limitation or requests a separately authorized intervention linked to the earlier one.

Distinguish enforceable limits on tasks, inputs and tools from estimated token/money consumption. Unknown provider usage is never zero. A provider configuration unable to enforce a required bound makes that operation unavailable; the user may choose a separately described policy with different guarantees, not a silent weakening. Usage receipts remain governed by ADR-0029 and cannot revive research-write authority.

### Completion, cancellation and recovery

An intervention reports complete requested coverage only when every required contribution has an accepted terminal result, all required coordination has finished and no delegated execution remains unresolved. A required contribution's output contract defines adequate coverage; a valid result containing an inaccessible or unreadable required input does not satisfy that coverage merely because its task completed. Preserve both the terminal execution receipt and the research limitation. Agent consensus never supplies human confirmation.

A failed, cancelled or insufficient prerequisite prevents activation of dependents requiring its artifact. Retain the dependency and reason; do not accept an empty substitute, invent evidence, rerun the producer outside its retry budget or silently remove the dependent. Independent branches may continue within the existing authorization and allocations. An optional contribution is still a mandatory prerequisite for any descendant that explicitly depends on its output; the optional label cannot bypass that edge.

Required coverage is fixed by the accepted request and cannot be downgraded by agent output to make the intervention complete. A failed/omitted optional contribution is disclosed and does not reduce required coverage when no required descendant depends on it. Once admitted work is reconciled and no authorized work remains, return a complete result when required coverage is satisfied, a partial result with exact omissions when useful artifacts exist but it is not, or a failure with reasons when no usable requested result exists. A research-level partial result is not a new task state; it composes the canonical task receipts and artifact coverage. Unresolved local/provider execution remains explicitly uncertain even if a partial report is available, and a known prerequisite block stays blocked until the researcher changes scope or an admissible prerequisite is established.

Synthesis can explain a limitation without claiming missing evidence. A required comparison cannot become a complete review simply because a synthesis turn summarized the sources that happened to be accessible. Waiving required material or selecting replacement inputs is a researcher decision recorded through a newly accepted scope; it neither rewrites the original intervention's coverage nor reopens a terminal task.

Cancellation records intervention intent and revokes future activation before stopping accepted tasks through ADR-0011. Queued work is cancelled without launch; running work follows its cessation/uncertainty rules. Completion and cancellation serialize with expected-version commands. If completion committed first, return its receipt; if cancellation won, later research effects are denied. Already committed partial artifacts retain their actual coverage and historical provenance.

A contributor finishing does not prove its delegated work ended. Hidden runtime subagents are disabled unless the adapter can prove their identity, scope, capacity/budget inclusion and terminal/cancellation evidence through these same controls. Otherwise the capability is unavailable. Do not combine application orchestration with an untracked second orchestration layer.

Application exit and startup use ADR-0011. On restart, recover the intervention ledger, event receipts and task outcomes before admitting work. Reconcile possible child dispatch before any replacement. Accepted not-started tasks remain paused; unactivated contribution intents are also held for explicit continuation. Reopening a project, receiving a notification or reconnecting a provider does not clear restart/cancellation holds. Late results retain their old inputs and may not publish through revoked authority; bounded usage settlement remains separate.

## Context, memory and disagreement

Context assembly selects exact permitted versions of the question, profile, decisions, source passages and needed artifacts. Record what was supplied and omitted for size, permissions or capability. A role cannot read another project or all library sources merely because its name is persistent. A summary of restricted material inherits relevant restrictions. Moving between providers rechecks the destination for every selected input and derived artifact.

Durable project memory is an inspectable projection of attributed research records: researcher statements and decisions, unresolved hypotheses, agent proposals, examined evidence and human review events. A condensed memory entry identifies its inputs and producer and can be corrected or withdrawn through project commands. Correction preserves history and marks dependent work for review. Summarization cannot turn a proposal into a researcher decision or turn an attributed statement into established fact.

Provider sessions and caches are execution aids, not the memory authority. Reuse/resume requires compatible inputs, definition/policy, current restrictions and effective configuration; a fresh context is required when those cannot be established. Inspection and editing of stored memory do not run inference. Retention/deletion commands check evidence dependencies and expose provider retention limits rather than promising remote erasure.

When contributions disagree, preserve each attributed proposition, evidence, scope and comparison conditions. Virgilio explains the point of disagreement and can propose a bounded follow-up. It does not take a majority vote, manufacture consensus or resolve an evidential question by choosing the most confident model. The researcher can leave the matter unresolved. Independent review declares what earlier outputs were withheld and later disclosed; it does not claim statistical independence from model identity.

## Editorial proposals and approval

An editorial proposal is a versioned artifact identifying manuscript/revision, target blocks/ranges, original text/hash, proposed replacement or structural change, rationale, operation/producer and supporting evidence dependencies. The format uses the validated manuscript model; raw provider markup or executable instructions are not editor commands. A substantive change is labelled so that accepting grammar corrections cannot silently strengthen a conclusion.

The interface shows the original and proposed wording, rationale and provenance. The researcher can edit the proposal, choose explicit changes or reject it. Editing creates a new proposal version; approval is bound to exactly the version displayed. A generic acceptance of a chat response, closing a panel or an agent tool call cannot approve manuscript changes.

A dedicated human command validates proposal version, expected current manuscript revision, target content and format invariants. In one transaction it records the approval, creates the resulting immutable manuscript revision, advances the current pointer and records which proposal changes were applied. Preserve agent text provenance and the researcher's approval separately; acceptance does not relabel the agent as a human author. An idempotent replay returns the same receipt and revision. Failure leaves the previous manuscript authoritative.

If the manuscript changed, reject application with a conflict. Offer explicit reconciliation into a new proposal against the current revision; even a confident block mapping cannot transfer the old approval. Partial acceptance records the exact accepted subset. Restoring or undoing manuscript content does not erase proposal or approval history. Approving wording does not confirm citations, evidence, methodological adequacy or institutional AI-use compliance; those retain their own review scope.

## Provider conformance

The [implementation-reference analysis](agent-coordination-references.md) distinguishes inspected third-party mechanisms from Ohtia design inferences and records the code-reuse boundary.

OpenAI's Codex app-server documents thread/turn lifecycle and interruption operations. These are integration surfaces to assess against Ohtia's adapter contract, not evidence that Ohtia has established descendant containment, per-transfer interception or cancellation of every external effect.[^codex-app-server]

Anthropic documents separate subagent contexts, explicit tool selection and runtime-dependent inheritance/limits. Its permissions controls require evaluation alongside OS/network containment; a tool allowlist alone does not establish the whole Ohtia boundary.[^anthropic-subagents][^anthropic-permissions] Its Agent SDK overview requires prior approval for offering claude.ai login or rate limits in third-party products, so Ohtia must establish its permitted access route rather than infer eligibility from a local login.[^anthropic-access]

For each enabled adapter/runtime/access-mode/platform combination, verify scoped inputs and tools, inherited configuration, delegation controls, event/terminal semantics, interruption, recovery, account eligibility and complete/partial/unknown usage. Keep provider-owned orchestration disabled when it bypasses the application contract. Do not promise feature parity, select a framework solely from its pattern names or expose cloud-managed execution as a local desktop guarantee.

[^openai-orchestration]: OpenAI distinguishes bounded specialist calls from transfers of conversational ownership.

[^codex-app-server]: The app-server API exposes thread and turn operations; Ohtia still establishes its own lifecycle and authority invariants.

[^anthropic-subagents]: Anthropic's subagent documentation describes context, tool inheritance and version-dependent controls, which require adapter-specific verification.

[^anthropic-permissions]: The SDK permission surface informs tool control without proving OS-level confinement.

[^anthropic-access]: Anthropic's stated integration access conditions are separate from technical availability and require current verification for the selected route.
