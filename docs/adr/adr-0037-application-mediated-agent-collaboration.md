---
type: DecisionRecord
title: "ADR-0037 — Application-mediated collaboration among specialist agents"
description: "Coordinate bounded specialist contributions through durable application records while preserving direct interaction and human authority."
verified:
  by: human:AdrianMastronardi
---

# ADR-0037 — Application-mediated collaboration among specialist agents

## Context

A research tutor needs specialist help without turning the researcher into a manager of an autonomous organization. Independent contexts can support focused reading and criticism, but unconstrained agent messages or nested runtime delegation obscure inputs, cost, cancellation and completion. A coordinator waiting inside the only available inference slot can prevent its own specialist from running.

Alternatives are a single agent with dynamically loaded skills, a fixed pipeline, runtime-owned nested subagents, peer choreography without an explicit coordinator, or application-mediated contribution records. The evaluation must compare the selected collaboration with a capable single-agent baseline; separate personas alone do not establish a benefit.

## Decision

Use [coordinator-mediated collaboration among loosely coupled specialists](../agents/agent-collaboration.md). Virgilio provides tutoring and can answer directly, consult specialists or propose bounded delegation. The researcher can interact directly with a specialist. A role identifies research responsibility rather than a permanent reporting relationship, provider account or process. [Product and agent identity](../agents/agent-identity.md) keeps Ohtia's female character, named AI contributors and human supervisors distinguishable without granting authority through appearance.

Persist intervention authorization, versioned contribution intent, immutable inputs, budget allocations, artifact dependencies and event/command receipts in the trusted application boundary. Model output proposes coordination; application rules validate and accept it. Specialists exchange versioned artifacts rather than sharing an unrestricted working context. Keep human editorial approval and evidence confirmation outside agent authority.

Run planning, specialist work and synthesis as separately bounded tasks under ADR-0011. Persist dependency waits outside active inference attempts and activate a continuation only after the coordinator's execution authority has ended and its capacity is safely released. Deduplicate durable ready states and enforce aggregate budgets across turns, attempts and delegation. Higher configured concurrency uses the same application/adapter admission rules; it is not required for collaboration to work.

Disable provider-native delegation unless the adapter can demonstrate equivalent scope, lifecycle, budget and cancellation accounting. Keep execution bookkeeping behind the research interface; collaboration does not require a virtual-company hierarchy, user-managed agent task board or scheduled autonomous work.

## Consequences

The application can explain who examined which material, preserve disagreement and recover work without treating a parent response as proof that all delegated execution ended. Specialist and provider replacement can preserve durable project authority. Serialized execution remains useful under the default concurrency of one.

Coordination adds records, context assembly, validation, latency and review burden. Event delivery must tolerate duplication and crashes, and uncertain provider work can hold capacity. The [evaluation playbook](../agents/agent-collaboration-evaluation.md) covers these contracts and compares their cost with a single-agent alternative. Revisit the choice if measured research benefit does not justify the complexity or if a runtime's conformance guarantees change.
