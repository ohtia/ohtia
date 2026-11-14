---
type: DecisionRecord
title: "ADR-0053 — Researcher-approved specialist collaboration"
description: "Coordinate bounded specialist contributions through durable application records, with planning inside direct guidance and explicit researcher approval."
generated:
  by: codex/gpt-6.1-sol
verified:
  by: human:AdrianMastronardi
---

# ADR-0053 — Researcher-approved specialist collaboration

Supersedes [ADR-0037 — Application-mediated collaboration among specialist agents](adr-0037-application-mediated-agent-collaboration.md). This record owns specialist coordination; [ADR-0051](adr-0051-research-agent-task-execution.md) owns task execution and [ADR-0052](adr-0052-current-provider-dispatch-authorization.md) owns provider-transfer authorization.

## Context

A research tutor needs specialist help without turning the researcher into a manager of an autonomous organization. Independent contexts can support focused reading and criticism, but unconstrained agent messages or nested runtime delegation obscure inputs, cost, cancellation and completion. A coordinator waiting inside the only available inference slot can prevent its own specialist from running.

Alternatives are a single agent with dynamically loaded skills, a fixed pipeline, runtime-owned nested subagents, peer choreography without an explicit coordinator, or application-mediated contribution records. Ohtia preserves researcher authorship (PRIN-002), provenance (PRIN-004) and honest coverage (PRIN-006) through application-validated scope and explicit researcher approval. It does not grade the models researchers connect or compare collaboration with a single-agent baseline. The choice rests on bounded authority, attribution and human control; separate personas alone are not evidence of research benefit.

## Decision

Use [coordinator-mediated collaboration among loosely coupled specialists](../agents/agent-collaboration.md). Virgilio provides tutoring and can answer directly, consult specialists or propose bounded delegation. The researcher can interact directly with a specialist. A role identifies research responsibility rather than a permanent reporting relationship, provider account or process. [Product and agent identity](../agents/agent-identity.md) keeps Ohtia's female character, named AI contributors and human supervisors distinguishable without granting authority through appearance.

Persist intervention authorization, versioned contribution intent, immutable inputs, budget allocations, artifact dependencies and event/command receipts in the trusted application boundary. Model output proposes coordination; application rules validate and accept it. Specialists exchange versioned artifacts rather than sharing an unrestricted working context. Keep human editorial approval and evidence confirmation outside agent authority.

A consultation requires the researcher to accept its concrete contribution request. A plan requires approval of its concrete versioned graph before specialist work runs; that approval permits its already accepted nodes to activate as their dependencies become ready without another prompt. New consultations and changes adding or replacing plan work require their own researcher decision. A specialist may propose further work but cannot grant that approval or create unapproved work merely by calling it within an envelope.

Planning happens inside the coordinator's direct-guidance turn. The researcher approves the concrete plan before specialist work runs. Specialist contributions and synthesis execute as separately bounded tasks under [ADR-0051](adr-0051-research-agent-task-execution.md). Persist dependency waits outside active inference attempts and activate a continuation only after the coordinator's execution authority has ended and its capacity is safely released. Deduplicate durable ready states and enforce aggregate budgets across turns, attempts and delegation. Higher configured concurrency uses the same application/adapter admission rules; it is not required for collaboration to work.

Disable provider-native delegation unless the adapter can demonstrate equivalent scope, lifecycle, budget and cancellation accounting. Keep execution bookkeeping behind the research interface; collaboration does not require a virtual-company hierarchy, user-managed agent task board or scheduled autonomous work.

## Consequences

The application can explain who examined which material, preserve disagreement and recover work without treating a parent response as proof that all delegated execution ended. Specialist and provider replacement can preserve durable project authority. Serialized execution remains correct when the researcher sets inference concurrency to one. Coordinators never retain a slot while waiting for a specialist that needs it.

Coordination adds records, context assembly, validation, latency and review burden. Event delivery must tolerate duplication and crashes, and adapters requiring separate cessation evidence can retain uncertain capacity. Verify scope, attribution, cancellation, provenance, durable dependency delivery and aggregate budgets independently of an optional research-quality review. Revisit the choice if those guarantees cannot be maintained or a runtime's conformance guarantees change. The benefit of coordination over a single agent is not measured; optional quality review establishes no model grade or enablement gate. The [collaboration contract](../agents/agent-collaboration.md) owns the contribution and approval records, and its verification scenarios must respect these decision boundaries.
