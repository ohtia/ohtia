---
type: Analysis
title: "Agent coordination implementation references"
description: "Source-backed lessons from provider documentation, Paperclip, and Multica for Ohtia's agent collaboration boundary."
verified:
  by: human:AdrianMastronardi
sources:
  - id: paperclip-budget
    resource: "https://github.com/paperclipai/paperclip/blob/ec2e0d64079e6ba127401098eaadfd4ba6eb3074/server/src/services/budget-reservations.ts"
    title: "Paperclip — Budget reservations"
  - id: paperclip-events
    resource: "https://github.com/paperclipai/paperclip/blob/ec2e0d64079e6ba127401098eaadfd4ba6eb3074/server/src/services/heartbeat-run-events.ts"
    title: "Paperclip — Heartbeat run events"
  - id: paperclip-wakes
    resource: "https://github.com/paperclipai/paperclip/blob/ec2e0d64079e6ba127401098eaadfd4ba6eb3074/server/src/services/issue-dependency-wakeups.ts"
    title: "Paperclip — Dependency wakeup controls"
  - id: multica-claims
    resource: "https://github.com/multica-ai/multica/blob/dbdbb299164347586e2650bb67684a490726a798/server/pkg/db/queries/agent.sql"
    title: "Multica — Agent task queries"
  - id: multica-squads
    resource: "https://github.com/multica-ai/multica/blob/dbdbb299164347586e2650bb67684a490726a798/server/internal/handler/squad_briefing.go"
    title: "Multica — Squad leader briefing"
  - id: multica-native-agents
    resource: "https://github.com/multica-ai/multica/blob/dbdbb299164347586e2650bb67684a490726a798/server/internal/daemon/execenv/codex_multi_agent.go"
    title: "Multica — Managed Codex subagent configuration"
  - id: multica-license
    resource: "https://github.com/multica-ai/multica/blob/dbdbb299164347586e2650bb67684a490726a798/LICENSE"
    title: "Multica License"
  - id: duolingo-characters
    resource: "https://blog.duolingo.com/building-character/"
    title: "Duolingo — Building a shared character world"
  - id: duolingo-lily
    resource: "https://blog.duolingo.com/video-call/"
    title: "Duolingo — Video Call with Lily"
  - id: paperclip-personas
    resource: "https://paperclip.ing/changelog/v2026.1001.0/"
    title: "Paperclip — October 1, 2026 release"
  - id: multica-identity
    resource: "https://multica.ai/docs/agents"
    title: "Multica — Agents, identity and runtime configuration"
  - id: notion-agent-identity
    resource: "https://www.notion.com/help/guides/get-started-with-your-personal-agent-in-notion"
    title: "Notion — Personal agent entry point and customization"
  - id: human-ai-guidelines
    resource: "https://www.microsoft.com/en-us/research/blog/guidelines-for-human-ai-interaction-design/"
    title: "Microsoft Research — Guidelines for human–AI interaction design"
---

# Agent coordination implementation references

## Scope and evidence

This analysis uses static inspection of the cited source revisions and the provider documentation examined in [Agent collaboration](agent-collaboration.md#provider-conformance). No Paperclip or Multica deployment was executed or audited end to end. An implementation mechanism or explanatory code comment supports a design lesson, not a claim that all runtime paths satisfy the intended guarantee.

Provider documentation establishes the stated integration surface and conditions; adapter conformance must establish what Ohtia can enforce. Third-party source illustrates mechanisms and failure handling. The [collaboration specification](agent-collaboration.md) owns Ohtia behavior and the [evaluation playbook](agent-collaboration-evaluation.md) owns its verification.

## Paperclip mechanisms

### Budget admission

The budget-reservation implementation reserves against pending execution and rechecks the reservation, current policy and agent readiness before provider work. Its explanation distinguishes estimates that constrain admission from a cap on the provider's eventual bill.[^paperclip-budget]

For Ohtia, retain transactional allocation and pre-dispatch validation across the whole intervention, with separate measured, estimated and unknown usage. The application owns this policy; an agent's prompt cannot enforce it. Do not import company accounting or promise an enforceable monetary cap for an opaque runtime.

### Durable and duplicate-aware events

The event implementation allocates run sequences through the database and includes duplicate/conflict handling for identified native events. It binds events to run, agent and company identity.[^paperclip-events]

The applicable lesson is explicit event identity, ordering and replay semantics. Ohtia's intervention events must instead use its project/attempt authority, SQLite transaction boundary and private research records. Adopting a mechanism concept does not establish that PostgreSQL-specific queries can be carried over.

### Reactivation loops

The dependency-wakeup code contains a guard against immediately waking an assignee that has just declared its own issue blocked. Its comments describe a repeated wake/block loop and its ready-state deduplication distinguishes delivery from current dependency readiness.[^paperclip-wakes]

Ohtia should wake coordination from a durable, versioned ready state, not from every progress message or repeated declaration of a blocker. A question awaiting a researcher response is not proof that another reasoning turn will make progress. This is a regression lesson visible in the source, not an independently reproduced incident.

## Multica mechanisms

### Ownership and claiming

The task query implements claiming through an update and a selected row with `FOR UPDATE SKIP LOCKED`; its conditions serialize work for an issue/agent pair while permitting other agents to contribute.[^multica-claims]

Ohtia needs an application-enforced claim and duplicate command receipts rather than a prompt instruction to avoid duplicate work. Its trusted writer must provide the equivalent invariant using the selected SQLite mechanism. A task claim alone does not protect shared manuscript content; expected-version human commands remain necessary.

### Coordinator role

The squad briefing directs a leader to choose members, delegate through recognized mentions and record its evaluation. It explicitly instructs the leader not to perform the assigned work itself.[^multica-squads]

This is evidence of a concrete coordinator protocol, not a wholly horizontal collaboration model. Ohtia retains explicit selection, bounded requests and recorded grounds, while allowing Virgilio to answer directly and specialists to interact with the researcher. A comment mention is not Ohtia's authority or dispatch contract.

### Nested runtime delegation

The managed Codex configuration disables native multi-agent behavior by default, with an explicit opt-in override. Its rationale explains that tracking only the parent thread could mark work terminal before children finished.[^multica-native-agents]

Ohtia must account for every authorized execution descendant before reporting complete or cancelled work. Either application-owned contribution tasks provide that accounting or a conformant adapter demonstrates equivalent controls. A parent's final message, a stream ending or a process exit does not by itself prove every delegated effect ceased.

### Reuse boundary

The inspected Multica license combines Apache License 2.0 text with additional conditions governing hosted services, commercial embedding, branding and attribution. It must be assessed as that complete license rather than assumed to be unmodified Apache License 2.0.[^multica-license]

This task adopts no third-party code or assets. Any later dependency proposal needs its own license and integration review. Source availability makes implementation study possible; it is not by itself authorization to redistribute a component under Ohtia's repository license.

## Visual identity and contributor recognition

These references were examined through official documentation and public material, without authenticated application testing. Their identity mechanisms inform alternatives; they do not establish that more characters improve academic reasoning or that every documented behavior was reproduced.

### Product mascot and functional characters

Duolingo describes a character family built to complement Duo through a common visual language, and identifies Lily as the character in its AI conversation feature.[^duolingo-characters][^duolingo-lily] This illustrates the feasibility of distinguishing a product mascot from a functional conversational character. Ohtia's research use still needs its own evaluation; engagement incentives and emotional reactions cannot substitute for evidence or researcher judgment.

### Static identities and focal animation

Paperclip's October 1, 2026 release describes static agent persona images across ordinary application surfaces, with focal animation in an agent header and onboarding and explicit reduced-motion/touch fallbacks.[^paperclip-personas] The transferable idea is stable contributor recognition with restrained animation. Ohtia does not adopt pointer-following behavior, simultaneous animated agents or expressions that certify findings.

### Stable agent identity

Multica separates an agent's name/avatar/description from instructions and runtime/model configuration, and states that switching models does not create a new agent.[^multica-identity] Ohtia likewise keeps contributor identity legible across adapter changes while preserving the actual configuration behind each contribution. Visual continuity does not erase changed capabilities or establish specialist competence.

Notion documents a circular face as an entry to its personal agent and provides agent customization.[^notion-agent-identity] The Ohtia design inference is that a recurrent character at the conversational entry point can be understood as the principal assistant. Giving that position to both Ohtia and Virgilio risks ambiguity unless the interface distinguishes product presence from the active contributor.

### Attention and identity decision

Microsoft's human–AI interaction guidance addresses timing assistance in context, efficient dismissal and making capabilities and limitations understandable.[^human-ai-guidelines] Ohtia's proposed controls follow those concerns without claiming that the guidance validates a particular mascot or avatar design.

[Ohtia and agent identity](agent-identity.md) selects the product-character-plus-named-contributors approach. Alternatives are making the existing character the single named guide, or presenting every specialist as a mode of one visible character. The selected approach preserves the female researcher and makes contributions attributable, at the cost of additional recognition work. Functional labels, shared visual language, static specialist avatars and explicit human/AI provenance are therefore evaluated before expanding the illustrated cast.

## Architectural inference

The evidence supports separating specialist research responsibility from execution ownership, and keeping budgets, event handling, cancellation and project authority in the application. It does not establish that a particular framework, model combination or number of specialists improves academic quality. That benefit remains a comparison against the single-agent baseline under declared evaluation conditions.

A central coordinator can work with narrowly defined specialist contracts without requiring a virtual organization. Ohtia's initial design combines bounded consultation and explicit conversational handoffs, while keeping research results and disagreement in versioned artifacts. Event delivery is an internal mechanism and does not require decentralized choreography, a user-managed task board or recurring inference.

[^paperclip-budget]: Static inspection of reservation, admission recheck and the implementation's billing-limit explanation.

[^paperclip-events]: Static inspection of sequence allocation and identified-event replay/conflict handling.

[^paperclip-wakes]: Static inspection of the self-block guard and ready-state deduplication rationale.

[^multica-claims]: Static inspection of `ClaimAgentTask` and its issue/agent serialization conditions.

[^multica-squads]: Static inspection of the leader protocol embedded in the squad briefing.

[^multica-native-agents]: Static inspection of the default configuration override and its documented lifecycle rationale.

[^multica-license]: Review of the complete license's additional conditions; no license compatibility or legal clearance is asserted.

[^duolingo-characters]: Review of Duolingo's explanation of a character family sharing its mascot's visual language.

[^duolingo-lily]: Review of the officially identified conversational character, not a claim of tested learning effectiveness.

[^paperclip-personas]: Review of the release's declared static persona surfaces, focal animation and accessibility fallbacks.

[^multica-identity]: Review of the documented separation between agent identity and model/runtime settings.

[^notion-agent-identity]: Review of the documented personal-agent entry point and customization, without authenticated UI testing.

[^human-ai-guidelines]: Microsoft's published guidance informs context, dismissal and intelligibility; it is not a completed Ohtia usability assessment.
